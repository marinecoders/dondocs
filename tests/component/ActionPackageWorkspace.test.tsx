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
import { capturePackageMember, readPackageMemberDraft, retainPackageAsset } from "@/lib/actionPackageAssets";
import { updatePackageRequirements } from "@/lib/packageRequirements";
import { prepareConditionalPackage, applyPreparedConditionalPackage } from "@/lib/packageConditional";
import type { PackageTemplateV2 } from "@/lib/packageTemplateSchema";
import { buildPortableActionPackage, importPortableActionPackage } from "@/lib/actionPackageTransfer";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";
import * as memberReviews from "@/lib/packageMemberReviews";
import * as packageRecords from "@/lib/actionPackages";
import { PACKAGE_WORKSPACE_CONTEXT_KEY, readPackageWorkspaceContext, rememberPackageWorkspaceContext } from "@/lib/packageWorkspaceContext";
import { maintainedPackageAction } from "@/lib/maintainedPackageActions";
import { saveConditionalPackageDraft } from "@/lib/packageConditional";

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
  localStorage.removeItem(PACKAGE_WORKSPACE_CONTEXT_KEY);
  useUIStore.setState({ actionPackagesOpen: false, isMobile: false, sidebarCollapsed: false });
});

it("exposes derived evidence requirements for an imported legacy intake without stored requirement declarations", async () => {
  const original = await saveConditionalPackageDraft({ template: await maintainedPackageAction("administrative-request"),
    answers: { version: 1, values: { supportingEvidence: true }, groups: {} } }, policy);
  const portable = JSON.parse(await buildPortableActionPackage(original));
  portable.package.id = `legacy-intake-${crypto.randomUUID()}`;
  for (const revision of portable.package.revisions) { delete revision.requirements; revision.templateState.requirementIds = []; }
  const legacy = await importPortableActionPackage(JSON.stringify(portable));
  expect(getPackageRevision(legacy).requirements).toBeUndefined();
  useUIStore.getState().openActionPackage(legacy.id);
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const requirements = await screen.findByRole("region", { name: "Evidence and requirements" }, { timeout: 15_000 });
  await within(requirements).findByRole("heading", { name: "Supporting PDF" });
  const check = within(requirements).getByRole("button", { name: "Check evidence requirements" });
  await waitFor(() => expect(check).toBeEnabled()); await userEvent.click(check);
  await within(requirements).findByText(/^PDF assembly requirement checks have unresolved items\./);
  expect((await listActionPackages()).find(record => record.id === legacy.id)).toEqual(legacy);
});

it("holds new action intake through close and package switching until its changes are discarded", async () => {
  const origin = await createActionPackage("Conditional intake origin"), destination = await createActionPackage("Conditional intake destination");
  useUIStore.getState().openActionPackage(origin.id);
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = await screen.findByRole("dialog", { name: "Action packages" }), user = userEvent.setup();
  const start = await within(dialog).findByRole("button", { name: "Start training participation" });
  await waitFor(() => expect(start).toBeEnabled()); await user.click(start);
  const course = await within(dialog).findByLabelText("Course or activity", { exact: true });
  await waitFor(() => expect(course).toBeEnabled()); await user.type(course, "Unapplied course title");
  expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toBeDisabled();
  await user.keyboard("{Escape}"); expect(dialog).toBeVisible(); expect(course).toHaveValue("Unapplied course title");
  act(() => useUIStore.getState().openActionPackage(destination.id));
  expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(origin.id);
  await user.click(within(dialog).getByRole("button", { name: "Discard intake changes" }));
  await waitFor(() => expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(destination.id));
  expect((await listActionPackages()).find(record => record.id === origin.id)).toEqual(origin);
});

