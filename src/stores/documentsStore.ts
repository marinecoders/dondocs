import { hasReviewComments, reviewCommentsSchema, type ReviewComments } from '@/lib/reviewComments';
import { showAppAlert } from '@/stores/alertStore';
import { materializeSignatureFallbacks, needsSignatureFallbacks } from '@/lib/signatureCompatibility';
import { signatureForComparison, formSignaturesForComparison } from '@/lib/signatureProjection';
import { materializeStoredSignatureFallbacks } from './signatureCompatibility';
import { sessionSearchFields } from '@/lib/workspaceSearch';
import { ENDORSEMENT_TEXT_FIELDS, endorsementTexts, hasEndorsementContent } from '@/lib/appendedEndorsement';
import { create } from 'zustand';
import { compressedParse } from '@/lib/compressedStorage';
import { DOC_TYPE_LABELS, formTypeLabel, type FormType, type DocumentCategory } from '@/types/document';
import { waitForStorage, DocumentWrites, WRITE_JOURNAL_KEY, parseDocumentWriteJournal, serializeDocumentWriteJournal, type PendingDocumentWrite } from '@/lib/documentWrites';
import { recoverReviewReturnWrite, REVIEW_WRITE_RECOVERY_KEY } from '@/lib/reviewReturnRecovery';
import { reviewReturnWriteSchema, type ReviewReturnWrite } from '@/lib/reviewReturns';
import { supportsReviewComments } from '@/lib/reviewCommentTargets';
import { parseFormInstance, migrateLegacyAnswers, type FormInstance } from '@/services/forms/model';
import { lastWriteFailed } from '@/lib/compressedStorage';
import {
  useDocumentStore,
  getSerializedSession,
  serializeSession,
  getSavedSession,
  prepareSessionState,
  installSessionState,
  createBlankSession,
  rehydrateEnclosureFiles,
  isApplyingSession,
  observeSessionReplacement,
  isApplyingAssets,
  areSessionSavesSuspended,
  saveSessionToStorage,
  replaceSessionState,
  clearSavedSession,
  type SerializedSession,
  type DocumentState,
} from './documentStore';
import { useUIStore } from './uiStore';
import { useProfileStore } from './profileStore';
import { canonicalizeUnitAddress } from '@/lib/unitAddress';
import { migratePortionMarkings } from '@/lib/paragraphUtils';
import { ensureParagraphIds, paragraphCommentIds } from '@/lib/paragraphIdentity';
import type { Profile } from '@/types/document';
import {
  idbGetAllDocuments,
  idbWriteDocument,
  idbDeleteDocumentIfUnchanged,
  idbAddSnapshot,
  idbReadSnapshots,
  idbEnrichSnapshots,
  idbGetCurrentId,
  idbSetCurrentId,
  idbGetMigratedIds,
  idbSetMigratedIds,
  type StoredDocument,
} from '@/lib/documentsDb';
import { useFormStore, serializeForm, FORMS_PERSIST_KEY } from './formStore';
import { scheduleBackup } from './backupStore';
import { debug } from '@/lib/debug';
import { TIMING } from '@/lib/constants';
import { useHistoryStore, type DocumentSnapshot } from './historyStore';
import { persistAttachment, withAttachmentStaging } from '@/lib/attachments';
import type { ReviewedDraft } from '@/lib/draftFile';
import { configForFormType } from '@/services/formRegistry';

/**
 * Multi-document registry behind the Recents list. Each document is a
 * SerializedSession plus light metadata, keyed by a stable id, with one marked
 * `currentId`. Persisted per-document in IndexedDB (see documentsDb): each
 * mutation mirrors the touched record. Hydration is async, so init() is a Promise.
 *
 * A registry entry is the same payload a share link carries, so it reuses the
 * document store's serialize/apply helpers. This store is authoritative for which
 * document is open: init loads the current one (auto-resume).
 *
 * Correspondence and each filled form share this lifecycle.
 */

export interface DocumentMeta {
  id: string;
  title: string;
  docType: string;
  updatedAt: number;
  /** User-set name; overrides the auto (Subject-derived) title and survives
   *  subsequent Subject edits. Empty/undefined falls back to the auto title. */
  name?: string;
  /** Pinned to the top of Recents (survives content edits — see metaFor). */
  pinned?: boolean;
  /** Reader hint only; review/source authority lives in the separate review records. */
  nativeReviewText?: true;
  /** In Trash until the user restores or permanently deletes this record. */
  deletedAt?: number;
}

export interface DocumentEntry {
  meta: DocumentMeta;
  session: SerializedSession;
}

const scopeBrand = Symbol('DocumentScope');
export interface DocumentScope {
  readonly documentId: string;
  readonly epoch: number;
  readonly [scopeBrand]: true;
}
export type TransitionOutcome = 'applied' | 'unchanged' | 'stale' | 'invalid' | 'safety-copy-failed';
const issuedScopes = new WeakSet<DocumentScope>();
const targetBrand = Symbol('DocumentTarget');
export interface DocumentTarget {
  readonly scope: DocumentScope;
  readonly editSequence: number;
  readonly [targetBrand]: true;
}
const issuedTargets = new WeakSet<DocumentTarget>();
let editSequence = 0;
let restoreRequest = 0;
let openingRequest = 0;

export function captureDocumentScope(): DocumentScope | null {
  const { currentId, activationEpoch } = useDocumentsStore.getState();
  if (!currentId) return null;
  const scope: DocumentScope = Object.freeze<DocumentScope>({ documentId: currentId, epoch: activationEpoch, [scopeBrand]: true });
  issuedScopes.add(scope);
  return scope;
}

export function isCurrentDocumentScope(scope: DocumentScope | null): scope is DocumentScope {
  const state = useDocumentsStore.getState();
  return !!scope && issuedScopes.has(scope) && scope.documentId === state.currentId
    && scope.epoch === state.activationEpoch && !state.trash[scope.documentId];
}

/** Bind a destructive proposal to the content the user reviewed. */
export function captureDocumentTarget(): DocumentTarget | null {
  const scope = captureDocumentScope();
  if (!scope) return null;
  const target = Object.freeze<DocumentTarget>({ scope, editSequence, [targetBrand]: true });
  issuedTargets.add(target);
  return target;
}

export function isCurrentDocumentTarget(target: DocumentTarget | null): target is DocumentTarget {
  return !!target && issuedTargets.has(target) && isCurrentDocumentScope(target.scope) && target.editSequence === editSequence;
}

/** Stop this reviewed editor from saving itself again during crash recovery. */
export function detachDocumentForRecovery(target: DocumentTarget | null): boolean {
  if (target ? !isCurrentDocumentTarget(target) : useDocumentsStore.getState().currentId !== null) return false;
  cancelPendingEditorWork();
  useDocumentsStore.setState({ ...activation(null), baseline: null });
  if (target) writes.cancel(target.scope.documentId);
  return true;
}

function activation(currentId: string | null) {
  return { currentId, activationEpoch: useDocumentsStore.getState().activationEpoch + 1 };
}

const preparedBrand = Symbol('PreparedDocument');
export interface PreparedDocument { readonly [preparedBrand]: true }
const preparedDocuments = new WeakMap<PreparedDocument, DocumentSnapshot>();

function ownPreparedState(state: DocumentSnapshot): PreparedDocument {
  const prepared = Object.freeze<PreparedDocument>({ [preparedBrand]: true });
  preparedDocuments.set(prepared, state);
  return prepared;
}

export function prepareDocument(value: unknown, preserveNativeText = false): PreparedDocument {
  return ownPreparedState(prepareSessionState(value, preserveNativeText));
}

interface InstallOptions {
  id?: string;
  save?: boolean;
  resume?: boolean;
  preserveOutgoing?: boolean;
}

/** Install only fully prepared input; all live state agrees before observers resume. */
function installDocument(prepared: PreparedDocument, options: InstallOptions = {}): TransitionOutcome {
  const incoming = preparedDocuments.get(prepared);
  if (!incoming) return 'invalid';
  openingRequest++;
  if (options.preserveOutgoing !== false) useDocumentsStore.getState().syncCurrent();
  const previous = useDocumentsStore.getState();
  const document = useDocumentStore.getState().getSnapshot();
  const forms = useFormStore.getState();
  const history = useHistoryStore.getState();
  const ui = useUIStore.getState();
  const id = options.id ?? newId();
  let failed = false;
  replaceSessionState(() => {
    try {
      useDocumentsStore.setState(activation(id));
      installSessionState(structuredClone(incoming));
      const baseline = getSerializedSession();
      useDocumentsStore.setState({ baseline });
    } catch (error) {
      failed = true;
      debug.error('Documents', 'Document installation cancelled', error);
      useDocumentsStore.setState({ ...activation(previous.currentId), baseline: previous.baseline });
      try { useFormStore.setState(forms); } catch { /* The in-memory rollback precedes persistence. */ }
      const { forms: _forms, ...content } = document;
      useDocumentStore.setState(content);
    }
  });
  if (failed) {
    useHistoryStore.getState().restoreHistory(history, captureDocumentScope());
    useUIStore.setState({ saveStatus: ui.saveStatus, lastSavedAt: ui.lastSavedAt, saveWarning: ui.saveWarning });
    return 'invalid';
  }
  if (previous.currentId && previous.currentId !== id && !writes.hasChanges(previous.currentId)) {
    // Verification owns no edits that need to survive leaving this document.
    writes.cancel(previous.currentId);
  }
  if (options.resume !== false) persistCurrentId(id);
  if (options.save !== false) useDocumentsStore.getState().saveCurrent();
  else {
    updateSaveStatus(id);
  }
  useUIStore.getState().setValidationVisible(false);
  void hydrateDocumentAssets(captureDocumentScope());
  return 'applied';
}

export function openPreparedDocument(prepared: PreparedDocument, target: DocumentTarget | null): TransitionOutcome {
  if (target ? !isCurrentDocumentTarget(target) : useDocumentsStore.getState().currentId !== null) return 'stale';
  return installDocument(prepared);
}

export function replaceCurrentDocument(prepared: PreparedDocument, target: DocumentTarget | null): TransitionOutcome {
  if (!isCurrentDocumentTarget(target)) return 'stale';
  return installDocument(prepared, { id: target.scope.documentId });
}

export async function hydrateDocumentAssets(scope: DocumentScope | null = captureDocumentScope()): Promise<void> {
  if (!isCurrentDocumentScope(scope)) return;
  await rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
}

/** A caller owns the copy; only issued prepared documents may be inspected. */
export function copyPreparedDocument(prepared: PreparedDocument): DocumentSnapshot {
  const state = preparedDocuments.get(prepared);
  if (!state) throw new Error('Invalid prepared document.');
  return structuredClone(state);
}

/** Reuse native draft resource staging for imports and pinned review copies. */
export async function prepareReviewedDocument(reviewed: ReviewedDraft, current: () => boolean, preserveNativeText = false): Promise<PreparedDocument | null> {
  const owned = structuredClone(reviewed);
  const state = prepareSessionState(owned.session, preserveNativeText);
  return stageReviewedDocument(owned, state, current);
}

