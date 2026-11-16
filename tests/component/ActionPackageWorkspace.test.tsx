import type { PackageRenderComparison } from "@/lib/packageRenderComparison";
import { StrictMode } from "react";
import { createExportGate } from "@/lib/exportController";
import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PDFDocument } from "pdf-lib";
import { ActionPackageWorkspace } from "@/components/ActionPackageWorkspace";
import { EditorSidebar } from "@/components/layout/EditorSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/uiStore";
import { createBlankSession } from "@/stores/documentStore";
import {
  createActionPackage,
  reviseActionPackage,
  listActionPackages,
  getPackageRevision,
} from "@/lib/actionPackages";
import { capturePackageMember } from "@/lib/actionPackageAssets";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";
import * as packageRecords from "@/lib/actionPackages";

const policy = resolveExportDeploymentPolicy({
  hostname: "localhost",
  environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] },
  runtime: { status: "absent" },
});
vi.mock("@/stores/backupStore", () => ({ scheduleBackup: vi.fn() }));
vi.mock("@/config/classification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/classification")>()),
  getExportDeploymentPolicy: async () => policy,
  getExportDeploymentPolicySync: () => policy,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  useUIStore.setState({ actionPackagesOpen: false, isMobile: false, sidebarCollapsed: false });
});
it("cancels a held render on close and never publishes into a reopened dialog or retains late output", async () => {
  const source = createBlankSession();
  source.formData = {
    ...source.formData,
    subject: "Synthetic cancellation",
    unitLine1: "FICTIONAL TRAINING UNIT",
    from: "Training Office",
    to: "Training Officer",
    sigLast: "Example",
    classLevel: "unclassified",
  };
  source.paragraphs = [
    {
      id: "cancellation-body",
      text: "Synthetic retained paragraph.",
      level: 0,
    },
  ];
  const captured = captureDocumentRevision(
    { documentId: "cancel-source", epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...source, endItems: [], publicationTables: {} },
  );
  const member = await capturePackageMember(
    captured,
    "Cancellation source",
    "basic-letter",
  );
  const record = await reviseActionPackage(
    await createActionPackage("Cancellation package"),
    [member],
  );
  const readPackages = packageRecords.listActionPackages;
  let releaseInventory!: () => void;
  const inventory = new Promise<void>(resolve => { releaseInventory = resolve; });
  vi.spyOn(packageRecords, "listActionPackages").mockImplementation(async () => {
    await inventory;
    return readPackages();
  });
  let finish!: (bytes: Uint8Array) => void;
  const compile = vi.fn(
    () =>
      new Promise<Uint8Array>((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  render(
    <StrictMode>
      <TooltipProvider>
      <EditorSidebar />
      <ActionPackageWorkspace
        exportGate={createExportGate()}
        ports={{
          compile,
          convertDocx: vi.fn(),
          waitForReady: async () => true,
        }}
      />
      </TooltipProvider>
    </StrictMode>,
  );
  await user.click(screen.getByRole("button", { name: "Packages" }));
  let dialog = screen.getByRole("dialog", { name: "Action packages" });
  expect(within(dialog).queryByRole("option", { name: record.name })).toBeNull();
  releaseInventory();
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(
    within(dialog).getByLabelText("Saved packages", { exact: true }),
    record.id,
  );
  await user.click(
    within(dialog).getByRole("button", {
      name: "Check readiness and assemble",
    }),
  );
  await within(dialog).findByRole("heading", {
    name: "Package readiness: ready",
  });
  await user.click(
    within(dialog).getByRole("checkbox", {
      name: /^I reviewed every included member/,
    }),
  );
  await user.click(
    within(dialog).getByRole("button", {
      name: "Assemble and retain PDF",
    }),
  );
  await waitFor(() => expect(compile).toHaveBeenCalledOnce());
  await user.click(
    within(dialog).getByRole("button", {
      name: "Cancel operation",
    }),
  );
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Action packages" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Packages" }));
  dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  const pdf = await PDFDocument.create();
  pdf.addPage();
  finish(await pdf.save());
  await waitFor(async () =>
    expect(
      getPackageRevision(
        (await listActionPackages()).find((item) => item.id === record.id)!,
      ).outputs,
    ).toEqual([]),
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Saved packages", { exact: true }),
    record.id,
  );
  expect(
    within(dialog).queryByRole("region", { name: "Retained package PDF" }),
  ).toBeNull();
  expect(within(dialog).queryByText(/Assembled PDF retained/)).toBeNull();
  expect(compile).toHaveBeenCalledOnce();
});