it("distinguishes a native draft with no library source from a known captured source without inventing a capture date", async () => {
  const blank = await createActionPackage("Generated and captured sources");
  const captured = await capturePackageMember(captureDocumentRevision({ documentId: "known-source", epoch: 0, editSequence: 0, capturedAt: 1794945600000 }, { ...createBlankSession(), endItems: [], publicationTables: {} }), "Known source", "basic-letter");
  const generated = { ...structuredClone(captured), id: "generated-native", revisionId: "generated-revision", label: "Generated native", role: "supporting-document" as const };
  delete generated.source;
  const record = await reviseActionPackage(blank, [captured, generated]);
  useUIStore.getState().openActionPackage(record.id);
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = await screen.findByRole("dialog", { name: "Action packages" });
  const generatedCard = (await within(dialog).findByRole("heading", { name: "2. Generated native" })).closest("li")!;
  expect(within(generatedCard).getByText("Source: No library source recorded")).toBeVisible();
  expect(within(generatedCard).queryByText(/^Source:.*Captured/)).toBeNull();
  expect(within(generatedCard).queryByText(/foreign provenance/)).toBeNull();
  const capturedCard = within(dialog).getByRole("heading", { name: "1. Known source" }).closest("li")!;
  expect(within(capturedCard).getByText(/Source: unavailable; preserved copy retained · Captured/)).toHaveTextContent(new Date(captured.source!.capturedAt).toLocaleString());
});

it("preserves request intake through close and queued selection until the user cancels it", async () => {
  const previous = await createActionPackage("Request starter origin");
  const requested = await createActionPackage("Request starter destination");
  useUIStore.getState().openActionPackage(previous.id);
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const user = userEvent.setup(), dialog = await screen.findByRole("dialog", { name: "Action packages" });
  await user.click(within(dialog).getByText("Quick request starter", { exact: true }));
  await user.click(await within(dialog).findByRole("button", { name: "Start an administrative request" }));
  const starter = within(dialog).getByRole("region", { name: "Administrative request starter" });
  await user.type(within(starter).getByLabelText("Requester", { exact: true }), "Unfinished request");
  expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(dialog).toBeVisible(); expect(within(starter).getByLabelText("Requester", { exact: true })).toHaveValue("Unfinished request");
  act(() => useUIStore.getState().openActionPackage(requested.id));
  expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(previous.id);
  await user.click(within(starter).getByRole("button", { name: "Cancel request starter" }));
  await waitFor(() => expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(requested.id));
  expect((await listActionPackages()).find(record => record.id === previous.id)).toEqual(previous);
});

it("finishes restoring saved context before accepting a new package name", async () => {
  const remembered = await createActionPackage("Previous package name");
  rememberPackageWorkspaceContext({ version: 1, packageId: remembered.id, revisionId: remembered.currentRevisionId, memberId: null, section: "overview" });
  let resolveInventory!: (records: typeof remembered[]) => void;
  vi.spyOn(packageRecords, "listActionPackages").mockImplementation(() => new Promise(resolve => { resolveInventory = resolve; }));
  useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = screen.getByRole("dialog", { name: "Action packages" });
  const name = within(dialog).getByLabelText("Package name", { exact: true });
  expect(name).toBeDisabled();
  await act(async () => resolveInventory([remembered]));
  await waitFor(() => expect(name).toBeEnabled());
  expect(name).toHaveValue(remembered.name);
  const user = userEvent.setup();
  await user.clear(name);
  await user.type(name, "New package name");
  expect(name).toHaveValue("New package name");
});