function stageReviewedDocument(owned: ReviewedDraft, state: DocumentSnapshot, current: () => boolean): Promise<PreparedDocument | null> {
  return withAttachmentStaging(async () => {
    if (!current()) return null;
    for (const [index, file] of owned.figures.entries()) {
      if (!file) continue;
      const figure = state.paragraphs[index]?.figure;
      if (!figure) throw new Error('Invalid reviewed document resource.');
      figure.fileRef = await persistAttachment({ name: file.name, size: file.size, type: figure.type ?? 'image/png' }, file.data);
      if (!current()) return null;
    }
    if (owned.basicLetter) {
      const file = owned.basicLetter;
      state.formData.basicLetterFileRef = await persistAttachment({ name: file.name, size: file.size, type: 'application/pdf' }, file.data);
      if (!current()) return null;
      state.formData.basicLetterFile = file;
    }
    for (const [index, file] of owned.files.entries()) {
      if (!file) continue;
      const enclosure = state.enclosures[index];
      if (!enclosure) throw new Error('Invalid reviewed document resource.');
      const ref = await persistAttachment({ name: file.name, size: file.size, type: 'application/pdf' }, file.data);
      if (!current()) return null;
      state.enclosures[index] = { ...enclosure, file, fileRef: ref };
    }
    return ownPreparedState(state);
  });
}

/** Stage operation-owned files before changing the editor or library identity. */
export async function openReviewedDocument(reviewed: ReviewedDraft, target: DocumentTarget | null): Promise<TransitionOutcome> {
  if (!isCurrentDocumentTarget(target)) return 'stale';
  const request = ++openingRequest;
  const current = () => request === openingRequest && isCurrentDocumentTarget(target);
  let owned: ReviewedDraft;
  let state: DocumentSnapshot;
  try { owned = structuredClone(reviewed);state = prepareSessionState(owned.session); }
  catch { return 'invalid'; }
  return withAttachmentStaging(async () => {
    const prepared = await stageReviewedDocument(owned, state, current);
    return prepared ? openPreparedDocument(prepared, target) : 'stale';
  });
}

/** Publish an already committed reviewer copy without replacing the source draft. */
export function openCommittedReviewCopy(prepared: PreparedDocument, record: StoredDocument, target: DocumentTarget | null): TransitionOutcome {
  useDocumentsStore.setState(state => ({ docs: { ...state.docs, [record.id]: { meta: record.meta, session: record.session } } }));
  broadcastDocs({ type: 'put', id: record.id });
  scheduleBackup();
  if (!isCurrentDocumentTarget(target)) return 'stale';
  return installDocument(prepared, { id: record.id, save: false });
}

export function restoreSavedDocument(): TransitionOutcome {
  const session = getSavedSession();
  return session ? openSessionAsNew(session) : 'unchanged';
}

function createCorrespondenceSession(docType = 'naval_letter'): SerializedSession {
  const session = createBlankSession(undefined, docType);
  const { selectedProfile, profiles } = useProfileStore.getState();
  if (selectedProfile && profiles[selectedProfile]) session.formData = { ...session.formData, ...profileFormPatch(profiles[selectedProfile]) };
  return session;
}

export function newCorrespondenceDocument(docType = 'naval_letter'): TransitionOutcome {
  let prepared: PreparedDocument;
  try { prepared = prepareDocument(createCorrespondenceSession(docType)); }
  catch { return 'invalid'; }
  return installDocument(prepared, { save: false });
}

function prepareBlankDocument(formType?: FormType): PreparedDocument {
  return prepareDocument(formType ? createBlankSession(formType) : createCorrespondenceSession());
}

export function openFormInstance(instance: FormInstance): TransitionOutcome {
  return openSessionAsNew({ ...createBlankSession(), documentCategory: 'forms', formType: instance.definition.formId,
    genericForm: instance, formData: {}, references: [], enclosures: [], paragraphs: [], copyTos: [], distributions: [],
  });
}

export function resetCurrentDocument(): TransitionOutcome {
  const scope = captureDocumentScope();
  if (!isCurrentDocumentScope(scope)) return 'stale';
  const document = useDocumentStore.getState();
  if (document.documentCategory !== 'forms') {
    const history = recordDocumentHistory(scope) ? useHistoryStore.getState() : null;
    const outcome = replaceCurrentDocument(prepareDocument(createBlankSession()), captureDocumentTarget());
    if (outcome === 'applied' && history) {
      // Reset is an edit of this document. Retain its Undo chain under the new
      // activation so pending work from before Reset remains invalid.
      const owner = captureDocumentScope();
      useHistoryStore.getState().restoreHistory(history, owner);
      recordDocumentHistory(owner);
    }
    return outcome;
  }
  recordDocumentHistory(scope);
  if (document.genericForm) useDocumentStore.setState({ genericForm: { ...document.genericForm, answers: {}, rows: {}, answerRevision: document.genericForm.answerRevision + 1 } });
  else {
    const forms = useFormStore.getState();
    if (document.formType === 'navmc_118_11') forms.resetNavmc11811();
    else forms.resetNavmc10274();
  }
  recordDocumentHistory(scope);
  return 'applied';
}

async function openGenericDocument(formType: string): Promise<void> {
  const target = captureDocumentTarget();
  const request = ++openingRequest;
  const legacy = useFormStore.getState();
  const migrate = !Object.values(useDocumentsStore.getState().docs).some(entry => entry.session.genericForm?.definition.formId === formType);
  const values = structuredClone(legacy.configFormValues[formType] ?? {});
  const rows = structuredClone(legacy.configFormRows[formType] ?? {});
  try {
    const definition = await configForFormType(formType);
    if (request !== openingRequest || !isCurrentDocumentTarget(target)) return;
    if (!definition) throw new Error('This form is unavailable. Reconnect and select it again.');
    if (definition.formId !== formType) throw new Error('The form definition does not match the selected form.');
    const data = migrate ? migrateLegacyAnswers(definition, values, rows) : { answers: {}, rows: {} };
    openFormInstance({ definition, ...data, answerRevision: 0 });
  } catch (error) {
    if (request === openingRequest && isCurrentDocumentTarget(target)) showAppAlert({ title: 'Form could not be opened', message: error instanceof Error ? error.message : 'Select the form again to retry.' });
  }
}

interface DocumentsState {
  docs: Record<string, DocumentEntry>;
  /** Last viewed drafts for category navigation in this workspace session. */
  lastKindIds: Partial<Record<DocumentCategory | FormType, string>>;
  trash: Record<string, DocumentEntry>;
  restoreFromTrash: (id: string) => void;
  permanentlyDelete: (id: string) => Promise<boolean>;
  currentId: string | null;
  activationEpoch: number;
  /** True once the registry has been read out of IndexedDB. */
  hydrated: boolean;
  recoveryCount: number;
  /**
   * The current document's content when it became current (loaded, switched to,
   * or reset). A not-yet-in-Recents document enters Recents once live content
   * drifts from this baseline; a pristine starter stays out. Not persisted.
   */
  baseline: SerializedSession | null;
  /** Snapshot the live document as the baseline (after it's loaded/reset). */
  markBaseline: () => void;
  /**
   * Hydrate from IndexedDB, then load the current doc or migrate the legacy
   * session. Resolves true when it resumed/migrated an existing document (so the
   * caller skips re-applying the profile), false when it seeded a fresh blank.
   */
  init: () => Promise<boolean>;
  /**
   * Snapshot a document into the current registry entry. Defaults to the live
   * document; pass a prior state to preserve it across a category transition.
   */
  syncCurrent: (source?: DocumentState) => void;
  /** Force the current document into Recents now (the explicit Save button). */
  saveCurrent: () => void;
  /** Start a blank correspondence document and make it current. */
  newDocument: (formType?: FormType) => void;
  selectKind: (category: DocumentCategory, formType?: FormType) => void;
  /** Open an existing document by id. */
  switchTo: (id: string) => void;
  /** Soft-delete a document; if it was open, fall back to the newest remaining
   *  or a blank one. Trash retains the complete entry and version history. */
  remove: (id: string) => void;
  /** Soft-delete several documents at once (bulk select), sharing one undo
   *  window. Reopens a fallback doc if the current one was among them. */
  removeMany: (ids: string[]) => void;
  /** Most recent soft delete, surfaced as a "Removed — Undo" affordance. `ids`
   *  holds every doc in the batch; `title` is the single title or "N documents". */
  pendingDelete: { ids: string[]; title: string } | null;
  /** Undo the most recent soft delete (re-list every kept entry in the batch). */
  restoreDeleted: () => void;
  /** Pin/unpin a document to the top of Recents. */
  togglePin: (id: string) => void;
  /** Give a document a user-set name (empty string clears it back to auto). */
  renameDocument: (id: string, name: string) => void;
  /** Clone a document into a new Recents entry titled "Copy of …". */
  duplicateDocument: (id: string) => void;
  /** Replace only the requested activation after its safety copy commits. */
  restoreSnapshot: (session: SerializedSession, target: DocumentTarget | null) => Promise<TransitionOutcome>;
  /** Detach live content into a new entry for recovery adapters. */
  openLoadedAsNew: () => void;
}

const newId = (): string => {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  // crypto.randomUUID is secure-context-only (undefined on plain http / some
  // embedded webviews), but getRandomValues is not — use it for a
  // collision-resistant id there instead of the weaker time+Math.random path.
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    return `doc_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
  }
  // Last resort (no Web Crypto at all): time + Math.random.
  return `doc_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
};

const isPlaceholder = (v: string): boolean => /^\[.*\]$/.test(v);

// True once the document holds real work: review feedback, a non-placeholder
// subject or a body paragraph with real text. Starter placeholders don't count, so a
// blank new document stays out of Recents until the user writes something. Used
// only for the legacy single-session migration on first load (no baseline to
// diff against); the live promotion path uses hasContentDrift() below.
export function isMeaningful(s: SerializedSession): boolean {
  if (hasReviewComments(s)) return true;
  if (s.documentCategory === 'forms' && s.genericForm) return true;
  if (s.documentCategory === 'forms') return !!s.forms;
  const subj = (s.formData?.subject ?? '').trim();
  if (subj !== '' && !isPlaceholder(subj)) return true;
  if (endorsementTexts(s.formData ?? {}).some((text) => text.trim() !== '' && !isPlaceholder(text.trim()))) return true;
  return (
    s.paragraphs?.some((p) => {
      const t = (p.text ?? '').trim();
      return t !== '' && !isPlaceholder(t);
    }) ?? false
  );
}

// A fingerprint of the *content* fields a user actually fills — what the letter
// says and who it's addressed to / copied to — excluding document configuration
// (letterhead, From, SSIC, serial, date, signature, font, doc-type). The starter
// document ships with demo references and copy-tos, so "has a copy-to" can't mean
// "has work"; instead we diff these fields against the doc's starting baseline, so
// only fields the USER changed from that starting point count. Review feedback
// is user work even when the draft itself still contains starter text.
function contentFingerprint(s: SerializedSession): string {
  if (s.documentCategory === 'forms' && s.genericForm) return JSON.stringify(s.genericForm);
  if (s.documentCategory === 'forms') return JSON.stringify(s.forms ?? {});
  const fd = s.formData ?? {};
  return JSON.stringify([
    fd.subject ?? '',
    fd.to ?? '',
    fd.via ?? '',
    // Classification is content the user sets, and it drives portion markings.
    fd.classLevel ?? '',
    fd.customClassification ?? '',
    fd.appendEndorsement ?? false,
    ENDORSEMENT_TEXT_FIELDS.map((field) => fd[field] ?? ''),
    (fd.additionalEndorsements ?? []).filter(hasEndorsementContent)
      .map((entry) => ENDORSEMENT_TEXT_FIELDS.map((field) => entry[field] ?? '')),
    // Per-paragraph: body text + heading, plus indent level and portion marking
    // (a paragraph reworked only by marking/indent is still real work).
    (s.paragraphs ?? []).map((p) => [p.text ?? '', p.header ?? '', p.level ?? 0, p.portionMarking ?? '']),
    (s.references ?? []).map((r) => [r.title ?? '', r.url ?? '']),
    (s.enclosures ?? []).map((e) => [e.title ?? '', e.coverPageDescription ?? '']),
    (s.copyTos ?? []).map((c) => c.text ?? ''),
    (s.distributions ?? []).map((d) => d.text ?? ''),
    hasReviewComments(s) ? s.reviewComments : null,
  ]);
}

