/**
 * Full-account backup: one downloadable file that captures EVERYTHING a user
 * has, not just their documents.
 *
 * The original "Back up all documents" file (`exportLibrary`, kind
 * `dondocs-library` v1) serialized only the IndexedDB document registry — so a
 * restore on a new machine silently lost the user's profiles + signatures,
 * saved snippets, user templates, and in-progress NAVMC form fields (each lives
 * in its own persisted store). This module produces a versioned bundle
 * (`dondocs-backup` v2) that includes all of them, and restores them
 * NON-DESTRUCTIVELY so re-importing an old backup can never clobber newer local
 * work.
 *
 * Everything here is a local browser operation (JSON build + merge into
 * localStorage/IndexedDB) — no network, air-gap safe.
 */
import type { Profile } from '@/types/document';
import { exportLibrary, importLibrary } from '@/stores/documentsStore';
import { useProfileStore } from '@/stores/profileStore';
import { useFormStore } from '@/stores/formStore';
import { useSnippetsStore, type Snippet } from '@/stores/snippetsStore';
import { useUserTemplatesStore, type UserTemplate } from '@/stores/userTemplatesStore';
import { useRoutingStore, sanitizeOverrides } from '@/stores/routingStore';
import {
  idbGetAttachment,
  idbPutAttachment,
  idbGetSnapshots,
  idbSetSnapshots,
  MAX_SNAPSHOTS,
  type StoredAttachment,
  type DocSnapshot,
} from '@/lib/documentsDb';
import { uint8ArrayToBase64, base64ToUint8Array, arrayBufferToUint8Array } from '@/lib/encoding';

export const BACKUP_KIND = 'dondocs-backup';
// v5 adds `routingOverrides` (unit AA-form routing). v4 added `snapshots`
// (per-document version history). v3 added `attachments`. Restore branches on
// `kind` and on field PRESENCE, not version, so an older bundle (missing any of
// these fields) still restores cleanly.
export const BACKUP_VERSION = 5;
const LIBRARY_KIND = 'dondocs-library'; // legacy docs-only file

/** An enclosure blob embedded in the bundle; `data` is base64 of the raw bytes. */
export interface BackupAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string;
}

export interface BackupBundle {
  kind: typeof BACKUP_KIND;
  version: number;
  exportedAt: number;
  documents: unknown[];
  profiles: { profiles: Record<string, Profile>; selectedProfile: string | null };
  forms: { navmc10274: unknown; navmc11811: unknown };
  snippets: Snippet[];
  userTemplates: Record<string, UserTemplate>;
  attachments: BackupAttachment[];
  /** Per-document version-history rings, keyed by document id. */
  snapshots: Record<string, DocSnapshot[]>;
  /** Unit-specific AA-form routing overrides, keyed by action-type id. */
  routingOverrides?: Record<string, string>;
}

export interface RestoreResult {
  documents: { imported: number; skipped: number };
  profilesAdded: number;
  snippetsAdded: number;
  templatesAdded: number;
  formsRestored: boolean;
  attachmentsAdded: number;
  /** Number of documents whose version history was restored. */
  snapshotDocs: number;
  /** Number of unit routing overrides merged in. */
  routingRulesAdded: number;
}

// ---------------------------------------------------------------------------
// Pure merge helpers (unit-tested; no store/IDB access)
// ---------------------------------------------------------------------------

/**
 * Non-destructive record merge keyed by object key: adds entries from `backup`
 * whose key is absent locally, and NEVER overwrites an existing local entry.
 * This is the fix for the old `importProfiles` shallow spread, which let a
 * restored backup silently clobber a profile you'd edited since.
 */
export function mergeRecord<T>(
  current: Record<string, T>,
  backup: Record<string, T> | undefined | null,
): { merged: Record<string, T>; added: number } {
  const merged = { ...current };
  let added = 0;
  if (backup && typeof backup === 'object') {
    for (const [key, value] of Object.entries(backup)) {
      if (!(key in merged)) {
        merged[key] = value;
        added++;
      }
    }
  }
  return { merged, added };
}

