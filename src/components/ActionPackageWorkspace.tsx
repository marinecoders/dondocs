import type { PackageSearchScope } from './PackageSearchPanel';
import { PackageReviewControls } from "./PackageReviewControls";
import { PackageMemberNavigation, PackageWorkspaceNavigation, PackageWorkspaceSummary } from "./PackageWorkspaceNavigation";
import { readPackageWorkspaceContext, rememberPackageWorkspaceContext, type PackageWorkspaceSection } from "@/lib/packageWorkspaceContext";
import { startPackageReview, openPackageReview, transitionPackageReview } from "@/lib/packageReviewRounds";
import type { PackageReviewRound } from "@/lib/actionPackages";
import type { ExportGate } from "@/lib/exportController";
import { reviewPackageOriginal } from "@/lib/actionPackageDisclosure";
import type { PackageAsset } from "@/lib/actionPackages";
import type { SerializedSession } from "@/stores/documentStore";
import { useEffect, useId, useLayoutEffect, useState, useRef, lazy, Suspense } from "react";
import { focusPackageDestination, type PackageDestination, type PackageDestinationRequest } from "@/lib/packageDestinations";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WordPackageDownload } from "./WordPackageDownload";
import { SessionChanges } from "./SessionChanges";
import { PackageRenderComparisonView } from "./PackageRenderComparisonView";
import type { PackageRenderComparison } from "@/lib/packageRenderComparison";
import { PackageCitations } from "./PackageCitations";
import { PackageCitationReorder } from "./PackageCitationReorder";
import { preparePackageCitationReorder, type PackageCitationReorder as CitationReorderOperation, type PreparedPackageCitationReorder } from "@/lib/packageCitationReorder";
import {
  createActionPackage,
  listActionPackages,
  getPackageRevision,
  reviseActionPackage,
  renameActionPackage,
  archiveActionPackage,
  duplicateActionPackage,
  packageRoles,
  packageMemberSchema,
  type ActionPackage,
  type NativePackageMember,
  type PackageMember,
} from "@/lib/actionPackages";
import {
  capturePackageMember,
  captureOriginalPackageMember,
  readPackageAsset,
} from "@/lib/actionPackageAssets";
import {
  assemblePackage,
  copyPreparedPackageOutput,
  preparePackageAssembly,
  assertPreparedPackagePolicy,
  type PreparedPackageAssembly,
} from "@/lib/actionPackageAssembly";
import {
  buildPortableActionPackage,
  importPortableActionPackage,
  MAX_PACKAGE_FILE_BYTES,
} from "@/lib/actionPackageTransfer";
import {
  editPackageMember,
  savePackageWorkingCopy,
  adoptPackageSource,
} from "@/lib/actionPackageWorkingCopy";
import { captureCurrentDocumentRevision } from "@/stores/captureDocument";
import { useDocumentsStore } from "@/stores/documentsStore";
import { useUIStore } from "@/stores/uiStore";
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from "@/config/classification";
import { triggerDownload } from "@/lib/encoding";
import { parseEncryptedShareFile, MAX_ENCRYPTED_SHARE_FILE_BYTES } from "@/lib/encryptedShareFile";
import { ShareModal } from "./modals/ShareModal";
import type { CorrespondenceRendererPorts } from "@/services/exports/correspondence";

const PackageDeliveryPanel = lazy(() => import("./PackageDeliveryPanel").then(module => ({ default: module.PackageDeliveryPanel })));
const PackageAssemblyPanel = lazy(() => import("./PackageAssemblyPanel").then(module => ({ default: module.PackageAssemblyPanel })));
const PackageOutputNavigation = lazy(() => import("./PackageOutputNavigation").then(module => ({ default: module.PackageOutputNavigation })));
const PackageSigningPanel = lazy(() => import("./PackageSigningPanel").then(module => ({ default: module.PackageSigningPanel })));
const PackageSearchPanel = lazy(() => import("./PackageSearchPanel").then(module => ({ default: module.PackageSearchPanel })));
const PackageEvidencePanel = lazy(() => import("./PackageEvidencePanel").then(module => ({ default: module.PackageEvidencePanel })));
const PackageInformationPanel = lazy(() => import("./PackageInformationPanel").then(module => ({ default: module.PackageInformationPanel })));
const PackageWorkPanel = lazy(() => import("./PackageWorkPanel").then(module => ({ default: module.PackageWorkPanel })));
const PackageChangeImpactPanel = lazy(() => import("./PackageChangeImpactPanel").then(module => ({ default: module.PackageChangeImpactPanel })));
const PackageConsistencyPanel = lazy(() => import("./PackageConsistencyPanel").then(module => ({ default: module.PackageConsistencyPanel })));
const PackageIntakePanel = lazy(() => import("./PackageIntakePanel").then(module => ({ default: module.PackageIntakePanel })));
const PackageRequirementsPanel = lazy(() => import("./PackageRequirementsPanel").then(module => ({ default: module.PackageRequirementsPanel })));
const AdministrativeRequestStarter = lazy(() => import("./AdministrativeRequestStarter").then(module => ({ default: module.AdministrativeRequestStarter })));
const PackageTemplatePanel = lazy(() => import("./PackageTemplatePanel").then(module => ({ default: module.PackageTemplatePanel })));

const RECEIVED_PACKAGE_SELECTION = Symbol("received-package-selection");
const UNSAVED_PACKAGE_INFORMATION = "Apply or discard the package information changes before closing this package.";
const loadRetainedPdfViewer = () => import("@/components/pdf/PdfViewer");
const RetainedPdfViewer = lazy(loadRetainedPdfViewer);
const PackageShareDialog = lazy(() => import("./PackageShareDialog"));

type Ports = CorrespondenceRendererPorts & {
  waitForReady(timeoutMs: number): Promise<boolean>;
};
const PackageMemberReviewPanel = lazy(() => import("./PackageMemberReviewPanel").then(module => ({ default: module.PackageMemberReviewPanel })));
const PackageReviewApplicationPanel = lazy(() => import("./PackageReviewApplicationPanel").then(module => ({ default: module.PackageReviewApplicationPanel })));
const PackageReviewTransfer = lazy(() => import("./PackageReviewTransfer").then(module => ({ default: module.PackageReviewTransfer })));

