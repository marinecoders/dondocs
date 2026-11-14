import { listActionPackages, packageAssets } from './actionPackages';
import { useProfileStore } from '@/stores/profileStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
/**
 * Inventory persisted, live, history, and operation roots before considering
 * attachment collection. Older tabs do not participate in the staging lock,
 * so an apparent orphan is not proof that its bytes can be deleted safely.
 * Reclamation stays deferred until cross-tab ownership can be established.
 */
import {
  idbGetAllDocuments,
  idbGetSnapshots,
  idbGetAllAttachments,
} from '@/lib/documentsDb';
import { useFormStore } from '@/stores/formStore';
import { useBatchStore } from '@/stores/batchStore';
import type { SerializedSession } from '@/stores/documentStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useHistoryStore } from '@/stores/historyStore';
import { getPendingDeleteSessions, useDocumentsStore } from '@/stores/documentsStore';
import { isRestoreInProgress } from '@/lib/backup';
import { debug } from '@/lib/debug';
import { attachmentSweepCheckpoint, withAttachmentSweep } from '@/lib/attachments';
import { listReviewRounds } from './reviewRounds';
import { formTemplateAttachmentId } from './formTemplateAssets';

/** Every enclosure and figure `fileRef.id` plus the basic-letter ref in one session. */
function collectSessionRefs(session: Pick<SerializedSession, 'formData' | 'enclosures' | 'paragraphs' | 'forms' | 'genericForm'> | undefined, into: Set<string>): void {
  for (const page of session?.genericForm?.definition.pages ?? []) if (page.sha256) into.add(formTemplateAttachmentId(page.sha256));
  // An endorsement's basic-letter PDF is stored as an attachment; keep it
  // reachable so the GC doesn't sweep it out from under a saved endorsement.
  for (const form of [session?.forms?.navmc10274, session?.forms?.navmc11811]) {
    for (const block of form?.signatureBlocks ?? []) if (block.imageRef?.id) into.add(block.imageRef.id);
  }
  const signatureId = session?.formData?.signatureImage?.fileRef?.id;
  if (typeof signatureId === 'string' && signatureId) into.add(signatureId);
  const blId = session?.formData?.basicLetterFileRef?.id;
  if (typeof blId === 'string' && blId) into.add(blId);

  // A publication's figure images hang off paragraphs, not the enclosure list.
  // This walk must precede the enclosures guard below: a publication has
  // figures and no enclosures array at all, and returning early left every
  // figure unmarked for the sweep to delete.
  const paragraphs = session?.paragraphs;
  if (Array.isArray(paragraphs)) {
    for (const para of paragraphs) {
      const id = para?.figure?.fileRef?.id;
      if (typeof id === 'string' && id) into.add(id);
    }
  }

  const enclosures = session?.enclosures;
  if (!Array.isArray(enclosures)) return;
  for (const enc of enclosures) {
    const id = enc?.fileRef?.id;
    if (typeof id === 'string' && id) into.add(id);
  }
}

/**
 * Build the set of attachment ids reachable from known roots. Returns null
 * to signal "could not read the registry" — callers MUST treat null as an abort
 * (delete nothing), never as an empty set.
 *
 * The registry is read from BOTH the persisted store AND the in-memory registry,
 * and their union is what's kept. This is load-bearing, not belt-and-suspenders:
 *   - buildBackup() marks attachments from the IN-MEMORY registry (exportLibrary),
 *     which can hold a doc whose IndexedDB write hasn't landed yet (a fresh local
 *     save, a just-made duplicate). Reading only IDB would let the sweep reap a
 *     blob a backup is about to embed — exactly the corruption we must avoid.
 *   - Another tab's save reaches IndexedDB before this tab's in-memory registry
 *     hears about it. Reading only memory would reap that doc's blobs.
 * This union includes known roots; it cannot discover another tab's unsaved history.
 */
