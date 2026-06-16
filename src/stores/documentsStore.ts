import { create } from 'zustand';
import { compressedParse } from '@/lib/compressedStorage';
import { DOC_TYPE_LABELS } from '@/types/document';
import {
  useDocumentStore,
  getSerializedSessionForShare,
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
} from '@/lib/documentsDb';
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
 * v1 scope: correspondence only. Forms field data lives in a separate store and
 * isn't part of SerializedSession.
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
}

interface DocumentEntry {
  meta: DocumentMeta;
  session: SerializedSession;
}

interface DocumentsState {
  docs: Record<string, DocumentEntry>;
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
  newDocument: () => void;
  /** Open an existing document by id. */
  switchTo: (id: string) => void;
  /** Soft-delete a document; if it was open, fall back to the newest remaining
   *  or a blank one. The IDB record + entry are kept ~6s so the delete can be
   *  undone (see pendingDelete / restoreDeleted). */
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
  /** Replace the live editor with a version-history snapshot (snapshots the
   *  current state first so the restore is itself reversible). */
  restoreSnapshot: (session: SerializedSession) => void;
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
  const s = entry.session;
  const fd = s.formData ?? {};
  const parts: (string | undefined)[] = [
    entry.meta.title,
    entry.meta.name,
    fd.subject,
    fd.to,
    fd.from,
    fd.via,
    fd.ssic,
    ...(s.paragraphs ?? []).flatMap((p) => [p.text, p.header]),
    ...(s.references ?? []).map((r) => r.title),
    ...(s.enclosures ?? []).map((e) => e.title),
    ...(s.copyTos ?? []).map((c) => c.text),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * A human, safe download filename for the current correspondence document:
 *  an optional SSIC prefix + a slug of the derived title, so a letter downloads
 *  as `5216-request-for-special-liberty.pdf` instead of `correspondence.pdf`.
 *  NAVMC forms build their own names; this brings correspondence to parity.
 */
export function correspondenceFilename(ext: string, session?: SerializedSession): string {
  const s = session ?? getSerializedSessionForShare();
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
  if (sig) useDocumentStore.getState().setFormData({ signatureImage: sig });
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
    docType: session.docType,
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
  // No durable store (private mode / blocked): the in-memory doc IS the doc and
  // StorageNotice already warns — mark optimistically saved, not an error.
  if (!isIdbAvailable()) {
    ui.markSaved();
    return;
  }
  // Reflect the real write outcome (drives "Saving…" → "Saved" / "Couldn't save")
  // instead of optimistically claiming saved before the put resolves.
  ui.setSaveStatus('saving');
  void idbPutDocument({ id: entry.meta.id, meta: entry.meta, session: entry.session }).then((ok) => {
    if (ok) {
      ui.markSaved();
      broadcastDocs({ type: 'put', id: entry.meta.id });
      // Mirror the change to the synced backup file (no-op unless one is set up).
      scheduleBackup();
    } else {
      ui.setSaveStatus('error');
    }
  });
}
function persistCurrentId(id: string | null): void {
  void idbSetCurrentId(id);
}

// One-time migration of the previous compressed-localStorage registry blob into
// IndexedDB, then drop the old key. Only runs while IndexedDB is still empty.
type LegacyRegistry = { docs?: Record<string, DocumentEntry>; currentId?: string | null };
export async function migrateLegacyRegistry(): Promise<void> {
  if ((await idbGetAllDocuments()).length > 0) return; // IDB already populated
  let raw: string | null;
  try {
    // Reading localStorage throws (SecurityError) when site data is blocked;
    // there's nothing to migrate in that case, so bail without escaping init().
    raw = typeof localStorage !== 'undefined' ? localStorage.getItem('dondocs_documents') : null;
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = compressedParse<{ state?: LegacyRegistry } & LegacyRegistry>(raw);
    const state = parsed.state ?? parsed;
    let allWritten = true;
    for (const [id, entry] of Object.entries(state.docs ?? {})) {
      if (entry?.meta && entry?.session) {
        if (!(await idbPutDocument({ id, meta: entry.meta, session: entry.session }))) allWritten = false;
      }
    }
    if (state.currentId && !(await idbSetCurrentId(state.currentId))) allWritten = false;
    // Only drop the legacy blob once every record is confirmed durable in IDB;
    // otherwise keep it so the next load retries rather than losing the user's
    // only copy. The length>0 guard above prevents a re-run from duplicating.
    if (allWritten) {
      localStorage.removeItem('dondocs_documents');
      debug.log('Documents', 'Migrated localStorage registry to IndexedDB');
    } else {
      debug.error('Documents', 'IndexedDB write failed during migration; keeping legacy blob for retry');
    }
  } catch (err) {
    debug.error('Documents', 'localStorage -> IndexedDB migration failed', err);
  }
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
      const [records, cid] = await Promise.all([idbGetAllDocuments(), idbGetCurrentId()]);
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
      set({ docs: loaded, currentId: cid, hydrated: true });
    })();
    // If hydration rejects, drop the cached promise so a later init() can retry
    // rather than being wedged on a permanently-rejected promise for the page
    // lifetime (mirrors openDb's dbPromise reset).
    hydratePromise.catch(() => {
      hydratePromise = null;
    });
  }
  return hydratePromise;
}