it("resumes the saved package revision and selected member after closing and reopening", async () => {
  const source = createBlankSession();
  const first = await capturePackageMember(captureDocumentRevision(
    { documentId: "workspace-first", epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...source, endItems: [], publicationTables: {} },
  ), "First workspace member", "basic-letter");
  const second = { ...structuredClone(first), id: "workspace-second", revisionId: "workspace-second-revision", label: "Second workspace member", role: "supporting-document" as const };
  const previous = await reviseActionPackage(await createActionPackage("Resumable workspace"), [first, second]);
  const current = await reviseActionPackage(previous, [first]);
  const user = userEvent.setup();
  useUIStore.setState({ actionPackagesOpen: true });
  const ports = { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true };
  const view = render(<ActionPackageWorkspace exportGate={createExportGate()} ports={ports} />);
  let dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: current.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), current.id);
  await user.selectOptions(within(dialog).getByLabelText("Package revision", { exact: true }), previous.currentRevisionId);
  await user.selectOptions(within(dialog).getByLabelText("Document to inspect", { exact: true }), second.id);
  await waitFor(() => expect(readPackageWorkspaceContext()).toMatchObject({ packageId: current.id, revisionId: previous.currentRevisionId, memberId: second.id, section: "documents" }));
  view.unmount();
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={ports} />);
  dialog = await screen.findByRole("dialog", { name: "Action packages" });
  await waitFor(() => expect(within(dialog).getByLabelText("Package revision", { exact: true })).toHaveValue(previous.currentRevisionId));
  expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(current.id);
  expect(within(dialog).getByRole("heading", { name: "2. Second workspace member" }).closest("li")).toHaveAttribute("data-selected", "true");
  expect(within(dialog).getByRole("navigation", { name: "Package workspace" })).toContainElement(within(dialog).getByRole("button", { name: "Documents" }));
  expect((await listActionPackages()).find(record => record.id === current.id)).toEqual(current);
});

it("lets explicit received selection supersede remembered package context", async () => {
  const remembered = await createActionPackage("Previously opened workspace");
  const requested = await createActionPackage("Explicitly requested workspace");
  rememberPackageWorkspaceContext({ version: 1, packageId: remembered.id, revisionId: remembered.currentRevisionId, memberId: null, section: "delivery" });
  useUIStore.getState().openActionPackage(requested.id, requested.currentRevisionId);
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = await screen.findByRole("dialog", { name: "Action packages" });
  await waitFor(() => expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(requested.id));
  expect(within(dialog).getByRole("region", { name: "Selected package" })).toHaveTextContent(requested.name);
  expect(readPackageWorkspaceContext()?.packageId).toBe(requested.id);
});
it("checks retained raw draft text before editable package download while allowing normalized PDF assembly", async () => {
  const source = createBlankSession();
  source.formData = { ...source.formData, subject: "Synthetic retained text", unitLine1: "FICTIONAL TRAINING UNIT",
    from: "Training Office", to: "Training Officer", sigLast: "Example", classLevel: "unclassified" };
  source.paragraphs = [{ id: "portable-raw-body", text: "Synthetic visible paragraph.", level: 0 }];
  const member = await capturePackageMember(captureDocumentRevision(
    { documentId: "portable-raw-source", epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...source, endItems: [], publicationTables: {} },
  ), "Synthetic retained text member", "basic-letter");
  const { draft } = await readPackageMemberDraft(member);
  Object.assign(draft as object, { legacyRetainedText: "(S) Synthetic omitted note" });
  const asset = await retainPackageAsset(member.draft.name, member.draft.type, new TextEncoder().encode(JSON.stringify(draft)).buffer);
  const record = await reviseActionPackage(await createActionPackage("Synthetic portable text review"), [{ ...member, draft: asset }]);
  const user = userEvent.setup(); useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), record.id);
  await user.click(within(dialog).getByRole("button", { name: "Export editable package" }));
  await within(dialog).findByRole("heading", { name: "Editable transfer checks: incomplete" });
  await user.click(within(dialog).getByRole("checkbox", { name: /I reviewed every included member/ }));
  expect(within(dialog).getByRole("button", { name: "Download reviewed editable package" })).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "Check readiness and assemble" }));
  await within(dialog).findByRole("heading", { name: "Package readiness: ready" });
  expect((await listActionPackages()).find(value => value.id === record.id)).toEqual(record);
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
  const startReview = within(dialog).getByRole("button", { name: "Start package review" });
  await waitFor(() => expect(startReview).toBeEnabled(), { timeout: 15_000 });
  await user.click(startReview);
  await within(dialog).findByText("Reviewing exact saved package revision", {}, { timeout: 15_000 });
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
  await user.click(within(dialog).getByRole("button", { name: "Open review Package review 1" }));
  await within(dialog).findByRole("heading", { name: "1. Synthetic exact review member" });
  expect(within(dialog).getByLabelText("Package revision")).toHaveValue(record.currentRevisionId);
  await user.click(within(dialog).getByRole("button", { name: "Close package review" }));
  await within(dialog).findByRole("button", { name: "Reopen package review" });
  expect((await listActionPackages()).find(value => value.id === record.id)?.reviewRounds?.[0].lifecycle?.events.at(-1)?.state).toBe("closed");
});