/** Non-destructive array merge by `id`: appends only backup items whose id is new. */
export function mergeById<T extends { id: string }>(
  current: T[],
  backup: T[] | undefined | null,
): { merged: T[]; added: number } {
  if (!Array.isArray(backup)) return { merged: current, added: 0 };
  const have = new Set(current.map((x) => x.id));
  const add = backup.filter((x) => x && typeof x.id === 'string' && !have.has(x.id));
  return { merged: add.length ? [...current, ...add] : current, added: add.length };
}

/**
 * Every distinct enclosure attachment id referenced by a set of document
 * records, so a backup embeds exactly the blobs its documents point at (no
 * orphaned bytes from since-removed enclosures). Tolerant of the loose
 * `unknown[]` shape that comes back from a parsed library file.
 */
export function collectAttachmentIds(docs: unknown[]): string[] {
  const ids = new Set<string>();
  for (const doc of docs) {
    const session = (doc as { session?: { enclosures?: unknown; formData?: { basicLetterFileRef?: { id?: unknown } } } })?.session;
    const enclosures = session?.enclosures;
    if (Array.isArray(enclosures)) {
      for (const enc of enclosures) {
        const id = (enc as { fileRef?: { id?: unknown } })?.fileRef?.id;
        if (typeof id === 'string' && id) ids.add(id);
      }
    }
    // An endorsement's basic-letter PDF is an attachment too — embed its bytes.
    const blId = session?.formData?.basicLetterFileRef?.id;
    if (typeof blId === 'string' && blId) ids.add(blId);
  }
  return [...ids];
}

/**
 * Non-destructive merge of two version-history rings for one document: union by
 * timestamp (the capture instant is the identity), newest-first, capped at
 * MAX_SNAPSHOTS. Restoring a backup adds its history WITHOUT dropping any local
 * snapshots you've taken since — same philosophy as every other merge here. A
 * timestamp present in both keeps the local copy (backup can't clobber newer
 * work). Malformed entries (no numeric ts) are dropped.
 */
export function mergeSnapshots(
  current: DocSnapshot[] | undefined | null,
  backup: DocSnapshot[] | undefined | null,
): DocSnapshot[] {
  const byTs = new Map<number, DocSnapshot>();
  // Backup first, then local — so a local snapshot at the same ts wins the slot.
  for (const s of Array.isArray(backup) ? backup : []) {
    if (s && typeof s.ts === 'number') byTs.set(s.ts, s);
  }
  for (const s of Array.isArray(current) ? current : []) {
    if (s && typeof s.ts === 'number') byTs.set(s.ts, s);
  }
  return [...byTs.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_SNAPSHOTS);
}

/** Parse + shape-check a backup file; returns the discriminated kind. */
export function classifyBackup(json: string): { kind: string; parsed: Record<string, unknown> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That file isn't valid JSON");
  }
  const kind = (parsed as { kind?: unknown })?.kind;
  if (kind !== BACKUP_KIND && kind !== LIBRARY_KIND) {
    throw new Error('Not a DonDocs backup file');
  }
  return { kind: kind as string, parsed: parsed as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Build / restore (store-wired)
// ---------------------------------------------------------------------------

/** Serialize the entire account to a single JSON backup string. */
export async function buildBackup(): Promise<string> {
  // Reuse the document exporter — it throws if the registry is unreadable, so
  // a broken DB can't produce a half-empty backup that looks complete.
  const libraryJson = await exportLibrary();
  const { docs } = JSON.parse(libraryJson) as { docs: unknown[] };

  // Per-document version history: pull each backed-up doc's snapshot ring so a
  // restore on a fresh machine brings back "restore an earlier version", not
  // just the current state.
  const snapshots: Record<string, DocSnapshot[]> = {};
  for (const doc of docs) {
    const id = (doc as { id?: unknown })?.id;
    if (typeof id !== 'string') continue;
    const ring = await idbGetSnapshots(id);
    if (ring.length) snapshots[id] = ring;
  }

  // Enclosure file bytes: pull exactly the blobs referenced by the backed-up
  // documents AND by their snapshots (a snapshot can reference an attachment the
  // current doc no longer does — that blob is kept alive by the GC and must ride
  // along so the restored history can rehydrate its file). DocSnapshot has the
  // same `.session.enclosures` shape collectAttachmentIds reads.
  const snapshotEntries = Object.values(snapshots).flat();
  const attachments: BackupAttachment[] = [];
  for (const id of collectAttachmentIds([...docs, ...snapshotEntries])) {
    const rec = await idbGetAttachment(id);
    if (!rec) continue; // a missing blob just means that enclosure won't restore its file
    attachments.push({
      id: rec.id,
      name: rec.name,
      type: rec.type,
      size: rec.size,
      data: uint8ArrayToBase64(arrayBufferToUint8Array(rec.data)),
    });
  }

  const profile = useProfileStore.getState();
  const form = useFormStore.getState();
  const bundle: BackupBundle = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    documents: docs,
    profiles: { profiles: profile.profiles, selectedProfile: profile.selectedProfile },
    forms: { navmc10274: form.navmc10274, navmc11811: form.navmc11811 },
    snippets: useSnippetsStore.getState().snippets,
    userTemplates: useUserTemplatesStore.getState().templates,
    attachments,
    snapshots,
    routingOverrides: useRoutingStore.getState().overrides,
  };
  return JSON.stringify(bundle);
}