// Did the user change any real content from the document's starting baseline?
// Tweaking only letterhead / font / doc-type / SSIC / serial / date is not content
// drift, so a pristine starter (or one only reconfigured) stays out of Recents,
// but filling the recipient, body, references, enclosures, copy-tos, or
// distribution promotes the document so "New" can no longer silently discard it.
export function hasContentDrift(baseline: SerializedSession, session: SerializedSession): boolean {
  return contentFingerprint(baseline) !== contentFingerprint(session);
}

// List title: the Subject line when present, else the document-type name.
// Recomputed on every save.
export function deriveTitle(s: SerializedSession): string {
  if (s.documentCategory === 'forms' && s.genericForm) return s.genericForm.definition.label;
  const clip = (t: string) => (t.length > 70 ? `${t.slice(0, 69)}…` : t);
  if (s.documentCategory === 'forms') {
    const form = s.forms;
    const title = s.formType === 'navmc_118_11'
      ? [form?.navmc11811?.lastName, form?.navmc11811?.firstName].filter(Boolean).join(', ')
      : form?.navmc10274?.natureOfAction;
    return clip(title?.trim() || `${formTypeLabel(s.formType, s.genericForm?.definition.label)} draft`);
  }
  const subj = (s.formData?.subject ?? '').trim();
  if (subj !== '' && !isPlaceholder(subj)) return clip(subj);
  // No usable subject yet — fall through so an in-progress draft still reads as
  // itself instead of collapsing to an indistinguishable "<Type> draft":
  //   1) who it's addressed to, then 2) the first real line of the body.
  const to = (s.formData?.to ?? '').trim().split('\n')[0]?.trim();
  if (to && !isPlaceholder(to)) return clip(`To ${to}`);
  const firstBody = (s.paragraphs ?? [])
    .map((p) => (p.text ?? '').trim())
    .find((t) => t !== '' && !isPlaceholder(t));
  if (firstBody) return clip(firstBody);
  return `${DOC_TYPE_LABELS[s.docType] ?? 'Document'} draft`;
}

/**
 * Lowercased text blob for full-text Recents search — the title plus the fields
 * a user actually names a letter by (subject, recipient, routing, SSIC, body,
 * headings, references, enclosures), so search finds a document by more than the
 * title alone.
 */
export function searchableText(entry: DocumentEntry): string {
  return [entry.meta.title, entry.meta.name, ...sessionSearchFields(entry.session).map((field) => field.text)]
    .filter(Boolean).join(' ').toLocaleLowerCase();
}

/**
 * A human, safe download filename for the current document:
 *  an optional SSIC prefix + a slug of the derived title, so a letter downloads
 *  as `5216-request-for-special-liberty.pdf` instead of `correspondence.pdf`.
 *  NAVMC forms build their own names; this brings correspondence to parity.
 */
export function correspondenceFilename(ext: string, session?: SerializedSession): string {
  const s = session ?? getSerializedSession();
  const slug =
    deriveTitle(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
      .replace(/-+$/, '') || 'correspondence';
  const stockList = s.docType === 'sl3' || s.docType === 'sl4' || s.docType === 'tm_ietm_front_matter';
  const identifier = (stockList ? s.formData?.shortTitle : s.formData?.ssic)?.trim() ?? '';
  const safeIdentifier = stockList ? identifier.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : identifier;
  const prefix = safeIdentifier && !isPlaceholder(identifier) ? `${safeIdentifier}-` : '';
  return `${prefix}${slug}.${ext}`;
}

// Same content if everything but save-derived fields matches. Ignore `timestamp`
// and each enclosure's `hasFile`: hasFile is emitted on serialize but dropped on
// load, so without ignoring it an attachment-bearing document would re-sort to
// the top of Recents on every reload.
export function sameContent(a: SerializedSession, b: SerializedSession): boolean {
  // Restores and older exporters can reorder object keys without editing data.
  const canonical = (value: unknown) => JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item);
  if ((a.documentCategory === 'forms' || b.documentCategory === 'forms') && (a.genericForm || b.genericForm)) return a.documentCategory === b.documentCategory && a.formType === b.formType && canonical(a.genericForm) === canonical(b.genericForm);
  const strip = ({ timestamp: _t, enclosures, ...rest }: SerializedSession) => ({
    ...rest,
    formData: { ...rest.formData, signatureImage: signatureForComparison(rest.formData?.signatureImage) },
    forms: rest.forms && { ...rest.forms,
      ...(rest.forms.navmc10274 ? { navmc10274: formSignaturesForComparison(rest.forms.navmc10274) } : {}),
      ...(rest.forms.navmc11811 ? { navmc11811: formSignaturesForComparison(rest.forms.navmc11811) } : {}),
    },
    enclosures: (enclosures ?? []).map(({ hasFile: _h, ...e }) => e),
  });
  return canonical(strip(a)) === canonical(strip(b));
}

/**
 * Seed the live document with the selected profile's letterhead, signatory, and
 * signature. Applied to a freshly-reset blank so "New document" starts from the
 * user's profile rather than the demo default. Shared by App's first-load seed
 * and newDocument/remove's blank fallback.
 */
/**
 * Map a profile's letterhead + signatory fields to a setFormData patch. The
 * signature block is applied ONLY when the profile carries a signer, so a
 * signer-less profile (e.g. the default unit profile) never blanks the
 * document's existing signature. Shared by applySelectedProfile (New-doc / seed)
 * and the interactive Profiles manager so the two paths can't drift.
 */
export function profileFormPatch(profile: Profile) {
  // A profile with no signer must NOT blank the document's existing signature —
  // that left new docs unsigned (and, before the \printSignature guard, crashed
  // the compile). Only overwrite the signature block when the profile carries a
  // signer; otherwise the doc keeps DEFAULT_FORM_DATA's signatory or its own.
  const hasSigner = !!(profile.sigFirst?.trim() || profile.sigLast?.trim());
  return {
    department: profile.department,
    unitLine1: profile.unitLine1,
    unitLine2: profile.unitLine2,
    // Canonicalize on read so a legacy profile gets the SECNAV comma layout.
    unitAddress: canonicalizeUnitAddress(profile.unitAddress),
    ssic: profile.ssic,
    from: profile.from,
    cuiControlledBy: profile.cuiControlledBy,
    pocEmail: profile.pocEmail,
    ...(hasSigner
      ? {
          sigFirst: profile.sigFirst,
          sigMiddle: profile.sigMiddle,
          sigLast: profile.sigLast,
          sigRank: profile.sigRank,
          sigTitle: profile.sigTitle,
          acting: profile.acting || false,
          actingTitle: profile.actingTitle || '',
          byDirection: !profile.acting && profile.byDirection,
          byDirectionAuthority: profile.byDirectionAuthority,
          signatureImage: profile.signatureImage ? (profile.signatureImage.data
            ? { name: profile.signatureImage.name, size: profile.signatureImage.size, data: profile.signatureImage.data }
            : structuredClone(profile.signatureImage)) : undefined,
        }
      : {}),
  };
}

export function applySelectedProfile(): void {
  const { selectedProfile, profiles } = useProfileStore.getState();
  const profile = selectedProfile ? profiles[selectedProfile] : null;
  if (!profile) return;
  useDocumentStore.getState().setFormData(profileFormPatch(profile));
}

/** Restore the built-in form view hint after the document library has loaded. */
export function restoreBuiltInFormView(session: SerializedSession | null): void {
  if (session?.documentCategory !== 'forms' || session.genericForm || !session.formType) return;
  const document = useDocumentStore.getState();
  if (document.genericForm) return;
  if (session.formType !== 'navmc_10274' && session.formType !== 'navmc_118_11') return;
  document.setDocumentCategory('forms');
  document.setFormType(session.formType);
}

function metaFor(id: string, session: SerializedSession, prev?: DocumentMeta): DocumentMeta {
  return {
    id,
    // A user-set name wins and survives Subject edits; otherwise auto-derive.
    title: prev?.name?.trim() || deriveTitle(session),
    docType: session.genericForm ? 'form' : session.documentCategory === 'forms' ? session.formType : session.docType,
    updatedAt: Date.now(),
    name: prev?.name,
    // Preserve the pin across content saves — metaFor rebuilds meta on every
    // sync, so without this a pinned doc would silently unpin on the next edit.
    pinned: prev?.pinned,
    nativeReviewText: prev?.nativeReviewText,
  };
}

// IndexedDB mirrors (fire-and-forget; documentsDb logs its own errors).
// Cross-tab sync channel (opened at the bottom of this module). Posting after a
// registry write lets sibling tabs mirror it into their Recents list.
let docsChannel: BroadcastChannel | null = null;
function broadcastDocs(msg: { type: 'put' | 'delete'; id: string }): void {
  try {
    docsChannel?.postMessage(msg);
  } catch {
    /* channel closed */
  }
}

const storedEntry = (entry: DocumentEntry): StoredDocument => ({ id: entry.meta.id, ...entry });
const writes = new DocumentWrites((before, after) => idbWriteDocument(before, after), (id, committed) => {
  if (committed) useDocumentsStore.setState(state => {
    const key = state.docs[id] ? 'docs' : state.trash[id] ? 'trash' : null;
    const entry = key && state[key][id];
    if (!key || !entry || JSON.stringify(entry.meta) !== JSON.stringify(committed.meta) || !sameContent(entry.session, committed.session)) return {};
    return { [key]: { ...state[key], [id]: { meta: committed.meta, session: committed.session } } };
  });
  updateSaveStatus(id);
  if (writes.failure(id) === 'conflict' || writes.failure(id) === 'missing-document') {
    if (writes.hasChanges(id)) {
      const after = writes.latest().find(record => record.id === id);
      if (after) retainRecoveryCopy(after);
    } else if (useDocumentsStore.getState().currentId !== id) {
      // An inactive verification has no edits to retain. Active verification
      // failures still block updating until the user leaves or retries Save.
      writes.cancel(id);
    }
  }
  if (committed) {
    broadcastDocs({ type: 'put', id });
    scheduleBackup();
  }
}, record => needsSignatureFallbacks(record.session)
  ? materializeSignatureFallbacks(record.session).then(session => ({ ...record, session })) : undefined);

/** Explicit same-meta repair keeps subsequent CAS expectations and receipts exact. */
async function materializeRegistrySignatures(records: StoredDocument[]): Promise<StoredDocument[]> {
  let conflict = false;
  const ready = await Promise.all(records.map(async record => {
    if (!needsSignatureFallbacks(record.session) || writes.has(record.id)) return record;
    try {
      return await waitForStorage((async () => {
        const session = await materializeSignatureFallbacks(record.session);
        if (JSON.stringify(session) === JSON.stringify(record.session) || writes.has(record.id)) return record;
        const after = { ...record, session };
        const outcome = await idbWriteDocument(record, after);
        if (outcome === 'committed' || outcome === 'already-committed') return after;
        conflict = true;return record;
      })());
    } catch { return record; }
  }));
  if (!conflict) return ready;
  try { return await waitForStorage(idbGetAllDocuments()) ?? ready; }
  catch { return ready; }
}

