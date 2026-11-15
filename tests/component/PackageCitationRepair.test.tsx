import "fake-indexeddb/auto";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PDFDocument } from "pdf-lib";
import { PackageCitationRepair } from "@/components/PackageCitationRepair";
import { createBlankSession } from "@/stores/documentStore";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { capturePackageMember, captureOriginalPackageMember } from "@/lib/actionPackageAssets";
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, type ActionPackage } from "@/lib/actionPackages";
import { initializePackageCitationTargets, linkPackageCitation, packageCitationOccurrences } from "@/lib/packageCitations";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";

const policy = resolveExportDeploymentPolicy({ hostname: "localhost", environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] }, runtime: { status: "absent" } });
vi.mock("@/config/classification", async original => ({ ...await original<typeof import("@/config/classification")>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
vi.mock("@/stores/backupStore", () => ({ scheduleBackup: vi.fn() }));
vi.mock("@/lib/pdfText", () => ({ extractPdfText: async () => "Synthetic original" }));
async function fixture() {
  const session = createBlankSession(); session.documentMode = "custom";
  session.paragraphs = [{ id: "repair-component-body", text: "Use enclosure (1).", level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: "repair-component-source", epoch: 0, editSequence: 1, capturedAt: 1 }, { ...session, endItems: [], publicationTables: {} }), "Repair component letter", "basic-letter");
  const pdf = await PDFDocument.create(); pdf.addPage();
  const first = await captureOriginalPackageMember({ name: "first.pdf", data: new Uint8Array(await pdf.save()).buffer }, "enclosure", true);
  const second = { ...first, id: "component-second", revisionId: "component-second-revision", label: "Second attachment" };
  const third = { ...first, id: "component-third", revisionId: "component-third-revision", label: "Third attachment" };
  let record = await initializePackageCitationTargets(await reviseActionPackage(await createActionPackage("Component repairs"), [native, first, second, third]));
  const source = (await packageCitationOccurrences(getPackageRevision(record)))[0];
  const target = getPackageRevision(record).citations!.targets.find(value => value.memberId === first.id)!;
  record = await linkPackageCitation(record, source.source, target.id);
  return reviseActionPackage(record, getPackageRevision(record).members.filter(value => value.id !== first.id));
}
function Harness({ initial }: { initial: ActionPackage }) {
  const [record, setRecord] = useState(initial), [error, setError] = useState("");
  const revision = getPackageRevision(record);
  return <><PackageCitationRepair key={revision.id} record={record} revision={revision} editable onChange={action => { void action().then(setRecord).catch(cause => setError(cause.message)); }} />{error && <p role="alert">{error}</p>}</>;
}

it("requires a reviewed exact occurrence and target before saving a new repaired revision", async () => {
  const record = await fixture(), user = userEvent.setup();
  const view = render(<Harness initial={record} />);
  await screen.findByText(/1 linked citations need repair/);
  await user.selectOptions(screen.getByLabelText("Link to repair"), getPackageRevision(record).citations!.links[0].id);
  await user.selectOptions(screen.getByLabelText("Current citation occurrence"), "0");
  await user.selectOptions(screen.getByLabelText("Replacement citation target"), within(screen.getByLabelText("Replacement citation target")).getByRole("option", { name: "Third attachment · package enclosure (2)" }));
  await user.click(screen.getByRole("button", { name: "Review citation repair" }));
  const preview = await screen.findByRole("region", { name: "Citation repair preview" });
  expect(preview.textContent).toContain("label 1 → 2");
  expect(screen.getByRole("button", { name: "Save reviewed citation repair" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /^I reviewed the occurrence/ }));
  await user.click(screen.getByRole("button", { name: "Save reviewed citation repair" }));
  await screen.findByText(/0 linked citations need repair/);
  const saved = (await listActionPackages()).find(value => value.id === record.id)!;
  expect(saved.revisions.slice(0, -1)).toEqual(record.revisions);
  const member = getPackageRevision(saved).members[0];
  expect(member.kind === "native" && member.session.paragraphs[0].text).toBe("Use enclosure (2).");
  view.unmount();
  render(<PackageCitationRepair record={saved} revision={getPackageRevision(saved)} editable={false} onChange={vi.fn()} />);
  await screen.findByText(/0 linked citations need repair/);
  expect(screen.queryByLabelText("Link to repair")).toBeNull();
});

it("requires explicit literal-text acknowledgement to discard a broken link and cancellation saves nothing", async () => {
  const record = await fixture(), user = userEvent.setup();
  render(<Harness initial={record} />);
  await screen.findByText(/1 linked citations need repair/);
  await user.selectOptions(screen.getByLabelText("Link to repair"), getPackageRevision(record).citations!.links[0].id);
  await user.click(screen.getByRole("button", { name: "Review discarding link" }));
  await screen.findByRole("region", { name: "Citation repair preview" });
  expect(screen.getByRole("button", { name: "Save reviewed citation repair" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Cancel repair" }));
  expect((await listActionPackages()).find(value => value.id === record.id)).toEqual(record);
  await user.click(screen.getByRole("button", { name: "Review discarding link" }));
  await screen.findByRole("checkbox", { name: /text remains literal/ });
  await user.click(screen.getByRole("checkbox", { name: /text remains literal/ }));
  await user.click(screen.getByRole("button", { name: "Save reviewed citation repair" }));
  await screen.findByText(/0 linked citations need repair/);
  await waitFor(async () => {
    const saved = (await listActionPackages()).find(value => value.id === record.id)!;
    expect(getPackageRevision(saved).members).toEqual(getPackageRevision(record).members);
  });
});
