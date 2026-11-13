import { hasReviewComments } from './reviewComments';
import { resolveSignature } from './signatureAssets';
import { materializeSignatureFallbacks, materializeSignatureFallback, materializeFormSignatureFallbacks } from './signatureCompatibility';
import { readAttachment, withAttachmentStaging } from './attachments';
import { copyAttachment, withAttachmentResources } from './attachmentResources';
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
 * with newer-wins document merging. Explicit restore replaces the two live
 * NAVMC buffers when present; those buffers have no per-draft timestamps.
 *
 * Everything here is a local browser operation (JSON build + merge into
 * localStorage/IndexedDB) — no network, air-gap safe.
 */
import { lastWriteFailed } from '@/lib/compressedStorage';
import { validateBackup, validateBackupSession, MAX_BACKUP_BYTES } from './backupValidation';
import type { Profile } from '@/types/document';
import { captureDocumentTarget, isCurrentDocumentTarget, useDocumentsStore, exportLibrary, importLibrary, validateLibraryDocuments } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useProfileStore } from '@/stores/profileStore';
import { useFormStore, FORMS_PERSIST_KEY, normalizeNavmc10274, normalizeNavmc11811 } from '@/stores/formStore';
import { useSnippetsStore, type Snippet } from '@/stores/snippetsStore';
import { useUserTemplatesStore, type UserTemplate } from '@/stores/userTemplatesStore';
import { useRoutingStore, sanitizeOverrides } from '@/stores/routingStore';
import {
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
export const BACKUP_VERSION = 6;
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
  forms: { navmc10274: unknown; navmc11811: unknown; includeCoverPage?: boolean; configFormValues?: unknown; configFormRows?: unknown };
  snippets: Snippet[];
  userTemplates: Record<string, UserTemplate>;
  attachments: BackupAttachment[];
  /** Per-document version-history rings, keyed by document id. */
  snapshots: Record<string, DocSnapshot[]>;
  /** Unit-specific AA-form routing overrides, keyed by action-type id. */
  routingOverrides?: Record<string, string>;
}