async function materializeHistorySignatures(id: string): Promise<void> {
  let active = true;
  try {
    await waitForStorage((async () => {
      const before = await idbReadSnapshots(id);
      if (!active) return;
      const after = await Promise.all(before.map(async snapshot => ({ ...snapshot, session: await materializeSignatureFallbacks(snapshot.session) })));
      if (active && JSON.stringify(before) !== JSON.stringify(after)) await idbEnrichSnapshots(id, before, after);
    })());
  } catch { /* A failed history read must not hide an independent library record. */ }
  finally { active = false; }
}

/** A memory registry entry alone cannot acknowledge a durable save. */
function updateSaveStatus(id: string): void {
  const state = useDocumentsStore.getState();
  if (state.currentId !== id) return;
  const ui = useUIStore.getState();
  const entry = state.docs[id];
  if (writes.failure(id)) { ui.setSaveStatus('error'); return; }
  if (!entry) { useUIStore.setState({ lastSavedAt: null }); ui.setSaveStatus('idle'); return; }
  if (!sameContent(entry.session, getSerializedSession())) { ui.setSaveStatus('pending'); return; }
  if (writes.has(id)) {
    if (!writes.recoveryAvailable()) useUIStore.setState({ saveStatus: 'error', saveWarning: 'Reload recovery is unavailable. Keep this tab open until Saved appears.' });
    else ui.setSaveStatus('saving');
    return;
  }
  const receipt = writes.latestReceipt(id);
  if (receipt && writes.matches(receipt, storedEntry(entry))) { ui.acknowledgeSave(receipt); return; }
  // Verify a loaded record through the same conditional transaction. It may
  // have changed in another tab since the registry was read.
  persistEntry(entry, entry);
}

/** Shared manual-save completion for all editor types and entry points. */
export async function commitCurrentDocument() {
  const scope = captureDocumentScope();
  if (!scope) throw new Error('There is no open document to save.');
  useDocumentsStore.getState().saveCurrent();
  for (;;) {
    if (!isCurrentDocumentScope(scope)) return null;
    useDocumentsStore.getState().syncCurrent();
    if (!await writes.flush(scope.documentId)) throw new Error('This document could not be saved. Retry Save or export a draft file.');
    if (!isCurrentDocumentScope(scope)) return null;
    const state = useDocumentsStore.getState();
    const entry = state.docs[scope.documentId];
    const receipt = writes.latestReceipt(scope.documentId);
    const live = getSerializedSession();
    if (entry && receipt && writes.matches(receipt, storedEntry(entry)) && sameContent(entry.session, live)) return receipt;
    if (!entry || state.baseline && sameContent(state.baseline, live)) {
      throw new Error('The current revision has not been saved. Retry Save or export a draft file.');
    }
    // Include edits made during this document's transaction without waiting on
    // failed or stalled transactions belonging to a different document.
  }
}

let retainedReviewWriteIntent = false;
function hasRetainedReviewWrites(documentId?: string): boolean {
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(REVIEW_WRITE_RECOVERY_KEY)) retainedReviewWriteIntent = true;
  } catch { /* Ordinary exports still work when this runtime has no recovery storage. */ }
  if (!retainedReviewWriteIntent || !documentId) return retainedReviewWriteIntent;
  try {
    const raw = sessionStorage.getItem(REVIEW_WRITE_RECOVERY_KEY);
    if (!raw) return true;
    const records = parseDocumentWriteJournal(JSON.parse(raw));
    return records.some(record => record.reviewReturns?.some(marker => marker.operation.round.ownerDocumentId === documentId));
  } catch { return true; } // Unknown/newer intents cannot be safely assigned to another scope.
}

export function hasPendingReviewWrites(documentId?: string): boolean {
  return (documentId ? writes.reviewReturnDocumentIds().includes(documentId) : writes.hasReviewReturns()) || hasRetainedReviewWrites(documentId);
}

/** A portable copy must not detach visible feedback from its uncommitted receipt. */
export async function flushPendingReviewWrites(documentId?: string): Promise<void> {
  if (hasRetainedReviewWrites(documentId)) throw new Error('An interrupted review return needs attention. Open recovered copies to keep its edits before exporting.');
  while (documentId ? writes.reviewReturnDocumentIds().includes(documentId) : writes.hasReviewReturns()) {
    useDocumentsStore.getState().syncCurrent();
    const owners = writes.reviewReturnDocumentIds().filter(id => !documentId || id === documentId);
    if ((await Promise.all(owners.map(id => writes.flush(id)))).some(saved => !saved)) {
      throw new Error('Review feedback is not saved yet. Retry Save before exporting this copy.');
    }
  }
}

/** Publish through the owner and its existing queue, including edits made while storage waits. */
export async function applyOwnedReviewReturn(target: DocumentTarget | null, comments: ReviewComments | undefined,
  input: ReviewReturnWrite): Promise<'committed' | 'pending' | 'stale' | 'invalid'> {
  let operation: ReviewReturnWrite;
  let nextComments: ReviewComments | undefined;
  try {
    operation = reviewReturnWriteSchema.parse(input);
    nextComments = comments === undefined ? undefined : reviewCommentsSchema.parse(comments);
  } catch { return 'invalid'; }
  if (!isCurrentDocumentTarget(target) || operation.round.ownerDocumentId !== target.scope.documentId) return 'stale';
  if (!supportsReviewComments(useDocumentStore.getState())) return 'invalid';
  if (hasRetainedReviewWrites(target.scope.documentId)) throw new Error('An interrupted review return needs attention. Open recovered copies first.');
  const saved = await commitCurrentDocument();
  if (!saved || !isCurrentDocumentTarget(target)) return 'stale';
  const registry = useDocumentsStore.getState(), entry = registry.docs[target.scope.documentId];
  if (!entry || !writes.matches(saved, storedEntry(entry)) || !recordDocumentHistory(target.scope)) return 'stale';
  const before = storedEntry(entry), after = structuredClone(before);
  if (nextComments?.threads.length) after.session.reviewComments = nextComments;
  else delete after.session.reviewComments;
  after.meta.updatedAt = Math.max(Date.now(), before.meta.updatedAt + 1);
  const revision = writes.enqueueReviewReturn(before, after, operation);
  // This synchronous publication happens before later input can capture a save.
  useDocumentStore.setState({ reviewComments: after.session.reviewComments });
  useDocumentsStore.setState(state => ({ docs: { ...state.docs, [after.id]: { meta: after.meta, session: after.session } }, baseline: after.session }));
  recordDocumentHistory(target.scope);updateSaveStatus(after.id);
  await writes.flush(after.id);
  return writes.status(revision)?.status === 'committed' ? 'committed' : 'pending';
}

function persistEntry(entry: DocumentEntry, before?: DocumentEntry): void {
  writes.enqueue(before ? storedEntry(before) : null, storedEntry(entry));
}

/** Reload only after all writes, including edits made during the wait, commit. */
export async function flushDocumentWrites(): Promise<void> {
  await waitForStorage(flushPendingDocumentWrites());
}

async function flushPendingDocumentWrites(): Promise<void> {
  // Hydration publishes the saved ID before init loads its session. Saving in
  // that gap would overwrite the saved document with the blank starter.
  if (initPromise) await initPromise;
  if (hasRetainedReviewWrites()) throw new Error('An interrupted review return needs attention. Open recovered copies before updating.');
  if (lastWriteFailed(FORMS_PERSIST_KEY)) {
    useFormStore.setState({});
    if (lastWriteFailed(FORMS_PERSIST_KEY)) throw new Error('Your form changes could not be saved. Download a backup before updating.');
  }
  for (;;) {
    useDocumentsStore.getState().syncCurrent();
    if (!await writes.flush()) throw new Error('Your latest changes could not be saved. Retry Save or download a backup before updating.');
    const { currentId, docs } = useDocumentsStore.getState();
    if (currentId && docs[currentId] && !await idbSetCurrentId(currentId)) throw new Error('The open document could not be saved for reopening. Retry before updating.');
    if (useDocumentsStore.getState().currentId !== currentId) continue;
    const live = getSerializedSession();
    if (!currentId || !docs[currentId]
      || sameContent(docs[currentId].session, live)) return;
    const baseline = useDocumentsStore.getState().baseline;
    if (baseline && sameContent(baseline, live)) {
      throw new Error('The open document differs from the saved version. Switch documents and reopen it before updating.');
    }
  }
}

function persistCurrentId(id: string | null): void {
  void idbSetCurrentId(id);
}

// One-time migration of the previous compressed-localStorage registry blob into
// IndexedDB, then drop the old key. Per-record and retryable: a record is
// skipped when it's already in IDB (a prior partial run migrated it) or in the
// migrated-ids ledger (migrated earlier and since DELETED by the user —
// re-putting it would resurrect it). The blob is kept until every record is
// durable, so a partial failure retries just the missing records on the next
// load instead of stranding them forever.
type LegacyRegistry = { docs?: Record<string, DocumentEntry>; currentId?: string | null };
export async function migrateLegacyRegistry(): Promise<void> {
  let raw: string | null;
  try {
    // Reading localStorage throws (SecurityError) when site data is blocked;
    // there's nothing to migrate in that case, so bail without escaping init().
    raw = typeof localStorage !== 'undefined' ? localStorage.getItem('dondocs_documents') : null;
  } catch {
    return;
  }
  if (!raw) return;
  const existing = await idbGetAllDocuments();
  if (existing === null) return; // registry unreadable — keep the legacy blob untouched
  try {
    const parsed = compressedParse<{ state?: LegacyRegistry } & LegacyRegistry>(raw);
    const state = parsed.state ?? parsed;
    const inIdb = new Set(existing.map((r) => r.id));
    const ledger = new Set(await idbGetMigratedIds());
    let allWritten = true;
    for (const [id, entry] of Object.entries(state.docs ?? {})) {
      if (!entry?.meta || !entry?.session) continue;
      if (inIdb.has(id) || ledger.has(id)) continue;
      const session = await materializeSignatureFallbacks(entry.session);
      const outcome = await idbWriteDocument(null, { id, meta: entry.meta, session });
      // A concurrent creator owns its existing record, as on the initial read.
      if (outcome === 'committed' || outcome === 'already-committed' || outcome === 'conflict') {
        ledger.add(id);
      } else {
        allWritten = false;
      }
    }
    // The resume pointer: only seed it when none exists — on a retry the user
    // may have switched documents since, and the stale legacy pointer must not
    // override that.
    if (state.currentId && !(await idbGetCurrentId())) {
      if (!(await idbSetCurrentId(state.currentId))) allWritten = false;
    }
    if (allWritten) {
      // Every record is durable: drop the blob, then the ledger (its only job
      // was to protect retries while the blob still existed).
      localStorage.removeItem('dondocs_documents');
      await idbSetMigratedIds([]);
      debug.log('Documents', 'Migrated localStorage registry to IndexedDB');
    } else {
      // Persist the ledger so the next load retries ONLY the failed records —
      // and a doc migrated now but deleted before that retry stays deleted.
      await idbSetMigratedIds([...ledger]);
      debug.error('Documents', 'IndexedDB write failed during migration; keeping legacy blob to retry the failed records');
    }
  } catch (err) {
    debug.error('Documents', 'localStorage -> IndexedDB migration failed', err);
  }
}