it("selects the exact reviewed historical revision when an imported package already has newer local history", async () => {
  const source = createBlankSession();
  const member = await capturePackageMember(captureDocumentRevision(
    { documentId: "selection-source", epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...source, endItems: [], publicationTables: {} },
  ), "Reviewed historical member", "basic-letter");
  const reviewed = await reviseActionPackage(await createActionPackage("Historical selection"), [member]);
  const newer = await reviseActionPackage(reviewed, [{ ...member, label: "Newer unreviewed member" }]);
  useUIStore.getState().openActionPackage(newer.id, reviewed.currentRevisionId);
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = await screen.findByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("heading", { name: "1. Reviewed historical member" });
  expect(within(dialog).queryByRole("heading", { name: "1. Newer unreviewed member" })).toBeNull();
  expect(within(dialog).getByLabelText("Package revision")).toHaveValue(reviewed.currentRevisionId);
  await waitFor(() => expect(useUIStore.getState().actionPackageSelectionRevisionId).toBeNull());
});

it("keeps exactly one citation editor while switching preserved package revisions", async () => {
  let record = await createActionPackage("Citation editor identity");
  record = await reviseActionPackage(record, []);
  record = await reviseActionPackage(record, []);
  const user = userEvent.setup();
  useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), record.id);
  for (const id of [record.revisions[0].id, record.revisions[1].id, record.currentRevisionId, record.revisions[0].id]) {
    await user.selectOptions(within(dialog).getByLabelText("Package revision"), id);
    expect(within(dialog).getAllByRole("region", { name: "Package citation identities" })).toHaveLength(1);
  }
});

async function retainedPair(name: string) {
  const { captureOriginalPackageMember } = await import("@/lib/actionPackageAssets");
  const { assemblePackage, preparePackageAssembly } = await import("@/lib/actionPackageAssembly");
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const member = await captureOriginalPackageMember({ name: "synthetic.pdf", data: new Uint8Array(await pdf.save()).buffer }, "basic-letter", false);
  let record = await reviseActionPackage(await createActionPackage(name), [member]);
  const ports = { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true };
  for (let index = 0; index < 2; index++) record = await assemblePackage(await preparePackageAssembly(record, record.currentRevisionId, policy), ports);
  return { record, ports };
}

function comparisonResult(revisionId: string): PackageRenderComparison {
  return {
    revisionId, beforeId: "before", afterId: "after",
    beforeCreatedAt: 1, afterCreatedAt: 2, beforeVersion: null, afterVersion: null,
    beforeSha256: "a".repeat(64), afterSha256: "b".repeat(64), identicalBytes: false,
    extractedText: "matches", textLayout: "matches", pageGeometry: "matches",
    memberBoundaries: "matches", recordedResources: "unavailable", recordedInputs: "unavailable",
    beforePages: 1, afterPages: 1, pagesWithoutText: [],
  };
}