// Soft-delete bookkeeping: the kept entries + their purge timer live outside the
// store (live entries / a timer handle, not serializable state). A batch (bulk
// delete) shares one timer and one undo affordance.
let purgeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingEntries: DocumentEntry[] = [];

// Finalize a lapsed/superseded purge. The document records were already removed
// in beginPending (so a tab close mid-window can't resurrect them); only the
// version-history snapshots remain — clean them up now that the undo window has
// truly closed, so an undo *within* the window still keeps its history.
function finalizePurge(): void {
  for (const e of pendingEntries) {
    void idbDeleteSnapshots(e.meta.id);
  }
  pendingEntries = [];
}

// Stage entries for a 6s-undoable delete. The document records are hard-deleted
// IMMEDIATELY (not on the timer): a deferred delete never runs if the tab is
// closed/reloaded during the window, so the "deleted" doc would reappear from
// IndexedDB on next load. The undo keeps only an in-memory copy — restoreDeleted()
// re-persists it. Snapshots are left until finalizePurge so an undo keeps history.
function beginPending(entries: DocumentEntry[], set: (partial: Partial<DocumentsState>) => void): void {
  if (entries.length === 0) return;
  if (purgeTimer) {
    clearTimeout(purgeTimer);
    finalizePurge();
  }
  for (const e of entries) {
    void idbDeleteDocument(e.meta.id);
    broadcastDocs({ type: 'delete', id: e.meta.id });
  }
  scheduleBackup(); // reflect the deletion in the synced backup file right away
  pendingEntries = entries;
  const title = entries.length === 1 ? entries[0].meta.title : `${entries.length} documents`;
  set({ pendingDelete: { ids: entries.map((e) => e.meta.id), title } });
  purgeTimer = setTimeout(() => {
    finalizePurge();
    purgeTimer = null;
    set({ pendingDelete: null });
  }, 6000);
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
function maybeSnapshot(docId: string, session: SerializedSession, force = false): void {
  const now = Date.now();
  if (!force && now - (lastSnap[docId] ?? 0) < SNAPSHOT_INTERVAL) return;
  lastSnap[docId] = now;
  void idbAddSnapshot(docId, { ts: now, session });
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  docs: {},
  currentId: null,
  hydrated: false,
  baseline: null,
  pendingDelete: null,

  markBaseline: () => {
    const session = getSerializedSessionForShare();
    set({ baseline: session.documentCategory === 'forms' ? null : session });
  },

  init: async () => {
    await ensureHydrated(set, get);
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
  },

  syncCurrent: (source) => {
    const { currentId, docs, baseline } = get();
    if (!currentId) return;
    const session = source ? serializeSession(source) : getSerializedSessionForShare();
    // Forms aren't part of SerializedSession yet.
    if (session.documentCategory === 'forms') return;

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
    }
    const entry = { meta: metaFor(currentId, session, prev?.meta), session };
    set({ docs: { ...docs, [currentId]: entry } });
    persistEntry(entry);
    // First time this doc reaches Recents: pin it as the resume pointer (init no
    // longer persists ids eagerly, so this is where a real doc becomes resumable).
    if (!prev) persistCurrentId(currentId);
    maybeSnapshot(currentId, session);
  },

  saveCurrent: () => {
    const { currentId, docs } = get();
    if (!currentId) return;
    const session = getSerializedSessionForShare();
    // Forms field data isn't part of SerializedSession yet; leave it to the
    // legacy save.
    if (session.documentCategory === 'forms') return;
    // Force-add when absent, but skip a no-op Save so it doesn't re-sort.
    const prev = docs[currentId];
    if (prev && sameContent(prev.session, session)) return;
    const entry = { meta: metaFor(currentId, session, prev?.meta), session };
    set({ docs: { ...docs, [currentId]: entry } });
    persistEntry(entry);
    if (!prev) persistCurrentId(currentId); // make a just-saved fresh doc resumable
    maybeSnapshot(currentId, session, true); // explicit Save = a deliberate checkpoint
  },

  newDocument: () => {
    get().syncCurrent(); // preserve the document being left
    const id = newId();
    set({ currentId: id });
    persistCurrentId(id);
    const ds = useDocumentStore.getState();
    ds.setDocumentCategory('correspondence');
    ds.resetForm();
    applySelectedProfile();
    get().markBaseline();
    useUIStore.getState().setLastSavedAt(null); // brand-new doc isn't saved yet
    debug.log('Documents', 'New document', { id });
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
    const { docs, currentId } = get();
    const entry = docs[id];
    const next = { ...docs };
    delete next[id];
    set({ docs: next });
    // Soft delete: the IDB record is removed now, but the entry is kept in memory
    // ~6s so an accidental delete can be undone. A current-but-unsaved doc has no
    // entry — nothing to keep, but we still reopen the newest below.
    if (entry) beginPending([entry], set);
    if (id !== currentId) return;
    reopenAfterRemoval(next, set, get().markBaseline);
  },

  removeMany: (ids) => {
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
    if (pendingEntries.length === 0) return;
    if (purgeTimer) {
      clearTimeout(purgeTimer);
      purgeTimer = null;
    }
    const entries = pendingEntries;
    pendingEntries = [];
    // The IDB records were hard-deleted eagerly in beginPending; re-list them in
    // memory and persist to re-add them to IndexedDB. Snapshots were left intact
    // during the window, so version history survives the undo.
    set((s) => {
      const docs = { ...s.docs };
      for (const e of entries) docs[e.meta.id] = e;
      return { docs, pendingDelete: null };
    });
    for (const e of entries) persistEntry(e);
    debug.log('Documents', 'Restored deleted document(s)', { ids: entries.map((e) => e.meta.id) });
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
      docType: entry.session.docType,
      updatedAt: Date.now(),
    };
    const dup: DocumentEntry = { meta, session: entry.session };
    set({ docs: { ...docs, [copyId]: dup } });
    persistEntry(dup);
    debug.log('Documents', 'Duplicated document', { from: id, to: copyId });
  },

  restoreSnapshot: (session) => {
    const { currentId } = get();
    // Snapshot the current state first so restoring is itself reversible.
    if (currentId) maybeSnapshot(currentId, getSerializedSessionForShare(), true);
    loadSharedSession(session);
    get().markBaseline();
    get().saveCurrent(); // persist the restored content as the current version
  },
}));