// Upgrade the two legacy form slots once. Keep their original storage intact;
// the migration ledger prevents a deleted or edited migrated draft reappearing.
async function migrateLegacyForms(): Promise<void> {
  const ledger = new Set(await idbGetMigratedIds());
  if (ledger.has('forms-registry-v1')) return;
  let exists: boolean;
  try { exists = !!localStorage.getItem(FORMS_PERSIST_KEY); } catch { return; }
  const records = await idbGetAllDocuments();
  if (!records) return;
  let complete = true;
  if (exists) {
    const lastSession = getSavedSession();
    for (const formType of ['navmc_10274', 'navmc_118_11'] as const) {
      const id = `legacy-form-${formType}`;
      if (ledger.has(id)) continue;
      const session = { ...serializeSession(useDocumentStore.getState()),
        documentCategory: 'forms' as const, formType, forms: serializeForm(formType),
        formData: {}, references: [], enclosures: [], paragraphs: [], copyTos: [], distributions: [],
      };
      const outcome = records.some(r => r.id === id) ? 'already-committed' : await idbWriteDocument(null, { id, meta: metaFor(id, session), session });
      if (outcome === 'committed' || outcome === 'already-committed' || outcome === 'conflict') {
        ledger.add(id);
        if (lastSession?.documentCategory === 'forms' && lastSession.formType === formType) await idbSetCurrentId(id);
      } else complete = false;
    }
  }
  if (complete) ledger.add('forms-registry-v1');
  await idbSetMigratedIds([...ledger]);
}

const RECOVERY_KEY = 'dondocs-recovery-copies';
interface RecoveryCopy { copyId: string; after: StoredDocument }
let recoveryCopies: RecoveryCopy[] = [];
function retainRecoveryCopy(after: StoredDocument): void {
  const existing = recoveryCopies.find(copy => copy.after.id === after.id);
  if (existing) existing.after = after;
  else recoveryCopies.push({ copyId: newId(), after });
  try { sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(recoveryCopies)); } catch { /* The write journal remains available. */ }
  useDocumentsStore.setState({ recoveryCount: recoveryCopies.length });
}

async function recoverInterruptedSave(): Promise<void> {
  let reviewRecovery: PendingDocumentWrite[] = [];
  try {
    const copies = JSON.parse(sessionStorage.getItem(RECOVERY_KEY) ?? '[]');
    if (!Array.isArray(copies) || copies.some(copy => !copy.copyId || !copy.after?.session)) throw new Error('Invalid recovery copies');
    recoveryCopies = copies;
    const pending = parseDocumentWriteJournal([
      ...JSON.parse(sessionStorage.getItem(REVIEW_WRITE_RECOVERY_KEY) ?? '[]'),
      ...JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY) ?? '[]'),
    ]);
    reviewRecovery = pending.filter(item => item.reviewReturns?.length);
    if (reviewRecovery.length) retainedReviewWriteIntent = true;
    // Read recovery records written by the previous release too.
    const legacy = sessionStorage.getItem('dondocs-interrupted-save');
    if (legacy) {
      const { before, after } = JSON.parse(legacy);
      pending.push({ before, versions: [after] });
    }
    for (const item of pending) {
      const after = item.versions.at(-1);
      if (!after?.id || after.meta?.id !== after.id || !after.session
        || item.versions.some(v => v.id !== after.id)
        || (item.before && item.before.id !== after.id)) throw new Error('Invalid recovery record');
      const prepared = { ...after, session: await materializeSignatureFallbacks(after.session) };
      let result;
      if (item.reviewReturns?.length) {
        try { result = await recoverReviewReturnWrite(item); }
        catch (cause) { retainRecoveryCopy(prepared);throw cause; }
        if (!['committed', 'already-committed'].includes(result)) {
          retainRecoveryCopy(prepared);
          throw new Error('An interrupted review return could not be committed to its original document. Its latest edits are kept as a recovered copy.');
        }
      } else result = await idbWriteDocument(item.before, prepared, item.versions, true);

      if (result === 'committed') broadcastDocs({ type: 'put', id: after.id });
      if (result === 'conflict' || result === 'missing-document' || result === 'failed') {
        if (!recoveryCopies.some(copy => JSON.stringify(copy.after) === JSON.stringify(prepared))) {
          recoveryCopies.push({ copyId: newId(), after: prepared });
        }
      }
    }
    // Preserve conflicts before removing the write journal, including on quota errors.
    sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(recoveryCopies));
    sessionStorage.removeItem(WRITE_JOURNAL_KEY);
    sessionStorage.removeItem(REVIEW_WRITE_RECOVERY_KEY);
    retainedReviewWriteIntent = false;
    sessionStorage.removeItem('dondocs-interrupted-save');
  } catch (error) {
    if (reviewRecovery.length) {
      try { sessionStorage.setItem(REVIEW_WRITE_RECOVERY_KEY, serializeDocumentWriteJournal(reviewRecovery)); }
      catch { /* The original journal is still retained below. */ }
    } else {
      try {
        const raw = sessionStorage.getItem(REVIEW_WRITE_RECOVERY_KEY) ?? sessionStorage.getItem(WRITE_JOURNAL_KEY);
        const entries = raw && JSON.parse(raw);
        if (Array.isArray(entries) && entries.some(item => item?.kind === 'dondocs-review-write')) {
          retainedReviewWriteIntent = true;
          sessionStorage.setItem(REVIEW_WRITE_RECOVERY_KEY, raw!);
        }
      } catch { /* Unreadable content is retained by the existing recovery copy below. */ }
    }
    // Keep the raw journal separate so subsequent edits cannot replace it.
    try {
      const raw = sessionStorage.getItem(WRITE_JOURNAL_KEY);
      if (raw) sessionStorage.setItem(`dondocs-recovery-unreadable-${Date.now()}`, raw);
    } catch { /* Storage remains unavailable; leave the original untouched. */ }
    debug.error('Documents', 'Recovery retained for retry', error);
    showAppAlert({ title: 'Recovery needs attention', message: 'An interrupted edit could not be recovered. Its recovery data remains in this tab. Keep this tab open and retry after storage is available.' });
  }
  useDocumentsStore.setState({ recoveryCount: recoveryCopies.length });
  if (recoveryCopies.length) showAppAlert({ title: 'Recovered edits need your review', message: 'A saved document changed or was deleted while edits were pending. Use Document actions → Open recovered copies to keep those edits as separate documents.' });
}

export async function openRecoveredCopies(): Promise<void> {
  useDocumentsStore.getState().syncCurrent();
  await writes.flush();
  const firstCopyId = recoveryCopies[0]?.copyId;
  for (const copy of recoveryCopies) {
    const meta = { ...copy.after.meta, id: copy.copyId, title: `Recovered: ${copy.after.meta.title}`, name: `Recovered: ${copy.after.meta.title}` };
    const record = { ...copy.after, id: copy.copyId, meta, session: await materializeSignatureFallbacks(copy.after.session) };
    const outcome = await idbWriteDocument(null, record);
    if (outcome !== 'committed' && outcome !== 'already-committed') throw new Error('Recovery copies could not be saved. The originals remain available for retry.');
    useDocumentsStore.setState(state => ({ docs: { ...state.docs, [record.id]: { meta, session: record.session } } }));
    broadcastDocs({ type: 'put', id: record.id });
  }
  const originals = await idbGetAllDocuments();
  if (originals === null) throw new Error('Recovery copies were saved, but the library could not be refreshed. Retry opening recovered copies.');
  const persisted = new Map(originals.map(record => [record.id, record]));
  useDocumentsStore.setState(state => {
    const docs = { ...state.docs };
    for (const copy of recoveryCopies) {
      if (writes.failure(copy.after.id) === 'conflict' || writes.failure(copy.after.id) === 'missing-document') writes.cancel(copy.after.id);
      const original = persisted.get(copy.after.id);
      if (original) docs[original.id] = { meta: original.meta, session: original.session };
      else delete docs[copy.after.id];
    }
    return partitionDocuments({ ...state.trash, ...docs });
  });
  if (firstCopyId) useDocumentsStore.getState().switchTo(firstCopyId);
  if (firstCopyId && !writes.hasReviewReturns()) {
    const copied = new Set(recoveryCopies.map(copy => copy.after.id));
    // Keeping a new unbound draft cancels the failed original return intent; it
    // does not create a receipt or claim that the original source was updated.
    try {
      const pending = parseDocumentWriteJournal(JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY) ?? '[]'))
        .filter(item => !item.reviewReturns?.length || !copied.has(item.versions[0].id));
      if (pending.length) sessionStorage.setItem(WRITE_JOURNAL_KEY, serializeDocumentWriteJournal(pending));
      else sessionStorage.removeItem(WRITE_JOURNAL_KEY);
      sessionStorage.removeItem(REVIEW_WRITE_RECOVERY_KEY);
      retainedReviewWriteIntent = false;
    } catch { /* Unsupported intent stays available for a compatible reader. */ }
  }
  sessionStorage.removeItem(RECOVERY_KEY);
  recoveryCopies = [];
  useDocumentsStore.setState({ recoveryCount: 0 });
}

// Shared hydration promise so concurrent init() calls read the registry once.
let hydratePromise: Promise<string | null> | null = null;
let initPromise: Promise<boolean> | null = null;
function ensureHydrated(
  set: (partial: Partial<DocumentsState>) => void,
  get: () => DocumentsState
): Promise<string | null> {
  if (get().hydrated) return Promise.resolve(get().currentId);
  if (!hydratePromise) {
    hydratePromise = (async () => {
      await migrateLegacyRegistry();
      await migrateLegacyForms();
      await recoverInterruptedSave();
      const [stored, cid] = await Promise.all([idbGetAllDocuments(), idbGetCurrentId()]);
      const records = stored && await materializeRegistrySignatures(stored);
      if (records === null) {
        // The registry exists but can't be read. Never proceed as if the library
        // were empty — init would fold the legacy blob into a duplicate document
        // and a backup would capture nothing. Surface the state, then reject so
        // hydratePromise resets (a later init() can retry after the fault clears)
        // while App's init catch seeds a usable blank in the meantime.
        useUIStore.getState().setStorageHealth('unreadable');
        throw new Error('Document registry unreadable');
      }
      const loaded: Record<string, DocumentEntry> = {};
      await Promise.all(records.map(record => materializeHistorySignatures(record.id)));
      for (const r of records) {
        // Fold a legacy FOUO portion marking to CUI in the PERSISTED registry, not
        // just the live store when the doc is later opened. Otherwise stored stays
        // FOUO while loadSharedSession migrates the live copy to CUI, and the first
        // syncCurrent sees a diff and re-saves + re-sorts an untouched doc. Reuse
        // the same meta (no updatedAt bump) so it never re-sorts Recents.
        const currentParagraphs = r.session.paragraphs ?? [];
        let paragraphs: typeof currentParagraphs;
        try { paragraphs = ensureParagraphIds(r.meta.nativeReviewText === true && supportsReviewComments(r.session)
          ? currentParagraphs : migratePortionMarkings(currentParagraphs), paragraphCommentIds(r.session.reviewComments)); }
        catch {
          // Keep a damaged record available for recovery; opening it will fail
          // validation without preventing healthy library documents from loading.
          loaded[r.id] = { meta: r.meta, session: r.session };
          continue;
        }
        if (paragraphs.some((paragraph, index) => paragraph !== currentParagraphs[index])) {
          const session = { ...r.session, paragraphs };
          const outcome = await idbWriteDocument(r, { ...r, session });
          loaded[r.id] = { meta: r.meta, session: outcome === 'committed' || outcome === 'already-committed' ? session : r.session };
        } else {
          loaded[r.id] = { meta: r.meta, session: r.session };
        }
      }
      set({ ...partitionDocuments(loaded), hydrated: true });
      return cid;
    })();
    // If hydration rejects, drop the cached promise so a later init() can retry
    // rather than being wedged on a permanently-rejected promise for the page
    // lifetime (mirrors openDb's dbPromise reset).
    void hydratePromise.then(() => { hydratePromise = null; }, () => { hydratePromise = null; });
  }
  return hydratePromise;
}

