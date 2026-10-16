import { showAppAlert } from '@/stores/alertStore';
import { sessionSearchFields } from '@/lib/workspaceSearch';
import { create } from 'zustand';
import { compressedParse } from '@/lib/compressedStorage';
import { DOC_TYPE_LABELS, FORM_TYPE_LABELS, type FormType, type DocumentCategory } from '@/types/document';
import {
  useDocumentStore,
  getSerializedSession,
  serializeSession,
  getSavedSession,
  loadSharedSession,
  clearSavedSession,
  type SerializedSession,
  type DocumentState,
} from './documentStore';
import { useUIStore } from './uiStore';
import { useProfileStore } from './profileStore';
import { canonicalizeUnitAddress } from '@/lib/unitAddress';
import { migratePortionMarkings } from '@/lib/paragraphUtils';
import type { Profile } from '@/types/document';
import {
  idbGetAllDocuments,
  idbPutDocument,
  isIdbAvailable,
  idbDeleteDocument,
  idbAddSnapshot,
  idbDeleteSnapshots,
  idbGetCurrentId,
  idbSetCurrentId,
  idbGetMigratedIds,
  idbSetMigratedIds,
  type StoredDocument,
} from '@/lib/documentsDb';
import { useFormStore, loadFormSession, serializeForm, FORMS_PERSIST_KEY } from './formStore';
import { scheduleBackup } from './backupStore';
import { debug } from '@/lib/debug';

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
  /** In Trash until the user restores or permanently deletes this record. */
  deletedAt?: number;
}

export interface DocumentEntry {
  meta: DocumentMeta;
  session: SerializedSession;
}

