import { packageEndorsementRoutes } from '@/lib/packageEndorsements';
import { bindUnsignedFormPdf, checkPackageFormReturn, signingMemberKey } from '@/lib/packageFormReturn';
import { officialEdition } from '@/services/forms/nativeCatalog';
import { packageMemberHistory, reviseUnsignedPackagePdf } from '@/lib/packageMemberHistory';
import { isEditableOfficialForm } from '@/lib/packageFormEditing';
import type { PackageEditorSurface } from './PackageCorrespondenceEditor';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { readFormLocation, rememberFormLocation } from '@/lib/packageFormLocation';
import { officialSigningRecords, saveOfficialRevision } from '@/lib/officialSigning';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { memberSigningFormId, packageOfficialForms, createOfficialFormMember, packageFormSigningAction, preparePackageFormSigning } from '@/lib/packageOfficialForms';
import { createBlankSession, getSerializedSession, prepareSessionState } from '@/stores/documentStore';
import { serializeDocumentSnapshot } from '@/lib/documentSerialization';
import { supportsReviewComments } from '@/lib/reviewCommentTargets';
import type { PackageSearchScope } from './PackageSearchPanel';
import { configuredApprovalOrigin } from '@/lib/packageApprovalOrigin';
import { PackageReviewControls } from "./PackageReviewControls";
import { PackageMemberNavigation, PackageWorkspaceNavigation } from "./PackageWorkspaceNavigation";
import { PackageLibrary } from "./PackageLibrary";
import { PackageNextActions } from "./PackageNextActions";
import { PackageBlankPdfs } from "./PackageBlankPdfs";
import { PackageDocumentPreview } from "./PackageDocumentPreview";
import { PackageExportOptions } from "./PackageExportOptions";
import { PackageExportFindings } from "./PackageExportFindings";
import { readPackageNewActionContext, type PackageNewActionContext } from '@/lib/packageNewActionContext';
import './package-workspace.css';
import { ArrowLeft, X } from 'lucide-react';
import { readPackageWorkspaceContext, rememberPackageWorkspaceContext, type PackageWorkspaceSection } from "@/lib/packageWorkspaceContext";
import { startPackageReview, openPackageReview, transitionPackageReview } from "@/lib/packageReviewRounds";
import type { PackageReviewRound } from "@/lib/actionPackages";
import type { ExportGate } from "@/lib/exportController";
import { reviewPackageOriginal } from "@/lib/actionPackageDisclosure";
import type { PackageAsset } from "@/lib/actionPackages";
import type { SerializedSession } from "@/stores/documentStore";
import { useEffect, useId, useMemo, useLayoutEffect, useState, useRef, lazy, Suspense } from "react";
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
  assemblePackage, renderPackageDraft,
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
import { sameContent, useDocumentsStore } from "@/stores/documentsStore";
import { useUIStore } from "@/stores/uiStore";
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from "@/config/classification";
import { triggerDownload } from "@/lib/encoding";
import { parseEncryptedShareFile, MAX_ENCRYPTED_SHARE_FILE_BYTES } from "@/lib/encryptedShareFile";
import { ShareModal } from "./modals/ShareModal";
import type { CorrespondenceRendererPorts } from "@/services/exports/correspondence";

const PackageApprovalPanel = import.meta.env.VITE_DONDOCS_APPROVAL_ORIGIN
  ? lazy(() => import("./PackageApprovalPanel").then(module => ({ default: module.PackageApprovalPanel })))
  : null;
const PackageRosterPanel = lazy(() => import("./PackageRosterPanel").then(module => ({ default: module.PackageRosterPanel })));
const PackageTemplateUpgradePanel = lazy(() => import("./PackageTemplateUpgradePanel").then(module => ({ default: module.PackageTemplateUpgradePanel })));
const PackageTemplateMaintenancePanel = lazy(() => import("./PackageTemplateMaintenancePanel").then(module => ({ default: module.PackageTemplateMaintenancePanel })));
const PackageJobsPanel = lazy(() => import("./PackageJobsPanel").then(module => ({ default: module.PackageJobsPanel })));
const PackageDeliveryPanel = lazy(() => import("./PackageDeliveryPanel").then(module => ({ default: module.PackageDeliveryPanel })));
const PackageAssemblyPanel = lazy(() => import("./PackageAssemblyPanel").then(module => ({ default: module.PackageAssemblyPanel })));
const PackageOutputNavigation = lazy(() => import("./PackageOutputNavigation").then(module => ({ default: module.PackageOutputNavigation })));
const OfficialSigningWorkspace = lazy(() => import('./modals/SigningWorkspace'));
const PackageSigningPanel = lazy(() => import("./PackageSigningPanel").then(module => ({ default: module.PackageSigningPanel })));
const PackageScanPanel = lazy(() => import("./PackageScanPanel").then(module => ({ default: module.PackageScanPanel })));
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
const PackageCorrespondenceEditor = lazy(() => import('./PackageCorrespondenceEditor'));
const PackageFormEditor = lazy(() => import('./PackageFormEditor'));
const PackageReviewApplicationPanel = lazy(() => import("./PackageReviewApplicationPanel").then(module => ({ default: module.PackageReviewApplicationPanel })));
const PackageReviewTransfer = lazy(() => import("./PackageReviewTransfer").then(module => ({ default: module.PackageReviewTransfer })));
const packageRoleLabels: Record<PackageMember['role'], string> = {
  'basic-letter': 'Main letter', endorsement: 'Endorsement', 'coordination-sheet': 'Coordination sheet',
  'supporting-document': 'Supporting document', enclosure: 'Enclosure',
};