// Set for the duration of a restore so the attachment GC sweep stands down.
// A restore writes documents BEFORE their blobs (below), so at every instant a
// written blob already has a referencing doc and would survive a sweep anyway —
// this flag is belt-and-suspenders against any future reordering of the steps.
let restoreInProgress = false;

/** True while {@link restoreBackup} is running. Read by the attachment GC. */
export function isRestoreInProgress(): boolean {
  return restoreInProgress;
}

/**
 * Restore a backup file. Branches on `kind` (not version) so legacy docs-only
 * `dondocs-library` files keep working. Collections merge non-destructively;
 * the single live NAVMC form buffer is replaced (an explicit restore should
 * bring back the backed-up form fields).
 */
export async function restoreBackup(json: string): Promise<RestoreResult> {
  restoreInProgress = true;
  try {
    return await runRestore(json);
  } finally {
    restoreInProgress = false;
  }
}

async function runRestore(json: string): Promise<RestoreResult> {
  const { kind, parsed } = classifyBackup(json);

  // Legacy docs-only file → delegate to the conflict-aware document merge.
  if (kind === LIBRARY_KIND) {
    const documents = await importLibrary(json);
    return { documents, profilesAdded: 0, snippetsAdded: 0, templatesAdded: 0, formsRestored: false, attachmentsAdded: 0, snapshotDocs: 0, routingRulesAdded: 0 };
  }

  // Documents: importLibrary expects `{ docs }`; the v2 bundle stores them under
  // `documents`. Reuse its newer-wins merge + safety guards.
  const documents = Array.isArray(parsed.documents)
    ? await importLibrary(JSON.stringify({ docs: parsed.documents }))
    : { imported: 0, skipped: 0 };

  // Profiles (+ signatures): non-destructive merge; adopt a selectedProfile only
  // if we currently have none.
  let profilesAdded = 0;
  const backupProfiles = (parsed.profiles as BackupBundle['profiles'] | undefined)?.profiles;
  if (backupProfiles) {
    useProfileStore.setState((s) => {
      const { merged, added } = mergeRecord(s.profiles, backupProfiles);
      profilesAdded = added;
      const backupSelected = (parsed.profiles as BackupBundle['profiles']).selectedProfile;
      return {
        profiles: merged,
        selectedProfile: s.selectedProfile ?? (typeof backupSelected === 'string' ? backupSelected : null),
      };
    });
  }

  // Snippets: add by id.
  let snippetsAdded = 0;
  useSnippetsStore.setState((s) => {
    const { merged, added } = mergeById(s.snippets, parsed.snippets as Snippet[] | undefined);
    snippetsAdded = added;
    return { snippets: merged };
  });

  // User templates: add by id.
  let templatesAdded = 0;
  useUserTemplatesStore.setState((s) => {
    const { merged, added } = mergeRecord(s.templates, parsed.userTemplates as Record<string, UserTemplate> | undefined);
    templatesAdded = added;
    return { templates: merged };
  });

  // Unit routing overrides: a shared config wins on conflicts (an admin chief's
  // backup is the authority for the command's routing); local-only entries stay.
  let routingRulesAdded = 0;
  const incomingRouting = sanitizeOverrides(parsed.routingOverrides);
  if (Object.keys(incomingRouting).length > 0) {
    useRoutingStore.setState((s) => {
      const merged = { ...s.overrides };
      for (const [id, dest] of Object.entries(incomingRouting)) {
        if (merged[id] !== dest) {
          merged[id] = dest;
          routingRulesAdded++;
        }
      }
      return { overrides: merged };
    });
  }

  // Live NAVMC form buffer: single state, replaced when the backup carries it.
  let formsRestored = false;
  const forms = parsed.forms as BackupBundle['forms'] | undefined;
  if (forms && (forms.navmc10274 || forms.navmc11811)) {
    useFormStore.setState((s) => ({
      navmc10274: (forms.navmc10274 as typeof s.navmc10274) ?? s.navmc10274,
      navmc11811: (forms.navmc11811 as typeof s.navmc11811) ?? s.navmc11811,
    }));
    formsRestored = true;
  }

  // Enclosure attachments: content is immutable per id, so add any the local DB
  // doesn't already have and leave existing ones untouched (idempotent re-import).
  let attachmentsAdded = 0;
  const backupAttachments = parsed.attachments;
  if (Array.isArray(backupAttachments)) {
    for (const a of backupAttachments as BackupAttachment[]) {
      if (!a || typeof a.id !== 'string' || typeof a.data !== 'string') continue;
      if (await idbGetAttachment(a.id)) continue; // already have these bytes
      const rec: StoredAttachment = {
        id: a.id,
        name: typeof a.name === 'string' ? a.name : '',
        type: typeof a.type === 'string' ? a.type : '',
        size: typeof a.size === 'number' ? a.size : 0,
        data: base64ToUint8Array(a.data).buffer as ArrayBuffer,
      };
      if (await idbPutAttachment(rec)) attachmentsAdded++;
    }
  }

  // Version history: merge each backed-up ring into any local ring for that doc
  // (never dropping local snapshots), then write it back. Absent on v2/v3
  // bundles → skipped. Done after attachments so a restored snapshot's enclosure
  // bytes are already on disk.
  let snapshotDocs = 0;
  const backupSnapshots = parsed.snapshots;
  if (backupSnapshots && typeof backupSnapshots === 'object') {
    for (const [docId, snaps] of Object.entries(backupSnapshots as Record<string, unknown>)) {
      if (!Array.isArray(snaps)) continue;
      const existing = await idbGetSnapshots(docId);
      const merged = mergeSnapshots(existing, snaps as DocSnapshot[]);
      if (merged.length && (await idbSetSnapshots(docId, merged))) snapshotDocs++;
    }
  }

  return { documents, profilesAdded, snippetsAdded, templatesAdded, formsRestored, attachmentsAdded, snapshotDocs, routingRulesAdded };
}

/** One-line human summary of a restore, for the save-status toast. */
export function summarizeRestore(r: RestoreResult): string {
  const parts: string[] = [];
  parts.push(`${r.documents.imported} doc${r.documents.imported === 1 ? '' : 's'}`);
  if (r.profilesAdded) parts.push(`${r.profilesAdded} profile${r.profilesAdded === 1 ? '' : 's'}`);
  if (r.snippetsAdded) parts.push(`${r.snippetsAdded} snippet${r.snippetsAdded === 1 ? '' : 's'}`);
  if (r.templatesAdded) parts.push(`${r.templatesAdded} template${r.templatesAdded === 1 ? '' : 's'}`);
  if (r.attachmentsAdded) parts.push(`${r.attachmentsAdded} attachment${r.attachmentsAdded === 1 ? '' : 's'}`);
  if (r.snapshotDocs) parts.push('version history');
  if (r.formsRestored) parts.push('form fields');
  if (r.routingRulesAdded) parts.push(`${r.routingRulesAdded} routing rule${r.routingRulesAdded === 1 ? '' : 's'}`);
  const kept = r.documents.skipped > 0 ? ` · kept ${r.documents.skipped} newer` : '';
  return `Restored ${parts.join(', ')}${kept}`;
}