interface DocumentsState {
  docs: Record<string, DocumentEntry>;
  trash: Record<string, DocumentEntry>;
  restoreFromTrash: (id: string) => void;
  permanentlyDelete: (id: string) => Promise<boolean>;
  currentId: string | null;
  /** True once the registry has been read out of IndexedDB. */
  hydrated: boolean;
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
  /** Replace the live editor with a version-history snapshot. Awaits a safety
   *  snapshot of the current state first — that commit is what makes the
   *  restore reversible — and resolves false (restoring nothing) if the safety
   *  copy could not be written. */
  restoreSnapshot: (session: SerializedSession) => Promise<boolean>;
  /**
   * Register the document currently in the live store as a new Recents entry
   * (used by Header's Load progress). Flush the open document first, then call
   * this so the loaded draft opens as its own entry instead of overwriting it.
   */
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

// True once the document holds real work: a non-placeholder subject or a body
// paragraph with real text. Bracketed starter placeholders don't count, so a
// blank new document stays out of Recents until the user writes something. Used
// only for the legacy single-session migration on first load (no baseline to
// diff against); the live promotion path uses hasContentDrift() below.
export function isMeaningful(s: SerializedSession): boolean {
  if (s.documentCategory === 'forms') return !!s.forms;
  const subj = (s.formData?.subject ?? '').trim();
  if (subj !== '' && !isPlaceholder(subj)) return true;
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
// only fields the USER changed from that starting point count.
function contentFingerprint(s: SerializedSession): string {
  if (s.documentCategory === 'forms') return JSON.stringify(s.forms ?? {});
  const fd = s.formData ?? {};
  return JSON.stringify([
    fd.subject ?? '',
    fd.to ?? '',
    fd.via ?? '',
    // Classification is content the user sets, and it drives portion markings.
    fd.classLevel ?? '',
    fd.customClassification ?? '',
    // Per-paragraph: body text + heading, plus indent level and portion marking
    // (a paragraph reworked only by marking/indent is still real work).
    (s.paragraphs ?? []).map((p) => [p.text ?? '', p.header ?? '', p.level ?? 0, p.portionMarking ?? '']),
    (s.references ?? []).map((r) => [r.title ?? '', r.url ?? '']),
    (s.enclosures ?? []).map((e) => [e.title ?? '', e.coverPageDescription ?? '']),
    (s.copyTos ?? []).map((c) => c.text ?? ''),
    (s.distributions ?? []).map((d) => d.text ?? ''),
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
  const clip = (t: string) => (t.length > 70 ? `${t.slice(0, 69)}…` : t);
  if (s.documentCategory === 'forms') {
    const form = s.forms;
    const title = s.formType === 'navmc_118_11'
      ? [form?.navmc11811?.lastName, form?.navmc11811?.firstName].filter(Boolean).join(', ')
      : form?.navmc10274?.natureOfAction;
    return clip(title?.trim() || `${FORM_TYPE_LABELS[s.formType]} draft`);
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
 * A human, safe download filename for the current correspondence document:
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
      .slice(0, 50) || 'correspondence';
  const ssic = (s.formData?.ssic ?? '').trim();
  const prefix = ssic && !isPlaceholder(ssic) ? `${ssic}-` : '';
  return `${prefix}${slug}.${ext}`;
}

// Same content if everything but save-derived fields matches. Ignore `timestamp`
// and each enclosure's `hasFile`: hasFile is emitted on serialize but dropped on
// load, so without ignoring it an attachment-bearing document would re-sort to
// the top of Recents on every reload.
export function sameContent(a: SerializedSession, b: SerializedSession): boolean {
  const strip = ({ timestamp: _t, enclosures, ...rest }: SerializedSession) => ({
    ...rest,
    enclosures: (enclosures ?? []).map(({ hasFile: _h, ...e }) => e),
  });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

// The signature image is a profile-level asset excluded from the serialized
// session (large base64 PNG), so re-seed it from the active profile after loading
// any document; otherwise the document renders and exports with no signature.
function applyProfileSignature(): void {
  const { selectedProfile, profiles } = useProfileStore.getState();
  const sig = selectedProfile ? profiles[selectedProfile]?.signatureImage : undefined;
  if (sig && useDocumentStore.getState().formData.signatureImage === undefined) useDocumentStore.getState().setFormData({ signatureImage: sig });
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
 * and the interactive ProfileBar dropdown so the two paths can't drift.
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
          byDirection: profile.byDirection,
          byDirectionAuthority: profile.byDirectionAuthority,
          signatureImage: profile.signatureImage,
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

function metaFor(id: string, session: SerializedSession, prev?: DocumentMeta): DocumentMeta {
  return {
    id,
    // A user-set name wins and survives Subject edits; otherwise auto-derive.
    title: prev?.name?.trim() || deriveTitle(session),
    docType: session.documentCategory === 'forms' ? session.formType : session.docType,
    updatedAt: Date.now(),
    name: prev?.name,
    // Preserve the pin across content saves — metaFor rebuilds meta on every
    // sync, so without this a pinned doc would silently unpin on the next edit.
    pinned: prev?.pinned,
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

function persistEntry(entry: DocumentEntry): void {
  const ui = useUIStore.getState();
  // Memory-only work must never be presented as a successful durable save.
  if (!isIdbAvailable()) {
    ui.setSaveStatus('error');
    return;
  }
  // Reflect the real write outcome (drives "Saving…" → "Saved" / "Couldn't save")
  // instead of optimistically claiming saved before the put resolves.
  ui.setSaveStatus('saving');
  void idbPutDocument({ id: entry.meta.id, meta: entry.meta, session: entry.session }).then((ok) => {
    if (ok) {
      if (useDocumentsStore.getState().currentId === entry.meta.id && sameContent(getSerializedSession(), entry.session)) ui.markSaved();
      broadcastDocs({ type: 'put', id: entry.meta.id });
      // Mirror the change to the synced backup file (no-op unless one is set up).
      scheduleBackup();
    } else if (useDocumentsStore.getState().currentId === entry.meta.id) {
      ui.setSaveStatus('error');
    }
  });
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
      if (await idbPutDocument({ id, meta: entry.meta, session: entry.session })) {
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
      if (records.some((r) => r.id === id) || await idbPutDocument({ id, meta: metaFor(id, session), session })) {
        ledger.add(id);
        if (lastSession?.documentCategory === 'forms' && lastSession.formType === formType) await idbSetCurrentId(id);
      } else complete = false;
    }
  }
  if (complete) ledger.add('forms-registry-v1');
  await idbSetMigratedIds([...ledger]);
}

// Shared hydration promise so concurrent init() calls read the registry once.
let hydratePromise: Promise<void> | null = null;
function ensureHydrated(
  set: (partial: Partial<DocumentsState>) => void,
  get: () => DocumentsState
): Promise<void> {
  if (get().hydrated) return Promise.resolve();
  if (!hydratePromise) {
    hydratePromise = (async () => {
      await migrateLegacyRegistry();
      await migrateLegacyForms();
      const [records, cid] = await Promise.all([idbGetAllDocuments(), idbGetCurrentId()]);
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
      for (const r of records) {
        // Fold a legacy FOUO portion marking to CUI in the PERSISTED registry, not
        // just the live store when the doc is later opened. Otherwise stored stays
        // FOUO while loadSharedSession migrates the live copy to CUI, and the first
        // syncCurrent sees a diff and re-saves + re-sorts an untouched doc. Reuse
        // the same meta (no updatedAt bump) so it never re-sorts Recents.
        const paragraphs = migratePortionMarkings(r.session.paragraphs ?? []);
        if (paragraphs !== r.session.paragraphs) {
          const session = { ...r.session, paragraphs };
          loaded[r.id] = { meta: r.meta, session };
          void idbPutDocument({ id: r.id, meta: r.meta, session });
        } else {
          loaded[r.id] = { meta: r.meta, session: r.session };
        }
      }
      set({ ...partitionDocuments(loaded), currentId: cid, hydrated: true });
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
    persistEntry(removed);
  }
  const title = entries.length === 1 ? entries[0].meta.title : `${entries.length} documents`;
  set({ trash, pendingDelete: { ids: entries.map((e) => e.meta.id), title } });
  purgeTimer = setTimeout(() => { set({ pendingDelete: null }); purgeTimer = null; }, 6000);
}

// Shared "the open doc was deleted" fallback: reopen the newest remaining doc,
// else seed a fresh blank. `remaining` is the docs map after the deletion.
function reopenAfterRemoval(
  remaining: Record<string, DocumentEntry>,
  set: (partial: Partial<DocumentsState>) => void,
  markBaseline: () => void
): void {
  // The deleted doc may still sit in the localStorage session blob; clear it so
  // a crash recovery can't hand back a document the user just deleted.
  clearSavedSession();
  const newest = Object.values(remaining).sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)[0];
  if (newest) {
    set({ currentId: newest.meta.id, baseline: newest.session });
    persistCurrentId(newest.meta.id);
    loadSharedSession(newest.session);
    applyProfileSignature();
    useUIStore.getState().setLastSavedAt(newest.meta.updatedAt);
  } else {
    const fresh = newId();
    set({ currentId: fresh });
    persistCurrentId(fresh);
    const ds = useDocumentStore.getState();
    ds.setDocumentCategory('correspondence');
    ds.resetForm();
    applySelectedProfile();
    markBaseline();
    useUIStore.getState().setLastSavedAt(null);
  }
  useUIStore.getState().setValidationVisible(false);
}

// Version-history snapshots: throttle autosave snapshots to one per document per
// SNAPSHOT_INTERVAL; an explicit Save forces one. idbAddSnapshot caps the ring.
const SNAPSHOT_INTERVAL = 3 * 60_000;
const lastSnap: Record<string, number> = {};
// Resolves true when the snapshot committed (or was throttle-skipped); callers
// that only checkpoint opportunistically `void` it, while restoreSnapshot awaits
// it — the safety copy is what makes a restore reversible.
function maybeSnapshot(docId: string, session: SerializedSession, force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && now - (lastSnap[docId] ?? 0) < SNAPSHOT_INTERVAL) return Promise.resolve(true);
  lastSnap[docId] = now;
  return idbAddSnapshot(docId, { ts: now, session });
}

// The post-hydration half of init(): resume the current document, or fold the
// legacy single-session blob into the registry, or start brand-new. Split out
// of the store so init() can run it under a cross-tab Web Lock.
function initAfterHydration(
  set: (partial: Partial<DocumentsState>) => void,
  get: () => DocumentsState
): boolean {
  const { currentId, docs } = get();

  // Returning user: the registry knows the open document; load it to resume.
  // The IndexedDB registry entry is authoritative — we deliberately do NOT fall
  // back to the id-less localStorage session blob here: it may hold a DIFFERENT
  // document (e.g. after a switchTo whose debounced blob-rewrite hadn't fired),
  // so preferring it could graft another draft's content onto this one.
  if (currentId && docs[currentId]) {
    let session = docs[currentId].session;
    // Canonicalize the stored unitAddress to match what loadSharedSession
    // applies; otherwise a legacy entry re-sorts to the top on first reload.
    if (session.formData?.unitAddress) {
      const canon = canonicalizeUnitAddress(session.formData.unitAddress);
      if (canon !== session.formData.unitAddress) {
        session = { ...session, formData: { ...session.formData, unitAddress: canon } };
        const entry = { ...docs[currentId], session };
        set({ docs: { ...docs, [currentId]: entry } });
        persistEntry(entry);
      }
    }
    loadSharedSession(session);
    applyProfileSignature();
    set({ baseline: session });
    useUIStore.getState().setValidationVisible(false);
    useUIStore.getState().setLastSavedAt(docs[currentId].meta.updatedAt);
    debug.log('Documents', 'Resumed current document', { id: currentId });
    return true;
  }

  // First load after this feature shipped: fold the legacy single session into
  // the registry so prior work isn't lost.
  const legacy = getSavedSession();
  if (legacy && legacy.documentCategory !== 'forms' && isMeaningful(legacy)) {
    if (legacy.formData?.unitAddress) {
      legacy.formData = {
        ...legacy.formData,
        unitAddress: canonicalizeUnitAddress(legacy.formData.unitAddress),
      };
    }
    const id = newId();
    const entry = { meta: metaFor(id, legacy), session: legacy };
    set({ currentId: id, docs: { ...docs, [id]: entry } });
    persistEntry(entry);
    persistCurrentId(id);
    loadSharedSession(legacy);
    applyProfileSignature();
    set({ baseline: legacy });
    debug.log('Documents', 'Migrated legacy session as first document', { id });
    return true;
  }

  // Brand-new (or forms-only) start: give the live document an id. The caller
  // sets its baseline after applying the profile; it enters Recents on first
  // edit. Don't persist this id yet — a visitor who types nothing would
  // otherwise leave a resume pointer aimed at a document that was never saved.
  // syncCurrent/saveCurrent persist it the moment the doc gains real content.
  const id = newId();
  set({ currentId: id, baseline: null });
  return false;
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  docs: {},
  trash: {},
  currentId: null,
  hydrated: false,
  baseline: null,
  pendingDelete: null,

  markBaseline: () => {
    const session = getSerializedSession();
    set({ baseline: session });
  },

  init: async () => {
    // Two tabs booting simultaneously on a user's FIRST post-upgrade load would
    // each fold the legacy session blob into its own newId() — a duplicate
    // document. The Web Locks API serializes init across tabs: the loser waits,
    // then hydrates a registry the winner already migrated and resumes normally.
    // Without locks support, behavior is unchanged (single-tab is unaffected).
    const run = async (): Promise<boolean> => {
      await ensureHydrated(set, get);
      return initAfterHydration(set, get);
    };
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return navigator.locks.request('dondocs-init', run);
    }
    return run();
  },

  syncCurrent: (source) => {
    const { currentId, docs, baseline } = get();
    if (!currentId || get().trash[currentId]) return;
    const session = source ? serializeSession(source) : getSerializedSession();

    const prev = docs[currentId];
    if (!prev) {
      // Not yet in Recents: add it once the user has changed real content from the
      // starting baseline (subject, body, recipient, references, enclosures,
      // copy-tos, distribution). A pristine starter, or one only changed in
      // letterhead / form / type / font, stays out until the user writes something.
      if (!baseline || !hasContentDrift(baseline, session)) return;
    } else if (sameContent(prev.session, session)) {
      // Already in Recents and unchanged. Removal is explicit (delete).
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
    // Advance the baseline to what we just persisted: "baseline" means the last
    // state THIS tab loaded or wrote, which is exactly the reference the stale-
    // flush guard above needs (not the state from load time).
    set({ docs: { ...docs, [currentId]: entry }, baseline: session });
    persistEntry(entry);
    // First time this doc reaches Recents: pin it as the resume pointer (init no
    // longer persists ids eagerly, so this is where a real doc becomes resumable).
    if (!prev) persistCurrentId(currentId);
    void maybeSnapshot(currentId, session);
  },

  saveCurrent: () => {
    const { currentId, docs } = get();
    if (!currentId || get().trash[currentId]) return;
    const session = getSerializedSession();
    // Force-add when absent, but skip a no-op Save so it doesn't re-sort.
    const prev = docs[currentId];
    if (prev && sameContent(prev.session, session)) {
      persistEntry(prev);
      void maybeSnapshot(currentId, session, true);
      return;
    }
    const entry = { meta: metaFor(currentId, session, prev?.meta), session };
    // Keep baseline in lockstep with what this tab persisted (see syncCurrent).
    set({ docs: { ...docs, [currentId]: entry }, baseline: session });
    persistEntry(entry);
    if (!prev) persistCurrentId(currentId); // make a just-saved fresh doc resumable
    void maybeSnapshot(currentId, session, true); // explicit Save = a deliberate checkpoint
  },

  newDocument: (formType) => {
    get().syncCurrent(); // preserve the document being left
    const id = newId();
    set({ currentId: id });
    persistCurrentId(id);
    const ds = useDocumentStore.getState();
    ds.resetForm();
    ds.setDocumentCategory(formType ? 'forms' : 'correspondence');
    if (formType) {
      ds.setFormType(formType);
      loadFormSession(formType);
    } else applySelectedProfile();
    get().markBaseline();
    useUIStore.getState().setLastSavedAt(null); // brand-new doc isn't saved yet
    debug.log('Documents', 'New document', { id });
  },

  selectKind: (category, formType = 'navmc_10274') => {
    const current = useDocumentStore.getState();
    if (current.documentCategory === category && (category !== 'forms' || current.formType === formType)) return;
    get().syncCurrent();
    const previous = Object.values(get().docs)
      .filter(({ session }) => session.documentCategory === category && (category !== 'forms' || session.formType === formType))
      .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)[0];
    if (previous) get().switchTo(previous.meta.id);
    else get().newDocument(category === 'forms' ? formType : undefined);
  },

  switchTo: (id) => {
    if (id === get().currentId) return;
    const entry = get().docs[id];
    if (!entry) return;
    get().syncCurrent(); // preserve the document being left
    set({ currentId: id, baseline: entry.session });
    persistCurrentId(id);
    loadSharedSession(entry.session);
    applyProfileSignature();
    useUIStore.getState().setValidationVisible(false);
    // Point the "Saved" indicator at THIS doc's last save, not the one we left.
    useUIStore.getState().setLastSavedAt(entry.meta.updatedAt);
    debug.log('Documents', 'Switched document', { id });
  },

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
    reopenAfterRemoval(next, set, get().markBaseline);
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
    if (currentId != null && ids.includes(currentId)) reopenAfterRemoval(next, set, get().markBaseline);
  },

  togglePin: (id) => {
    const { docs } = get();
    const entry = docs[id];
    if (!entry) return;
    const meta: DocumentMeta = { ...entry.meta, pinned: !entry.meta.pinned };
    const updated = { ...entry, meta };
    set({ docs: { ...docs, [id]: updated } });
    persistEntry(updated);
  },

  openLoadedAsNew: () => {
    const id = newId();
    set({ currentId: id });
    persistCurrentId(id);
    get().markBaseline();
    get().saveCurrent(); // force the loaded draft into Recents as its own entry
    useUIStore.getState().setValidationVisible(false);
    debug.log('Documents', 'Opened loaded draft as new document', { id });
  },

  restoreDeleted: () => {
    for (const id of get().pendingDelete?.ids ?? []) get().restoreFromTrash(id);
    if (purgeTimer) clearTimeout(purgeTimer);
    set({ pendingDelete: null });
  },

  restoreFromTrash: (id) => {
    const entry = get().trash[id];
    if (!entry) return;
    const { deletedAt: _deletedAt, ...meta } = entry.meta;
    const restored = { ...entry, meta: { ...meta, updatedAt: Date.now() } };
    const trash = { ...get().trash };
    delete trash[id];
    set({ trash, docs: { ...get().docs, [id]: restored } });
    persistEntry(restored);
  },

  permanentlyDelete: async (id) => {
    if (!get().trash[id]) return false;
    if (!await idbDeleteDocument(id)) return false;
    await idbDeleteSnapshots(id);
    const trash = { ...get().trash };
    delete trash[id];
    set({ trash });
    broadcastDocs({ type: 'delete', id });
    scheduleBackup();
    void import('@/lib/attachmentGc').then((m) => void m.sweepOrphanedAttachments());
    return true;
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
    persistEntry(updated);
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

  restoreSnapshot: async (session) => {
    const { currentId } = get();
    // The safety snapshot is what makes a restore reversible (the modal says
    // so), so it must COMMIT before anything is overwritten. Fire-and-forget
    // here used to race saveCurrent's forced checkpoint below and lose the
    // safety copy — silently destroying the pre-restore draft. If it can't be
    // written, restore nothing and let the caller say so.
    if (currentId) {
      const ok = await maybeSnapshot(currentId, getSerializedSession(), true);
      if (!ok || get().currentId !== currentId) return false;
    }
    loadSharedSession(session);
    get().markBaseline();
    get().saveCurrent(); // persist the restored content as the current version
    return true;
  },
}));

// Snapshot the live document into the registry shortly after edits settle.
// Subscribing here (rather than documentStore calling us) keeps the dependency
// one-directional. loadSharedSession/resetForm also fire this, but sameContent()
// makes those a no-op.
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleSync = () => {
  const registry = useDocumentsStore.getState();
  const entry = registry.currentId ? registry.docs[registry.currentId] : undefined;
  const reference = entry?.session ?? registry.baseline;
  if (registry.hydrated && reference) {
    const live = getSerializedSession();
    const changed = entry ? !sameContent(reference, live) : hasContentDrift(reference, live);
    const ui = useUIStore.getState();
    if (changed) ui.setSaveStatus('pending');
    else if (ui.saveStatus === 'pending') ui.setSaveStatus(ui.lastSavedAt == null ? 'idle' : 'saved');
  }
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => useDocumentsStore.getState().syncCurrent(), 1500);
};
useDocumentStore.subscribe(scheduleSync);
useFormStore.subscribe(() => {
  if (useDocumentStore.getState().documentCategory === 'forms') scheduleSync();
});

// Flush the pending registry sync when the page is hidden so the last edits
// reach IndexedDB before the user leaves. visibilitychange keeps the page alive
// so the async IDB transaction can commit; pagehide may abort it mid-flight.
if (typeof document !== 'undefined') {
  const flushOnLeave = () => {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    useDocumentsStore.getState().syncCurrent();
  };
  // visibilitychange keeps the page alive so the async IDB txn can commit; it's
  // the primary flush. pagehide is the backstop for hard closes / navigations
  // the former can miss (it fires when visibilitychange may not), so the last
  // ~1.5s of edits still reach Recents. syncCurrent() is idempotent (sameContent
  // makes the second call a no-op), so firing both is safe.
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
    void idbGetAllDocuments().then((records) => {
      if (records !== null) reconcileDocuments(records, event.data?.type === 'delete' ? event.data.id : undefined);
    });
  };
}

/** Follow deletion from another tab without resurrecting its old identity. */
export function reconcileDocuments(records: StoredDocument[], permanentlyDeletedId?: string): void {
  const loaded: Record<string, DocumentEntry> = {};
  for (const record of records) loaded[record.id] = { meta: record.meta, session: record.session };
  const { currentId, docs, baseline } = useDocumentsStore.getState();
  const removed = !!currentId && (!!loaded[currentId]?.meta.deletedAt || permanentlyDeletedId === currentId && !loaded[currentId]);
  if (currentId && docs[currentId] && !loaded[currentId] && !removed) loaded[currentId] = docs[currentId];
  const partitioned = partitionDocuments(loaded);
  useDocumentsStore.setState(partitioned);
  if (!removed) return;
  if (baseline && !sameContent(baseline, getSerializedSession())) {
    useDocumentsStore.getState().openLoadedAsNew();
    showAppAlert({ title: 'Edits kept in a new draft', message: 'This document was deleted in another tab. Your newer edits were kept as a separate draft.' });
  } else {
    reopenAfterRemoval(partitioned.docs, useDocumentsStore.setState, useDocumentsStore.getState().markBaseline);
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
  useDocumentsStore.getState().syncCurrent();
  const { docs, trash, hydrated } = useDocumentsStore.getState();
  if (!hydrated || useUIStore.getState().storageHealth === 'unreadable') {
    throw new Error('Saved documents could not be read — a backup now would be incomplete');
  }
  const records: StoredDocument[] = Object.values({ ...docs, ...trash }).map((e) => ({
    id: e.meta.id,
    meta: e.meta,
    session: e.session,
  }));
  return JSON.stringify({ kind: 'dondocs-library', version: 1, docs: records });
}

/** Merge a library backup into IndexedDB and refresh the in-memory registry.
 *  Conflict-aware: when the backup and the current library hold the same doc id,
 *  the newer (higher updatedAt) copy wins, so restoring an old backup can't
 *  silently clobber work you've done since. Returns how many were imported and
 *  how many were skipped as older. Throws on a malformed file. */
export async function importLibrary(json: string): Promise<{ imported: number; skipped: number }> {
  const parsed = JSON.parse(json) as { docs?: unknown };
  const records = parsed?.docs;
  if (!Array.isArray(records)) throw new Error('Not a DonDocs library file');

  // Snapshot the current updatedAt per id so we only overwrite with something
  // at least as new. If that read fails, ABORT: with an empty conflict map an
  // old backup would silently overwrite every newer local copy.
  const current = await idbGetAllDocuments();
  if (current === null) {
    throw new Error('Could not read the current library — import cancelled to protect newer local copies');
  }
  const existing = new Map<string, number>();
  for (const r of current) existing.set(r.id, r.meta?.updatedAt ?? 0);

  let imported = 0;
  let skipped = 0;
  const applied: DocumentEntry[] = [];
  for (const r of records as DocumentEntry[]) {
    if (!r?.meta?.id || !r?.session) continue;
    if (!importShouldReplace(existing.get(r.meta.id), r.meta.updatedAt ?? 0)) {
      skipped++; // the copy already here is newer — keep it
      continue;
    }
    if (await idbPutDocument({ id: r.meta.id, meta: r.meta, session: r.session })) {
      imported++;
      applied.push({ meta: r.meta, session: r.session });
    }
  }
  // Re-read the merged set so the Recents list reflects the import immediately.
  // If that read fails, fold the just-imported records into the in-memory list
  // instead of blanking it — the puts above are already durable.
  const all = await idbGetAllDocuments();
  const loaded: Record<string, DocumentEntry> = {};
  if (all !== null) {
    for (const r of all) loaded[r.id] = { meta: r.meta, session: r.session };
  } else {
    Object.assign(loaded, useDocumentsStore.getState().docs, useDocumentsStore.getState().trash);
    for (const e of applied) loaded[e.meta.id] = e;
  }
  useDocumentsStore.setState(partitionDocuments(loaded));
  return { imported, skipped };
}