function partitionDocuments(entries: Record<string, DocumentEntry>) {
  const docs: Record<string, DocumentEntry> = {};
  const trash: Record<string, DocumentEntry> = {};
  for (const [id, entry] of Object.entries(entries)) {
    (entry.meta.deletedAt ? trash : docs)[id] = entry;
  }
  return { docs, trash };
}

// The short Undo notification expires; the document and history do not.
let purgeTimer: ReturnType<typeof setTimeout> | null = null;
const deletingDocuments = new Set<string>();
export function getPendingDeleteSessions(): SerializedSession[] {
  return Object.values(useDocumentsStore.getState().trash).map((e) => e.session);
}
function beginPending(entries: DocumentEntry[], set: (partial: Partial<DocumentsState>) => void): void {
  if (!entries.length) return;
  if (purgeTimer) clearTimeout(purgeTimer);
  const trash = { ...useDocumentsStore.getState().trash };
  for (const e of entries) {
    const removed = { ...e, meta: { ...e.meta, deletedAt: Date.now(), updatedAt: Date.now() } };
    trash[e.meta.id] = removed;
    persistEntry(removed, e);
  }
  const title = entries.length === 1 ? entries[0].meta.title : `${entries.length} documents`;
  set({ trash, pendingDelete: { ids: entries.map((e) => e.meta.id), title } });
  purgeTimer = setTimeout(() => { set({ pendingDelete: null }); purgeTimer = null; }, 6000);
}

function tryPrepareSavedSession(session: SerializedSession, preserveNativeText = false): PreparedDocument | null {
  try { return prepareDocument(session, preserveNativeText); }
  catch (error) {
    debug.warn('Documents', 'Could not prepare saved document', error);
    showAppAlert({ title: 'Saved document could not be opened', message: 'The saved copy remains in your library. Download a workspace backup to keep a recovery copy, then try opening it with the latest version of DonDocs.' });
    return null;
  }
}

function reopenAfterRemoval(remaining: Record<string, DocumentEntry>): void {
  clearSavedSession();
  const newest = Object.values(remaining).sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)[0];
  const prepared = newest ? tryPrepareSavedSession(newest.session, newest.meta.nativeReviewText === true && supportsReviewComments(newest.session)) : null;
  if (newest && prepared) installDocument(prepared, { id: newest.meta.id, save: false, preserveOutgoing: false });
  else installDocument(prepareBlankDocument(), { save: false, preserveOutgoing: false });
}

// Version-history snapshots: throttle autosave snapshots to one per document per
// SNAPSHOT_INTERVAL; an explicit Save forces one. idbAddSnapshot caps the ring.
const SNAPSHOT_INTERVAL = 3 * 60_000;
const lastSnap: Record<string, number> = {};
// Resolves true when the snapshot committed (or was throttle-skipped); callers
// that only checkpoint opportunistically `void` it, while restoreSnapshot awaits
// it — the safety copy is what makes a restore reversible.
async function maybeSnapshot(docId: string, session: SerializedSession, force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && now - (lastSnap[docId] ?? 0) < SNAPSHOT_INTERVAL) return Promise.resolve(true);
  lastSnap[docId] = now;
  const captured = needsSignatureFallbacks(session) ? await materializeSignatureFallbacks(session) : structuredClone(session);
  return idbAddSnapshot(docId, { ts: now, session: captured });
}

// The post-hydration half of init(): resume the current document, or fold the
// legacy single-session blob into the registry, or start brand-new. Split out
// of the store so init() can run it under a cross-tab Web Lock.
function initAfterHydration(
  set: (partial: Partial<DocumentsState>) => void,
  get: () => DocumentsState,
  currentId: string | null,
): boolean {
  const { docs } = get();
  if (currentId && docs[currentId]) {
    let session = docs[currentId].session;
    if (!(docs[currentId].meta.nativeReviewText === true && supportsReviewComments(session)) && session.formData?.unitAddress) {
      const address = canonicalizeUnitAddress(session.formData.unitAddress);
      if (address !== session.formData.unitAddress) {
        session = { ...session, formData: { ...session.formData, unitAddress: address } };
        const entry = { ...docs[currentId], session };
        set({ docs: { ...docs, [currentId]: entry } });
        persistEntry(entry, docs[currentId]);
      }
    }
    const prepared = tryPrepareSavedSession(session, docs[currentId].meta.nativeReviewText === true && supportsReviewComments(session));
    if (prepared && installDocument(prepared, { id: currentId, save: false }) === 'applied') return true;
  } else {
    const legacy = getSavedSession();
    if (legacy && (legacy.documentCategory !== 'forms' || legacy.genericForm) && isMeaningful(legacy)) {
      const prepared = tryPrepareSavedSession(legacy);
      if (prepared && installDocument(prepared) === 'applied') return true;
    }
  }
  installDocument(prepareBlankDocument(), { save: false, resume: false });
  return false;
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  docs: {},
  lastKindIds: {},
  trash: {},
  currentId: null,
  activationEpoch: 0,
  hydrated: false,
  recoveryCount: 0,
  baseline: null,
  pendingDelete: null,

  markBaseline: () => {
    const session = getSerializedSession();
    set({ baseline: session });
  },

  init: () => {
    if (initPromise) return initPromise;
    // Two tabs booting simultaneously on a user's FIRST post-upgrade load would
    // each fold the legacy session blob into its own newId() — a duplicate
    // document. The Web Locks API serializes init across tabs: the loser waits,
    // then hydrates a registry the winner already migrated and resumes normally.
    // Without locks support, behavior is unchanged (single-tab is unaffected).
    const run = async (): Promise<boolean> => {
      const epoch = get().activationEpoch;
      const sequence = editSequence;
      await materializeStoredSignatureFallbacks();
      const currentId = await ensureHydrated(set, get);
      if (get().activationEpoch !== epoch || editSequence !== sequence) return true;
      return initAfterHydration(set, get, currentId);
    };
    initPromise = (typeof navigator !== 'undefined' && navigator.locks?.request
      ? navigator.locks.request('dondocs-init', run)
      : run()).finally(() => { initPromise = null; });
    return initPromise;
  },

  syncCurrent: (source) => {
    // pagehide and debounced saves must also leave the starter alone until the
    // persisted session has been loaded, not just read out of IndexedDB.
    if (initPromise) return;
    const { currentId, docs, baseline } = get();
    if (!currentId || get().trash[currentId]) return;
    const session = source ? serializeSession(source) : getSerializedSession();
    if (session.documentCategory === 'forms' && session.formType !== 'navmc_10274' && session.formType !== 'navmc_118_11' && !session.genericForm) return;
    const category = session.documentCategory ?? 'correspondence';
    const kind = category === 'forms' ? session.formType ?? 'navmc_10274' : category;
    const remembered = get().lastKindIds;
    if (remembered[category] !== currentId || remembered[kind] !== currentId) {
      set({ lastKindIds: { ...remembered, [category]: currentId, [kind]: currentId } });
    }

    const prev = docs[currentId];
    if (!prev) {
      // Not yet in Recents: add it once the user has changed real content from the
      // starting baseline (subject, body, recipient, references, enclosures,
      // copy-tos, distribution). A pristine starter, or one only changed in
      // letterhead / form / type / font, stays out until the user writes something.
      if (!baseline || !hasContentDrift(baseline, session)) {
        if (!source) useUIStore.getState().setSaveStatus('idle');
        return;
      }
    } else if (sameContent(prev.session, session)) {
      // Retry failed content even when the editor has not changed.
      if (writes.failure(currentId)) writes.retry(currentId);
      else if (!source) updateSaveStatus(currentId);
      return;
    } else if (baseline && sameContent(baseline, session)) {
      // The live document matches what THIS tab last loaded/persisted — the
      // registry entry moved ahead via another tab's save (mirrored in by the
      // cross-tab broadcast). This tab has nothing of its own to contribute, so
      // persisting now would overwrite the other tab's newer copy with a stale
      // one. Classic case: the same document open in two tabs, and the idle
      // tab's visibilitychange/pagehide flush firing after the active tab saved.
      return;
    }
    const entry = { meta: metaFor(currentId, session, prev?.meta), session };
    // Track the editor snapshot separately from the write queue’s committed base.
    set({ docs: { ...docs, [currentId]: entry }, baseline: session });
    persistEntry(entry, prev);
    // First time this doc reaches Recents: pin it as the resume pointer (init no
    // longer persists ids eagerly, so this is where a real doc becomes resumable).
    if (!prev) persistCurrentId(currentId);
    void maybeSnapshot(currentId, session);
  },

  saveCurrent: () => {
    const { currentId, docs } = get();
    if (!currentId || get().trash[currentId]) return;
    const session = getSerializedSession();
    if (session.documentCategory === 'forms' && session.formType !== 'navmc_10274' && session.formType !== 'navmc_118_11' && !session.genericForm) return;
    // Force-add when absent, but skip a no-op Save so it doesn't re-sort.
    const prev = docs[currentId];
    if (prev && sameContent(prev.session, session)) {
      if (writes.has(currentId)) writes.retry(currentId);
      else updateSaveStatus(currentId);
      void maybeSnapshot(currentId, session, true);
      return;
    }
    const entry = { meta: metaFor(currentId, session, prev?.meta), session };
    // Keep baseline in lockstep with what this tab persisted (see syncCurrent).
    set({ docs: { ...docs, [currentId]: entry }, baseline: session });
    persistEntry(entry, prev);
    if (!prev) persistCurrentId(currentId); // make a just-saved fresh doc resumable
    void maybeSnapshot(currentId, session, true); // explicit Save = a deliberate checkpoint
  },

  newDocument: (formType) => {
    if (formType && formType !== 'navmc_10274' && formType !== 'navmc_118_11') {
      void openGenericDocument(formType);
      return;
    }
    if (!formType) newCorrespondenceDocument();
    else installDocument(prepareBlankDocument(formType), { save: false });
  },

  selectKind: (category, formType) => {
    // Re-selecting the active view still supersedes an older asynchronous open.
    openingRequest++;
    const current = useDocumentStore.getState();
    if (current.documentCategory === category && (category !== 'forms' || !formType || current.formType === formType)) return;
    get().syncCurrent();
    const candidates = Object.values(get().docs)
      .filter(({ session }) => session.documentCategory === category && (category !== 'forms' || !formType || session.formType === formType));
    const remembered = get().lastKindIds[category === 'forms' && formType ? formType : category];
    const previous = candidates.find(({ meta }) => meta.id === remembered)
      ?? candidates.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)[0];
    if (previous) get().switchTo(previous.meta.id);
    else get().newDocument(category === 'forms' ? formType ?? 'navmc_10274' : undefined);
  },

  switchTo: (id) => { openExistingDocument(id); },

  remove: (id) => {
    if (id === get().currentId) get().syncCurrent();
    const { docs, currentId } = get();
    const entry = docs[id];
    const next = { ...docs };
    delete next[id];
    set({ docs: next });
    // A current-but-unsaved starter has no record to move to Trash.
    if (entry) beginPending([entry], set);
    if (id !== currentId) return;
    reopenAfterRemoval(next);
  },

  removeMany: (ids) => {
    if (get().currentId && ids.includes(get().currentId!)) get().syncCurrent();
    const { docs, currentId } = get();
    const entries = ids.map((id) => docs[id]).filter((e): e is DocumentEntry => !!e);
    if (entries.length === 0) return;
    const next = { ...docs };
    for (const id of ids) delete next[id];
    set({ docs: next });
    beginPending(entries, set);
    if (currentId != null && ids.includes(currentId)) reopenAfterRemoval(next);
  },

  togglePin: (id) => {
    const { docs } = get();
    const entry = docs[id];
    if (!entry) return;
    const meta: DocumentMeta = { ...entry.meta, pinned: !entry.meta.pinned };
    const updated = { ...entry, meta };
    set({ docs: { ...docs, [id]: updated } });
    persistEntry(updated, entry);
  },

  openLoadedAsNew: () => {
    const state = prepareSessionState(getSerializedSession());
    const live = useDocumentStore.getState();
    state.enclosures = structuredClone(live.enclosures);
    state.formData = structuredClone(live.formData);
    installDocument(ownPreparedState(state), { preserveOutgoing: false });
  },

  restoreDeleted: () => {
    for (const id of get().pendingDelete?.ids ?? []) get().restoreFromTrash(id);
    if (purgeTimer) clearTimeout(purgeTimer);
    set({ pendingDelete: null });
  },

  restoreFromTrash: (id) => {
    if (deletingDocuments.has(id)) return;
    const entry = get().trash[id];
    if (!entry) return;
    const { deletedAt: _deletedAt, ...meta } = entry.meta;
    const restored = { ...entry, meta: { ...meta, updatedAt: Date.now() } };
    const trash = { ...get().trash };
    delete trash[id];
    set({ trash, docs: { ...get().docs, [id]: restored } });
    persistEntry(restored, entry);
  },

  permanentlyDelete: async (id) => {
    const entry = get().trash[id];
    if (!entry || deletingDocuments.has(id)) return false;
    const expected = structuredClone(storedEntry(entry));
    const matches = (current: DocumentEntry | undefined) => !!current && JSON.stringify(storedEntry(current)) === JSON.stringify(expected);
    deletingDocuments.add(id);
    try {
      if (!await writes.flush() || !matches(get().trash[id])) return false;
      const outcome = await idbDeleteDocumentIfUnchanged(expected);
      if (outcome !== 'deleted' && outcome !== 'already-deleted') return false;
      writes.cancel(id);
      const trash = { ...get().trash };
      if (matches(trash[id])) delete trash[id];
      set({ trash });
      broadcastDocs({ type: 'delete', id });
      scheduleBackup();
      void import('@/lib/attachmentGc')
        .then(m => m.sweepOrphanedAttachments())
        .catch(error => debug.warn('Documents', 'Attachment cleanup could not finish after document deletion', error));
      return true;
    } finally { deletingDocuments.delete(id); }
  },

  renameDocument: (id, name) => {
    const { docs } = get();
    const entry = docs[id];
    if (!entry) return;
    const trimmed = name.trim();
    const meta: DocumentMeta = {
      ...entry.meta,
      name: trimmed || undefined,
      title: trimmed || deriveTitle(entry.session),
    };
    const updated = { ...entry, meta };
    set({ docs: { ...docs, [id]: updated } });
    persistEntry(updated, entry);
  },

  duplicateDocument: (id) => {
    if (id === get().currentId) get().syncCurrent();
    const { docs } = get();
    const entry = docs[id];
    if (!entry) return;
    const copyId = newId();
    const base = entry.meta.name?.trim() || entry.meta.title;
    const copyName = `Copy of ${base}`;
    const meta: DocumentMeta = {
      id: copyId,
      title: copyName,
      name: copyName,
      docType: entry.meta.docType,
      updatedAt: Date.now(),
    };
    const dup: DocumentEntry = { meta, session: entry.session };
    set({ docs: { ...docs, [copyId]: dup } });
    persistEntry(dup);
    debug.log('Documents', 'Duplicated document', { from: id, to: copyId });
  },

  restoreSnapshot: async (session, target) => {
    if (!isCurrentDocumentTarget(target)) return 'stale';
    const request = ++restoreRequest;
    const current = () => isCurrentDocumentTarget(target) && request === restoreRequest;
    let incoming: PreparedDocument;
    try {
      const meta = get().docs[target.scope.documentId]?.meta;
      const preserveNativeText = meta?.nativeReviewText === true && supportsReviewComments(session);
      incoming = prepareDocument(session, preserveNativeText);
      if (needsSignatureFallbacks(session)) {
        const materialized = await materializeSignatureFallbacks(session);
        if (!current()) return 'stale';
        incoming = prepareDocument(materialized, preserveNativeText);
      }
    }
    catch { return 'invalid'; }
    // Keep the safety copy even if its operation becomes stale while writing.
    let ok: boolean;
    try { ok = await maybeSnapshot(target.scope.documentId, getSerializedSession(), true); }
    catch { ok = false; }
    if (!current()) return 'stale';
    if (!ok) return 'safety-copy-failed';
    return replaceCurrentDocument(incoming, target);
  },
}));