export function ActionPackageWorkspace({
  ports,
  exportGate,
}: {
  ports: Ports;
  exportGate: ExportGate;
}) {
  const open = useUIStore(state => state.actionPackagesOpen);
  const setOpen = useUIStore(state => state.setActionPackagesOpen);
  useEffect(() => {
    if (open) void loadRetainedPdfViewer().catch(() => {});
  }, [open]);
  return open ? (
    <PackageDialog
      ports={ports}
      exportGate={exportGate}
      onClose={() => setOpen(false)}
    />
  ) : null;
}
function PackageDialog({
  ports,
  exportGate,
  onClose,
}: {
  ports: Ports;
  exportGate: ExportGate;
  onClose(): void;
}) {
  const operation = useRef<AbortController | null>(null),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      operation.current?.abort();
    };
  }, []);
  function assertOperationCurrent() {
    if (!active.current)
      throw new DOMException("The package dialog was closed.", "AbortError");
    operation.current?.signal.throwIfAborted();
  }
  function close() {
    if (evidenceDirty) { setError("Add or discard the prepared evidence file before closing this package."); return; }
    if (assemblyDirty) { setError("Save or discard assembly settings before closing this package."); return; }
    if (signingDirty) { setError("Capture or discard the prepared signing changes before closing this package."); return; }
    if (workDirty) { setError("Save or discard the task changes before closing this package."); return; }
    if (consistencyDirty) { setError("Save or discard the relationship changes before closing this package."); return; }
    if (intakeDirty) { setError("Save, apply or discard the intake changes before closing this package."); return; }
    if (requirementsDirty) { setError("Save or discard the requirement changes before closing this package."); return; }
    if (starterDirty) { setError("Create or cancel the request starter before closing this package."); return; }
    if (informationDirty) { setError(UNSAVED_PACKAGE_INFORMATION); return; }
    if (typedDirty) { setError("Save or cancel the unfinished feedback before closing this package review."); return; }
    operation.current?.abort();
    active.current = false;
    onClose();
  }
  const [savedWorkspace] = useState(readPackageWorkspaceContext);
  const [workspaceSection, setWorkspaceSection] = useState<PackageWorkspaceSection>(savedWorkspace?.section ?? "overview");
  const [activeMemberId, setActiveMemberId] = useState<string | null>(savedWorkspace?.memberId ?? null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const dialogRoot = useRef<HTMLDivElement>(null), destinationOwner = useRef(''), destinationSequence = useRef(0);
  const [destination, setDestination] = useState<PackageDestinationRequest>();
  const documentsRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const deliveryRef = useRef<HTMLDivElement>(null);
  const resumed = useRef(false);
  const [original, setOriginal] = useState<{
    asset: PackageAsset;
    bytes: ArrayBuffer;
    policyIdentity: string;
    owner: string;
  } | null>(null);
  const [records, setRecords] = useState<ActionPackage[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [revisionId, setRevisionId] = useState("");
  const [name, setName] = useState(""),
    [role, setRole] = useState<PackageMember["role"]>("basic-letter"),
    [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [notice, setNotice] = useState("");
  const [typedDirty, setTypedDirty] = useState(false);
  useEffect(() => { if (!typedDirty) setError(previous => previous === "Save or cancel the unfinished feedback before closing this package review." ? "" : previous); }, [typedDirty]);
  const nameLimitId = useId();
  const nameTooLong = name.trim().length > 120;
  const validName = !!name.trim() && !nameTooLong;
  const [informationDirty, setInformationDirty] = useState(false);
  const [starterDirty, setStarterDirty] = useState(false);
  const [intakeDirty, setIntakeDirty] = useState(false), [requirementsDirty, setRequirementsDirty] = useState(false);
  const [consistencyDirty, setConsistencyDirty] = useState(false);
  const [workDirty, setWorkDirty] = useState(false);
  const [signingDirty, setSigningDirty] = useState(false);
  const [assemblyDirty, setAssemblyDirty] = useState(false);
  useEffect(() => { if (!assemblyDirty) setError(previous => previous === "Save or discard assembly settings before closing this package." ? "" : previous); }, [assemblyDirty]);
  useEffect(() => { if (!signingDirty) setError(previous => previous === "Capture or discard the prepared signing changes before closing this package." ? "" : previous); }, [signingDirty]);
  useEffect(() => {
    if (!workDirty) setError(previous => previous === "Save or discard the task changes before closing this package." ? "" : previous);
  }, [workDirty]);
  const [evidenceDirty, setEvidenceDirty] = useState(false);
  const deliverySearchEpoch = useRef(0);
  const [deliverySearch, setDeliverySearch] = useState<{ owner: string; scope: PackageSearchScope }>();
  useEffect(() => { if (!evidenceDirty) setError(previous => previous === "Add or discard the prepared evidence file before closing this package." ? "" : previous); }, [evidenceDirty]);
  const pendingPackageEdits = evidenceDirty || assemblyDirty || signingDirty || workDirty || typedDirty || informationDirty || starterDirty || intakeDirty || requirementsDirty || consistencyDirty;
  useEffect(() => {
    if (!consistencyDirty) setError(previous => previous === "Save or discard the relationship changes before closing this package." ? "" : previous);
  }, [consistencyDirty]);
  useEffect(() => {
    if (!pendingPackageEdits) setError(previous => previous === "Save or discard package edits before following a finding." ? "" : previous);
  }, [pendingPackageEdits]);
  useEffect(() => {
    if (!intakeDirty) setError(previous => previous === "Save, apply or discard the intake changes before closing this package." ? "" : previous);
  }, [intakeDirty]);
  useEffect(() => {
    if (!requirementsDirty) setError(previous => previous === "Save or discard the requirement changes before closing this package." ? "" : previous);
  }, [requirementsDirty]);
  useEffect(() => {
    if (!starterDirty) setError(previous => previous === "Create or cancel the request starter before closing this package." ? "" : previous);
  }, [starterDirty]);
  useEffect(() => {
    if (!informationDirty) setError(previous => previous === UNSAVED_PACKAGE_INFORMATION ? "" : previous);
  }, [informationDirty]);
  const [openedReview, setOpenedReview] = useState<PackageReviewRound | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [encryptedImport, setEncryptedImport] = useState<string | null>(null);
  const requestedPackageId = useUIStore(state => state.actionPackageSelectionId);
  const requestedRevisionId = useUIStore(state => state.actionPackageSelectionRevisionId);
  const inventoryLoaded = useRef(false);
  const [prepared, setPrepared] = useState<PreparedPackageAssembly | null>(
      null,
    ),
    [approved, setApproved] = useState(false);
  const [reviewMode, setReviewMode] = useState<
    "assemble" | "portable" | "saved" | "preview" | "original" | "compare"
  >("assemble");
  const [beforeOutputId, setBeforeOutputId] = useState(""),
    [afterOutputId, setAfterOutputId] = useState(""),
    [renderComparison, setRenderComparison] = useState<PackageRenderComparison | null>(null);
  const [selectedRetainedOutputId, setSelectedRetainedOutputId] = useState("");
  const [otherReviews, setOtherReviews] = useState<PreparedPackageAssembly[]>(
    [],
  );
  const [citationReorder, setCitationReorder] = useState<PreparedPackageCitationReorder | null>(null);
  const [comparison, setComparison] = useState<{
      member: NativePackageMember;
      source: SerializedSession;
    } | null>(null),
    [pdfUrl, setPdfUrl] = useState("");
  const docs = useDocumentsStore((state) => state.docs),
    currentId = useDocumentsStore((state) => state.currentId);
  const record = records.find((record) => record.id === selectedId),
    revision = record
      ? openedReview?.baseline ?? getPackageRevision(record, revisionId || record.currentRevisionId)
      : null;
  const readRecord: ActionPackage | undefined = record && openedReview ? { ...record, historyScope: "selected-revision", currentRevisionId: openedReview.revisionId, revisions: [openedReview.baseline], reviewRounds: undefined, reviewApplications: undefined, fieldReviewApplications: undefined, workingCopies: undefined } : record;
  const editable =
    !!record && !record.reviewRounds?.some(round => round.ownerPackageId === undefined) && !openedReview && revision?.id === record.currentRevisionId && !record.archived;
  const selectedMember = revision?.members.find(member => member.id === activeMemberId) ?? revision?.members[0];
  const selectedRetainedOutput = selectedRetainedOutputId
    ? revision?.outputs.find(output => output.id === selectedRetainedOutputId) : revision?.outputs.at(-1);
  const missingRetainedOutput = !!selectedRetainedOutputId && !selectedRetainedOutput;
  const selectionOwner = `${record?.id ?? ''}:${record?.sequence ?? ''}:${revision?.id ?? ''}:${openedReview?.id ?? ''}`;
  useLayoutEffect(() => { destinationOwner.current = selectionOwner; }, [selectionOwner]);
  function followDestination(target: PackageDestination) {
    if (!active.current || destinationOwner.current !== selectionOwner || !record || !revision) return;
    if (busy || pendingPackageEdits) { setError("Save or discard package edits before following a finding."); return; }
    if (target.reviewRoundId) {
      const round = record.reviewRounds?.find(item => item.id === target.reviewRoundId);
      if (!round || target.revisionId && round.revisionId !== target.revisionId) { setNotice("That exact review is not included in this package."); return; }
      const owner = selectionOwner;
      void run(async () => {
        const latest = (await listActionPackages()).find(item => item.id === record.id);
        if (!latest) throw new Error("This saved package is unavailable.");
        const captured = await openPackageReview(latest, round.id);
        assertOperationCurrent();
        if (target.revisionId && captured.revisionId !== target.revisionId) throw new Error("The review no longer matches this exact saved revision.");
        if (destinationOwner.current !== owner) return;
        update(latest); setOpenedReview(captured); setRevisionId(captured.revisionId); setWorkspaceSection("review");
        setDestination({ ...target, section: "review", packageId: latest.id, revisionId: captured.revisionId, requestId: ++destinationSequence.current });
      });
      return;
    }
    const selected = !target.revisionId || target.revisionId === revision.id ? revision : record.revisions.find(item => item.id === target.revisionId);
    if (!selected) { setNotice("That saved revision is not included in this package."); return; }
    const binding = target.bindingId && selected.bindings?.items.find(item => item.id === target.bindingId);
    const valid = target.bindingId ? !!binding && (!target.factId || binding.factId === target.factId) && (!target.memberId || binding.memberId === target.memberId)
      : target.factId ? !!selected.information?.facts.some(item => item.id === target.factId)
        : target.requirementId ? !!selected.requirements?.items.some(item => item.id === target.requirementId)
          : target.signingId ? !!selected.signing?.handoffs.some(item => item.id === target.signingId)
          : target.outputId ? selected.outputs.some(item => item.id === target.outputId)
            : target.citationId ? !!selected.citations && [...selected.citations.targets, ...selected.citations.links].some(item => item.id === target.citationId)
              : target.memberId ? selected.members.some(item => item.id === target.memberId) : true;
    if (!valid) { setNotice("That item is not available in the selected saved revision."); return; }
    if (selected.id !== revision.id) {
      setOpenedReview(null); setRevisionId(selected.id); setPrepared(null); setApproved(false); setComparison(null);
      setRenderComparison(null); setBeforeOutputId(""); setAfterOutputId(""); setPdfUrl("");
      setSelectedRetainedOutputId("");
    }
    if (target.outputId) {
      setSelectedRetainedOutputId(target.outputId); setPrepared(null); setApproved(false); setPdfUrl("");
    }
    if (target.memberId && !target.factId && !target.bindingId && !target.requirementId) setActiveMemberId(target.memberId);
    const section = target.signingId ? "delivery" : target.factId || target.bindingId || target.requirementId ? "overview" : target.panel ? target.section ?? (target.panel === "signing" ? "delivery" : "overview")
      : target.outputId ? "delivery" : target.citationId ? "documents" : target.section ?? (target.memberId ? "documents" : "overview");
    setWorkspaceSection(section);
    setNotice("");
    setDestination({ ...target, section, packageId: record.id, revisionId: selected.id, requestId: ++destinationSequence.current });
  }
  useEffect(() => {
    if (!destination || record?.id !== destination.packageId || revision?.id !== destination.revisionId) return;
    if (destination.factId || destination.bindingId || destination.requirementId) return;
    if (destination.signingId) return; // The signing panel focuses its exact captured handoff.
    if (destination.citationId) return; // Citation identities load asynchronously in their panel.
    if (destination.outputId) { focusPackageDestination(dialogRoot.current, 'data-package-output-id', destination.outputId); return; }
    if (destination.reviewRoundId) { focusPackageDestination(dialogRoot.current, 'data-package-review-id', destination.reviewRoundId); return; }
    if (destination.panel) { focusPackageDestination(dialogRoot.current, 'data-package-panel', destination.panel); return; }
    const target = destination.memberId
      ? document.getElementById(`package-member-${destination.memberId}`)
      : destination.section === "documents" ? documentsRef.current : destination.section === "review" ? reviewRef.current
        : destination.section === "delivery" ? deliveryRef.current : overviewRef.current;
    target?.focus({ preventScroll: true }); target?.scrollIntoView?.({ block: "start" });
  }, [destination, record?.id, revision?.id]);
  useEffect(() => {
    if (record && revision) rememberPackageWorkspaceContext({ version: 1, packageId: record.id, revisionId: revision.id,
      memberId: selectedMember?.id ?? null, section: workspaceSection });
  }, [record, revision, selectedMember?.id, workspaceSection]);
  useEffect(() => {
    if (!loaded || resumed.current) return;
    resumed.current = true;
    if (!savedWorkspace || requestedPackageId) return;
    const target = savedWorkspace.section === "documents"
      ? document.getElementById(`package-member-${savedWorkspace.memberId}`) ?? documentsRef.current
      : savedWorkspace.section === "delivery" ? deliveryRef.current : savedWorkspace.section === "review" ? reviewRef.current : overviewRef.current;
    target?.scrollIntoView?.({ block: "start" });
    target?.focus({ preventScroll: true });
  }, [loaded, savedWorkspace, requestedPackageId]);
  function navigate(section: PackageWorkspaceSection) {
    setWorkspaceSection(section);
    const target = section === "documents"
      ? document.getElementById(`package-member-${selectedMember?.id}`) ?? documentsRef.current
      : section === "delivery" ? deliveryRef.current : section === "review" ? reviewRef.current : overviewRef.current;
    target?.scrollIntoView?.({ block: "start" });
    target?.focus({ preventScroll: true });
  }
  function inspectMember(memberId: string) {
    setActiveMemberId(memberId); setWorkspaceSection("documents");
    const target = document.getElementById(`package-member-${memberId}`);
    target?.scrollIntoView?.({ block: "start" }); target?.focus({ preventScroll: true });
  }
  function rememberMember(memberId: string) {
    if (!record || !revision) return;
    setActiveMemberId(memberId); setWorkspaceSection("documents");
    rememberPackageWorkspaceContext({ version: 1, packageId: record.id, revisionId: revision.id, memberId, section: "documents" });
  }
  const beforeComparisonId = beforeOutputId || revision?.outputs.at(-2)?.id || "";
  const afterComparisonId = afterOutputId || revision?.outputs.at(-1)?.id || "";
  useEffect(() => {
    if (pendingPackageEdits || !requestedPackageId && inventoryLoaded.current) return;
    // A received selection supersedes work captured for the previous package.
    // Abort before loading inventory so late results cannot publish during that read.
    if (requestedPackageId) operation.current?.abort(RECEIVED_PACKAGE_SELECTION);
    let live = true;
    void listActionPackages()
      .then((records) => {
        if (live) {
          setRecords(records);
          setLoaded(true);
          inventoryLoaded.current = true;
          const explicit = records.find(record => record.id === requestedPackageId);
          const requested = explicit ?? (!requestedPackageId ? records.find(record => record.id === savedWorkspace?.packageId) : undefined);
          if (requested) {
            setOpenedReview(null);
            setSelectedId(requested.id);
            if (requestedRevisionId && !requested.revisions.some(revision => revision.id === requestedRevisionId))
              throw new Error("The reviewed package revision is no longer available. Reopen the share and review it again.");
            const restoredRevision = !explicit && requested.revisions.some(revision => revision.id === savedWorkspace?.revisionId)
              ? savedWorkspace!.revisionId : requested.currentRevisionId;
            setRevisionId(requestedRevisionId ?? restoredRevision);
            if (explicit) { setWorkspaceSection("overview"); setActiveMemberId(null); }
            setName(requested.name);
            setPrepared(null);
            setOriginal(null);
            setApproved(false);
            setComparison(null);
            setPdfUrl("");
            setBeforeOutputId("");
            setAfterOutputId("");
            setSelectedRetainedOutputId("");
            setRenderComparison(null);
            useUIStore.getState().clearActionPackageSelection();
          }
        }
      })
      .catch((error) => {
        if (live) setError(error.message);
      });
    return () => {
      live = false;
    };
  }, [requestedPackageId, requestedRevisionId, typedDirty, informationDirty, starterDirty, intakeDirty, requirementsDirty, consistencyDirty, workDirty, pendingPackageEdits, savedWorkspace]);
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );
  function select(value: ActionPackage) {
    setDestination(undefined);
    if (value.id !== selectedId) { setActiveMemberId(null); setWorkspaceSection("overview"); }
    setOpenedReview(null);
    setCitationReorder(null);
    setSelectedId(value.id);
    setRevisionId(value.currentRevisionId);
    setName(value.name);
    setPrepared(null);
    setOriginal(null);
    setComparison(null);
    setPdfUrl("");
    setApproved(false);
    setBeforeOutputId("");
    setAfterOutputId("");
    setSelectedRetainedOutputId("");
    setRenderComparison(null);
  }
  function update(value: ActionPackage) {
    assertOperationCurrent();
    setRecords((previous) => [
      ...previous.filter((record) => record.id !== value.id),
      value,
    ]);
    select(value);
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      if (!active.current || controller.signal.reason === RECEIVED_PACKAGE_SELECTION) return;
      if (controller.signal.aborted) {
        setPrepared(null);
        setApproved(false);
      }
      setError(
        controller.signal.aborted
          ? "Operation cancelled. Reopen the package to check its last complete revision."
          : error instanceof Error
            ? error.message
            : "The package operation failed.",
      );
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function modify(members: PackageMember[]) {
    if (record)
      update(
        await reviseActionPackage(record, members, operation.current?.signal),
      );
  }
  async function prepareCitationReorder(value: CitationReorderOperation) {
    if (!record) return;
    setCitationReorder(null);
    const result = await preparePackageCitationReorder(record, value, await getExportDeploymentPolicy(), operation.current?.signal);
    assertOperationCurrent();
    setCitationReorder(result);
  }
  async function reorderMembers(members: PackageMember[]) {
    if (revision?.citations) await prepareCitationReorder({ kind: "members", order: members.map(member => member.id) });
    else await modify(members);
  }
  async function review(mode: typeof reviewMode) {
    if (!record || !revision) return;
    if (mode === "saved" || mode === "preview") requireRetainedOutput();
    if (mode === "compare") {
      if (!beforeComparisonId || !afterComparisonId || beforeComparisonId === afterComparisonId)
        throw new Error("Choose two different retained PDFs from this revision.");
      if (revision.outputs.reduce((total, output) => total + output.asset.size, 0) > 25 * 1024 * 1024)
        throw new Error("This revision has more than 25 MB of retained PDFs. Comparison reviews every saved output before inspecting the selected pair. Their saved downloads remain available.");
      setRenderComparison(null);
    }
    const policy = await getExportDeploymentPolicy();
    if (policy.status !== "ready") throw new Error(policy.message);
    const result = mode === "compare"
      ? await (await import("@/lib/packageRenderComparison")).preparePackageRenderComparison(
          readRecord!, revision.id, policy, operation.current!.signal,
        )
      : await preparePackageAssembly(readRecord!, revision.id, policy, { includeRetainedDraftText: mode === "portable" });
    assertOperationCurrent();
    setOtherReviews([]);
    setReviewMode(mode);
    setPrepared(result);
    setApproved(false);
  }
  async function reviewOriginal(
    member: Exclude<PackageMember, { kind: "native" }>,
  ) {
    const policy = await getExportDeploymentPolicy();
    if (policy.status !== 'ready') throw new Error(policy.message);
    const bytes = await readPackageAsset(member.original);
    const review = member.kind === "attachment"
      ? (await (await import("@/lib/packageAttachmentCapabilities")).reviewPackageAttachment(member.original, bytes, policy, operation.current?.signal)).review
      : await reviewPackageOriginal(bytes, `${member.label}: ${member.original.name}`, policy);
    assertOperationCurrent();
    setOriginal({ asset: member.original, bytes, policyIdentity: policy.policy.identity, owner: selectionOwner });
    setReviewMode("original");
    setOtherReviews([]);
    setApproved(false);
    setPrepared({
      purpose: "pdf",
      revisionId: revision!.id,
      readiness: { state: "ready", findings: [] },
      reviews: [{ member: member.label, review }],
    });
  }
  async function previewAsset(asset: PackageAsset) {
    const bytes = await readPackageAsset(asset);
    assertOperationCurrent();
    setPdfUrl(
      URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
    );
  }
  function requireRetainedOutput() {
    if (!selectedRetainedOutput) throw new Error(selectedRetainedOutputId
      ? "The selected retained PDF is no longer included in this saved revision. Choose another retained PDF."
      : "This revision has no retained PDF.");
    return selectedRetainedOutput;
  }
  async function deliver() {
    if (!record || !revision || !prepared || !approved) return;
    assertOperationCurrent();
    if (reviewMode === "compare") {
      assertPreparedPackagePolicy(prepared, await getExportDeploymentPolicy());
      const { comparePreparedPackageOutputs } = await import("@/lib/packageRenderComparison");
      const result = await comparePreparedPackageOutputs(
        prepared, beforeComparisonId, afterComparisonId, operation.current!.signal,
      );
      assertOperationCurrent();
      assertPreparedPackagePolicy(prepared, await getExportDeploymentPolicy());
      assertOperationCurrent();
      const current = (await listActionPackages()).find(item => item.id === record.id);
      if (!current || current.sequence !== record.sequence || current.currentRevisionId !== record.currentRevisionId)
        throw new Error("The package changed during comparison. Reopen it and review the selected revision again.");
      assertPreparedPackagePolicy(prepared, getExportDeploymentPolicySync());
      assertOperationCurrent();
      setRenderComparison(result);
      setNotice("Comparison complete. The saved PDFs were not changed.");
    } else if (reviewMode === "original") {
      if (!original) throw new Error("Review the unchanged original again.");
      const policy = await getExportDeploymentPolicy();
      assertOperationCurrent();
      const sync = getExportDeploymentPolicySync();
      if (destinationOwner.current !== original.owner || policy.status !== 'ready' || sync.status !== 'ready'
        || policy.policy.identity !== original.policyIdentity || sync.policy.identity !== original.policyIdentity)
        throw new Error('The package context or export policy changed. Review this original again.');
      triggerDownload(
        new Uint8Array(original.bytes),
        original.asset.name,
        original.asset.type,
      );
    } else if (reviewMode === "portable") {
      assertPreparedPackagePolicy(prepared, await getExportDeploymentPolicy());
      assertOperationCurrent();
      const json = await buildPortableActionPackage(
        readRecord!,
        revision.id,
        async (asset) =>
          revision.outputs.some((output) => output.asset.id === asset.id)
            ? copyPreparedPackageOutput(prepared, asset.id)
            : readPackageAsset(asset),
      );
      assertOperationCurrent();
      assertPreparedPackagePolicy(prepared, await getExportDeploymentPolicy());
      assertOperationCurrent();
      assertPreparedPackagePolicy(prepared, getExportDeploymentPolicySync());
      triggerDownload(
        new TextEncoder().encode(json),
        `${record.name.replace(/[^a-z0-9_-]/gi, "_")}.dondocs-package.json`,
        "application/json",
      );
      setNotice(
        "Editable package downloaded, including the selected revision and its original files.",
      );
    } else if (reviewMode === "preview" || reviewMode === "saved") {
      const output = requireRetainedOutput();
      assertPreparedPackagePolicy(prepared, await getExportDeploymentPolicy());
      assertOperationCurrent();
      assertPreparedPackagePolicy(prepared, getExportDeploymentPolicySync());
      const bytes = copyPreparedPackageOutput(prepared, output.asset.id);
      if (reviewMode === "preview") setPdfUrl(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
      else {
        triggerDownload(new Uint8Array(bytes), output.asset.name, output.asset.type);
        setNotice(`Retained PDF downloaded. SHA-256: ${output.asset.sha256}`);
      }
    } else {
      const release = exportGate.acquire();
      if (!release)
        throw new Error(
          "Another export is still running. Wait for it to finish before assembling this package.",
        );
      let updated: ActionPackage;
      try {
        updated = await assemblePackage(
          prepared,
          ports,
          operation.current?.signal,
        );
      } finally {
        release();
      }
      update(updated);
      const output = getPackageRevision(updated, revision.id).outputs.at(-1)!;
      setRevisionId(revision.id);
      setSelectedRetainedOutputId(output.id);
      await previewAsset(output.asset);
      setNotice(`Assembled PDF retained. SHA-256: ${output.asset.sha256}`);
    }
    setPrepared(null);
    setApproved(false);
  }
  const comparedSource = comparison?.source;
  return (
    <><Dialog
      open
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent ref={dialogRoot} className="p-3 sm:max-w-6xl sm:p-6" aria-busy={busy} showCloseButton={!pendingPackageEdits}>
        <DialogHeader>
          <DialogTitle>Action packages</DialogTitle>
          <DialogDescription>
            Preserve editable members, original files and assembled PDFs by
            revision. Review linked citation reorders before saving a new revision.
          </DialogDescription>
        </DialogHeader>
        <PackageWorkspaceNavigation active={workspaceSection} hasPackage={!!record} disabled={busy || pendingPackageEdits} onNavigate={navigate} />
        <div ref={overviewRef} tabIndex={-1} className="min-w-0 scroll-mt-4 space-y-4">
        {record && revision && <PackageWorkspaceSummary record={record} revision={revision} />}

        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="break-all text-sm">
            {notice}
          </p>
        )}
        <fieldset disabled={!loaded || busy || pendingPackageEdits} className="min-w-0 scroll-mt-4 space-y-4">
          <legend className="mb-2 text-sm font-medium">Start or open a package</legend>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            Saved packages
            <select
              aria-label="Saved packages"
              className="mt-1 w-full rounded border bg-background p-2"
              value={selectedId}
              onChange={(event) => {
                const found = records.find(
                  (record) => record.id === event.target.value,
                );
                if (found) select(found);
              }}
            >
              <option value="">Choose a package</option>
              {records.map((record) => (
                <option value={record.id} key={record.id}>
                  {record.name}
                  {record.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          {record && revision && <>
              <label className="block text-sm">
                Package revision
                <select
                  aria-label="Package revision"
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={revision.id}
                  onChange={(event) => {
                    setDestination(undefined);
                    setOpenedReview(null);
                    setRevisionId(event.target.value);
                    setSelectedRetainedOutputId("");
                    setPrepared(null);
                    setApproved(false);
                    setComparison(null);
                    setPdfUrl("");
                    setBeforeOutputId("");
                    setAfterOutputId("");
                    setRenderComparison(null);
                  }}
                >
                  {[...record.revisions].reverse().map((revision, index) => (
                    <option key={revision.id} value={revision.id}>
                      {record.historyScope === "selected-revision" ? `Saved revision ${revision.id.slice(-8)}` : `Revision ${record.revisions.length - index}`} ·{" "}
                      {new Date(revision.createdAt).toLocaleString()}
                      {revision.id === record.currentRevisionId
                        ? " (current)"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
          </>}
          </div>
          {record && revision && <>
              <p className="text-xs text-muted-foreground break-all">
                Revision ID: {revision.id}. Source changes never update captured
                members automatically. Signed originals remain separate;
                assembled output has no inherited signature or approval.
              </p>
          </>}
        </fieldset>
        <Suspense fallback={<p>Loading action intake…</p>}>
          <PackageIntakePanel record={record} revision={revision ?? undefined} editable={editable} disabled={!loaded || typedDirty || informationDirty || starterDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty}
            busy={busy} run={run} onApply={update} onDirtyChange={setIntakeDirty}
            signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
        </Suspense>
        <details className="min-w-0 rounded border p-3">
          <summary className="cursor-pointer text-sm font-medium">Quick request starter{starterDirty ? " · unsaved" : ""}</summary>
        <Suspense fallback={<p>Loading request starter…</p>}>
          <AdministrativeRequestStarter disabled={!loaded || typedDirty || informationDirty || intakeDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty} busy={busy} run={run}
            signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted}
            onDirtyChange={setStarterDirty} onCreate={value => { update(value); setNotice("Request package created. Review its letter and worksheet before submission."); }} />
        </Suspense>
        </details>
        <fieldset disabled={!loaded || busy || pendingPackageEdits} className="min-w-0 scroll-mt-4 space-y-4">
          <legend className="mb-2 text-sm font-medium">Blank packages, templates and imports</legend>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-sm">
              Package name
              {/* Native maxlength can drop a full-length Unicode replacement on mobile; validate commits instead. */}
              <input
                aria-label="Package name"
                className="mt-1 w-full rounded border bg-background p-2"
                aria-invalid={nameTooLong || undefined}
                aria-describedby={nameTooLong ? nameLimitId : undefined}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {nameTooLong && <span id={nameLimitId} role="status" className="mt-1 block text-xs text-destructive">Use a package name of 120 characters or fewer.</span>}
            </label>
            <Button
              disabled={!loaded || !validName}
              onClick={() =>
                void run(async () =>
                  update(
                    await createActionPackage(name, operation.current?.signal),
                  ),
                )
              }
            >
              Create package
            </Button>
            <label className="cursor-pointer rounded border p-2 text-sm">
              Import editable package
              <input
                aria-label="Import editable package"
                type="file"
                accept=".json,.zip,application/zip"
                className="sr-only"
                disabled={!loaded || busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file)
                    void run(async () => {
                      if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
                        const { importPackageDeliveryBundle, MAX_PACKAGE_DELIVERY_BUNDLE_BYTES } = await import("@/lib/packageDeliveryBundle");
                        if (file.size > MAX_PACKAGE_DELIVERY_BUNDLE_BYTES) throw new Error("Delivery bundles are limited to 200 MB.");
                        const bytes = new Uint8Array(await file.arrayBuffer()); assertOperationCurrent();
                        update(await importPackageDeliveryBundle(bytes, operation.current?.signal, () => active.current && !operation.current?.signal.aborted));
                        return;
                      }
                      if (file.size > MAX_ENCRYPTED_SHARE_FILE_BYTES)
                        throw new Error(
                          "This package file exceeds the encrypted transfer limit.",
                        );
                      const json = await file.text();
                      assertOperationCurrent();
                      const value: unknown = JSON.parse(json);
                      if (value && typeof value === "object" && "kind" in value && value.kind === "dondocs-encrypted-share") {
                        setEncryptedImport(parseEncryptedShareFile(json));
                        return;
                      }
                      if (file.size > MAX_PACKAGE_FILE_BYTES) throw new Error("Editable packages are limited to 100 MB.");
                      update(
                        await importPortableActionPackage(
                          json,
                          operation.current?.signal,
                        ),
                      );
                    });
                }}
              />
            </label>
          </div>
          <Suspense fallback={<p>Loading package review files…</p>}>
            <PackageReviewTransfer record={record} round={openedReview} busy={busy} run={run} signal={() => operation.current?.signal}
              isCurrent={() => active.current && !operation.current?.signal.aborted} onImport={value => {
                update(value); const round = value.reviewRounds![0]; setOpenedReview(round); setRevisionId(round.revisionId);
              }} />
          </Suspense>
          <details className="rounded border p-3">
          <summary className="cursor-pointer text-sm font-medium">Reusable package templates</summary>
          <Suspense fallback={<p>Loading package templates…</p>}>
            <PackageTemplatePanel record={openedReview ? undefined : record} revisionId={revision?.id} busy={busy || typedDirty}
              run={run} signal={() => operation.current?.signal} isCurrent={() => active.current}
              onCreate={update} />
          </Suspense>
          </details>

        </fieldset>
        {record && revision && (revision.requirements !== undefined || !!revision.templateState) && <Suspense fallback={<p role="status">Loading evidence requirements…</p>}>
          <PackageRequirementsPanel record={record} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty}
            busy={busy} run={run} onApply={update} onDirtyChange={setRequirementsDirty}
            destination={destination}
            signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
        </Suspense>}
        {readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Work and next actions{workDirty ? " · unsaved changes" : revision.work?.tasks.length ? ` · ${revision.work.tasks.filter(task => task.status === 'pending').length} open` : ""}</summary>
          <div tabIndex={-1} data-package-panel="work" className="pt-3"><Suspense fallback={<p role="status">Loading package work…</p>}>
            <PackageWorkPanel record={readRecord} revision={revision} reviewBaseline={!!openedReview} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || requirementsDirty || consistencyDirty || signingDirty || assemblyDirty || evidenceDirty}
              busy={busy} run={run} onApply={update} onDirtyChange={setWorkDirty} onNavigate={followDestination}
              signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
        {record && revision && <details className="min-w-0 rounded border p-3">
          <summary className="cursor-pointer text-sm font-medium">Consistency checks{consistencyDirty ? " · unsaved changes" : revision.consistency?.rules.length ? ` · ${revision.consistency.rules.length} ${revision.consistency.rules.length === 1 ? 'relationship' : 'relationships'}` : ""}</summary>
          <div tabIndex={-1} data-package-panel="consistency" className="pt-3">
            <Suspense fallback={<p role="status">Loading consistency checks…</p>}>
              <PackageConsistencyPanel record={record} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || requirementsDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty}
                busy={busy} run={run} onApply={update} onDirtyChange={setConsistencyDirty} onNavigate={followDestination}
                signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
            </Suspense>
          </div>
        </details>}
        {readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Change impact</summary>
          <div className="pt-3"><Suspense fallback={<p role="status">Loading change impact…</p>}>
            <PackageChangeImpactPanel record={readRecord} revision={revision} disabled={pendingPackageEdits} busy={busy} run={run}
              onNavigate={followDestination} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
        {record && revision && <Suspense fallback={<p role="status">Loading package information…</p>}>
          <PackageInformationPanel record={record} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty} busy={busy} run={run} onApply={update}
            destination={destination}
            onDirtyChange={setInformationDirty} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
        </Suspense>}
        {readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Search captured package</summary>
          <div className="min-w-0 pt-3"><Suspense fallback={<p role="status">Opening captured package search…</p>}>
            <PackageSearchPanel record={readRecord} revision={revision} disabled={pendingPackageEdits} busy={busy} run={run} onNavigate={followDestination}
              delivery={deliverySearch?.owner === selectionOwner ? deliverySearch.scope : undefined}
              signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
        {readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Assembly layout{assemblyDirty ? " · unsaved settings" : ""}</summary>
          <div className="min-w-0 pt-3"><Suspense fallback={<p role="status">Opening assembly settings…</p>}>
            <PackageAssemblyPanel record={readRecord} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || evidenceDirty}
              busy={busy} run={run} onApply={update} onDirtyChange={setAssemblyDirty} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
        {record && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Supporting evidence files{evidenceDirty ? " · awaiting review" : ""}</summary>
          <div className="pt-3"><Suspense fallback={<p role="status">Loading supporting files…</p>}>
            <PackageEvidencePanel record={record} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty}
              busy={busy} run={run} onApply={update} onDirtyChange={setEvidenceDirty} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
        </div>
        <fieldset disabled={informationDirty || starterDirty || intakeDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty} aria-label="Package documents, review and delivery" className="min-w-0 space-y-4">

          {record && revision && (
            <>
              <fieldset disabled={busy || typedDirty} className="min-w-0 space-y-4">
              <Button variant="outline" disabled={!!openedReview} onClick={() => setShareOpen(true)}>Share encrypted package</Button>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!validName}
                  onClick={() =>
                    void run(async () =>
                      update(
                        await renameActionPackage(
                          record,
                          name,
                          operation.current?.signal,
                        ),
                      ),
                    )
                  }
                >
                  Rename
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void run(async () =>
                      update(
                        await duplicateActionPackage(
                          record,
                          undefined,
                          operation.current?.signal,
                        ),
                      ),
                    )
                  }
                >
                  Duplicate
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void run(async () =>
                      update(
                        await archiveActionPackage(
                          record,
                          !record.archived,
                          operation.current?.signal,
                        ),
                      ),
                    )
                  }
                >
                  {record.archived ? "Reopen archived package" : "Archive"}
                </Button>
              </div>
              <div ref={reviewRef} tabIndex={-1} className="scroll-mt-4 space-y-4">
              <PackageReviewControls record={record} disabled={busy} opened={openedReview} onExit={() => select(record)}
                onStart={() => void run(async () => {
                  const next = await startPackageReview(record, revision.id, `Package review ${(record.reviewRounds?.length ?? 0) + 1}`, operation.current?.signal, () => active.current);
                  update(next);
                  const round = await openPackageReview(next, next.reviewRounds!.at(-1)!.id);
                  assertOperationCurrent(); setOpenedReview(round); setRevisionId(round.revisionId);
                })}
                onOpen={roundId => void run(async () => {
                  const latest = (await listActionPackages()).find(value => value.id === record.id);
                  if (!latest) throw new Error("This saved package is unavailable.");
                  const round = await openPackageReview(latest, roundId);
                  update(latest); setOpenedReview(round); setRevisionId(round.revisionId);
                })}
                onTransition={(roundId, transition) => void run(async () => {
                  const next = await transitionPackageReview(record, roundId, transition, undefined, operation.current?.signal, () => active.current);
                  update(next);
                  const round = await openPackageReview(next, roundId);
                  assertOperationCurrent(); setOpenedReview(round); setRevisionId(round.revisionId);
                })} />
              {openedReview?.ownerPackageId === record.id && <Suspense fallback={<p>Loading feedback application…</p>}>
                <PackageReviewApplicationPanel key={`${record.id}:${record.sequence}:${openedReview.id}`} record={record} round={openedReview} busy={busy} run={run}
                  signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted}
                  onApply={next => { update(next); setOpenedReview(null); setRevisionId(next.currentRevisionId); }} />
              </Suspense>}
              </div>
              </fieldset>
              {openedReview && <Suspense fallback={<p>Loading member review…</p>}>
                <PackageMemberReviewPanel key={openedReview.id} record={record} round={openedReview} busy={busy} run={run} onDraftChange={setTypedDirty} signal={() => operation.current?.signal}
                  onChange={(next, round) => { update(next); setOpenedReview(round); setRevisionId(round.revisionId); }} />
              </Suspense>}
              <fieldset disabled={busy || typedDirty} className="min-w-0 space-y-4">
              <div ref={documentsRef} tabIndex={-1} className="min-w-0 scroll-mt-4 space-y-4">
              {editable && (
                <div className="space-y-2 rounded border p-3">
                  <label className="block text-sm">
                    New member role
                    <select
                      aria-label="New member role"
                      className="ml-2 rounded border bg-background p-2"
                      value={role}
                      onChange={(event) =>
                        setRole(event.target.value as typeof role)
                      }
                    >
                      {packageRoles.map((role) => (
                        <option key={role}>{role}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        void run(async () => {
                          const captured = captureCurrentDocumentRevision();
                          const member = await capturePackageMember(
                            captured,
                            docs[currentId!]?.meta.title || "Native member",
                            role,
                          );
                          await modify([...revision.members, member]);
                        })
                      }
                    >
                      Capture current document
                    </Button>
                    <label className="cursor-pointer rounded border p-2 text-sm">
                      Add original PDF
                      <input
                        aria-label="Add original PDF"
                        type="file"
                        accept="application/pdf,.pdf"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file)
                            void run(async () => {
                              if (file.size > 25 * 1024 * 1024)
                                throw new Error(
                                  "Original files are limited to 25 MB.",
                                );
                              await modify([
                                ...revision.members,
                                await captureOriginalPackageMember(
                                  {
                                    name: file.name,
                                    data: await file.arrayBuffer(),
                                  },
                                  role,
                                  signed,
                                ),
                              ]);
                            });
                        }}
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={signed}
                      onChange={(event) => setSigned(event.target.checked)}
                    />
                    Uploaded original is signed (preserve unchanged)
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Existing native correspondence and forms, plus original
                    PDFs, are supported. Native draft files including embedded
                    assets: 25 MB each. Portable resources: 75 MB total, 256
                    entries.
                  </p>
                </div>
              )}
              <div className="grid min-w-0 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
              <PackageMemberNavigation members={revision.members} selectedId={selectedMember?.id} disabled={busy || typedDirty} onSelect={inspectMember} />
              <ol className="min-w-0 space-y-3">
                {revision.members.map((member, index) => {
                  const source =
                    member.kind === "native" &&
                    member.source?.local &&
                    docs[member.source.documentId];
                  const working = record.workingCopies?.find(
                    (copy) =>
                      copy.memberId === member.id &&
                      copy.revisionId === record.currentRevisionId,
                  );
                  return (
                    <li
                      key={member.id}
                      id={`package-member-${member.id}`}
                      tabIndex={-1}
                      data-selected={selectedMember?.id === member.id || undefined}
                      className={`min-w-0 scroll-mt-4 space-y-2 rounded border p-3 ${selectedMember?.id === member.id ? "border-primary/40" : ""}`}
                    >
                      <h3 className="break-words font-medium">
                        {index + 1}. {member.label}
                      </h3>
                      <p className="break-all text-xs text-muted-foreground">
                        {member.role} ·{" "}
                        {member.kind === "original"
                          ? member.signedOriginal
                            ? "Original PDF (marked signed)"
                            : "Original PDF"
                          : member.kind === "attachment" ? `Supporting file (${member.original.type})` : "Captured native draft"}{" "}
                        · Member revision: {member.revisionId}
                      </p>
                      {member.kind === "native" && (
                        <p className="break-all text-xs">
                          Source:{" "}
                          {source && !source.meta.deletedAt
                            ? source.meta.title
                            : member.source?.local
                              ? "unavailable; preserved copy retained"
                              : member.source
                                ? "foreign provenance; no local binding"
                                : "No library source recorded"}
                          {member.source && <> · Captured{" "}{new Date(member.source.capturedAt).toLocaleString()}</>}
                        </p>
                      )}
                      {working && (
                        <p className="text-xs">
                          Working copy:{" "}
                          {docs[working.documentId]?.meta.title ||
                            "unavailable"}
                          . Changes remain outside the saved package until you
                          save a new revision.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {editable && (
                          <>
                            <label className="text-xs">
                              Role
                              <select
                                aria-label={`Role for ${member.label}`}
                                className="ml-1 rounded border bg-background p-1"
                                value={member.role}
                                onChange={(event) =>
                                  void run(() =>
                                    modify(
                                      revision.members.map((item): PackageMember =>
                                        item.id === member.id
                                          ? packageMemberSchema.parse({ ...item, role: event.target.value })
                                          : item,
                                      ),
                                    ),
                                  )
                                }
                              >
                                {packageRoles.filter(role => member.kind !== "attachment" || !["basic-letter", "endorsement"].includes(role)).map((role) => (
                                  <option key={role}>{role}</option>
                                ))}
                              </select>
                            </label>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={index === 0}
                              onClick={() =>
                                void run(async () => {
                                  const members = [...revision.members];
                                  [members[index - 1], members[index]] = [
                                    members[index],
                                    members[index - 1],
                                  ];
                                  await reorderMembers(members);
                                })
                              }
                            >
                              Move up
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={index === revision.members.length - 1}
                              onClick={() =>
                                void run(async () => {
                                  const members = [...revision.members];
                                  [members[index + 1], members[index]] = [
                                    members[index],
                                    members[index + 1],
                                  ];
                                  await reorderMembers(members);
                                })
                              }
                            >
                              Move down
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void run(() =>
                                  modify(
                                    revision.members.filter(
                                      (item) => item.id !== member.id,
                                    ),
                                  ),
                                )
                              }
                            >
                              Remove
                            </Button>
                          </>
                        )}
                        {member.kind === "native" && editable && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void run(async () => {
                                  rememberMember(member.id);
                                  update(
                                    await editPackageMember(
                                      record,
                                      member,
                                      operation.current?.signal,
                                    ),
                                  );
                                  onClose();
                                })
                              }
                            >
                              Edit working copy
                            </Button>
                            {working && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    rememberMember(member.id);
                                    useDocumentsStore
                                      .getState()
                                      .switchTo(working.documentId);
                                    onClose();
                                  }}
                                >
                                  Open working copy
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={working.documentId !== currentId}
                                  onClick={() =>
                                    void run(async () =>
                                      update(
                                        await savePackageWorkingCopy(
                                          record,
                                          member,
                                          operation.current?.signal,
                                        ),
                                      ),
                                    )
                                  }
                                >
                                  Save working copy as new revision
                                </Button>
                              </>
                            )}
                            {source && !source.meta.deletedAt && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setComparison({
                                    member,
                                    source: structuredClone(source.session),
                                  })
                                }
                              >
                                Compare newer source
                              </Button>
                            )}
                          </>
                        )}
                        {member.kind !== "native" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void run(() => reviewOriginal(member))
                            }
                          >
                            Download unchanged original
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              </div>
              </div>
              {comparison && comparedSource && (
                <section className="space-y-3 rounded border p-3">
                  <h3 className="font-medium">
                    Compare captured member with library source
                  </h3>
                  <SessionChanges
                    before={comparison.member.session}
                    after={comparedSource}
                    highlightText
                  />
                  <p className="text-xs">
                    Adopting captures the selected source and its current files
                    as a new revision. Older members and outputs remain
                    preserved.
                  </p>
                  <Button
                    onClick={() =>
                      void run(async () =>
                        update(
                          await adoptPackageSource(
                            record,
                            comparison.member,
                            comparison.source,
                            operation.current?.signal,
                          ),
                        ),
                      )
                    }
                  >
                    Adopt source as new revision
                  </Button>
                  <Button variant="ghost" onClick={() => setComparison(null)}>
                    Cancel comparison
                  </Button>
                </section>
              )}
              <div ref={deliveryRef} tabIndex={-1} className="flex scroll-mt-4 flex-wrap gap-2">
                {(revision.outputs.length > 1 || missingRetainedOutput) && <label className="w-full min-w-0 text-sm sm:max-w-xl">
                  Retained PDF to open
                  <select aria-label="Retained PDF to open" disabled={busy || pendingPackageEdits}
                    className="mt-1 w-full min-w-0 rounded border bg-background p-2"
                    value={selectedRetainedOutputId || selectedRetainedOutput?.id || ""}
                    onChange={event => {
                      if (busy || pendingPackageEdits) return;
                      setSelectedRetainedOutputId(event.target.value); setPrepared(null); setApproved(false); setPdfUrl(""); setNotice(""); setError("");
                    }}>
                    {missingRetainedOutput && <option value={selectedRetainedOutputId}>Selected PDF unavailable</option>}
                    {revision.outputs.map((output, index) => <option key={output.id} value={output.id}>
                      Saved PDF {index + 1} · {output.asset.name}{index === revision.outputs.length - 1 ? " (latest)" : ""}
                    </option>)}
                  </select>
                </label>}
                {missingRetainedOutput && <p role="alert" className="w-full break-words text-sm text-destructive">The selected retained PDF is no longer included in this saved revision. Choose another retained PDF.</p>}
                <Button disabled={!!openedReview} onClick={() => void run(() => review("assemble"))}>
                  Check readiness and assemble
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void run(() => review("portable"))}
                >
                  Export editable package
                </Button>
                {revision.outputs.length > 0 && (
                  <>
                    <Button
                      variant="outline"
                      disabled={!selectedRetainedOutput}
                      onClick={() => void run(() => review("saved"))}
                    >
                      Download retained PDF
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!selectedRetainedOutput}
                      onClick={() => void run(() => review("preview"))}
                    >
                      Preview retained PDF
                    </Button>
                  </>
                )}
              </div>
              <Suspense fallback={<p className="text-sm">Opening saved PDF contents…</p>}>
                <PackageOutputNavigation output={selectedRetainedOutput} revision={revision} disabled={busy || pendingPackageEdits}
                  onNavigate={followDestination} onOpenPage={(outputId, page) => {
                    if (busy || pendingPackageEdits || outputId !== selectedRetainedOutput?.id) return;
                    useUIStore.getState().rememberPreviewPage(`package:${record.id}:${revision.id}:${outputId}`, page);
                    setPdfUrl(""); void run(() => review("preview"));
                  }} />
              </Suspense>
              <PackageCitations key={`citations:${record.id}:${revision.id}`} record={record} revision={revision} editable={editable} destination={destination}
                onChange={action => void run(async () => update(await action(operation.current?.signal)))} />
              <PackageCitationReorder key={`reorder-${record.id}:${revision.id}:${record.sequence}`} record={record} revision={revision} editable={editable} prepared={citationReorder}
                onPrepare={value => void run(() => prepareCitationReorder(value))} onDiscard={() => setCitationReorder(null)}
                onChange={action => void run(async () => update(await action(operation.current?.signal)))} />
              <WordPackageDownload key={`${record.id}:${revision.id}`} record={readRecord!} revisionId={revision.id} ports={ports} exportGate={exportGate} />
              {revision.outputs.length > 1 && (
                <section className="space-y-3 rounded border p-3" aria-label="Compare saved renderings">
                  <h3 className="font-medium">Compare saved renderings</h3>
                  <p className="text-sm">Use “Check readiness and assemble” to retain a new rendering of this exact revision, then compare it with an earlier saved PDF. Existing outputs are preserved.</p>
                  {(["before", "after"] as const).map(side => (
                    <label className="block text-sm" key={side}>
                      {side === "before" ? "Earlier retained PDF" : "Later retained PDF"}
                      <select disabled={busy} className="mt-1 w-full rounded border bg-background p-2"
                        value={side === "before" ? beforeComparisonId : afterComparisonId}
                        onChange={event => {
                          (side === "before" ? setBeforeOutputId : setAfterOutputId)(event.target.value);
                          setPrepared(null); setApproved(false); setRenderComparison(null);
                        }}>
                        {revision.outputs.map((output, index) => <option key={output.id} value={output.id}>Saved PDF {index + 1} · {new Date(output.createdAt).toLocaleString()}</option>)}
                      </select>
                    </label>
                  ))}
                  <Button variant="outline" disabled={busy || beforeComparisonId === afterComparisonId}
                    onClick={() => void run(() => review("compare"))}>Review PDF comparison</Button>
                </section>
              )}
              {renderComparison && <PackageRenderComparisonView comparison={renderComparison} />}
              {prepared && (
                <section className="space-y-3 rounded border p-3">
                  <h3 className="font-medium">
                    {prepared.purpose === "portable" ? "Editable transfer checks" : "Package readiness"}: {prepared.readiness.state}
                  </h3>
                  {[prepared, ...otherReviews].flatMap((result, group) =>
                    result.readiness.findings.map((finding, index) => (
                      <p
                        key={`${group}-${index}`}
                        className="break-words text-sm"
                      >
                        {finding.severity === "error"
                          ? "Required: "
                          : "Review: "}
                        {revision.members.find(
                          (member) => member.id === finding.memberId,
                        )?.label
                          ? `${revision.members.find((member) => member.id === finding.memberId)!.label}: `
                          : ""}
                        {finding.message}
                      </p>
                    )),
                  )}
                  {[prepared, ...otherReviews].flatMap((result, group) =>
                    result.reviews.map((entry, index) => (
                      <div key={`${group}-${index}`} className="text-sm">
                        <p className="font-medium">{entry.member}</p>
                        {entry.review.privacy.findings.map((match, i) => (
                          <p key={i}>
                            {match.type}: {match.value}
                          </p>
                        ))}
                        {entry.review.structure.map((finding, i) => (
                          <p key={i}>{finding.message}</p>
                        ))}
                        {entry.review.notices.map((notice, i) => (
                          <p key={i}>{notice}</p>
                        ))}
                        {entry.review.markingReview && (
                          <p>Review classification markings.</p>
                        )}
                      </div>
                    )),
                  )}
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={(event) => setApproved(event.target.checked)}
                    />
                    I reviewed every included member, privacy findings,
                    markings, citations and original PDFs for this operation.
                    The assembled derivative is unsigned.
                  </label>
                  <Button
                    disabled={
                      !approved ||
                      [prepared, ...otherReviews].some((result) =>
                        ["draft", "incomplete"].includes(
                          result.readiness.state,
                        ),
                      )
                    }
                    onClick={() => void run(deliver)}
                  >
                    {reviewMode === "assemble"
                      ? "Assemble and retain PDF"
                      : reviewMode === "portable"
                        ? "Download reviewed editable package"
                        : reviewMode === "compare"
                          ? "Compare reviewed retained PDFs"
                        : reviewMode === "preview"
                          ? "Preview reviewed retained PDF"
                          : reviewMode === "original"
                            ? "Download reviewed unchanged original"
                            : "Download reviewed retained PDF"}
                  </Button>
                </section>
              )}
              {revision.outputs.map((output) => (
                <div key={output.id} tabIndex={-1} data-package-output-id={output.id} className="break-all space-y-1 text-xs">
                  <p>
                    Retained output {output.id} · SHA-256 {output.asset.sha256}
                  </p>
                  <p>
                    {output.renderer} · unsigned assembled derivative. Retrieval
                    preserves exact bytes; future re-rendering depends on
                    available renderer resources and can produce different
                    bytes.
                  </p>
                  {output.boundaries.map((boundary) => (
                    <p key={boundary.memberId}>
                      {
                        revision.members.find(
                          (member) => member.id === boundary.memberId,
                        )?.label
                      }
                      : PDF pages {boundary.startPage}–
                      {boundary.startPage + boundary.pageCount - 1};{" "}
                      {boundary.numbering}, first label{" "}
                      {boundary.firstPageLabel}.
                    </p>
                  ))}
                </div>
              ))}
              {pdfUrl && (
                <section
                  role="region"
                  aria-label="Retained package PDF"
                  className="h-[60vh] min-h-64 w-full overflow-hidden rounded border"
                >
                  <Suspense
                    fallback={
                      <p className="p-3 text-sm">Loading retained PDF…</p>
                    }
                  >
                    <RetainedPdfViewer
                      key={`package:${record.id}:${revision.id}:${selectedRetainedOutput?.id}`}
                      documentId={`package:${record.id}:${revision.id}:${selectedRetainedOutput?.id}`}
                      pdfUrl={pdfUrl}
                      showFullscreen={false}
                      toolbarLabel="Retained package PDF"
                    />
                  </Suspense>
                </section>
              )}
              </fieldset>
            </>
          )}
        </fieldset>
        {readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Package signing{signingDirty ? " · awaiting capture" : ""}</summary>
          <div className="min-w-0 pt-3"><Suspense fallback={<p role="status">Opening package signing…</p>}>
            <PackageSigningPanel record={readRecord} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || requirementsDirty || consistencyDirty || workDirty || assemblyDirty || evidenceDirty}
              busy={busy} run={run} onApply={update} destination={destination} onNavigate={followDestination} onDirtyChange={setSigningDirty} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
        {record && readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Recipient delivery</summary>
          <div className="min-w-0 pt-3"><Suspense fallback={<p role="status">Opening recipient delivery…</p>}>
            <PackageDeliveryPanel record={record} revision={revision} disabled={pendingPackageEdits} ports={ports}
              onPreparedChange={prepared => {
                if (!active.current || destinationOwner.current !== selectionOwner) return;
                const epoch = ++deliverySearchEpoch.current;
                if (!prepared) { setDeliverySearch(undefined); return; }
                if (prepared.sourcePackageId !== record.id || prepared.sourceRevisionId !== revision.id) return;
                void import("@/lib/packageDelivery").then(({ copyPreparedPackageDeliveryProjection, readPreparedPackageDeliveryAsset, assertPackageDeliveryCurrent }) => {
                  if (!active.current || deliverySearchEpoch.current !== epoch || destinationOwner.current !== selectionOwner) return;
                  setDeliverySearch({ owner: selectionOwner, scope: { key: prepared.revisionId, label: prepared.packageName,
                    record: copyPreparedPackageDeliveryProjection(prepared), revisionId: prepared.revisionId, sourceRevisionId: revision.id,
                    readAsset: async asset => {
                      const current = () => active.current && deliverySearchEpoch.current === epoch && destinationOwner.current === selectionOwner;
                      if (!current()) throw new Error('This captured delivery is no longer selected. Prepare it again.');
                      await assertPackageDeliveryCurrent(prepared, await getExportDeploymentPolicy(), undefined, current);
                      return readPreparedPackageDeliveryAsset(prepared, asset);
                    } } });
                }).catch(cause => { if (active.current && deliverySearchEpoch.current === epoch && destinationOwner.current === selectionOwner) setError(cause instanceof Error ? cause.message : "Delivery search could not be prepared."); });
              }}
              busy={busy} run={run} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
        {busy && (
          <Button variant="outline" onClick={() => operation.current?.abort()}>
            Cancel operation
          </Button>
        )}
        {busy && (
          <p role="status">Saving or checking preserved package content…</p>
        )}
      </DialogContent>
    </Dialog>
    {record && revision && shareOpen && <Suspense fallback={<p role="status">Opening package sharing…</p>}>
      <PackageShareDialog key={`${record.id}:${revision.id}`} record={record} revisionId={revision.id} onClose={() => setShareOpen(false)} />
    </Suspense>}
    {encryptedImport && <ShareModal open mode="import" initialPayload={encryptedImport}
      onOpenChange={open => { if (!open) setEncryptedImport(null); }} />}
    </>
  );
}
