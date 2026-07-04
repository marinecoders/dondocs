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
import { idbGetAttachment, idbPutAttachment, type StoredAttachment } from '@/lib/documentsDb';
import { uint8ArrayToBase64, base64ToUint8Array, arrayBufferToUint8Array } from '@/lib/encoding';

export const BACKUP_KIND = 'dondocs-backup';
// v3 adds `attachments` (enclosure file bytes). Restore branches on `kind`, not
// version, so a v2 bundle (no attachments) still restores cleanly.
export const BACKUP_VERSION = 3;
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
}

export interface RestoreResult {
  documents: { imported: number; skipped: number };
  profilesAdded: number;
  snippetsAdded: number;
  templatesAdded: number;
  formsRestored: boolean;
  attachmentsAdded: number;
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
    const enclosures = (doc as { session?: { enclosures?: unknown } })?.session?.enclosures;
    if (!Array.isArray(enclosures)) continue;
    for (const enc of enclosures) {
      const id = (enc as { fileRef?: { id?: unknown } })?.fileRef?.id;
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  return [...ids];
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

  // Enclosure file bytes: pull exactly the blobs the backed-up documents point
  // at, base64-encoded to ride inside the single JSON file (the same encoding
  // the single-draft export already uses for enclosures).
  const attachments: BackupAttachment[] = [];
  for (const id of collectAttachmentIds(docs)) {
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
  };
  return JSON.stringify(bundle);
}

/**
 * Restore a backup file. Branches on `kind` (not version) so legacy docs-only
 * `dondocs-library` files keep working. Collections merge non-destructively;
 * the single live NAVMC form buffer is replaced (an explicit restore should
 * bring back the backed-up form fields).
 */
export async function restoreBackup(json: string): Promise<RestoreResult> {
  const { kind, parsed } = classifyBackup(json);

  // Legacy docs-only file → delegate to the conflict-aware document merge.
  if (kind === LIBRARY_KIND) {
    const documents = await importLibrary(json);
    return { documents, profilesAdded: 0, snippetsAdded: 0, templatesAdded: 0, formsRestored: false, attachmentsAdded: 0 };
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

  return { documents, profilesAdded, snippetsAdded, templatesAdded, formsRestored, attachmentsAdded };
}

/** One-line human summary of a restore, for the save-status toast. */
export function summarizeRestore(r: RestoreResult): string {
  const parts: string[] = [];
  parts.push(`${r.documents.imported} doc${r.documents.imported === 1 ? '' : 's'}`);
  if (r.profilesAdded) parts.push(`${r.profilesAdded} profile${r.profilesAdded === 1 ? '' : 's'}`);
  if (r.snippetsAdded) parts.push(`${r.snippetsAdded} snippet${r.snippetsAdded === 1 ? '' : 's'}`);
  if (r.templatesAdded) parts.push(`${r.templatesAdded} template${r.templatesAdded === 1 ? '' : 's'}`);
  if (r.attachmentsAdded) parts.push(`${r.attachmentsAdded} attachment${r.attachmentsAdded === 1 ? '' : 's'}`);
  if (r.formsRestored) parts.push('form fields');
  const kept = r.documents.skipped > 0 ? ` · kept ${r.documents.skipped} newer` : '';
  return `Restored ${parts.join(', ')}${kept}`;
}