function advanceActivation(): void {
  cancelPendingEditorWork();
  useDocumentsStore.setState(state => ({ activationEpoch: state.activationEpoch + 1 }));
}
observeSessionReplacement(phase => {
  if (phase === 'before') advanceActivation();
  else {
    resetScopedHistory();
    scheduleRecovery();
  }
});

/** Record and apply history through the active workspace owner. */
export function recordDocumentHistory(scope: DocumentScope | null): boolean {
  if (!isCurrentDocumentScope(scope)) return false;
  const history = useHistoryStore.getState();
  if (!history.owner || history.owner.documentId !== scope.documentId || history.owner.epoch !== scope.epoch) return false;
  history.saveSnapshot(useDocumentStore.getState().getSnapshot(), scope);
  return true;
}

export function changeDocumentHistory(direction: 'undo' | 'redo', scope: DocumentScope | null): TransitionOutcome {
  if (!isCurrentDocumentScope(scope)) return 'stale';
  const history = useHistoryStore.getState();
  if (!history.owner || history.owner.documentId !== scope.documentId || history.owner.epoch !== scope.epoch) return 'stale';
  const selected = direction === 'undo' ? history.past.at(-1) : history.future[0];
  for (const entry of [history.currentSnapshot, selected]) {
    if (entry && (!entry.owner || entry.owner.documentId !== scope.documentId || entry.owner.epoch !== scope.epoch)) return 'stale';
  }
  // Include the last keystroke even when its debounced capture has not fired.
  recordDocumentHistory(scope);
  const snapshot = useHistoryStore.getState()[direction](scope);
  if (!snapshot) return 'unchanged';
  useDocumentStore.getState().applySnapshot(snapshot, () => isCurrentDocumentScope(scope));
  return 'applied';
}

let historyTimer: ReturnType<typeof setTimeout> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRecovery: DocumentScope | null = null;
let historyGeneration = 0;
let syncGeneration = 0;
let recoveryGeneration = 0;

function cancelPendingEditorWork(): void {
  historyGeneration++;
  syncGeneration++;
  recoveryGeneration++;
  if (historyTimer) clearTimeout(historyTimer);
  if (syncTimer) clearTimeout(syncTimer);
  if (recoveryTimer) clearTimeout(recoveryTimer);
  historyTimer = syncTimer = recoveryTimer = null;
  pendingRecovery = null;
}

function resetScopedHistory(): void {
  historyGeneration++;
  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = null;
  const scope = captureDocumentScope();
  const history = useHistoryStore.getState();
  history.bindOwner(scope);
  history.saveSnapshot(useDocumentStore.getState().getSnapshot(), scope);
}

function scheduleRecovery(): void {
  const generation = ++recoveryGeneration;
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = null;
  pendingRecovery = null;
  if (areSessionSavesSuspended()) return;
  const scope = captureDocumentScope();
  if (!scope) return;
  pendingRecovery = scope;
  recoveryTimer = setTimeout(() => {
    if (generation !== recoveryGeneration || !isCurrentDocumentScope(scope)) return;
    recoveryTimer = null;
    pendingRecovery = null;
    if (isCurrentDocumentScope(scope) && !areSessionSavesSuspended()) saveSessionToStorage(useDocumentStore.getState());
  }, 2000);
}

function scheduleEditorWork(captureHistory = true): void {
  if (isApplyingSession()) return;
  const scope = captureDocumentScope();
  if (!scope) return;
  if (!captureHistory) {
    const snapshot = useDocumentStore.getState().getSnapshot();
    const history = useHistoryStore.getState();
    history.updateAttachmentHandles(snapshot, scope);
    history.updateSignatureHandles(snapshot, scope);
  }
  if (captureHistory) {
    const generation = ++historyGeneration;
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      if (generation !== historyGeneration || !isCurrentDocumentScope(scope)) return;
      historyTimer = null;
      recordDocumentHistory(scope);
    }, TIMING.HISTORY_SNAPSHOT_DEBOUNCE);
  }
  scheduleRecovery();
  const registry = useDocumentsStore.getState();
  const entry = registry.docs[scope.documentId];
  const reference = entry?.session ?? registry.baseline;
  if (registry.hydrated && reference) {
    const live = getSerializedSession();
    const changed = entry ? !sameContent(reference, live) : hasContentDrift(reference, live);
    const ui = useUIStore.getState();
    if (changed) ui.setSaveStatus('pending');
    else if (ui.saveStatus === 'pending') updateSaveStatus(scope.documentId);
  }
  const generation = ++syncGeneration;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    if (generation !== syncGeneration || !isCurrentDocumentScope(scope)) return;
    syncTimer = null;
    useDocumentsStore.getState().syncCurrent();
  }, 1500);
}

useDocumentStore.subscribe((state, prev) => {
  if (isApplyingSession()) return;
  if (!isApplyingAssets() && (!sameContent(serializeSession(state), serializeSession(prev))
    || state.formData.basicLetterFile !== prev.formData.basicLetterFile
    || state.enclosures.some((enclosure, index) => enclosure.file !== prev.enclosures[index]?.file))) editSequence++;
  if (prev.documentCategory !== state.documentCategory || prev.formType !== state.formType) {
    useDocumentsStore.getState().syncCurrent(prev);
    // Compatibility for direct category setters until their callers migrate.
    replaceSessionState(() => useDocumentsStore.setState({ ...activation(newId()), baseline: serializeSession(state) }));
  }
  scheduleEditorWork(!isApplyingAssets());
});
useFormStore.subscribe((state, previous) => {
  const document = useDocumentStore.getState();
  if (isApplyingSession() || document.documentCategory !== 'forms' || document.genericForm) return;
  if (state.includeCoverPage !== previous.includeCoverPage
    || (document.formType === 'navmc_118_11' ? state.navmc11811 !== previous.navmc11811 : state.navmc10274 !== previous.navmc10274)) {
    if (!isApplyingAssets()) editSequence++;
  }
  scheduleEditorWork(!isApplyingAssets());
});