export interface RestoreResult {
  documents: { imported: number; skipped: number; issues?: string[] };
  issues?: string[];
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
 * Every distinct attachment id referenced by a set of document records --
 * enclosures, a publication's figure images and an endorsement's basic letter
 * -- so a backup embeds exactly the blobs its documents point at (no orphaned
 * bytes from since-removed enclosures). Tolerant of the loose `unknown[]`
 * shape that comes back from a parsed library file.
 */
export function collectAttachmentIds(docs: unknown[]): string[] {
  const ids = new Set<string>();
  for (const doc of docs) {
    const session = (doc as { session?: { enclosures?: unknown; paragraphs?: unknown; forms?: Record<string, { signatureBlocks?: Array<{ imageRef?: { id?: unknown } }> }>; formData?: { signatureImage?: { fileRef?: { id?: unknown } }; basicLetterFileRef?: { id?: unknown } } } })?.session;
    for (const form of Object.values(session?.forms ?? {})) {
      for (const block of form?.signatureBlocks ?? []) if (typeof block.imageRef?.id === 'string') ids.add(block.imageRef.id);
    }
    const enclosures = session?.enclosures;
    if (Array.isArray(enclosures)) {
      for (const enc of enclosures) {
        const id = (enc as { fileRef?: { id?: unknown } })?.fileRef?.id;
        if (typeof id === 'string' && id) ids.add(id);
      }
    }
    // A publication's figures are attachments too, referenced from paragraphs.
    const paragraphs = session?.paragraphs;
    if (Array.isArray(paragraphs)) {
      for (const para of paragraphs) {
        const id = (para as { figure?: { fileRef?: { id?: unknown } } })?.figure?.fileRef?.id;
        if (typeof id === 'string' && id) ids.add(id);
      }
    }
    // An endorsement's basic-letter PDF is an attachment too — embed its bytes.
    const signatureId = session?.formData?.signatureImage?.fileRef?.id;
    if (typeof signatureId === 'string' && signatureId) ids.add(signatureId);
    const blId = session?.formData?.basicLetterFileRef?.id;
    if (typeof blId === 'string' && blId) ids.add(blId);
  }
  return [...ids];
}

/** A legacy attachment flag cannot stand in for bytes in a complete backup. */
function hasUnresolvedEnclosure(entry: unknown): boolean {
  const session = (entry as { session?: { enclosures?: Array<{ hasFile?: boolean; fileRef?: { id?: unknown } }> } })?.session;
  return Array.isArray(session?.enclosures) && session.enclosures.some(enclosure =>
    (enclosure.hasFile || enclosure.fileRef) && (typeof enclosure.fileRef?.id !== 'string' || !enclosure.fileRef.id));
}

function sameAttachmentBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(left), rightBytes = new Uint8Array(right);
  for (let index = 0; index < leftBytes.length; index++) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

/** Shared templates retain their text while deliberately omitting local files. */
function normalizeTemplateEnclosures(templates: Record<string, UserTemplate>): void {
  for (const template of Object.values(templates)) {
    if (Array.isArray(template.session.enclosures)) {
      template.session.enclosures = template.session.enclosures.map(enclosure =>
        enclosure.fileRef ? enclosure : { ...enclosure, hasFile: false });
    }
  }
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
  if (json.length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 100 MB import limit');
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
  const version = (parsed as { version?: unknown }).version;
  if (version !== undefined && (typeof version !== 'number' || !Number.isSafeInteger(version)
    || version < 1 || version > (kind === BACKUP_KIND ? BACKUP_VERSION : 2))) throw new Error('Unsupported backup version');
  return { kind: kind as string, parsed: parsed as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Build / restore (store-wired)
// ---------------------------------------------------------------------------

/** Serialize the entire account to a single JSON backup string. */
let backupExports = 0;
export function isBackupExportInProgress(): boolean { return backupExports > 0; }
export async function buildBackup(): Promise<string> {
  backupExports++;
  try { return await serializeBackup(); } finally { backupExports--; }
}
async function serializeBackup(): Promise<string> {
  const profile = useProfileStore.getState();
  const form = useFormStore.getState();
  const captured = structuredClone<Omit<BackupBundle, 'documents' | 'snapshots' | 'attachments' | 'forms'> & {
    forms: Pick<typeof form, 'navmc10274' | 'navmc11811' | 'includeCoverPage' | 'configFormValues' | 'configFormRows'>;
  }>({
    kind: BACKUP_KIND,
    version: 5,
    exportedAt: Date.now(),
    profiles: { profiles: profile.profiles, selectedProfile: profile.selectedProfile },
    forms: { navmc10274: form.navmc10274, navmc11811: form.navmc11811, includeCoverPage: form.includeCoverPage, configFormValues: form.configFormValues, configFormRows: form.configFormRows },
    snippets: useSnippetsStore.getState().snippets,
    userTemplates: useUserTemplatesStore.getState().templates,
    routingOverrides: useRoutingStore.getState().overrides,
  });
  normalizeTemplateEnclosures(captured.userTemplates);
  const libraryJson = await exportLibrary();
  const { docs } = JSON.parse(libraryJson) as { docs: unknown[] };
  for (const profile of Object.values(captured.profiles.profiles)) {
    const image = await resolveSignature(profile.signatureImage);
    if (image) { const { fileRef: _ref, ...inline } = image; profile.signatureImage = inline; }
  }

  // Per-document version history: pull each backed-up doc's snapshot ring so a
  // restore on a fresh machine brings back "restore an earlier version", not
  // just the current state.
  const snapshots: Record<string, DocSnapshot[]> = {};
  for (const doc of docs) {
    const id = (doc as { id?: unknown })?.id;
    if (typeof id !== 'string') continue;
    const ring = await idbGetSnapshots(id, true);
    if (ring.length) snapshots[id] = await Promise.all(ring.map(async snapshot => ({ ...snapshot, session: await materializeSignatureFallbacks(snapshot.session) })));
  }
  for (const template of Object.values(captured.userTemplates)) template.session = await materializeSignatureFallbacks(template.session);
  captured.forms.navmc10274 = await materializeFormSignatureFallbacks(normalizeNavmc10274(captured.forms.navmc10274));
  captured.forms.navmc11811 = await materializeFormSignatureFallbacks(normalizeNavmc11811(captured.forms.navmc11811));

  const entries = [{ session: { forms: captured.forms } }, ...docs, ...Object.values(snapshots).flat(), ...Object.values(captured.userTemplates)];
  if (entries.some(hasUnresolvedEnclosure)) throw new Error('An enclosure file is missing its saved reference. The backup was not created.');
  const ids = collectAttachmentIds(entries);
  return withAttachmentResources(ids, async resources => {
    const attachments = ids.map(id => {
      const record = copyAttachment(resources, id);
      return { ...record, data: uint8ArrayToBase64(arrayBufferToUint8Array(record.data)) };
    });
    const withComments = docs.some(doc => hasReviewComments((doc as { session: import('@/stores/documentStore').SerializedSession }).session))
      || Object.values(snapshots).some(ring => ring.some(snapshot => hasReviewComments(snapshot.session)))
      || Object.values(captured.userTemplates).some(template => hasReviewComments(template.session));
    const bundle: BackupBundle = { ...captured, version: withComments ? BACKUP_VERSION : 5, documents: docs, snapshots, attachments };
    return JSON.stringify(bundle);
  });
}

// Set for the duration of a restore so the attachment GC sweep stands down.
// Restore stages bytes before publishing their dependent records. Collection
// remains suspended until all independent sections have reported their outcome.
let restoresInProgress = 0;

/** True while {@link restoreBackup} is running. Read by the attachment GC. */
export function isRestoreInProgress(): boolean {
  return restoresInProgress > 0;
}

function captureFormReplacement(): () => boolean {
  const target = captureDocumentTarget();
  const documentBefore = useDocumentStore.getState();
  const formsBefore = useFormStore.getState();
  return () => target ? isCurrentDocumentTarget(target)
    : useDocumentsStore.getState().currentId === null && useDocumentStore.getState() === documentBefore && useFormStore.getState() === formsBefore;
}

/**
 * Restore a backup file. Branches on `kind` (not version) so legacy docs-only
 * `dondocs-library` files keep working. Collections merge non-destructively;
 * the single live NAVMC form buffer is replaced (an explicit restore should
 * bring back the backed-up form fields).
 */
export async function restoreBackup(json: string): Promise<RestoreResult> {
  return restoreWithTarget(json, captureFormReplacement());
}

async function restoreWithTarget(json: string, canReplaceForms: () => boolean): Promise<RestoreResult> {
  restoresInProgress++;
  try {
    return await withAttachmentStaging(() => runRestore(json, canReplaceForms));
  } finally {
    restoresInProgress--;
  }
}

export async function restoreBackupFile(file: Blob): Promise<RestoreResult> {
  const canReplaceForms = captureFormReplacement();
  restoresInProgress++;
  try { return await restoreWithTarget(await file.text(), canReplaceForms); } finally { restoresInProgress--; }
}

async function runRestore(json: string, canReplaceForms: () => boolean): Promise<RestoreResult> {
  const { kind, parsed } = classifyBackup(json);

  if (kind === LIBRARY_KIND) parsed.documents = parsed.docs;
  validateBackup(parsed);
  validateLibraryDocuments(kind === LIBRARY_KIND ? parsed.docs : parsed.documents ?? []);
  const incomingTemplates = (parsed.userTemplates ?? {}) as Record<string, UserTemplate>;
  normalizeTemplateEnclosures(incomingTemplates);

  // Decode every attachment before changing any local state.
  const decoded = new Map<string, ArrayBuffer>();
  if (parsed.attachments !== undefined && !Array.isArray(parsed.attachments)) throw new Error('Invalid attachments');
  for (const a of (parsed.attachments ?? []) as BackupAttachment[]) {
    if (!a || typeof a.id !== 'string' || !a.id || typeof a.data !== 'string' || decoded.has(a.id)) throw new Error('Invalid or duplicate attachment');
    if ((a.name !== undefined && typeof a.name !== 'string')
      || (a.type !== undefined && typeof a.type !== 'string')) {
      throw new Error(`Attachment ${a.id} has invalid metadata`);
    }
    const bytes = base64ToUint8Array(a.data);
    if (typeof a.size !== 'number' || a.size !== bytes.byteLength) throw new Error(`Attachment ${a.id} has an invalid size`);
    decoded.set(a.id, bytes.buffer as ArrayBuffer);
  }
  if (parsed.snapshots !== undefined && (!parsed.snapshots || typeof parsed.snapshots !== 'object' || Array.isArray(parsed.snapshots))) throw new Error('Invalid history');
  for (const [docId, ring] of Object.entries(parsed.snapshots ?? {})) {
    if (!docId || Object.hasOwn(Object.prototype, docId)) throw new Error('Invalid history document identity');
    if (!Array.isArray(ring)) throw new Error('Invalid history ring');
    for (const snapshot of ring) {
      if (!snapshot?.session || !Number.isFinite(snapshot.ts)) throw new Error('Invalid history entry');
      validateBackupSession(snapshot.session);
    }
  }
  const issues: string[] = [];
  const persistCategory = (label: string, write: () => void, key?: string): boolean => {
    try {
      write();
      if (key && lastWriteFailed(key)) throw new Error('Storage write failed');
      return true;
    } catch {
      issues.push(`${label} could not be saved; keep this tab open and retry the backup`);
      return false;
    }
  };

  const unavailable = new Set<string>();
  const available = new Set<string>();
  let attachmentsAdded = 0;
  for (const attachment of (parsed.attachments ?? []) as BackupAttachment[]) {
    const existing = await readAttachment(attachment.id);
    if (existing.status === 'found') {
      if (sameAttachmentBytes(existing.attachment.data, decoded.get(attachment.id)!)) available.add(attachment.id);
      else { unavailable.add(attachment.id); issues.push(`Attachment ${attachment.id} differs from the local copy; kept local bytes`); }
      continue;
    }
    if (existing.status !== 'missing') {
      unavailable.add(attachment.id); issues.push(`Attachment ${attachment.id} could not be read (${existing.status})`); continue;
    }
    const record: StoredAttachment = { id: attachment.id, name: attachment.name ?? '', type: attachment.type ?? '', size: attachment.size, data: decoded.get(attachment.id)! };
    if (await idbPutAttachment(record, true)) { attachmentsAdded++; available.add(attachment.id); }
    else {
      // A concurrent restore may have committed the same immutable asset.
      const retried = await readAttachment(attachment.id);
      if (retried.status === 'found' && sameAttachmentBytes(retried.attachment.data, decoded.get(attachment.id)!)) available.add(attachment.id);
      else { unavailable.add(attachment.id); issues.push(`Attachment ${attachment.id} could not be saved`); }
    }
  }
  const incomingDocuments = parsed.documents ?? [];
  const incomingHistory = (parsed.snapshots ?? {}) as Record<string, DocSnapshot[]>;
  const backupProfiles = (parsed.profiles as BackupBundle['profiles'] | undefined)?.profiles;
  const profileEntry = (profile: Profile) => ({ session: { formData: { signatureImage: profile.signatureImage } } });
  for (const id of collectAttachmentIds([{ session: { forms: parsed.forms } }, ...(incomingDocuments as unknown[]), ...Object.values(incomingHistory).flat(), ...Object.values(incomingTemplates), ...Object.values(backupProfiles ?? {}).map(profileEntry)])) {
    if (available.has(id) || unavailable.has(id)) continue;
    const result = await readAttachment(id);
    if (result.status === 'found') available.add(id);
    else {
      unavailable.add(id);
      issues.push(result.status === 'missing' ? `Attachment ${id} is missing from the backup and local storage` : `Attachment ${id} could not be read (${result.status})`);
    }
  }
  if ([...(incomingDocuments as unknown[]), ...Object.values(incomingHistory).flat(), ...Object.values(incomingTemplates)].some(hasUnresolvedEnclosure)) {
    issues.push('An enclosure file is missing from this backup; its dependent record was not restored');
  }
  const complete = (entry: unknown) => !hasUnresolvedEnclosure(entry) && collectAttachmentIds([entry]).every(id => available.has(id));
  const readyDocuments = (incomingDocuments as unknown[]).filter(complete);
  const documents = await importLibrary(JSON.stringify({ docs: readyDocuments }));
  documents.skipped += (incomingDocuments as unknown[]).length - readyDocuments.length;

  // Profiles (+ signatures): non-destructive merge; adopt a selectedProfile only
  // if we currently have none.
  let profilesAdded = 0;
  if (backupProfiles) {
    const readyProfiles = Object.fromEntries(await Promise.all(Object.entries(backupProfiles)
      .filter(([, profile]) => complete(profileEntry(profile)))
      .map(async ([name, profile]) => [name, { ...profile, signatureImage: await materializeSignatureFallback(profile.signatureImage) }] as const)));
    if (!persistCategory('Profiles', () => {
      useProfileStore.setState((s) => {
        const { merged, added } = mergeRecord(s.profiles, readyProfiles);
        profilesAdded = added;
        const backupSelected = (parsed.profiles as BackupBundle['profiles']).selectedProfile;
        return {
          profiles: merged,
          selectedProfile: s.selectedProfile ?? (typeof backupSelected === 'string' && Object.hasOwn(merged, backupSelected) ? backupSelected : null),
        };
      });
    })) profilesAdded = 0;
  }

  // Snippets: add by id.
  let snippetsAdded = 0;
  if (!persistCategory('Snippets', () => {
    useSnippetsStore.setState((s) => {
      const { merged, added } = mergeById(s.snippets, parsed.snippets as Snippet[] | undefined);
      snippetsAdded = added;
      return { snippets: merged };
    });
  })) snippetsAdded = 0;

  // User templates: add by id.
  let templatesAdded = 0;
  const readyTemplates = Object.fromEntries(await Promise.all(Object.entries(incomingTemplates)
    .filter(([, entry]) => complete(entry))
    .map(async ([id, entry]) => [id, { ...entry, session: await materializeSignatureFallbacks(entry.session) }] as const)));
  if (!persistCategory('Templates', () => {
    useUserTemplatesStore.setState((s) => {
      const { merged, added } = mergeRecord(s.templates, readyTemplates);
      templatesAdded = added;
      return { templates: merged };
    });
  })) templatesAdded = 0;

  // Unit routing overrides: a shared config wins on conflicts (an admin chief's
  // backup is the authority for the command's routing); local-only entries stay.
  let routingRulesAdded = 0;
  const incomingRouting = sanitizeOverrides(parsed.routingOverrides);
  if (Object.keys(incomingRouting).length > 0) {
    if (!persistCategory('Routing rules', () => {
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
    }, 'dondocs_routing')) routingRulesAdded = 0;
  }

  // Explicit restore replaces the two live NAVMC buffers, normalizing old fields.
  // configFormValues/
  // configFormRows are dictionaries keyed by form id, one entry per form the
  // user has touched, so they merge non-destructively (add-only-missing, keep
  // local) — a restore must never clobber a config form the user has in
  // progress but the bundle lacks, per this module's contract.
  let formsRestored = false;
  const incomingForms = parsed.forms as BackupBundle['forms'] | undefined;
  const forms = incomingForms && { ...incomingForms,
    ...(incomingForms.navmc10274 ? { navmc10274: await materializeFormSignatureFallbacks(normalizeNavmc10274(incomingForms.navmc10274)) } : {}),
    ...(incomingForms.navmc11811 ? { navmc11811: await materializeFormSignatureFallbacks(normalizeNavmc11811(incomingForms.navmc11811)) } : {}),
  };
  if (forms && (forms.navmc10274 || forms.navmc11811 || forms.configFormValues || forms.configFormRows || typeof forms.includeCoverPage === 'boolean')) {
    if (!complete({ session: { forms } })) issues.push('Form fields were not replaced because a signature asset is unavailable');
    else if (!canReplaceForms()) issues.push('Form fields were not replaced because the open document changed during restore');
    else formsRestored = persistCategory('Form fields', () => {
      useFormStore.setState((s) => ({
        navmc10274: forms.navmc10274 ? normalizeNavmc10274(forms.navmc10274 as Partial<typeof s.navmc10274>) : s.navmc10274,
        navmc11811: forms.navmc11811 ? normalizeNavmc11811(forms.navmc11811 as Partial<typeof s.navmc11811>) : s.navmc11811,
        includeCoverPage: typeof forms.includeCoverPage === 'boolean' ? forms.includeCoverPage : s.includeCoverPage,
        configFormValues: mergeRecord(s.configFormValues, forms.configFormValues as typeof s.configFormValues).merged,
        configFormRows: mergeRecord(s.configFormRows, forms.configFormRows as typeof s.configFormRows).merged,
      }));
    }, FORMS_PERSIST_KEY);
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
      const readySnapshots = await Promise.all((snaps as DocSnapshot[]).filter(complete).map(async snapshot => ({ ...snapshot, session: await materializeSignatureFallbacks(snapshot.session) })));
      if (readySnapshots.length) {
        if (await idbSetSnapshots(docId, readySnapshots, true)) snapshotDocs++;
        else issues.push(`History for ${docId} could not be saved`);
      }
    }
  }

  issues.push(...(documents.issues ?? []));
  return { documents, profilesAdded, snippetsAdded, templatesAdded, formsRestored, attachmentsAdded, snapshotDocs, routingRulesAdded, ...(issues.length ? { issues } : {}) };
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
  const issues = r.issues ?? r.documents.issues ?? [];
  return issues.length ? `Partially restored ${parts.join(', ')}${kept}. ${issues.join('; ')}. Keep the backup and retry.` : `Restored ${parts.join(', ')}${kept}`;
}
