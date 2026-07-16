/**
 * Enclosure attachment garbage collection.
 *
 * Enclosure file bytes are written to the IndexedDB `attachments` store on
 * attach (see {@link file://./attachments.ts}) but nothing ever removed them:
 * deleting a document, replacing an enclosure's file, or removing an enclosure
 * all strand the old blob. On an offline PWA where storage quota is the whole
 * ballgame — we warn the user when it runs low — leaked blobs are a real defect.
 *
 * This is a mark-and-sweep collector, not eager per-operation deletion, because
 * eager deletion can't cope with the app's realities: document deletes are
 * 6s-undoable, and an in-session enclosure edit doesn't rewrite the persisted
 * document until the next debounced save. A periodic reachability sweep is
 * robust to every orphaning path, including a crash mid-operation.
 *
 * THE MARK SET is the union of every `fileRef.id` reachable from:
 *   (a) every persisted document's session enclosures,
 *   (b) every persisted document's version-history snapshot ring — snapshots
 *       serialize the full session, so a blob referenced only by undo-history
 *       must survive (missing this corrupts "restore an earlier version"),
 *   (c) the live in-memory session — a just-attached blob whose document save
 *       is still debounced is referenced here and nowhere on disk yet,
 *   (d) documents staged for an undoable delete — an undo re-persists them, so
 *       their blobs must not be reaped inside the 6s window.
 *
 * SAFETY — the sweep aborts and deletes NOTHING when it can't fully build the
 * mark set: `idbGetAllDocuments()` returning null means the read FAILED (as
 * opposed to an empty registry), and treating a failed read as "no documents
 * reference anything" would wipe every live blob. Same rule for the attachment
 * read. This mirrors the established read-failure-≠-empty invariant across the
 * storage layer. It also skips entirely while a backup restore is in flight
 * (restore writes documents before their blobs; the guard is belt-and-suspenders
 * on top of that ordering).
 *
 * All local browser operations — no network, air-gap safe.
 */
import {
  idbGetAllDocuments,
  idbGetSnapshots,
  idbGetAllAttachments,
  idbDeleteAttachment,
} from '@/lib/documentsDb';
import type { SerializedSession } from '@/stores/documentStore';
import { useDocumentStore } from '@/stores/documentStore';
import { getPendingDeleteSessions, useDocumentsStore } from '@/stores/documentsStore';
import { isRestoreInProgress } from '@/lib/backup';
import { debug } from '@/lib/debug';

/** Every enclosure `fileRef.id` plus the basic-letter ref in one session. */
function collectSessionRefs(session: SerializedSession | undefined, into: Set<string>): void {
  // An endorsement's basic-letter PDF is stored as an attachment; keep it
  // reachable so the GC doesn't sweep it out from under a saved endorsement.
  const blId = session?.formData?.basicLetterFileRef?.id;
  if (typeof blId === 'string' && blId) into.add(blId);

  const enclosures = session?.enclosures;
  if (!Array.isArray(enclosures)) return;
  for (const enc of enclosures) {
    const id = enc?.fileRef?.id;
    if (typeof id === 'string' && id) into.add(id);
  }
}

/**
 * Build the set of attachment ids still reachable from anywhere. Returns null
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
 * The union is a superset of both, so no live, backed-up, or cross-tab blob is
 * ever a sweep target.
 */
export async function collectLiveAttachmentIds(): Promise<Set<string> | null> {
  const persisted = await idbGetAllDocuments();
  if (persisted === null) return null; // read failure — refuse to sweep on partial knowledge

  const live = new Set<string>();

  // (a) registry documents — union of persisted (IDB) and in-memory, keyed by id
  // so a doc present in both is visited once for its snapshot ring.
  const inMemory = Object.values(useDocumentsStore.getState().docs);
  const sessionsById = new Map<string, SerializedSession>();
  for (const doc of persisted) sessionsById.set(doc.id, doc.session);
  for (const entry of inMemory) sessionsById.set(entry.meta.id, entry.session);

  for (const [id, session] of sessionsById) {
    collectSessionRefs(session, live);
    // (b) the document's version-history snapshot ring.
    const snaps = await idbGetSnapshots(id); // [] on read failure — best-effort per doc
    for (const snap of snaps) collectSessionRefs(snap.session, live);
  }

  // (c) the live in-memory session — a just-attached blob lives here before its
  // debounced document save reaches the registry.
  collectSessionRefs(
    { enclosures: useDocumentStore.getState().enclosures } as SerializedSession,
    live
  );

  // (d) documents staged for an undoable delete — an undo re-persists them.
  for (const session of getPendingDeleteSessions()) collectSessionRefs(session, live);

  return live;
}

let sweeping = false;

/**
 * Reclaim every attachment blob not in the live set. Returns the number
 * deleted, or null when the sweep was skipped/aborted (already running, restore
 * in flight, or an unreadable store) — in every null case the store is left
 * exactly as found.
 */
export async function sweepOrphanedAttachments(): Promise<number | null> {
  if (sweeping) return null; // serialize concurrent triggers (startup + a purge)
  if (isRestoreInProgress()) return null; // never race a restore's doc→blob write order
  sweeping = true;
  try {
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
    for (const orphan of orphans) await idbDeleteAttachment(orphan.id);
    if (orphans.length > 0) {
      debug.log('AttachmentGc', `reclaimed ${orphans.length} orphaned attachment(s)`);
    }
    return orphans.length;
  } catch (err) {
    debug.error('AttachmentGc', 'sweep failed', err);
    return null;
  } finally {
    sweeping = false;
  }
}