function flushOnLeave(): void {
  if (isApplyingSession()) return;
  const scope = captureDocumentScope();
  if (!isCurrentDocumentScope(scope)) return;
  syncGeneration++;
  recoveryGeneration++;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  useDocumentsStore.getState().syncCurrent();
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = null;
  if (isCurrentDocumentScope(pendingRecovery) && !areSessionSavesSuspended()) saveSessionToStorage(useDocumentStore.getState());
  pendingRecovery = null;
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnLeave();
  });
  window.addEventListener('pagehide', flushOnLeave);
}

// Cross-tab sync: mirror another tab's registry writes into this tab's Recents
// list so it can't go stale (and a delete in one tab disappears in the other).
// Only the document LIST is synced — never the live editor — so the tab you're
// actively typing in is never clobbered.
if (typeof BroadcastChannel !== 'undefined') {
  docsChannel = new BroadcastChannel('dondocs-docs');
  docsChannel.onmessage = (event: MessageEvent<{ type?: string; id?: string }>) => {
    void idbGetAllDocuments().then(async records => records && await materializeRegistrySignatures(records)).then((records) => {
      if (records !== null) reconcileDocuments(records, event.data?.type === 'delete' ? event.data.id : undefined);
    });
  };
}

/** Follow deletion from another tab without resurrecting its old identity. */
export function reconcileDocuments(records: StoredDocument[], permanentlyDeletedId?: string, importedIds?: ReadonlySet<string>): void {
  const loaded: Record<string, DocumentEntry> = {};
  for (const record of records) loaded[record.id] = { meta: record.meta, session: record.session };
  const { currentId, docs, baseline } = useDocumentsStore.getState();
  const removed = !!currentId && (!!loaded[currentId]?.meta.deletedAt || permanentlyDeletedId === currentId && !loaded[currentId]);
  // A restore committed by this tab must become available when the document is
  // reopened. Pending local edits still take precedence in the queue below.
  if (currentId && docs[currentId] && !removed && !importedIds?.has(currentId)) loaded[currentId] = docs[currentId];
  // Keep queued edits (including Trash mutations) based on their original
  // committed record. A broadcast must not rebase them onto another tab's edit.
  for (const record of writes.latest()) {
    if (writes.hasChanges(record.id) && (record.id !== currentId || !removed)) loaded[record.id] = { meta: record.meta, session: record.session };
  }
  const partitioned = partitionDocuments(loaded);
  useDocumentsStore.setState(partitioned);
  if (!removed) return;
  if (writes.hasChanges(currentId!) || baseline && !sameContent(baseline, getSerializedSession())) {
    useDocumentsStore.getState().openLoadedAsNew();
    showAppAlert({ title: 'Edits kept in a new draft', message: 'This document was deleted in another tab. Your newer edits were kept as a separate draft.' });
  } else {
    writes.cancel(currentId!);
    reopenAfterRemoval(partitioned.docs);
  }
}

// ── Whole-library backup ────────────────────────────────────────────────────
// Browser storage can be evicted (StorageNotice warns about this), so let users
// export every saved document to one file and restore it later.

/** Should an incoming backup record replace the copy already in the library?
 *  Yes when there's no existing copy, or the incoming one is at least as new —
 *  so restoring an old backup never overwrites work done since. */
export function importShouldReplace(existingUpdatedAt: number | undefined, incomingUpdatedAt: number): boolean {
  return existingUpdatedAt === undefined || incomingUpdatedAt >= existingUpdatedAt;
}

/** Serialize every saved document to a single JSON backup string.
 *
 *  Reads the in-memory registry — the exact list the user sees in Recents,
 *  kept in lockstep with IndexedDB by persistEntry and cross-tab broadcasts —
 *  so a database whose reads are failing can't quietly produce an empty
 *  backup file. When the registry couldn't be read at all this session,
 *  refuse (the caller shows "Backup failed") rather than fabricate success. */
export async function exportLibrary(): Promise<string> {
  if (hasPendingReviewWrites()) await flushPendingReviewWrites();
  useDocumentsStore.getState().syncCurrent();
  const { docs, trash, hydrated } = useDocumentsStore.getState();
  if (!hydrated || useUIStore.getState().storageHealth === 'unreadable') {
    throw new Error('Saved documents could not be read — a backup now would be incomplete');
  }
  let records: StoredDocument[] = Object.values({ ...docs, ...trash }).map((e) => ({
    id: e.meta.id,
    meta: e.meta,
    session: e.session,
  }));
  if (recoveryCopies.length) {
    const originals = await idbGetAllDocuments();
    if (originals === null) throw new Error('Conflicted originals could not be read; backup cancelled');
    const conflictedIds = new Set(recoveryCopies.map(copy => copy.after.id));
    records = [...records.filter(record => !conflictedIds.has(record.id)), ...originals.filter(record => conflictedIds.has(record.id))];
  }
  for (const copy of recoveryCopies) {
    if (!records.some(record => record.id === copy.copyId)) records.push({ ...copy.after, id: copy.copyId, meta: { ...copy.after.meta, id: copy.copyId, title: `Recovered: ${copy.after.meta.title}` } });
  }
  const captured = structuredClone(records);
  const compatible = await Promise.all(captured.map(async record => ({ ...record, session: await materializeSignatureFallbacks(record.session) })));
  return JSON.stringify({ kind: 'dondocs-library', version: compatible.some(record => hasReviewComments(record.session)) ? 2 : 1, docs: compatible });
}

/** External sessions must not inherit the open document's library ID. */
export function openSessionAsNew(session: unknown): TransitionOutcome {
  let prepared: PreparedDocument;
  try { prepared = prepareDocument(session); }
  catch { return 'invalid'; }
  return openPreparedDocument(prepared, captureDocumentTarget());
}

export function openExistingDocument(id: string): TransitionOutcome {
  const registry = useDocumentsStore.getState();
  const entry = registry.docs[id];
  if (!entry) return 'invalid';
  openingRequest++;
  const current = useDocumentStore.getState();
  if (id === registry.currentId && current.documentCategory === (entry.session.documentCategory ?? 'correspondence')
    && current.formType === entry.session.formType && Boolean(current.genericForm) === Boolean(entry.session.genericForm)) return 'unchanged';
  const prepared = tryPrepareSavedSession(entry.session, entry.meta.nativeReviewText === true && supportsReviewComments(entry.session));
  if (!prepared) return 'invalid';
  return installDocument(prepared, { id, save: false });
}

/** Validate document identities and basic payload structure before staging resources. */
export function validateLibraryDocuments(records: unknown): asserts records is unknown[] {
  if (!Array.isArray(records)) throw new Error('Not a DonDocs library file');
  const ids = new Set<string>();
  for (const record of records) {
    if (!record?.meta || typeof record.meta.id !== 'string' || !record.meta.id || Object.hasOwn(Object.prototype, record.meta.id)
      || (record.id !== undefined && record.id !== record.meta.id)
      || !record.session || typeof record.session !== 'object' || Array.isArray(record.session)
      || !Number.isFinite(record.meta.updatedAt ?? 0)) throw new Error('Invalid document in backup');
    if (ids.has(record.meta.id)) throw new Error(`Duplicate document ID: ${record.meta.id}`);
    ids.add(record.meta.id);
    if (record.meta.nativeReviewText !== undefined && record.meta.nativeReviewText !== true) throw new Error('Invalid native review reader hint');
    if (record.session.reviewComments !== undefined) reviewCommentsSchema.parse(record.session.reviewComments);
    if (record?.session?.genericForm) {
      const form = parseFormInstance(record.session.genericForm);
      if (record.session.documentCategory !== 'forms' || record.session.formType !== form.definition.formId) throw new Error('Form type does not match the saved definition');
    }
  }
}

/** Merge a library backup into IndexedDB and refresh the in-memory registry.
 *  Conflict-aware: when the backup and the current library hold the same doc id,
 *  the newer (higher updatedAt) copy wins, so restoring an old backup can't
 *  silently clobber work you've done since. Returns how many were imported and
 *  how many were skipped as older. Throws on a malformed file. */
export async function importLibrary(json: string): Promise<{ imported: number; skipped: number; issues?: string[] }> {
  const parsed = JSON.parse(json) as { docs?: unknown };
  const records = parsed?.docs;
  validateLibraryDocuments(records);

  const live = useDocumentsStore.getState();
  if (live.hydrated && live.baseline) live.syncCurrent();

  // Snapshot the current updatedAt per id so we only overwrite with something
  // at least as new. If that read fails, ABORT: with an empty conflict map an
  // old backup would silently overwrite every newer local copy.
  const current = await idbGetAllDocuments();
  if (current === null) {
    throw new Error('Could not read the current library — import cancelled to protect newer local copies');
  }
  const committed = new Map(current.map(record => [record.id, record]));
  const issues: string[] = [];
  const existing = new Map<string, number>();
  for (const r of current) existing.set(r.id, r.meta?.updatedAt ?? 0);
  // Pending or failed local writes still represent work the user can see.
  for (const entry of Object.values(useDocumentsStore.getState().docs)) {
    existing.set(entry.meta.id, Math.max(existing.get(entry.meta.id) ?? 0, entry.meta.updatedAt));
  }

  let imported = 0;
  let skipped = 0;
  const applied: DocumentEntry[] = [];
  for (const r of records as DocumentEntry[]) {
    if (!r?.meta?.id || !r?.session) continue;
    if (!importShouldReplace(existing.get(r.meta.id), r.meta.updatedAt ?? 0)) {
      skipped++; // the copy already here is newer — keep it
      continue;
    }
    const before = committed.get(r.meta.id) ?? null;
    const session = await materializeSignatureFallbacks(r.session);
    const after = { id: r.meta.id, meta: r.meta, session };
    if (deletingDocuments.has(r.meta.id) || writes.hasChanges(r.meta.id) || (before && before.meta.updatedAt === r.meta.updatedAt && JSON.stringify(before) !== JSON.stringify(after))) {
      skipped++;
      issues.push(`Document ${r.meta.id} conflicts with local edits; kept local copy`);
      continue;
    }
    // Import supersedes a verification, but must never discard queued edits.
    writes.cancel(r.meta.id);
    const outcome = await idbWriteDocument(before, after);
    if (outcome === 'committed' || outcome === 'already-committed') {
      imported++;
      applied.push({ meta: r.meta, session });
      broadcastDocs({ type: 'put', id: r.meta.id });
    } else {
      skipped++;
      issues.push(`Document ${r.meta.id}: ${outcome === 'failed' ? 'could not be saved' : 'changed during restore; kept local copy'}`);
    }
  }
  // Re-read the merged set so the Recents list reflects the import immediately.
  // If that read fails, fold the just-imported records into the in-memory list
  // instead of blanking it — the puts above are already durable.
  const all = await idbGetAllDocuments();
  if (all !== null) reconcileDocuments(all, undefined, new Set(applied.map(entry => entry.meta.id)));
  else {
    const state = useDocumentsStore.getState();
    const loaded = { ...state.trash, ...state.docs };
    for (const entry of applied) {
      if (!writes.hasChanges(entry.meta.id)) loaded[entry.meta.id] = entry;
    }
    useDocumentsStore.setState(partitionDocuments(loaded));
  }
  const currentId = useDocumentsStore.getState().currentId;
  if (currentId) updateSaveStatus(currentId);
  return { imported, skipped, ...(issues.length ? { issues } : {}) };
}