// Snapshot the live document into the registry shortly after edits settle.
// Subscribing here (rather than documentStore calling us) keeps the dependency
// one-directional. loadSharedSession/resetForm also fire this, but sameContent()
// makes those a no-op.
let syncTimer: ReturnType<typeof setTimeout> | null = null;
useDocumentStore.subscribe((state, prev) => {
  // Flush immediately when the category flips correspondence -> forms: the prior
  // state still holds the user's unsaved letter, which the debounced,
  // forms-skipping sync would drop.
  if (prev.documentCategory === 'correspondence' && state.documentCategory === 'forms') {
    useDocumentsStore.getState().syncCurrent(prev);
  }
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => useDocumentsStore.getState().syncCurrent(), 1500);
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
  docsChannel.onmessage = () => {
    void idbGetAllDocuments().then((records) => {
      const loaded: Record<string, DocumentEntry> = {};
      for (const r of records) loaded[r.id] = { meta: r.meta, session: r.session };
      const { currentId, docs } = useDocumentsStore.getState();
      // Keep this tab's live current doc even if it isn't persisted yet, and
      // don't resurrect a doc this tab has soft-deleted (still in IDB pending).
      if (currentId && docs[currentId] && !loaded[currentId]) loaded[currentId] = docs[currentId];
      for (const e of pendingEntries) delete loaded[e.meta.id];
      useDocumentsStore.setState({ docs: loaded });
    });
  };
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

/** Serialize every saved document to a single JSON backup string. */
export async function exportLibrary(): Promise<string> {
  const records = await idbGetAllDocuments();
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
  // at least as new.
  const existing = new Map<string, number>();
  for (const r of await idbGetAllDocuments()) existing.set(r.id, r.meta?.updatedAt ?? 0);

  let imported = 0;
  let skipped = 0;
  for (const r of records as DocumentEntry[]) {
    if (!r?.meta?.id || !r?.session) continue;
    if (!importShouldReplace(existing.get(r.meta.id), r.meta.updatedAt ?? 0)) {
      skipped++; // the copy already here is newer — keep it
      continue;
    }
    if (await idbPutDocument({ id: r.meta.id, meta: r.meta, session: r.session })) imported++;
  }
  // Re-read the merged set so the Recents list reflects the import immediately.
  const all = await idbGetAllDocuments();
  const loaded: Record<string, DocumentEntry> = {};
  for (const r of all) loaded[r.id] = { meta: r.meta, session: r.session };
  useDocumentsStore.setState({ docs: loaded });
  return { imported, skipped };
}