it("locks the reviewed comparison pair while reading and discards a cancelled late result", async () => {
  const { record, ports } = await retainedPair("Held comparison");
  const comparison = await import("@/lib/packageRenderComparison");
  const { preparePackageAssembly } = await import("@/lib/actionPackageAssembly");
  vi.spyOn(comparison, "preparePackageRenderComparison").mockImplementation((record, id, policy) => preparePackageAssembly(record, id, policy));
  let finish!: (value: PackageRenderComparison) => void;
  const compare = vi.spyOn(comparison, "comparePreparedPackageOutputs").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup();
  useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={ports} />);
  let dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), record.id);
  const before = within(dialog).getByLabelText("Earlier retained PDF"), after = within(dialog).getByLabelText("Later retained PDF");
  const beforeValue = (before as HTMLSelectElement).value, afterValue = (after as HTMLSelectElement).value;
  await user.click(within(dialog).getByRole("button", { name: "Review PDF comparison" }));
  await within(dialog).findByRole("heading", { name: /^Package readiness: (ready|exported)$/ });
  await user.click(within(dialog).getByRole("checkbox", { name: /^I reviewed every included member/ }));
  await user.click(within(dialog).getByRole("button", { name: "Compare reviewed retained PDFs" }));
  await waitFor(() => expect(compare).toHaveBeenCalledOnce());
  await user.selectOptions(before, afterValue);
  await user.selectOptions(after, beforeValue);
  expect((before as HTMLSelectElement).value).toBe(beforeValue);
  expect((after as HTMLSelectElement).value).toBe(afterValue);
  expect((within(dialog).getByRole("button", { name: "Review PDF comparison" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(within(dialog).getByRole("button", { name: "Cancel operation" }));
  const signal = compare.mock.calls[0][3];
  expect(signal.aborted).toBe(true);
  await user.keyboard("{Escape}");
  useUIStore.setState({ actionPackagesOpen: true });
  dialog = await screen.findByRole("dialog", { name: "Action packages" });
  finish({} as PackageRenderComparison);
  await waitFor(() => expect(within(dialog).queryByRole("region", { name: "Retained PDF comparison" })).toBeNull());
  expect(within(dialog).queryByText(/Comparison complete/)).toBeNull();
});

it("explains the aggregate saved-output review limit before reading a small selected pair", async () => {
  const { record, ports } = await retainedPair("Aggregate comparison limit");
  const revision = getPackageRevision(record), extra = structuredClone(revision.outputs[0]);
  extra.id = "extra-output";
  extra.asset = { ...extra.asset, id: "large-other-output", size: 25 * 1024 * 1024 };
  revision.outputs.unshift(extra);
  record.revisions = record.revisions.map(value => value.id === revision.id ? revision : value);
  vi.spyOn(packageRecords, "listActionPackages").mockResolvedValue([record]);
  const user = userEvent.setup();
  useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={ports} />);
  const dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), record.id);
  await user.click(within(dialog).getByRole("button", { name: "Review PDF comparison" }));
  await within(dialog).findByText(/Comparison reviews every saved output before inspecting the selected pair/);
  expect(within(dialog).queryByRole("heading", { name: /^Package readiness:/ })).toBeNull();
});

it("rechecks the saved package after a delayed final policy refresh before publishing comparison", async () => {
  const { record, ports } = await retainedPair("Concurrent comparison update");
  const comparison = await import("@/lib/packageRenderComparison");
  const classification = await import("@/config/classification");
  const { preparePackageAssembly } = await import("@/lib/actionPackageAssembly");
  vi.spyOn(comparison, "preparePackageRenderComparison").mockImplementation((record, id, policy) => preparePackageAssembly(record, id, policy));
  vi.spyOn(comparison, "comparePreparedPackageOutputs").mockResolvedValue(comparisonResult(record.currentRevisionId));
  const user = userEvent.setup();
  useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={ports} />);
  const dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), record.id);
  await user.click(within(dialog).getByRole("button", { name: "Review PDF comparison" }));
  await within(dialog).findByRole("heading", { name: /^Package readiness: (ready|exported)$/ });
  await user.click(within(dialog).getByRole("checkbox", { name: /^I reviewed every included member/ }));
  let releasePolicy!: (value: typeof policy) => void;
  const finalPolicy = new Promise<typeof policy>(resolve => { releasePolicy = resolve; });
  const policies = vi.spyOn(classification, "getExportDeploymentPolicy")
    .mockResolvedValueOnce(policy).mockImplementationOnce(() => finalPolicy);
  await user.click(within(dialog).getByRole("button", { name: "Compare reviewed retained PDFs" }));
  await waitFor(() => expect(policies).toHaveBeenCalledTimes(2));
  await packageRecords.renameActionPackage(record, "Changed in another tab");
  releasePolicy(policy);
  await within(dialog).findByText(/The package changed during comparison/);
  expect(within(dialog).queryByRole("region", { name: "Retained PDF comparison" })).toBeNull();
  expect(within(dialog).queryByText(/Comparison complete/)).toBeNull();
});

