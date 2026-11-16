import "fake-indexeddb/auto";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PackageCitationReorder } from "@/components/PackageCitationReorder";
import { createBlankSession } from "@/stores/documentStore";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { capturePackageMember } from "@/lib/actionPackageAssets";
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, type ActionPackage } from "@/lib/actionPackages";
import { initializePackageCitationTargets, linkPackageCitation, packageCitationOccurrences } from "@/lib/packageCitations";
import { preparePackageCitationReorder, type PreparedPackageCitationReorder } from "@/lib/packageCitationReorder";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";

const policy = resolveExportDeploymentPolicy({ hostname: "localhost", environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] }, runtime: { status: "absent" } });
vi.mock("@/stores/backupStore", () => ({ scheduleBackup: vi.fn() }));
vi.mock("@/config/classification", async importOriginal => ({
  ...await importOriginal<typeof import("@/config/classification")>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy,
}));
beforeEach(() => { vi.restoreAllMocks(); });

async function fixture() {
  const source = createBlankSession();
  source.references = [{ letter: "a", title: "Alpha source" }, { letter: "b", title: "Beta source" }];
  source.paragraphs = [{ id: "component-reorder-body", text: "Use reference (a).", level: 0 }];
  source.enclosures = [{ title: "First enclosure" }, { title: "Second enclosure" }];
  const member = await capturePackageMember(captureDocumentRevision({ documentId: "component-reorder-source", epoch: 0, editSequence: 1, capturedAt: 1 }, { ...source, endItems: [], publicationTables: {} }), "Training letter", "basic-letter");
  const identified = await initializePackageCitationTargets(await reviseActionPackage(await createActionPackage("Component reorder"), [member]));
  const occurrence = (await packageCitationOccurrences(getPackageRevision(identified)))[0];
  const target = getPackageRevision(identified).citations!.targets.find(value => value.kind === "reference" && value.index === 0)!;
  return { member, record: await linkPackageCitation(identified, occurrence.source, target.id) };
}
function Harness({ initial }: { initial: ActionPackage }) {
  const [record, setRecord] = useState(initial), [prepared, setPrepared] = useState<PreparedPackageCitationReorder | null>(null), [error, setError] = useState("");
  const revision = getPackageRevision(record);
  return <><PackageCitationReorder key={revision.id} record={record} revision={revision} editable prepared={prepared}
    onPrepare={operation => { void preparePackageCitationReorder(record, operation, policy).then(setPrepared).catch(error => setError(error.message)); }} onDiscard={() => setPrepared(null)}
    onChange={action => { void action().then(record => { setRecord(record); setPrepared(null); }).catch(error => setError(error.message)); }} />{error && <p role="alert">{error}</p>}</>;
}

it("requires a before/after review and explicit approval before publishing a native list reorder", async () => {
  const { record } = await fixture(), user = userEvent.setup();
  render(<Harness initial={record} />);
  await user.click(screen.getByRole("button", { name: "Move list item 2 up" }));
  await user.click(screen.getByRole("button", { name: "Review native list reorder" }));
  const review = await screen.findByRole("region", { name: "Citation reorder review" });
  expect(review.textContent).toContain("Before: Use reference (a).");
  expect(review.textContent).toContain("After: Use reference (b).");
  expect((screen.getByRole("button", { name: "Save reviewed citation reorder" }) as HTMLButtonElement).disabled).toBe(true);
  expect((await listActionPackages()).find(value => value.id === record.id)?.sequence).toBe(record.sequence);
  await user.click(within(review).getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Save reviewed citation reorder" }));
  await waitFor(async () => expect((await listActionPackages()).find(value => value.id === record.id)?.sequence).toBe(record.sequence + 1));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Citation reorder review" })).toBeNull());
  const changed = (await listActionPackages()).find(value => value.id === record.id)!;
  const member = getPackageRevision(changed).members[0];
  if (member.kind !== "native") throw new Error("Expected native");
  expect(member.session.paragraphs[0].text).toBe("Use reference (b).");
  expect(changed.revisions.slice(0, -1)).toEqual(record.revisions);
});

it("cancels a plan without writes and does not reuse approval for a newly prepared order", async () => {
  const { record, member } = await fixture(), user = userEvent.setup();
  const first = await preparePackageCitationReorder(record, { kind: "references", memberId: member.id, order: [1, 0] }, policy);
  const second = await preparePackageCitationReorder(record, { kind: "enclosures", memberId: member.id, order: [1, 0] }, policy);
  const discard = vi.fn(), onChange = vi.fn();
  const props = { record, revision: getPackageRevision(record), editable: true, onPrepare: vi.fn(), onDiscard: discard, onChange };
  const rendered = render(<PackageCitationReorder {...props} prepared={first} />);
  await user.click(screen.getByRole("region", { name: "Citation reorder review" }).querySelector('input[type="checkbox"]')!);
  expect((screen.getByRole("button", { name: "Save reviewed citation reorder" }) as HTMLButtonElement).disabled).toBe(false);
  rendered.rerender(<PackageCitationReorder {...props} prepared={second} />);
  expect((screen.getByRole("button", { name: "Save reviewed citation reorder" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Cancel citation reorder" }));
  expect(discard).toHaveBeenCalledOnce(); expect(onChange).not.toHaveBeenCalled();
  expect((await listActionPackages()).find(value => value.id === record.id)?.sequence).toBe(record.sequence);
  rendered.rerender(<PackageCitationReorder {...props} editable={false} prepared={second} />);
  expect(screen.queryByRole("button", { name: "Save reviewed citation reorder" })).toBeNull();
  expect(screen.queryByLabelText("Native list to reorder")).toBeNull();
});