it("keeps unsaved package typing through blocked navigation, close and failed save, then unlocks after cancel", async () => {
  const source = createBlankSession();
  source.paragraphs = [{ id: "package-typed-body", text: "Synthetic paragraph.", level: 0 }];
  const member = await capturePackageMember(captureDocumentRevision(
    { documentId: "package-typed-source", epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...source, endItems: [], publicationTables: {} },
  ), "Synthetic typing member", "basic-letter");
  const record = await reviseActionPackage(await createActionPackage("Synthetic typing workflow"), [member]);
  const user = userEvent.setup(); useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), record.id);
  const startReview = within(dialog).getByRole("button", { name: "Start package review" });
  await waitFor(() => expect(startReview).toBeEnabled(), { timeout: 15_000 });
  await user.click(startReview);
  const nav = await within(dialog).findByRole("navigation", { name: "Captured review members" }, { timeout: 15_000 });
  await user.click(within(nav).getByRole("button", { name: member.label }));
  await user.type(await within(dialog).findByLabelText("Reviewer name for suggestion"), "Synthetic reviewer");
  await user.click(within(dialog).getByRole("button", { name: "Suggest Changes mode" }));
  await user.selectOptions(within(dialog).getByLabelText("Paragraph for suggested typing"), "package-typed-body");
  await user.type(within(dialog).getByLabelText("Suggested paragraph text"), " Added");
  for (const label of ["Saved packages", "Package revision", "Import package reviewer copy"])
    expect(within(dialog).getByLabelText(label, { exact: true })).toBeDisabled();
  for (const name of ["Return to package workspace", "Close package review", "Open review Package review 1", "Prepare package feedback return", "Prepare package reviewer copy", "Export editable package"])
    expect(within(dialog).getByRole("button", { name })).toBeDisabled();
  expect(within(nav).getByRole("button", { name: member.label })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Save typed suggestion" })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: "Cancel typed changes" })).toBeEnabled();
  const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  await user.keyboard("{Escape}"); expect(screen.getByRole("dialog", { name: "Action packages" })).toBeInTheDocument();
  vi.spyOn(memberReviews, "savePackageMemberReview").mockRejectedValueOnce(new Error("Synthetic quota failure"));
  await user.click(within(dialog).getByRole("button", { name: "Save typed suggestion" }));
  await within(dialog).findByText("Synthetic quota failure");
  expect(within(dialog).getByLabelText("Suggested paragraph text")).toHaveValue("Synthetic paragraph. Added");
  expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel typed changes" }));
  await waitFor(() => expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toBeEnabled());
  await user.type(within(dialog).getByLabelText("Suggested paragraph text"), " Saved");
  await user.click(within(dialog).getByRole("button", { name: "Save typed suggestion" }));
  await within(dialog).findByText("Typed suggestion submitted. The reviewed baseline is unchanged.");
  await waitFor(() => expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toBeEnabled());
  const saved = (await listActionPackages()).find(value => value.id === record.id)!;
  expect(saved.revisions).toEqual(record.revisions);
  expect(saved.reviewRounds![0].memberReviews![0].suggestions!.proposals).toHaveLength(1);
});