export function ActionPackageWorkspace({
  editorSurface,
  ports,
  exportGate,
}: {
  editorSurface?: PackageEditorSurface;
  ports: Ports;
  exportGate: ExportGate;
}) {
  const open = useUIStore(state => state.actionPackagesOpen);
  const setOpen = useUIStore(state => state.setActionPackagesOpen);
  useEffect(() => {
    if (readFormLocation('active')) setOpen(true);
  }, [setOpen]);
  useEffect(() => {
    if (open) void loadRetainedPdfViewer().catch(() => {});
  }, [open]);
  return open ? (
    <PackageDialog
      editorSurface={editorSurface}
      ports={ports}
      exportGate={exportGate}
      onClose={() => setOpen(false)}
    />
  ) : null;
}
function PackageDialog({
  editorSurface,
  ports,
  exportGate,
  onClose,
}: {
  editorSurface?: PackageEditorSurface;
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
    if (rosterDirty) { setError("Save or discard roster inputs before closing this workspace."); return; }
    if (upgradeDirty) { setError("Apply or discard template and form upgrade edits before closing this package."); return; }
    if (templateDirty) { setError("Save or discard template editing before closing this workspace."); return; }
    if (scanDirty) { setError("Save or discard scanned-evidence edits before closing this package."); return; }
    if (evidenceDirty) { setError("Add or discard the prepared evidence file before closing this package."); return; }
    if (assemblyDirty) { setError("Save or discard assembly settings before closing this package."); return; }
    if (signingDirty) { setError("Capture or discard the prepared signing changes before closing this package."); return; }
    if (workDirty) { setError("Save or discard the task changes before closing this package."); return; }
    if (consistencyDirty) { setError("Save or discard the relationship changes before closing this package."); return; }
    if (intakeDirty && !intakeRecoverable) { setError("Save, apply or discard the intake changes before closing this package."); return; }
    if (requirementsDirty) { setError("Save or discard the requirement changes before closing this package."); return; }
    if (starterDirty) { setError("Create or cancel the request starter before closing this package."); return; }
    if (informationDirty && !informationRecoverable) { setError(UNSAVED_PACKAGE_INFORMATION); return; }
    if (typedDirty) { setError("Save or cancel the unfinished feedback before closing this package review."); return; }
    operation.current?.abort();
    active.current = false;
    rememberFormLocation('active', '');
    onClose();
  }
  const [savedWorkspace] = useState(readPackageWorkspaceContext);
  const [unfinishedAction, setUnfinishedAction] = useState(readPackageNewActionContext);
  const [actionToResume, setActionToResume] = useState<PackageNewActionContext>();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingAction, setCreatingAction] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deliveryFormat, setDeliveryFormat] = useState<'pdf' | 'draft' | 'editable'>('pdf');
  const [workspaceSection, setWorkspaceSection] = useState<PackageWorkspaceSection>("overview");
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const mainScroll = useRef<HTMLDivElement>(null);
  const preparedResultRef = useRef<HTMLDivElement>(null);
  const dialogRoot = useRef<HTMLDivElement>(null), destinationOwner = useRef(''), destinationSequence = useRef(0);
  const [destination, setDestination] = useState<PackageDestinationRequest>();
  const documentsRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const deliveryRef = useRef<HTMLDivElement>(null);
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
  const [informationRecoverable, setInformationRecoverable] = useState(false), [intakeRecoverable, setIntakeRecoverable] = useState(false);
  const [starterDirty, setStarterDirty] = useState(false);
  const [editingIntake, setEditingIntake] = useState(false);
  const [intakeDirty, setIntakeDirty] = useState(false), [requirementsDirty, setRequirementsDirty] = useState(false);
  const [consistencyDirty, setConsistencyDirty] = useState(false);
  const [workDirty, setWorkDirty] = useState(false);
  const [formLocation, setFormLocation] = useState(() => readFormLocation('active'));
  const [formSigning, setFormSigning] = useState<{ id: string; memberId: string; revisionId: string; documentId: string; base: string; initialField?: string }>();
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
  const [scanDirty, setScanDirty] = useState(false);
  useEffect(() => { if (!scanDirty) setError(previous => previous === "Save or discard scanned-evidence edits before closing this package." ? "" : previous); }, [scanDirty]);
  const [templateDirty, setTemplateDirty] = useState(false);
  useEffect(() => { if (!templateDirty) setError(previous => previous === "Save or discard template editing before closing this workspace." ? "" : previous); }, [templateDirty]);
  const [upgradeDirty, setUpgradeDirty] = useState(false);
  useEffect(() => { if (!upgradeDirty) setError(previous => previous === "Apply or discard template and form upgrade edits before closing this package." ? "" : previous); }, [upgradeDirty]);
  const [rosterDirty, setRosterDirty] = useState(false);
  useEffect(() => { if (!rosterDirty) setError(previous => previous === "Save or discard roster inputs before closing this workspace." ? "" : previous); }, [rosterDirty]);
  const pendingPackageEdits = rosterDirty || upgradeDirty || templateDirty || scanDirty || evidenceDirty || assemblyDirty || signingDirty || workDirty || typedDirty || informationDirty || starterDirty || intakeDirty || requirementsDirty || consistencyDirty;
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
  useEffect(() => {
    if (informationRecoverable || intakeRecoverable) setError(previous =>
      informationRecoverable && previous === UNSAVED_PACKAGE_INFORMATION || intakeRecoverable && previous === 'Save, apply or discard the intake changes before closing this package.' ? '' : previous);
  }, [informationRecoverable, intakeRecoverable]);
  const [openedReview, setOpenedReview] = useState<PackageReviewRound | null>(null);
  const [reviewCopyRequest, setReviewCopyRequest] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [encryptedImport, setEncryptedImport] = useState<string | null>(null);
  const requestedPackageId = useUIStore(state => state.actionPackageSelectionId);
  const requestedRevisionId = useUIStore(state => state.actionPackageSelectionRevisionId);
  const inventoryLoaded = useRef(false);
  const [prepared, setPrepared] = useState<PreparedPackageAssembly | null>(null);
  const [reviewMode, setReviewMode] = useState<
    "assemble" | "draft" | "portable" | "saved" | "preview" | "original" | "compare"
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
    revision = useMemo(() => record
      ? openedReview?.baseline ?? getPackageRevision(record, revisionId || record.currentRevisionId)
      : null, [record, openedReview, revisionId]);
  const endorsementRoutes = useMemo(() => revision && packageEndorsementRoutes(revision), [revision]);
  const readRecord: ActionPackage | undefined = record && openedReview ? { ...record, historyScope: "selected-revision", currentRevisionId: openedReview.revisionId, revisions: [openedReview.baseline], reviewRounds: undefined, reviewApplications: undefined, fieldReviewApplications: undefined, workingCopies: undefined } : record;
  const editable =
    !!record && !record.reviewRounds?.some(round => round.ownerPackageId === undefined) && !openedReview && revision?.id === record.currentRevisionId && !record.archived;
  const selectedMember = revision?.members.find(member => member.id === activeMemberId) ?? revision?.members[0];
  const editorMember = editable && revision?.members.find(m => formLocation === record.id + '/' + m.id);
  const formMember = editorMember && isEditableOfficialForm(editorMember) ? editorMember : undefined;
  const correspondence = editorMember && editorMember.kind === 'native' && editorMember.session.documentCategory !== 'forms' ? editorMember : undefined;
  const copy = correspondence && record?.workingCopies?.find(item => item.memberId === correspondence.id && item.revisionId === revision?.id);
  async function openMemberEditor(id?: string) {
    if (!record || !revision) return;
    const target = revision.members.find(item => item.id === id);
    function enter(location: string) {
      if (id) rememberMember(id);
      setFormLocation(location);
      rememberFormLocation('active', location);
    }
    if (target?.kind === 'native' && target.session.documentCategory !== 'forms') {
      await run(async () => {
        const [latest] = await listActionPackages(record.id);
        const current = latest && getPackageRevision(latest).members.find(item => item.id === target.id);
        if (!latest || latest.archived || !current || current.kind !== 'native' || current.revisionId !== target.revisionId)
          throw new Error('The selected document changed. Reopen its current package version.');
        const standalone = useDocumentsStore.getState().currentId;
        const next = await editPackageMember(latest, current, operation.current?.signal);
        if (!readFormLocation('return-document') && standalone) rememberFormLocation('return-document', standalone);
        const activeId = useDocumentsStore.getState().currentId;
        const location = record.id + '/' + target.id;
        // Older installations can already have edits in a standalone working copy.
        if (latest.workingCopies?.some(copy => copy.documentId === activeId && copy.revisionId === latest.currentRevisionId)) {
          const baseline = serializeDocumentSnapshot(prepareSessionState(current.session, supportsReviewComments(current.session)), 0);
          if (!sameContent(getSerializedSession(), baseline)) rememberFormLocation(location + '/unsaved', '1');
        }
        update(next);
        enter(location);
        const section = readFormLocation(location + '/section');
        if (section && activeId) useEditorOutlineStore.getState().requestJump(activeId, section);
      });
      return;
    }
    const standalone = readFormLocation('return-document');
    if (standalone && currentId === copy?.documentId && docs[standalone] && !docs[standalone].meta.deletedAt)
      useDocumentsStore.getState().switchTo(standalone);
    rememberFormLocation('return-document', '');
    enter(target && isEditableOfficialForm(target) && !record.workingCopies?.some(item => item.memberId === target.id && item.revisionId === revision.id) ? record.id + '/' + id : '');
  }
  function onEditorSave(next: ActionPackage) {
    setRecords(all => all.map(item => item.id === next.id ? next : item));
    setRevisionId(next.currentRevisionId);
  }
  const library = libraryOpen || !record && !creating;
  const selectedRetainedOutput = selectedRetainedOutputId
    ? revision?.outputs.find(output => output.id === selectedRetainedOutputId) : revision?.outputs.at(-1);
  const missingRetainedOutput = !!selectedRetainedOutputId && !selectedRetainedOutput;
  const selectionOwner = `${record?.id ?? ''}:${record?.sequence ?? ''}:${revision?.id ?? ''}:${openedReview?.id ?? ''}`;
  useLayoutEffect(() => { destinationOwner.current = selectionOwner; }, [selectionOwner]);
  function openMemberSigning(member: PackageMember, initialField?: string) {
    if (!record || !editable || busy || pendingPackageEdits || !packageFormSigningAction(member)) return;
    return run(async () => {
      const signal = operation.current!.signal;
      const documentId = await signingMemberKey(record.id, member);
      let saved = (await officialSigningRecords()).find(entry => entry.sourceRevision?.documentId === documentId);
      if (!saved) {
        const policy = await getExportDeploymentPolicy();
        const release = await exportGate.acquireWhenAvailable(signal);
        const source = await preparePackageFormSigning(member, policy, signal, ports).finally(release);
        const current = () => active.current && !signal.aborted;
        const { confirmSigningDisclosure } = await import('./signingDisclosure');
        await confirmSigningDisclosure({ pdfs: [source], metadata: source.metadata }, current, { action: 'sign' });
        const edition = member.kind === 'native' && officialEdition(memberSigningFormId(member) ?? '');
        const bytes = edition ? bindUnsignedFormPdf(source.bytes, edition.length, documentId) : source.bytes;
        saved = await saveOfficialRevision(source.label, bytes, current, undefined,
          { documentId, epoch: 0, editSequence: 0, capturedAt: Date.now() });
      }
      signal.throwIfAborted();
      setFormSigning({ id: saved.id, initialField, memberId: member.id, revisionId: member.revisionId, documentId, base: saved.revisions[0].sha256 });
    });
  }
  const [deliveryReturnPackage, setDeliveryReturnPackage] = useState<string>();
  function openDeliveryFinding(target: PackageDestination) {
    if (!record || !revision) return;
    setDeliveryReturnPackage(record.id);
    const member = revision.members.find(item => item.id === target.memberId);
    if (editable && target.signatureField && target.revisionId === revision.id && member && packageFormSigningAction(member)) {
      void openMemberSigning(member, target.signatureField);
    } else followDestination(target);
  }
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
        : target.requirementId ? (!!selected.requirements?.items.some(item => item.id === target.requirementId) || !!selected.templateState && !selected.requirements)
          : target.signingId ? !!selected.signing?.handoffs.some(item => item.id === target.signingId)
          : target.outputId ? selected.outputs.some(item => item.id === target.outputId)
            : target.citationId ? !!selected.citations && [...selected.citations.targets, ...selected.citations.links].some(item => item.id === target.citationId)
              : target.memberId ? selected.members.some(item => item.id === target.memberId) : true;
    if (!valid) { setNotice("That item is not available in the selected saved revision."); return; }
    if (selected.id !== revision.id) {
      setOpenedReview(null); setRevisionId(selected.id); setPrepared(null);  setComparison(null);
      setRenderComparison(null); setBeforeOutputId(""); setAfterOutputId(""); setPdfUrl("");
      setSelectedRetainedOutputId("");
    }
    if (target.outputId) {
      setSelectedRetainedOutputId(target.outputId); setPrepared(null);  setPdfUrl("");
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
  function navigate(section: PackageWorkspaceSection) {
    setLibraryOpen(false);
    setWorkspaceSection(section);
  }
  function continueEditing() {
    const panel = rosterDirty ? 'roster' : templateDirty ? 'templates' : upgradeDirty ? 'upgrades'
      : typedDirty ? 'member-review' : signingDirty ? 'signing' : assemblyDirty ? 'assembly'
        : evidenceDirty ? 'evidence' : scanDirty ? 'scans' : informationDirty ? 'information'
          : starterDirty ? 'request-starter' : intakeDirty ? 'intake' : requirementsDirty ? 'requirements'
            : consistencyDirty ? 'consistency' : 'work';
    setLibraryOpen(rosterDirty || templateDirty);
    setWorkspaceSection(typedDirty ? 'review' : signingDirty || assemblyDirty ? 'delivery' : evidenceDirty || scanDirty ? 'documents' : 'overview');
    requestAnimationFrame(() => {
      if (active.current) focusPackageDestination(dialogRoot.current, 'data-package-panel', panel);
    });
  }
  useLayoutEffect(() => {
    mainScroll.current?.scrollTo?.({ top: 0 });
    if (library) return;
    const target = workspaceSection === 'documents' ? document.getElementById(`package-member-${selectedMember?.id}`) ?? documentsRef.current
      : workspaceSection === 'delivery' ? deliveryRef.current : workspaceSection === 'review' ? reviewRef.current : overviewRef.current;
    target?.focus({ preventScroll: true });
  }, [workspaceSection, selectedMember?.id, library, selectedId, creating]);
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
          const restoredForm = readFormLocation('active');
          const resumeForm = !requestedPackageId && records.find(r => restoredForm.startsWith(r.id + '/'));
          const requested = explicit || resumeForm;
          if (requested) {
            setCreating(false);
            setCreatingAction(false);
            setLibraryOpen(false);
            setOpenedReview(null);
            setSelectedId(requested.id);
            if (requestedRevisionId && !requested.revisions.some(revision => revision.id === requestedRevisionId))
              throw new Error("The reviewed package revision is no longer available. Reopen the share and review it again.");
            setRevisionId(requestedRevisionId ?? requested.currentRevisionId);
            const returningToDocument = explicit && savedWorkspace?.packageId === explicit.id && savedWorkspace.revisionId === requestedRevisionId && savedWorkspace.section === 'documents';
            setWorkspaceSection(returningToDocument ? "documents" : "overview");
            setActiveMemberId(returningToDocument ? savedWorkspace.memberId : null);
            if (resumeForm) {
              setWorkspaceSection('documents');
              setActiveMemberId(restoredForm.slice(requested.id.length + 1));
            }
            setName(requested.name);
            setPrepared(null);
            setOriginal(null);

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
  useLayoutEffect(() => {
    if (workspaceSection !== 'delivery' || library) return;
    if (pdfUrl) {
      mainScroll.current?.scrollTo?.({ top: 0 }); deliveryRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!prepared) return;
    preparedResultRef.current?.scrollIntoView?.({ block: 'start' });
    preparedResultRef.current?.focus({ preventScroll: true });
  }, [prepared, pdfUrl, workspaceSection, library]);
  function select(value: ActionPackage) {
    setReviewCopyRequest(null);
    setLibraryOpen(false);
    setCreating(false);
    setDestination(undefined);
    if (value.id !== selectedId) { setRole("basic-letter"); setActiveMemberId(null); setWorkspaceSection("overview"); }
    setOpenedReview(null);
    setCitationReorder(null);
    setSelectedId(value.id);
    setRevisionId(value.currentRevisionId);
    setName(value.name);
    setPrepared(null);
    setOriginal(null);
    setComparison(null);
    setPdfUrl("");

    setBeforeOutputId("");
    setAfterOutputId("");
    setSelectedRetainedOutputId("");
    setRenderComparison(null);
  }
  function showLibrary() {
    if (creating && !pendingPackageEdits) setCreating(false);
    setUnfinishedAction(readPackageNewActionContext());
    setLibraryOpen(true);
    setError('');
    setNotice('');
  }
  function startNewPackage(resume?: PackageNewActionContext) {
    if (busy || pendingPackageEdits) return;
    operation.current?.abort();
    setSelectedId(''); setRevisionId(''); setOpenedReview(null);
    setName(''); setPrepared(null); setPdfUrl(''); setOriginal(null); setComparison(null);
    setActionToResume(resume);
    setWorkspaceSection('overview'); setLibraryOpen(false); setCreatingAction(false); setCreating(true);
    setError(''); setNotice('');
  }
  function changeRevision(id: string) {
    if (busy || pendingPackageEdits) return;
    setDestination(undefined); setOpenedReview(null); setRevisionId(id);
    setSelectedRetainedOutputId(''); setPrepared(null);  setComparison(null);
    setPdfUrl(''); setBeforeOutputId(''); setAfterOutputId(''); setRenderComparison(null);
    setHistoryOpen(false);
    mainScroll.current?.scrollTo?.({ top: 0 });
  }
  function cancelExport() {
    setPrepared(null); setOriginal(null); setOtherReviews([]); setError(''); setNotice('');
    setPdfUrl(''); setComparison(null); setRenderComparison(null);
    mainScroll.current?.scrollTo?.({ top: 0 }); deliveryRef.current?.focus({ preventScroll: true });
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
    if (!record) return;
    const added = members.find(member => !revision?.members.some(previous => previous.id === member.id));
    update(await reviseActionPackage(record, members, operation.current?.signal));
    if (added) {
      setActiveMemberId(added.id);
      setWorkspaceSection('documents');
    }
  }
  async function addBlankDocument(type: 'naval_letter' | 'coordination_page', label: string, memberRole: PackageMember['role']) {
    if (!revision) return;
    const session = createBlankSession(undefined, type);
    const captured = captureDocumentRevision({
      documentId: crypto.randomUUID(), epoch: 0, editSequence: 0, capturedAt: session.timestamp,
    }, prepareSessionState(session));
    const member = await capturePackageMember(captured, label, memberRole);
    await modify([...revision.members, member]);
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
    setWorkspaceSection('delivery');
    setDeliveryFormat(mode === 'portable' ? 'editable' : mode === 'draft' ? 'draft' : 'pdf');
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
      : await preparePackageAssembly(readRecord!, revision.id, policy, { includeRetainedDraftText: mode === "portable", draftPdf: mode === "draft" });
    assertOperationCurrent();
    setOtherReviews([]);
    setPdfUrl('');
    setReviewMode(mode);
    setPrepared(result);

  }
  async function reviewOriginal(
    member: Exclude<PackageMember, { kind: "native" }>,
  ) {
    setWorkspaceSection('delivery');
    const policy = await getExportDeploymentPolicy();
    if (policy.status !== 'ready') throw new Error(policy.message);
    const bytes = await readPackageAsset(member.original);
    const review = member.kind === "attachment"
      ? (await (await import("@/lib/packageAttachmentCapabilities")).reviewPackageAttachment(member.original, bytes, policy, operation.current?.signal)).review
      : await reviewPackageOriginal(bytes, `${member.label}: ${member.original.name}`, policy);
    assertOperationCurrent();
    setPdfUrl('');
    setOriginal({ asset: member.original, bytes, policyIdentity: policy.policy.identity, owner: selectionOwner });
    setReviewMode("original");
    setOtherReviews([]);

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
  async function deliver(reviewed: boolean) {
    if (!record || !revision || !prepared || !reviewed) return;
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
      const release = await exportGate.acquireWhenAvailable(operation.current!.signal);
      let updated: ActionPackage;
      try {
        assertOperationCurrent();
        if (reviewMode === 'draft') {
          const bytes = await renderPackageDraft(prepared, ports, operation.current!.signal);
          assertOperationCurrent();
          assertPreparedPackagePolicy(prepared, getExportDeploymentPolicySync());
          triggerDownload(bytes, record.name + '-draft.pdf', 'application/pdf');
          setNotice('Draft PDF downloaded.');
          return;
        }
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
      const bytes = await readPackageAsset(output.asset);
      assertOperationCurrent(); assertPreparedPackagePolicy(prepared, getExportDeploymentPolicySync());
      triggerDownload(new Uint8Array(bytes), output.asset.name, output.asset.type);
      setNotice('PDF downloaded. A copy is kept with this version.');
    }
    setPrepared(null);

  }
  const comparedSource = comparison?.source;
  return <>
    <Dialog open onOpenChange={value => { if (!value) close(); }}>
      <DialogContent fullscreen showCloseButton={false} ref={dialogRoot} className="package-workspace-dialog" aria-busy={busy} data-package-id={record?.id} data-revision-id={revision?.id}>
        <DialogHeader className="sr-only"><DialogTitle>Action packages</DialogTitle><DialogDescription>Package documents, review and delivery.</DialogDescription></DialogHeader>
        {editorSurface && record && correspondence && copy && copy.documentId === currentId && <Suspense fallback={<p role="status">Opening document…</p>}>
          <PackageCorrespondenceEditor key={copy.documentId} record={record} member={correspondence} documentId={copy.documentId}
            {...editorSurface} navigationError={error} disabled={busy} onSave={onEditorSave} onNavigate={openMemberEditor} />
        </Suspense>}
        {record && formMember && formMember.kind === 'native' && <Suspense fallback={<p role="status">Opening form editor…</p>}>
          <PackageFormEditor key={record.id + '/' + formMember.id} record={record} member={formMember} ports={ports} exportGate={exportGate}
            onSave={onEditorSave} navigationError={error}
            onSharedDetails={() => {
              openMemberEditor();
              navigate('overview');
              requestAnimationFrame(() => focusPackageDestination(dialogRoot.current, 'data-package-panel', 'information'));
            }}
            onNavigate={openMemberEditor} />
        </Suspense>}
        <div className="package-workspace-appbar">
          <img src={`${import.meta.env.BASE_URL}attachments/marine-coders-logo.svg`} alt="Marine Coders" className="h-7 w-9 object-contain brightness-0 dark:invert" />
          <span className="package-workspace-brand text-sm font-semibold">DonDocs</span><span className="text-muted-foreground">/</span>
          {library ? <span className="text-sm">Packages</span> : <Button variant="ghost" size="sm" aria-label="Back to packages" disabled={busy} onClick={showLibrary}><ArrowLeft aria-hidden="true" className="size-4" />Packages</Button>}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={close}>Close<X aria-hidden="true" className="size-4" /></Button>
        </div>
        <div className="package-workspace-layout" style={library || creating ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
          <aside hidden={library || creating} className="package-workspace-sidebar">
            <PackageWorkspaceNavigation active={workspaceSection} hasPackage={!!record && !library && !creating} disabled={busy || library || creating} onNavigate={navigate} />
            {record && !library && deliveryReturnPackage === record.id && workspaceSection !== 'delivery' &&
              <Button variant="link" disabled={busy || pendingPackageEdits} onClick={() => navigate('delivery')}>Return to delivery</Button>}
            {record && !library && <Button variant="ghost" className="package-workspace-history" onClick={() => setHistoryOpen(true)}>Version history</Button>}
          </aside>
          <div ref={mainScroll} className="package-workspace-main">
            <div className="package-workspace-content">
              <div className="package-workspace-feedback" aria-live="polite">
                {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
                {notice && <p role="status" className="break-words text-sm">{notice}</p>}
                {busy && <div className="flex items-center justify-between gap-4"><span role="status" className="text-sm">Preparing package content…</span><Button variant="outline" size="sm" onClick={() => operation.current?.abort()}>Cancel operation</Button></div>}
              </div>
              <div hidden={!library} className="package-workspace-page">
                {pendingPackageEdits && <div role="status" className="mb-7 flex flex-wrap items-center justify-between gap-4 rounded-md bg-muted px-4 py-3 text-sm"><span>Finish your edits before opening another package.</span><Button variant="outline" size="sm" onClick={continueEditing}>Continue editing</Button></div>}
                <PackageLibrary records={records} loaded={loaded} disabled={busy || pendingPackageEdits} onOpen={select} onCreate={() => startNewPackage()}
                  onResume={unfinishedAction ? () => startNewPackage(unfinishedAction) : undefined} />
                <details className="mt-10 border-t pt-5"><summary className="text-sm">Advanced</summary><div className="mt-5 space-y-5"><details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Maintain package templates{templateDirty ? " · editing separate revision" : ""}</summary>
          <div tabIndex={-1} data-package-panel="templates" className="min-w-0 pt-3"><Suspense fallback={<p role="status">Opening template maintenance…</p>}>
            <PackageTemplateMaintenancePanel key={`maintenance:${record?.id ?? "library"}:${revision?.id ?? "none"}`} disabled={!loaded || typedDirty || informationDirty || starterDirty || intakeDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty || scanDirty || upgradeDirty || rosterDirty}
              busy={busy} run={run} onDirtyChange={setTemplateDirty} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted}
              onSaved={() => setNotice("Separate maintained template saved. Choose it from the action intake template list.")} />
          </Suspense></div>
        </details>
<details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Packages from a roster{rosterDirty ? " · unsaved inputs" : ""}</summary>
          <div tabIndex={-1} data-package-panel="roster" className="min-w-0 pt-3"><Suspense fallback={<p role="status">Opening package rosters…</p>}>
            <PackageRosterPanel disabled={!loaded || typedDirty || informationDirty || starterDirty || intakeDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty || scanDirty || templateDirty || upgradeDirty}
              busy={busy} run={run} onDirtyChange={setRosterDirty} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted}
              onCreated={created => setRecords(previous => [created, ...previous.filter(item => item.id !== created.id)])}
              onOpenPackage={created => { update(created); setWorkspaceSection("overview"); requestAnimationFrame(() => { if (active.current) { overviewRef.current?.scrollIntoView({ block: "start" }); overviewRef.current?.focus({ preventScroll: true }); } }); }} />
          </Suspense></div>
        </details></div></details>
              </div>
              <div hidden={library}>
                <header className="mb-8">
                  {!creating && <p className="mb-2 text-xs text-muted-foreground">{openedReview ? 'Review copy' : revision?.templateState ? 'Action package' : 'Package'}</p>}
                  <h1 className="break-words text-2xl font-semibold tracking-tight">{creating ? 'New package' : record?.name}</h1>
                  {record && revision && <p className="mt-2 text-xs text-muted-foreground">{record.historyScope === 'selected-revision' ? `Saved revision ${revision.id.slice(-8)}` : `Version ${record.revisions.findIndex(item => item.id === revision.id) + 1}`}{record.archived ? ' · Archived' : revision.id !== record.currentRevisionId ? ' · Historical' : ''}{pendingPackageEdits ? ' · Unapplied edits' : ''}</p>}
                  {record && revision && revision.id !== record.currentRevisionId && !openedReview && <Button variant="link" className="mt-3 h-auto p-0 text-sm" disabled={busy || pendingPackageEdits} onClick={() => changeRevision(record.currentRevisionId)}><ArrowLeft aria-hidden="true" className="size-4" />Back to current version</Button>}
                  {record && openedReview && <Button variant="link" className="mt-3 h-auto p-0 text-sm" disabled={busy || pendingPackageEdits} onClick={() => { select(record); mainScroll.current?.scrollTo?.({ top: 0 }); }}><ArrowLeft aria-hidden="true" className="size-4" />Back to current package</Button>}
                </header>
                {pendingPackageEdits && !(workspaceSection === 'overview' && editingIntake && intakeDirty) && <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-md bg-muted px-4 py-3 text-sm" role="status"><span>Apply or discard your edits before preparing files.</span><Button variant="link" size="sm" onClick={continueEditing}>Continue editing</Button></div>}
                <div ref={overviewRef} role="region" aria-label="Package overview" tabIndex={-1} hidden={workspaceSection !== 'overview'} className="package-workspace-page space-y-7 outline-none">
                  {record && revision && <PackageNextActions quiet={editingIntake || informationDirty} record={readRecord!} revision={revision} disabled={busy || pendingPackageEdits} reviewBaseline={!!openedReview} onNavigate={followDestination} onPrepare={() => void run(() => review('assemble'))} />}
                  {creating && !creatingAction && <fieldset disabled={!loaded || busy || pendingPackageEdits} className="min-w-0 space-y-3">
          <legend className="text-sm font-medium">Custom package</legend>
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
              onClick={() => void run(async () => {
                update(await createActionPackage(name, operation.current?.signal));
                setWorkspaceSection('documents');
              })}
            >
              Create package
            </Button>
          </div>
                    </fieldset>}
                  {(creating || revision?.templateState) && <Suspense fallback={<p>Loading action intake…</p>}>
          <PackageIntakePanel workspace destination={destination} resume={creating ? actionToResume : undefined} record={record} revision={revision ?? undefined} editable={editable} disabled={!loaded || typedDirty || informationDirty || starterDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty || scanDirty || templateDirty || upgradeDirty || rosterDirty}
            busy={busy} run={run} onApply={update} onStartWithDocuments={value => { update(value); setWorkspaceSection("documents"); }} onDirtyChange={setIntakeDirty} onRecoveryChange={setIntakeRecoverable} onNewActionChange={setCreatingAction} onEditingChange={setEditingIntake}
            signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
        </Suspense>}
                  <div hidden={!creating || creatingAction} className="space-y-7">

                    <details><summary className="cursor-pointer text-sm font-medium">Saved templates and imports</summary><div className="mt-5 space-y-5"><fieldset disabled={!loaded || busy || pendingPackageEdits} className="min-w-0 space-y-4">
          <legend className="sr-only">Saved templates and imports</legend>
          <div className="flex flex-wrap items-end gap-2">
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
            <PackageReviewTransfer directDownload record={record} round={openedReview} busy={busy} run={run} signal={() => operation.current?.signal}
              isCurrent={() => active.current && !operation.current?.signal.aborted} onImport={value => {
                update(value); const round = value.reviewRounds![0]; setOpenedReview(round); setRevisionId(round.revisionId); setWorkspaceSection("review");
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

        </fieldset></div></details>
                    <details><summary className="cursor-pointer text-sm font-medium">Other starters</summary><div tabIndex={-1} data-package-panel="request-starter" className="mt-5"><Suspense fallback={<p>Loading request starter…</p>}>
          <AdministrativeRequestStarter disabled={!loaded || typedDirty || informationDirty || intakeDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty || scanDirty || templateDirty || upgradeDirty || rosterDirty} busy={busy} run={run}
            signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted}
            onDirtyChange={setStarterDirty} onCreate={value => { update(value); setNotice("Request package created. Review its letter and worksheet before submission."); }} />
        </Suspense></div></details>
                  </div>
                  {record && revision && <details open={!revision.templateState || informationDirty}><summary hidden={!revision.templateState} className="cursor-pointer text-sm">Field links</summary><Suspense fallback={<p role="status">Loading package information…</p>}>
          <PackageInformationPanel workspace={!revision.templateState} recoverEdits record={record} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty || scanDirty || templateDirty || upgradeDirty || rosterDirty} busy={busy} run={run} onApply={update}
            destination={destination}
            onDirtyChange={setInformationDirty} onRecoveryChange={setInformationRecoverable} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
        </Suspense></details>}
                  {record && revision && (revision.requirements !== undefined || !!revision.templateState) && <details open={requirementsDirty || destination?.panel === 'requirements' && destination.revisionId === revision.id}><summary className="cursor-pointer text-sm">Requirements</summary><div className="mt-4"><Suspense fallback={<p role="status">Loading evidence requirements…</p>}>
          <PackageRequirementsPanel record={record} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty || scanDirty || templateDirty || upgradeDirty || rosterDirty}
            busy={busy} run={run} onApply={update} onDirtyChange={setRequirementsDirty}
            destination={destination}
            signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
        </Suspense></div></details>}
                  {record && revision && <section><div className="mb-4 flex items-center justify-between"><h2 className="text-base font-medium">Documents</h2><Button variant="link" size="sm" onClick={() => navigate('documents')}>Open documents</Button></div><ol className="divide-y">{revision.members.map((member, index) => <li key={member.id} className="flex items-center gap-4 py-4"><span className="text-xs text-muted-foreground">{index + 1}</span><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{member.label}</p><p className="mt-1 text-xs text-muted-foreground">{member.kind === 'native' ? member.session.documentCategory === 'forms' ? 'Form' : 'Correspondence' : member.kind === 'original' ? 'Original PDF' : 'Supporting file'}</p></div><Button variant="link" size="sm" onClick={() => inspectMember(member.id)}>Open</Button></li>)}</ol></section>}
                  <details hidden={!record}><summary className="cursor-pointer text-sm font-medium">Advanced</summary><div className="mt-5 space-y-5">{record && revision && <details className="rounded border p-3"><summary className="cursor-pointer text-sm font-medium">Reusable package templates</summary><fieldset disabled={busy || pendingPackageEdits} className="mt-4"><Suspense fallback={<p>Loading package templates…</p>}><PackageTemplatePanel record={openedReview ? undefined : record} revisionId={revision.id} busy={busy || pendingPackageEdits} run={run} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} onCreate={update} /></Suspense></fieldset></details>}{readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Template and form upgrades{upgradeDirty ? " · awaiting review" : ""}</summary>
          <div tabIndex={-1} data-package-panel="upgrades" className="min-w-0 pt-3"><Suspense fallback={<p role="status">Opening template and form upgrades…</p>}>
            <PackageTemplateUpgradePanel record={readRecord} revision={revision} disabled={!editable || typedDirty || informationDirty || starterDirty || intakeDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty || scanDirty || templateDirty || rosterDirty}
              busy={busy} run={run} onApply={update} onDirtyChange={setUpgradeDirty} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
{readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Work and next actions{workDirty ? " · unsaved changes" : revision.work?.tasks.length ? ` · ${revision.work.tasks.filter(task => task.status === 'pending').length} open` : ""}</summary>
          <div tabIndex={-1} data-package-panel="work" className="pt-3"><Suspense fallback={<p role="status">Loading package work…</p>}>
            <PackageWorkPanel record={readRecord} revision={revision} reviewBaseline={!!openedReview} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || requirementsDirty || consistencyDirty || signingDirty || assemblyDirty || evidenceDirty || scanDirty || templateDirty || upgradeDirty || rosterDirty}
              busy={busy} run={run} onApply={update} onDirtyChange={setWorkDirty} onNavigate={followDestination}
              signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
{record && revision && <details className="min-w-0 rounded border p-3">
          <summary className="cursor-pointer text-sm font-medium">Consistency checks{consistencyDirty ? " · unsaved changes" : revision.consistency?.rules.length ? ` · ${revision.consistency.rules.length} ${revision.consistency.rules.length === 1 ? 'relationship' : 'relationships'}` : ""}</summary>
          <div tabIndex={-1} data-package-panel="consistency" className="pt-3">
            <Suspense fallback={<p role="status">Loading consistency checks…</p>}>
              <PackageConsistencyPanel record={record} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || requirementsDirty || workDirty || signingDirty || assemblyDirty || evidenceDirty || scanDirty || templateDirty || upgradeDirty || rosterDirty}
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
{readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Search captured package</summary>
          <div className="min-w-0 pt-3"><Suspense fallback={<p role="status">Opening captured package search…</p>}>
            <PackageSearchPanel record={readRecord} revision={revision} disabled={pendingPackageEdits} busy={busy} run={run} onNavigate={followDestination}
              delivery={deliverySearch?.owner === selectionOwner ? deliverySearch.scope : undefined}
              signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
                    {record && revision && <fieldset disabled={busy || pendingPackageEdits} className="space-y-4"><legend className="mb-4 text-sm font-medium">Package settings</legend><label className="block text-sm">Package name<input aria-invalid={nameTooLong || undefined} aria-describedby={nameTooLong ? nameLimitId : undefined} className="mt-2 block w-full rounded border bg-background p-2" value={name} onChange={event => setName(event.target.value)} />{nameTooLong && <span id={nameLimitId} role="status" className="mt-1 block text-xs text-destructive">Use a package name of 120 characters or fewer.</span>}</label><Button variant="outline" disabled={!!openedReview} onClick={() => setShareOpen(true)}>Share encrypted package</Button>
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
              </div></fieldset>}
                  </div></details>
                </div>
                {record && revision && <>
                  <fieldset hidden={workspaceSection !== 'review'} disabled={busy || pendingPackageEdits && !typedDirty} className="package-workspace-page space-y-7">
                    <h2 className="text-base font-medium">Review</h2>
                    <div ref={reviewRef} tabIndex={-1} className="scroll-mt-4 space-y-4">
              <PackageReviewControls workspace record={record} disabled={busy || typedDirty} opened={openedReview} onExit={() => select(record)}
                onStart={() => void run(async () => {
                  const next = await startPackageReview(record, revision.id, `Package review ${(record.reviewRounds?.length ?? 0) + 1}`, operation.current?.signal, () => active.current);
                  update(next);
                  const round = await openPackageReview(next, next.reviewRounds!.at(-1)!.id);
                  assertOperationCurrent(); setOpenedReview(round); setRevisionId(round.revisionId); setReviewCopyRequest(round.id);
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
              {PackageApprovalPanel && configuredApprovalOrigin && !openedReview && <details className="min-w-0 rounded border p-3">
                <summary className="cursor-pointer text-sm font-medium">Approvals</summary>
                <div className="pt-3"><Suspense fallback={<p role="status">Opening approvals…</p>}>
                  <PackageApprovalPanel key={`${record.id}:${revision.id}:${record.sequence}`} packageId={record.id} revision={revision}
                    origin={configuredApprovalOrigin} canStart={editable} disabled={busy || pendingPackageEdits} />
                </Suspense></div>
              </details>}
              {openedReview?.ownerPackageId === record.id && <Suspense fallback={<p>Loading feedback application…</p>}>
                <PackageReviewApplicationPanel workspace key={`${record.id}:${record.sequence}:${openedReview.id}`} record={record} round={openedReview} busy={busy || typedDirty} run={run}
                  signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted}
                  onApply={next => { update(next); setOpenedReview(null); setRevisionId(next.currentRevisionId); }} />
              </Suspense>}
              </div>
                    {openedReview && <Suspense fallback={<p>Loading member review…</p>}>
                <PackageMemberReviewPanel workspace key={openedReview.id} record={record} round={openedReview} busy={busy} run={run} onDraftChange={setTypedDirty} signal={() => operation.current?.signal}
                  onChange={(next, round) => { update(next); setOpenedReview(round); setRevisionId(round.revisionId); }} />
              </Suspense>}
                    <Suspense fallback={<p>Loading package review files…</p>}>
            <PackageReviewTransfer autoPrepareRoundId={reviewCopyRequest} directDownload record={record} round={openedReview} busy={busy || typedDirty} run={run} signal={() => operation.current?.signal}
              isCurrent={() => active.current && !operation.current?.signal.aborted} onImport={value => {
                update(value); const round = value.reviewRounds![0]; setOpenedReview(round); setRevisionId(round.revisionId); setWorkspaceSection("review");
              }} />
          </Suspense>
                  </fieldset>
                  <fieldset hidden={workspaceSection !== 'documents'} disabled={busy || pendingPackageEdits && !evidenceDirty && !scanDirty} className="package-workspace-page space-y-7">
                    <h2 className="text-base font-medium">Documents</h2>
                    {workspaceSection === 'documents' && record && revision?.templateState && !library &&
                      <PackageBlankPdfs key={revision.id} record={record} revisionId={revision.id} />}
                    <div ref={documentsRef} tabIndex={-1} className="min-w-0 scroll-mt-4 space-y-4">
              <details key={record.id} hidden={!editable} open={!revision.templateState || undefined}><summary className="cursor-pointer text-sm font-medium">Add documents</summary><div className="mt-4">{editable && (
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
                        <option key={role} value={role}>{packageRoleLabels[role]}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => void run(() => addBlankDocument('naval_letter', 'Naval letter', role))}>
                      Add letter
                    </Button>
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
                    <Button variant="outline" onClick={() => void run(() => addBlankDocument('coordination_page', 'Coordination page', 'coordination-sheet'))}>
                      Add coordination page
                    </Button>
                    {packageOfficialForms.map(form => <Button key={form.id} variant="outline" onClick={() => void run(async () => {
                      const member = await createOfficialFormMember(form.id, role);
                      await modify([...revision.members, member]);
                    })}>Add {form.label}</Button>)}
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
                    Add the document open in the editor, or upload an original PDF up to 25 MB.
                  </p>
                </div>
              )}</div></details>
              <div className="grid min-w-0 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
              <PackageMemberNavigation members={revision.members} selectedId={selectedMember?.id} disabled={busy || typedDirty || templateDirty || upgradeDirty || rosterDirty} onSelect={inspectMember} />
              <ol className="min-w-0 space-y-3">
                {revision.members.map((member, index) => {
                  const route = endorsementRoutes?.get(member.id);
                  const linkedLetter = member.endorsementLink && revision.members.find(item => item.id === member.endorsementLink?.basicMemberId);
                  const routeLetter = route && revision.members.find(item => item.id === route.basicMemberId);
                  const source =
                    member.kind === "native" &&
                    member.source?.local &&
                    docs[member.source.documentId];
                  const working = record.workingCopies?.find(
                    (copy) =>
                      copy.memberId === member.id &&
                      copy.revisionId === record.currentRevisionId,
                  );
                  const inPackageEditor = !!editorSurface && member.kind === 'native' && member.session.documentCategory !== 'forms';
                  return (
                    <li
                      key={member.id}
                      id={`package-member-${member.id}`}
                      hidden={selectedMember?.id !== member.id}
                      tabIndex={-1}
                      data-selected={selectedMember?.id === member.id || undefined}
                      className="package-workspace-member space-y-5 outline-none"
                    >
                      <header className="flex flex-wrap items-start justify-between gap-4"><h3 className="break-words font-medium">
                        {index + 1}. {member.label}
                      </h3>
                      {editable && packageFormSigningAction(member) && <Button size="sm" variant="outline" disabled={busy || pendingPackageEdits}
                        onClick={() => void openMemberSigning(member)}>{packageFormSigningAction(member)}</Button>}
                      {editable && isEditableOfficialForm(member) && !working ? (
                        <Button size="sm" disabled={busy || pendingPackageEdits} onClick={() => openMemberEditor(member.id)}>Edit form</Button>
                      ) : inPackageEditor && editable ? (
                        <Button size="sm" disabled={busy || pendingPackageEdits} onClick={() => openMemberEditor(member.id)}>Edit document</Button>
                      ) : member.kind === 'native' && editable && (<Button
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
                              Edit document
                            </Button>)}</header>
{editable && member.kind === 'original' && revision.requirements?.items.some(rule =>
                        rule.kind === 'document' && rule.memberId === member.id && rule.completion?.reviewedScan) &&
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy || pendingPackageEdits}
                          checked={member.signatureReviewSha256 === member.original.sha256} onChange={event => {
                            const reviewed = event.target.checked;
                            void run(async () => {
                              await readPackageAsset(member.original);
                              const { signatureReviewSha256: _old, ...previous } = member;
                              await modify(revision.members.map(item => item.id === member.id ? { ...previous,
                                revisionId: crypto.randomUUID(), ...(reviewed && { signatureReviewSha256: member.original.sha256 }) } : item));
                            });
                          }} />I reviewed the signature on this exact scan</label>}
                      {editable && member.kind === 'original' && !member.signedOriginal && <label className="inline-block cursor-pointer rounded border px-3 py-2 text-sm">
                        Replace PDF in this slot
                        <input className="sr-only" type="file" accept="application/pdf,.pdf" disabled={busy || pendingPackageEdits}
                          onChange={event => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) void run(async () => update(await reviseUnsignedPackagePdf(record, member, file, operation.current?.signal)));
                          }} />
                      </label>}
                      {selectedMember?.id === member.id && !openedReview && <details>
                        <summary className="cursor-pointer text-sm">Document versions</summary>
                        <ol className="mt-2 space-y-1">{packageMemberHistory(record, member.id, revision.id).map((entry, version) =>
                          <li key={entry.packageRevisionId}><Button variant="link" size="sm" disabled={busy || pendingPackageEdits || entry.member.revisionId === member.revisionId}
                            onClick={() => changeRevision(entry.packageRevisionId)}>
                            Version {version + 1} · {entry.member.kind === 'native' ? 'Editable document' : entry.member.signedOriginal ? 'Signed original' : 'Original file'}
                          </Button></li>)}</ol>
                      </details>}
{working && !inPackageEditor && (
                        <p className="text-xs">
                          Working copy:{" "}
                          {docs[working.documentId]?.meta.title ||
                            "unavailable"}
                          . Changes remain outside the saved package until you
                          save a new revision.
                        </p>
                      )}
<PackageDocumentPreview packageId={record.id} revisionId={revision.id} member={member} active={loaded && !editorMember && !library && workspaceSection === 'documents' && selectedMember?.id === member.id} ports={ports} exportGate={exportGate} />
<details><summary className="cursor-pointer text-xs text-muted-foreground">Document details</summary><div className="mt-4 space-y-4"><p className="break-all text-xs text-muted-foreground">
                        {packageRoleLabels[member.role]} ·{" "}
                        {member.kind === "original"
                          ? member.signedOriginal
                            ? "Original PDF (marked signed)"
                            : "Original PDF"
                          : member.kind === "attachment" ? `Supporting file (${member.original.type})` : "Captured native draft"}{" "}
                        · Member revision: {member.revisionId}
                      </p>{member.role === 'endorsement' && member.endorsementLink &&
                        <p className="text-xs">{member.endorsementLink.ordinal} endorsement of {linkedLetter?.label ?? 'a removed letter'}</p>}
                        {editable && member.role === 'endorsement' && member.kind === 'native' && route && routeLetter &&
                          member.endorsementLink?.basicMemberId !== route.basicMemberId &&
                          <Button size="sm" variant="outline" disabled={busy || pendingPackageEdits}
                            onClick={() => void run(() => modify(revision.members.map(item => item.id === member.id ? { ...item, endorsementLink: route } : item)))}>
                            Link endorsement to {routeLetter.label}
                          </Button>}
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
                      )}<div className="flex flex-wrap gap-2">
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
                                          ? packageMemberSchema.parse({ ...item, role: event.target.value, endorsementLink: undefined })
                                          : item,
                                      ),
                                    ),
                                  )
                                }
                              >
                                {packageRoles.filter(role => member.kind !== "attachment" || !["basic-letter", "endorsement"].includes(role)).map((role) => (
                                  <option key={role} value={role}>{packageRoleLabels[role]}</option>
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

                            {working && !inPackageEditor && (
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
                      </div></div></details>
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
                    <details><summary className="cursor-pointer text-sm font-medium">Supporting files and document relationships</summary><div className="mt-5 space-y-5">{record && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Supporting evidence files{evidenceDirty ? " · awaiting review" : ""}</summary>
          <div tabIndex={-1} data-package-panel="evidence" className="pt-3"><Suspense fallback={<p role="status">Loading supporting files…</p>}>
            <PackageEvidencePanel record={record} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || assemblyDirty || scanDirty || templateDirty || upgradeDirty || rosterDirty}
              busy={busy} run={run} onApply={update} onDirtyChange={setEvidenceDirty} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
{readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Scanned evidence{scanDirty ? " · unsaved corrections" : ""}</summary>
          <div tabIndex={-1} data-package-panel="scans" className="min-w-0 pt-3"><Suspense fallback={<p className="text-sm">Opening scanned evidence…</p>}>
            <PackageScanPanel record={readRecord} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || requirementsDirty || consistencyDirty || workDirty || evidenceDirty || signingDirty || assemblyDirty || templateDirty || upgradeDirty || rosterDirty}
              busy={busy} run={run} onApply={update} onDirtyChange={setScanDirty} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
<PackageCitations key={`citations:${record.id}:${revision.id}`} record={record} revision={revision} editable={editable} destination={destination}
                onChange={action => void run(async () => update(await action(operation.current?.signal)))} />
<PackageCitationReorder key={`reorder-${record.id}:${revision.id}:${record.sequence}`} record={record} revision={revision} editable={editable} prepared={citationReorder}
                onPrepare={value => void run(() => prepareCitationReorder(value))} onDiscard={() => setCitationReorder(null)}
                onChange={action => void run(async () => update(await action(operation.current?.signal)))} /></div></details>
                  </fieldset>
                  <fieldset hidden={workspaceSection !== 'delivery'} disabled={busy || pendingPackageEdits && !signingDirty && !assemblyDirty} className="package-workspace-page space-y-7">
                    <h2 className="text-base font-medium">Export</h2>
                    <div ref={deliveryRef} tabIndex={-1} className="outline-none">{pdfUrl || prepared && !["assemble", "draft", "portable"].includes(reviewMode) ? <Button variant="link" className="h-auto p-0" disabled={busy} onClick={cancelExport}><ArrowLeft aria-hidden="true" className="size-4" />Back to export options</Button> : <PackageExportOptions active={workspaceSection === 'delivery' && !formSigning} canSign={editable} onNavigate={openDeliveryFinding} revision={revision} format={deliveryFormat} disabled={busy || pendingPackageEdits} pdfDisabled={!!openedReview} onFormat={format => { setDeliveryFormat(format); setPrepared(null); setOriginal(null); setPdfUrl(''); setError(''); setNotice(''); }} onPrepare={() => void run(() => review(deliveryFormat === 'draft' ? 'draft' : deliveryFormat === 'pdf' ? 'assemble' : 'portable'))} onOpenDocument={inspectMember} />}</div>
                    <div ref={preparedResultRef} tabIndex={-1} className="outline-none">{prepared && (
                <section className="space-y-3 rounded border p-3">
                  <h3 className="font-medium">
                    {reviewMode === 'original' ? original?.asset.name : reviewMode === 'saved' || reviewMode === 'preview' ? selectedRetainedOutput?.asset.name : prepared.purpose === "portable" ? "Editable package" : "PDF export"}
                  </h3>

                  <PackageExportFindings results={[prepared, ...otherReviews]} revision={revision} onNavigate={followDestination} />

                  <div className="flex flex-wrap gap-2"><Button
                    disabled={
                      pendingPackageEdits || busy ||
                      [prepared, ...otherReviews].some((result) =>
                        ["draft", "incomplete"].includes(
                          result.readiness.state,
                        ),
                      )
                    }
                    onClick={() => void run(() => deliver(true))}
                  >
                    {reviewMode === "draft" ? "Download draft PDF" : reviewMode === "assemble"
                      ? "Download PDF"
                      : reviewMode === "portable"
                        ? "Download editable package"
                        : reviewMode === "compare"
                          ? "Compare reviewed retained PDFs"
                        : reviewMode === "preview"
                          ? "Preview reviewed retained PDF"
                          : reviewMode === "original"
                            ? "Download reviewed unchanged original"
                            : "Download reviewed retained PDF"}
                  </Button><Button variant="outline" disabled={busy} onClick={cancelExport}>Cancel export</Button></div>
                </section>
              )}</div>
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
                    <div hidden={deliveryFormat !== 'pdf'}><Suspense fallback={<p className="text-sm">Opening saved PDF contents…</p>}>
                <PackageOutputNavigation output={selectedRetainedOutput} revision={revision} disabled={busy || pendingPackageEdits}
                  onNavigate={followDestination} onOpenPage={(outputId, page) => {
                    if (busy || pendingPackageEdits || outputId !== selectedRetainedOutput?.id) return;
                    useUIStore.getState().rememberPreviewPage(`package:${record.id}:${revision.id}:${outputId}`, page);
                    setPdfUrl(""); void run(() => review("preview"));
                  }} />
              </Suspense></div>
                    <details><summary className="cursor-pointer text-sm font-medium">Saved files</summary><fieldset disabled={busy || pendingPackageEdits} className="mt-5 space-y-5">{(revision.outputs.length > 1 || missingRetainedOutput) && <label className="w-full min-w-0 text-sm sm:max-w-xl">
                  Retained PDF to open
                  <select aria-label="Retained PDF to open" disabled={busy || pendingPackageEdits}
                    className="mt-1 w-full min-w-0 rounded border bg-background p-2"
                    value={selectedRetainedOutputId || selectedRetainedOutput?.id || ""}
                    onChange={event => {
                      if (busy || pendingPackageEdits) return;
                      setSelectedRetainedOutputId(event.target.value); setPrepared(null);  setPdfUrl(""); setNotice(""); setError("");
                    }}>
                    {missingRetainedOutput && <option value={selectedRetainedOutputId}>Selected PDF unavailable</option>}
                    {revision.outputs.map((output, index) => <option key={output.id} value={output.id}>
                      Saved PDF {index + 1} · {output.asset.name}{index === revision.outputs.length - 1 ? " (latest)" : ""}
                    </option>)}
                  </select>
                </label>}
{missingRetainedOutput && <p role="alert" className="w-full break-words text-sm text-destructive">The selected retained PDF is no longer included in this saved revision. Choose another retained PDF.</p>}
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
                )}{revision.outputs.map((output) => (
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
              ))}</fieldset></details>
                    <details><summary className="cursor-pointer text-sm font-medium">Other export options</summary><div className="mt-5 space-y-5">{readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Assembly layout{assemblyDirty ? " · unsaved settings" : ""}</summary>
          <div tabIndex={-1} data-package-panel="assembly" className="min-w-0 pt-3"><Suspense fallback={<p role="status">Opening assembly settings…</p>}>
            <PackageAssemblyPanel record={readRecord} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || requirementsDirty || consistencyDirty || workDirty || signingDirty || evidenceDirty || scanDirty || templateDirty || upgradeDirty || rosterDirty}
              busy={busy} run={run} onApply={update} onDirtyChange={setAssemblyDirty} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
<fieldset disabled={busy || pendingPackageEdits}><WordPackageDownload key={`${record.id}:${revision.id}`} record={readRecord!} revisionId={revision.id} ports={ports} exportGate={exportGate} /></fieldset>
{revision.outputs.length > 1 && (
                <section className="space-y-3 rounded border p-3" aria-label="Compare saved renderings">
                  <h3 className="font-medium">Compare saved renderings</h3>
                  <p className="text-sm">Download a PDF to save a new rendering of this version, then compare it with an earlier saved PDF.</p>
                  {(["before", "after"] as const).map(side => (
                    <label className="block text-sm" key={side}>
                      {side === "before" ? "Earlier retained PDF" : "Later retained PDF"}
                      <select disabled={busy || pendingPackageEdits} className="mt-1 w-full rounded border bg-background p-2"
                        value={side === "before" ? beforeComparisonId : afterComparisonId}
                        onChange={event => {
                          (side === "before" ? setBeforeOutputId : setAfterOutputId)(event.target.value);
                          setPrepared(null);  setRenderComparison(null);
                        }}>
                        {revision.outputs.map((output, index) => <option key={output.id} value={output.id}>Saved PDF {index + 1} · {new Date(output.createdAt).toLocaleString()}</option>)}
                      </select>
                    </label>
                  ))}
                  <Button variant="outline" disabled={busy || pendingPackageEdits || beforeComparisonId === afterComparisonId}
                    onClick={() => void run(() => review("compare"))}>Review PDF comparison</Button>
                </section>
              )}
{renderComparison && <PackageRenderComparisonView comparison={renderComparison} />}
{readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Package signing{signingDirty ? " · awaiting capture" : ""}</summary>
          <div className="min-w-0 pt-3"><Suspense fallback={<p role="status">Opening package signing…</p>}>

            <PackageSigningPanel record={readRecord} revision={revision} disabled={!editable || typedDirty || starterDirty || intakeDirty || informationDirty || requirementsDirty || consistencyDirty || workDirty || assemblyDirty || evidenceDirty || scanDirty || templateDirty || upgradeDirty || rosterDirty}
              busy={busy} run={run} onApply={update} destination={destination} onNavigate={followDestination} onDirtyChange={setSigningDirty} signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
          </Suspense></div>
        </details>}
{record && readRecord && revision && <details className="min-w-0 rounded border p-2 sm:p-3">
          <summary className="cursor-pointer text-sm font-medium">Recipient delivery</summary>
          <div className="min-w-0 pt-3"><Suspense fallback={<p role="status">Opening recipient delivery…</p>}>
            <PackageDeliveryPanel canSign={editable} visible={workspaceSection === 'delivery' && !formSigning} onNavigate={openDeliveryFinding} directDownload record={record} revision={revision} disabled={pendingPackageEdits} ports={ports}
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
        </details>}</div></details>
                  </fieldset>
                  <div hidden={workspaceSection !== 'delivery'} className="mt-7">
                    {readRecord && revision && <Suspense fallback={<p role="status">Opening saved assembly jobs…</p>}>
                      <PackageJobsPanel record={readRecord} revision={revision} disabled={pendingPackageEdits || !!openedReview} busy={busy} ports={ports} run={run} onApply={update}
                        signal={() => operation.current?.signal} isCurrent={() => active.current && !operation.current?.signal.aborted} />
                    </Suspense>}
                  </div>
                </>}
              </div>
            </div>
          </div>
        </div>
        <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
          <DialogContent><DialogHeader><DialogTitle>Version history</DialogTitle><DialogDescription>{record?.name}</DialogDescription></DialogHeader>
            {record && revision && <label className="block text-sm">Package revision<select aria-label="Package revision" value={revision.id} disabled={busy || pendingPackageEdits} className="mt-2 w-full rounded border bg-background p-2" onChange={event => changeRevision(event.target.value)}>{[...record.revisions].reverse().map((item, index) => <option key={item.id} value={item.id}>{record.historyScope === 'selected-revision' ? `Saved revision ${item.id.slice(-8)}` : `Version ${record.revisions.length - index}`} · {new Date(item.createdAt).toLocaleString()}{item.id === record.currentRevisionId ? ' · Current' : ''}</option>)}</select></label>}
            <p className="text-xs text-muted-foreground">Open Documents or Delivery after choosing a version to inspect its captured content.</p>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>Done</Button>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
    {record && revision && formSigning && <Suspense fallback={<p role="status">Opening signing workspace…</p>}><OfficialSigningWorkspace open initialRecordId={formSigning.id} initialField={formSigning.initialField}
              onOpenChange={open => { if (!open) setFormSigning(undefined); }}
              onAttach={async (saved, inspection) => {
                if (!editable || !record) throw new Error('The package changed. Reopen the current member before applying a signed revision.');
                const source = revision.members.find(item => item.id === formSigning.memberId);
                if (!source || source.revisionId !== formSigning.revisionId || source.kind === 'attachment' || await signingMemberKey(record.id, source) !== formSigning.documentId) throw new Error('The original member revision is unavailable.');
                const bytes = await checkPackageFormReturn(record, source, saved, formSigning, inspection);
                const original = await captureOriginalPackageMember({ name: saved.filename, data: bytes.buffer }, source.role, true);
                await modify(revision.members.map(item => item.id === source.id
                  ? { ...original, id: source.id, label: source.label, required: source.required, ...(source.endorsementLink && { endorsementLink: source.endorsementLink }) } : item));
                setFormSigning(undefined);
              }} /></Suspense>}
      {record && revision && shareOpen && <Suspense fallback={<p role="status">Opening package sharing…</p>}><PackageShareDialog key={`${record.id}:${revision.id}`} record={record} revisionId={revision.id} onClose={() => setShareOpen(false)} /></Suspense>}
    {encryptedImport && <ShareModal open mode="import" initialPayload={encryptedImport} onOpenChange={open => { if (!open) setEncryptedImport(null); }} />}
  </>;

}
