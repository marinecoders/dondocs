import "fake-indexeddb/auto";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PackageCitations } from "@/components/PackageCitations";
import { createBlankSession } from "@/stores/documentStore";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { capturePackageMember } from "@/lib/actionPackageAssets";
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, type ActionPackage } from "@/lib/actionPackages";

vi.mock("@/stores/backupStore", () => ({ scheduleBackup: vi.fn() }));
async function fixture() {
  const session = createBlankSession();
  session.references = [{ letter: "a", title: "Alpha source" }, { letter: "b", title: "Beta source" }];
  session.paragraphs = [{ id: "component-body", text: "Use reference (a).", level: 0 }];
  const captured = captureDocumentRevision({ documentId: "component-source", epoch: 0, editSequence: 1, capturedAt: 1 }, { ...session, endItems: [], publicationTables: {} });
  return reviseActionPackage(await createActionPackage("Component citation training"), [await capturePackageMember(captured, "Training letter", "basic-letter")]);
}
function Harness({ initial }: { initial: ActionPackage }) {
  const [record, setRecord] = useState(initial), [error, setError] = useState("");
  const revision = getPackageRevision(record);
  return <><PackageCitations key={revision.id} record={record} revision={revision} editable onChange={action => { void action().then(setRecord).catch(cause => setError(cause.message)); }} />{error && <p role="alert">{error}</p>}</>;
}

it("creates and links an explicit occurrence, then restores the same identities after remount", async () => {
  const record = await fixture(), user = userEvent.setup();
  const rendered = render(<Harness initial={record} />);
  await waitFor(() => expect(screen.queryByText("Reading citation identities…")).toBeNull());
  await user.click(screen.getByRole("button", { name: "Identify current references and enclosures" }));
  await screen.findByText("2 identified targets · 0 linked citations");
  await user.selectOptions(screen.getByLabelText("Citation occurrence"), "0");
  const target = within(screen.getByLabelText("Citation target")).getByRole("option", { name: "Training letter · reference (a): Alpha source" });
  await user.selectOptions(screen.getByLabelText("Citation target"), target);
  await user.click(screen.getByRole("button", { name: "Save citation link" }));
  await screen.findByText("2 identified targets · 1 linked citations");
  const saved = (await listActionPackages()).find(value => value.id === record.id)!;
  expect(saved.revisions).toHaveLength(record.revisions.length + 2);
  const metadata = structuredClone(getPackageRevision(saved).citations);
  rendered.unmount();
  render(<Harness initial={saved} />);
  const links = await screen.findByRole("list", { name: "Linked citation occurrences" });
  expect(links.textContent).toContain("reference (a): Alpha source · current");
  expect(getPackageRevision((await listActionPackages()).find(value => value.id === record.id)!).citations).toEqual(metadata);
  expect(within(screen.getByLabelText("Citation occurrence")).queryByRole("option", { name: /Use reference/ })).toBeNull();
});

it("rejects a mismatched target without publishing a link and shows historical identities read-only", async () => {
  const record = await fixture(), user = userEvent.setup();
  const rendered = render(<Harness initial={record} />);
  await waitFor(() => expect(screen.queryByText("Reading citation identities…")).toBeNull());
  await user.click(screen.getByRole("button", { name: "Identify current references and enclosures" }));
  await screen.findByText("2 identified targets · 0 linked citations");
  await user.selectOptions(screen.getByLabelText("Citation occurrence"), "0");
  await user.selectOptions(screen.getByLabelText("Citation target"), within(screen.getByLabelText("Citation target")).getByRole("option", { name: "Training letter · reference (b): Beta source" }));
  await user.click(screen.getByRole("button", { name: "Save citation link" }));
  expect((await screen.findByRole("alert")).textContent).toContain("label does not match");
  const saved = (await listActionPackages()).find(value => value.id === record.id)!;
  expect(getPackageRevision(saved).citations?.links).toEqual([]);
  rendered.unmount();
  render(<PackageCitations record={saved} revision={getPackageRevision(saved)} editable={false} onChange={vi.fn()} />);
  await screen.findByRole("list", { name: "Identified citation targets" });
  expect(screen.queryByRole("button", { name: "Identify current references and enclosures" })).toBeNull();
});