it("cancels a held package member write before its parent CAS", async () => {
  const source = createBlankSession(); source.paragraphs = [{ id: "member-cancel-body", text: "Synthetic member.", level: 0 }];
  const member = await capturePackageMember(captureDocumentRevision(
    { documentId: "member-cancel-source", epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...source, endItems: [], publicationTables: {} },
  ), "Synthetic cancelled member", "basic-letter");
  const record = await reviseActionPackage(await createActionPackage("Synthetic member cancellation"), [member]);
  const user = userEvent.setup(); useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = screen.getByRole("dialog", { name: "Action packages" });
  await within(dialog).findByRole("option", { name: record.name });
  await user.selectOptions(within(dialog).getByLabelText("Saved packages", { exact: true }), record.id);
  await user.click(within(dialog).getByRole("button", { name: "Start package review" }));
  const nav = await within(dialog).findByRole("navigation", { name: "Captured review members" });
  await user.click(within(nav).getByRole("button", { name: member.label }));
  await user.type(await within(dialog).findByLabelText("Package comment reviewer name"), "Synthetic reviewer");
  await user.type(within(dialog).getByLabelText("Package member comment"), "Cancelled feedback must not commit.");
  const before = (await listActionPackages()).find(value => value.id === record.id)!;
  const save = memberReviews.savePackageMemberReview;
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let finish!: () => void; const completed = new Promise<void>(resolve => { finish = resolve; });
  vi.spyOn(memberReviews, "savePackageMemberReview").mockImplementationOnce(async (...args) => {
    await held; try { return await save(...args); } finally { finish(); }
  });
  await user.click(within(dialog).getByRole("button", { name: "Post member comment" }));
  await user.click(await within(dialog).findByRole("button", { name: "Cancel operation" }));
  await act(async () => { release(); await completed; });
  expect((await listActionPackages()).find(value => value.id === record.id)).toEqual(before);
  expect(within(dialog).getByLabelText("Package member comment")).toHaveValue("Cancelled feedback must not commit.");
});

it("validates long package names without discarding a valid full-length Unicode replacement", async () => {
  const record = await createActionPackage("Original name");
  rememberPackageWorkspaceContext({ version: 1, packageId: record.id, revisionId: record.currentRevisionId, memberId: null, section: "overview" });
  useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = screen.getByRole("dialog", { name: "Action packages" }), name = within(dialog).getByLabelText("Package name", { exact: true });
  await waitFor(() => expect(name).toBeEnabled());
  const user = userEvent.setup();await user.clear(name);await user.paste("A".repeat(121));
  expect(name).toHaveValue("A".repeat(121));expect(name).toHaveAttribute("aria-invalid", "true");
  expect(within(dialog).getByRole("button", { name: "Create package" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Rename" })).toBeDisabled();
  expect(within(dialog).getByText("Use a package name of 120 characters or fewer.")).toBeVisible();
  await user.clear(name);await user.paste("😀".repeat(60));
  expect(name).toHaveValue("😀".repeat(60));expect(name).not.toHaveAttribute("aria-invalid");
  expect(within(dialog).getByRole("button", { name: "Create package" })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: "Rename" })).toBeEnabled();
  expect((await listActionPackages()).find(value => value.id === record.id)?.name).toBe("Original name");
});


it("mounts stored requirements and fences close, selection, navigation and mutations until discarded", async () => {
  const initial = await updatePackageRequirements(await createActionPackage("Stored requirements origin"), { version: 1, items: [
    { id: "read-source", label: "Read the supporting record", kind: "confirmation", condition: "active", operations: ["pdf"] },
  ] }, policy);
  const requested = await createActionPackage("Stored requirements destination");
  useUIStore.getState().openActionPackage(initial.id);
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const user = userEvent.setup(), dialog = await screen.findByRole("dialog", { name: "Action packages" });
  await waitFor(() => expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(initial.id));
  await user.click(within(dialog).getByText("Quick request starter", { exact: true }));
  const panel = await within(dialog).findByRole("region", { name: "Evidence and requirements" });
  const declaration = within(panel).getByRole("checkbox", { name: /User declaration for Read the supporting record/ });
  const navigation = within(dialog).getByRole("navigation", { name: "Package workspace" });
  expect(within(navigation).getByRole("button", { name: "Documents" })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: "Rename" })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: "Start an administrative request" })).toBeEnabled();
  await user.click(declaration);
  expect(within(panel).getByText("Unapplied requirement changes · not saved yet.")).toBeVisible();
  expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toBeDisabled();
  expect(within(dialog).getByLabelText("Package revision", { exact: true })).toBeDisabled();
  for (const button of within(navigation).getAllByRole("button")) expect(button).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Rename" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Archive" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Start an administrative request" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Add shared value" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(dialog).toBeVisible(); expect(declaration).toBeChecked();
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Save or discard the requirement changes before closing this package.");
  act(() => useUIStore.getState().openActionPackage(requested.id));
  expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(initial.id);
  await user.click(within(panel).getByRole("button", { name: "Discard requirement changes" }));
  await waitFor(() => expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(requested.id));
  expect((await listActionPackages()).find(record => record.id === initial.id)).toEqual(initial);
  await user.keyboard("{Escape}"); await waitFor(() => expect(dialog).not.toBeVisible());
});