it("clears the previous comparison when a received package selects another revision in the open workspace", async () => {
  const { record, ports } = await retainedPair("Previously compared package");
  const incoming = await createActionPackage("Received package selection");
  const comparison = await import("@/lib/packageRenderComparison");
  const { preparePackageAssembly } = await import("@/lib/actionPackageAssembly");
  vi.spyOn(comparison, "preparePackageRenderComparison").mockImplementation((record, id, policy) => preparePackageAssembly(record, id, policy));
  vi.spyOn(comparison, "comparePreparedPackageOutputs").mockResolvedValue(comparisonResult(record.currentRevisionId));
  const user = userEvent.setup();
  useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={ports} />);
  const dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), record.id);
  await user.click(within(dialog).getByRole("button", { name: "Review PDF comparison" }));
  await within(dialog).findByRole("heading", { name: /^Package readiness: (ready|exported)$/ });
  await user.click(within(dialog).getByRole("checkbox", { name: /^I reviewed every included member/ }));
  await user.click(within(dialog).getByRole("button", { name: "Compare reviewed retained PDFs" }));
  await within(dialog).findByRole("region", { name: "Retained PDF comparison" });
  act(() => useUIStore.getState().openActionPackage(incoming.id, incoming.currentRevisionId));
  await waitFor(() => expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(incoming.id));
  expect(within(dialog).queryByRole("region", { name: "Retained PDF comparison" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Compare reviewed retained PDFs" })).toBeNull();
});

it("discards an active comparison when a received package selects another revision", async () => {
  const { record, ports } = await retainedPair("Active comparison before received selection");
  const incoming = await createActionPackage("Incoming during comparison");
  const comparison = await import("@/lib/packageRenderComparison");
  const { preparePackageAssembly } = await import("@/lib/actionPackageAssembly");
  vi.spyOn(comparison, "preparePackageRenderComparison").mockImplementation((record, id, policy) => preparePackageAssembly(record, id, policy));
  let finish!: (value: PackageRenderComparison) => void;
  const compare = vi.spyOn(comparison, "comparePreparedPackageOutputs").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup();
  useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={ports} />);
  const dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), record.id);
  await user.click(within(dialog).getByRole("button", { name: "Review PDF comparison" }));
  await within(dialog).findByRole("heading", { name: /^Package readiness: (ready|exported)$/ });
  await user.click(within(dialog).getByRole("checkbox", { name: /^I reviewed every included member/ }));
  await user.click(within(dialog).getByRole("button", { name: "Compare reviewed retained PDFs" }));
  await waitFor(() => expect(compare).toHaveBeenCalledOnce());
  act(() => useUIStore.getState().openActionPackage(incoming.id, incoming.currentRevisionId));
  await waitFor(() => expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(incoming.id));
  await act(async () => { finish(comparisonResult(record.currentRevisionId)); });
  await waitFor(() => expect(dialog).not.toHaveAttribute("aria-busy", "true"));
  expect(within(dialog).queryByRole("region", { name: "Retained PDF comparison" })).toBeNull();
  expect(within(dialog).queryByText(/Comparison complete/)).toBeNull();
  expect(compare.mock.calls[0][3].aborted).toBe(true);
  expect(within(dialog).queryByRole("alert")).toBeNull();
});

it("starts and reopens an exact saved package review after membership removal and dialog reload", async () => {
  const source = createBlankSession();
  const member = await capturePackageMember(captureDocumentRevision(
    { documentId: "review-package-source", epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...source, endItems: [], publicationTables: {} },
  ), "Synthetic exact review member", "basic-letter");
  const record = await reviseActionPackage(await createActionPackage("Synthetic review workflow"), [member]);
  const user = userEvent.setup();
  useUIStore.setState({ actionPackagesOpen: true });
  const view = render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  let dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), record.id);
  await user.click(within(dialog).getByRole("button", { name: "Start package review", exact: true }));
  await within(dialog).findByText("Reviewing exact saved package revision");
  expect(within(dialog).getByRole("button", { name: "Check readiness and assemble" })).toBeDisabled();
  expect(within(dialog).queryByRole("button", { name: "Edit working copy" })).toBeNull();
  const saved = (await listActionPackages()).find(value => value.id === record.id)!;
  expect(saved.revisions).toEqual(record.revisions);
  await reviseActionPackage(saved, []);
  view.unmount();
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), record.id);
  expect(within(dialog).queryByRole("heading", { name: "1. Synthetic exact review member" })).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: "Open review Package review 1", exact: true }));
  await within(dialog).findByRole("heading", { name: "1. Synthetic exact review member" });
  expect(within(dialog).getByLabelText("Package revision")).toHaveValue(record.currentRevisionId);
  await user.click(within(dialog).getByRole("button", { name: "Close package review", exact: true }));
  await within(dialog).findByRole("button", { name: "Reopen package review", exact: true });
  expect((await listActionPackages()).find(value => value.id === record.id)?.reviewRounds?.[0].lifecycle?.events.at(-1)?.state).toBe("closed");
});