export async function collectLiveAttachmentIds(): Promise<Set<string> | null> {
  try { return await collectKnownAttachmentIds(); } catch { return null; }
}
async function collectKnownAttachmentIds(): Promise<Set<string> | null> {
  const persisted = await idbGetAllDocuments();
  if (persisted === null) return null; // read failure — refuse to sweep on partial knowledge

  const live = new Set<string>();
  try {
    for (const record of await listActionPackages()) for (const asset of packageAssets(record)) live.add(asset.id);
    for (const round of await listReviewRounds()) collectSessionRefs(round.baseline.session, live);
  } catch {
    // A missing or unreadable pin inventory is never proof that its files are orphaned.
    return null;
  }
  for (const profile of Object.values(useProfileStore.getState().profiles)) {
    const id = profile.signatureImage?.fileRef?.id;
    if (id) live.add(id);
  }
  const forms = useFormStore.getState();
  collectSessionRefs({ formData: {}, enclosures: [], paragraphs: [], forms: { navmc10274: forms.navmc10274, navmc11811: forms.navmc11811, includeCoverPage: forms.includeCoverPage } }, live);
  const batchSource = useBatchStore.getState().source;
  if (batchSource) collectSessionRefs(batchSource, live);
  for (const template of Object.values(useUserTemplatesStore.getState().templates)) collectSessionRefs(template.session, live);

  // (a) Mark BOTH versions of a document: another tab's saved attachment may
  // differ from this tab's pending edit. Only deduplicate the history reads.
  const inMemory = Object.values(useDocumentsStore.getState().docs);
  for (const doc of persisted) collectSessionRefs(doc.session, live);
  for (const entry of inMemory) collectSessionRefs(entry.session, live);
  const ids = new Set([...persisted.map(doc => doc.id), ...inMemory.map(entry => entry.meta.id)]);
  for (const id of ids) {
    // (b) the document's version-history snapshot ring.
    const snaps = await idbGetSnapshots(id, true).catch(() => null);
    if (snaps === null) return null;
    for (const snap of snaps) collectSessionRefs(snap.session, live);
  }

  // (c) the live in-memory session — a just-attached blob lives here before its
  // debounced document save reaches the registry. formData must ride along:
  // an endorsement's just-uploaded basic letter is referenced only by
  // formData.basicLetterFileRef, and omitting it left a ~2s window where any
  // sweep (e.g. finalizePurge after a document delete) reaped the letter's
  // bytes before the save made them reachable.
  const liveState = useDocumentStore.getState();
  collectSessionRefs(
    { enclosures: liveState.enclosures, formData: liveState.formData, paragraphs: liveState.paragraphs, genericForm: liveState.genericForm },
    live
  );

  // In-session Undo/Redo is finer-grained than the durable version ring. A
  // recently replaced attachment may be owned only by one of these snapshots.
  const history = useHistoryStore.getState();
  for (const snapshot of [...history.past, history.currentSnapshot, ...history.future]) collectSessionRefs(snapshot ?? undefined, live);

  // (d) documents staged for an undoable delete — an undo re-persists them.
  for (const session of getPendingDeleteSessions()) collectSessionRefs(session, live);

  return live;
}

let sweeping = false;

/**
 * Inspect attachment reachability. Returns zero when every blob is rooted,
 * or null when the sweep could not finish (already running, restore
 * or staging in flight, an unreadable store, an invalidated mark set, or
 * apparent orphans whose cross-tab ownership cannot be established).
 */
export async function sweepOrphanedAttachments(): Promise<number | null> {
  if (sweeping) return null; // serialize concurrent triggers (startup + a purge)
  if (isRestoreInProgress()) return null; // never race a restore's doc→blob write order
  const checkpoint = attachmentSweepCheckpoint();
  if (checkpoint === null) return null;
  sweeping = true;
  try {
    return await withAttachmentSweep(async () => {
      const live = await collectLiveAttachmentIds();
      if (live === null) {
        debug.log('AttachmentGc', 'skipped: registry unreadable');
        return null;
      }
      const all = await idbGetAllAttachments();
      if (all === null) {
        debug.log('AttachmentGc', 'skipped: attachments unreadable');
        return null;
      }
      const orphans = all.filter((a) => !live.has(a.id));
      if (attachmentSweepCheckpoint() !== checkpoint) return null;
      // Web Locks coordinate new staging callers, but cannot prove that an
      // older tab has released its in-memory document or history references.
      // Keep candidates until collection has a compatible cross-tab protocol.
      if (orphans.length) {
        debug.log('AttachmentGc', 'deferred: cross-tab ownership is not established');
        return null;
      }
      return 0;
    });
  } catch (err) {
    debug.error('AttachmentGc', 'sweep failed', err);
    return null;
  } finally {
    sweeping = false;
  }
}