it("derives legacy requirement slots through the real Workspace and saves an existing-member assignment", async () => {
  const session = createBlankSession(undefined, "standard_letter");
  session.formData = { ...session.formData, signatureType: "none", subject: "", sigFirst: "", sigMiddle: "", sigLast: "", classLevel: "unclassified" };
  const template: PackageTemplateV2 = { kind: "dondocs-package-template", version: 2, id: `workspace-legacy-${crypto.randomUUID()}`, name: "Workspace legacy evidence", createdAt: 0,
    program: { revision: "1", questions: [{ id: "subject", label: "Subject", kind: "text", required: true }], participantGroups: [],
      requirements: [{ id: "supporting-proof", label: "Supporting proof", kind: "document", operations: ["pdf"] }] },
    members: [{ key: "main", kind: "native", label: "Legacy main letter", role: "basic-letter", required: true,
      draft: { ...session, timestamp: 0, kind: "dondocs-draft", version: 2, documentKind: "correspondence" }, pages: {},
      links: [{ questionId: "subject", target: { kind: "correspondence", docType: "standard_letter", field: "subject" }, format: "field" }] }] };
  const prepared = await prepareConditionalPackage({ template, answers: { version: 1, values: { subject: "SYNTHETIC WORKSPACE EVIDENCE" }, groups: {} } }, policy);
  const original = (await applyPreparedConditionalPackage(prepared, policy, true)).record;
  const envelope = JSON.parse(await buildPortableActionPackage(original));
  envelope.package.id = `workspace-package-${crypto.randomUUID()}`; envelope.package.name = `Imported workspace evidence ${crypto.randomUUID()}`;
  for (const revision of envelope.package.revisions) delete revision.requirements;
  const initial = await importPortableActionPackage(JSON.stringify(envelope)), baseline = getPackageRevision(initial);
  expect(baseline.requirements).toBeUndefined();
  useUIStore.getState().openActionPackage(initial.id);
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const user = userEvent.setup(), dialog = await screen.findByRole("dialog", { name: "Action packages" });
  await waitFor(() => expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toHaveValue(initial.id));
  const panel = await within(dialog).findByRole("region", { name: "Evidence and requirements" });
  const proof = (await within(panel).findByRole("heading", { name: "Supporting proof" })).closest("article")!;
  expect(within(dialog).getByLabelText("Saved packages", { exact: true })).toBeEnabled();
  await user.click(within(panel).getByRole("button", { name: "Check evidence requirements" }));
  await within(panel).findByText(/PDF assembly requirement checks have unresolved items/);
  await user.selectOptions(within(proof).getByRole("combobox"), baseline.members[0].id);
  expect(within(dialog).getByLabelText("Package revision", { exact: true })).toBeDisabled();
  await user.click(within(panel).getByRole("button", { name: "Review requirement changes" }));
  await user.click(await within(panel).findByRole("checkbox", { name: /I reviewed these evidence assignments/ }));
  await user.click(within(panel).getByRole("button", { name: "Save requirement changes" }));
  await within(panel).findByText("Requirements saved as a new revision. Unresolved evidence remains visible.");
  const saved = (await listActionPackages()).find(record => record.id === initial.id)!;
  expect(saved.revisions).toHaveLength(initial.revisions.length + 1);
  expect(getPackageRevision(saved).requirements?.items.find(item => item.definitionId === "supporting-proof")).toMatchObject({ memberId: baseline.members[0].id });
  expect(saved.revisions.find(revision => revision.id === baseline.id)?.requirements).toBeUndefined();
  expect(within(dialog).getByLabelText("Package revision", { exact: true })).toBeEnabled();
  await user.selectOptions(within(dialog).getByLabelText("Package revision", { exact: true }), baseline.id);
  const historicalProof = (await within(panel).findByRole("heading", { name: "Supporting proof" })).closest("article")!;
  expect(within(historicalProof).getByRole("combobox")).toBeDisabled();
});

it('loads and saves new intake through its own busy parent controller without revoking its operation', async () => {
  const before = await listActionPackages(), user = userEvent.setup();
  useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = await screen.findByRole('dialog', { name: 'Action packages' });
  const start = await within(dialog).findByRole('button', { name: 'Start training participation' });
  await waitFor(() => expect(start).toBeEnabled()); await user.click(start);
  const course = await within(dialog).findByLabelText('Course or activity', { exact: true });
  await waitFor(() => expect(course).toBeEnabled()); await user.type(course, 'Synthetic parent busy lifecycle');
  await user.click(within(dialog).getByRole('button', { name: 'Save intake draft' }));
  await within(dialog).findByText('Intake saved; document changes not applied.', {}, { timeout: 15_000 });
  const saved = (await listActionPackages()).find(record => !before.some(existing => existing.id === record.id));
  expect(saved).toBeDefined(); expect(getPackageRevision(saved!).templateState!.answers.values.course).toBe('Synthetic parent busy lifecycle');
  expect(getPackageRevision(saved!).members).toEqual([]);
});


it('reviews and creates a request through its own busy parent controller', async () => {
  const before = await listActionPackages(), user = userEvent.setup();
  useUIStore.setState({ actionPackagesOpen: true });
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = await screen.findByRole('dialog', { name: 'Action packages' });
  await user.click(within(dialog).getByText('Quick request starter', { exact: true }));
  const start = await within(dialog).findByRole('button', { name: 'Start an administrative request' });
  await waitFor(() => expect(start).toBeEnabled()); await user.click(start);
  const starter = within(dialog).getByRole('region', { name: 'Administrative request starter' });
  const fields = { Requester: 'Synthetic Person', Organization: 'Synthetic Unit', Recipient: 'Training Officer', 'Request subject': 'Parent controller lifecycle',
    'Request date': '2026-11-18', SSIC: '1500', 'Printed signature name': 'S. PERSON', 'Requested action and justification': 'Synthetic request lifecycle verification.' };
  for (const [label, value] of Object.entries(fields)) await user.type(within(starter).getByLabelText(label, { exact: label !== 'Printed signature name' }), value);
  await user.click(within(starter).getByRole('button', { name: 'Review request starter' }));
  await user.click(await within(starter).findByRole('checkbox', { name: /^I reviewed these request details/ }, { timeout: 15_000 }));
  await user.click(within(starter).getByRole('button', { name: 'Create reviewed request package' }));
  await within(dialog).findByText('Request package created. Review its letter and worksheet before submission.', {}, { timeout: 15_000 });
  const saved = (await listActionPackages()).find(record => !before.some(existing => existing.id === record.id));
  expect(saved).toBeDefined(); expect(getPackageRevision(saved!).members).toHaveLength(2);
  expect(getPackageRevision(saved!).information!.facts.some(fact => fact.value === fields.Requester)).toBe(true);
});
