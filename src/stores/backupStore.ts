import { create } from 'zustand';
import {
  idbGetBackupHandle,
  idbSetBackupHandle,
  idbClearBackupHandle,
} from '@/lib/documentsDb';
import { buildBackup } from '@/lib/backup';
import { WorkspaceBackupTooLargeError } from '@/lib/backupSize';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { debug } from '@/lib/debug';

/**
 * Synced backup file (File System Access API). The user picks a folder once.
 * The file handle is persisted in IndexedDB so the
 * link survives reloads and restarts. Every registry save is mirrored to that
 * file, so it's always the latest copy — drop it in a synced folder for
 * cross-machine backup, all without a server.
 *
 * The mirror is a full-account bundle (the same one "Download workspace backup"
 * downloads): documents, profiles + signatures, snippets, user templates, the
 * live NAVMC form fields, and enclosure file bytes. A restore from this file
 * therefore brings back everything, not just documents.
 *
 * Chromium-desktop only. Elsewhere the status is 'unsupported' and the manual
 * "Download workspace backup" export remains the fallback. Browsers require a fresh
 * user gesture to re-grant write access after a full restart ('needs-permission').
 * 'error' = the file can't be written (moved/deleted/locked/disk-full) or the
 * account can't be read. 'too-large' preserves the previous file when the new
 * snapshot exceeds the restore limit. Both surface a stale mirror, and a
 * later successful save flips the status back to 'connected'.
 */
export type BackupStatus = 'off' | 'connected' | 'needs-permission' | 'error' | 'too-large' | 'unsupported';

/** The recovery action shown alongside the mirror status. */
type BackupAction = 'reconnect' | 'setup' | 'retry' | 'options';

/**
 * Which one this situation actually calls for. Kept here, and pure, so the
 * notice strip and the save chip cannot offer different answers to the same
 * state — and so the reasoning is testable without rendering anything.
 *
 * The distinction that matters: only a file that is genuinely missing is fixed
 * by choosing another one. A write the system refused — ransomware protection
 * or a policy standing between the browser and that folder — leaves the file
 * perfectly good, and sending the user back to the file picker there teaches
 * them to re-map something that was never broken.
 */
export function backupAction(status: BackupStatus, fileMissing: boolean): BackupAction | null {
  if (status === 'needs-permission') return 'reconnect';
  if (status === 'off') return 'setup';
  if (status === 'error') return fileMissing ? 'setup' : 'retry';
  if (status === 'too-large') return 'options';
  return null; // 'connected' has nothing to fix; 'unsupported' has no way out.
}

function canMirror(status: BackupStatus): boolean {
  return status === 'connected' || status === 'error' || status === 'too-large';
}

const isSupported =
  typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  && typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';

type PermState = 'granted' | 'denied' | 'prompt';
type PermCapableHandle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermState>;
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermState>;
};

async function queryPerm(handle: FileSystemFileHandle): Promise<PermState> {
  const h = handle as PermCapableHandle;
  return h.queryPermission ? h.queryPermission({ mode: 'readwrite' }) : 'granted';
}
async function requestPerm(handle: FileSystemFileHandle): Promise<PermState> {
  const h = handle as PermCapableHandle;
  return h.requestPermission ? h.requestPermission({ mode: 'readwrite' }) : 'granted';
}

// The full-account bundle to mirror. buildBackup() throws when the account can't
// be read (e.g. an unreadable registry) — we convert that to null so the caller
// SKIPS the write: mirroring a failed read would overwrite the user's one
// external safety copy with an incomplete/empty file.
//
// Runtime-only import cycle (backupStore → backup → documentsStore → backupStore):
// every edge is called from inside a function, never at module init, so the
// modules initialize cleanly.
async function buildBackupJson(): Promise<string | null> {
  try {
    return await buildBackup();
  } catch (err) {
    if (err instanceof WorkspaceBackupTooLargeError) throw err;
    debug.error('Backup', 'account read failed — skipped backup write', err);
    return null;
  }
}

/**
 * Whether the backing file is gone — asked directly, not inferred.
 *
 * `getFile()` rejects with NotFoundError once the entry no longer exists, which
 * is a fact about the file. Reading it off the write error instead is a guess:
 * a browser can refuse a write for reasons that say nothing about whether the
 * file is there, and the reverse holds too, so the two questions have to be
 * asked separately.
 */
export async function isFileMissing(handle: FileSystemFileHandle | null): Promise<boolean> {
  if (!handle) return false;
  try {
    await handle.getFile();
    return false;
  } catch (err) {
    return (err as Error)?.name === 'NotFoundError';
  }
}

async function writeToHandle(handle: FileSystemFileHandle, json: string, current: () => boolean): Promise<void> {
  const writable = await handle.createWritable();
  try {
    if (!current()) { await writable.abort?.(); return; }
    await writable.write(json);
    if (!current()) { await writable.abort?.(); return; }
    await writable.close();
  }
  catch (error) {
    try { await writable.abort?.(); } catch { /* Preserve the original write error. */ }
    throw error;
  }
}

/** Stable id so the browser reopens the folder the user chose last time, even
 *  when we no longer hold a handle. Must be <=32 chars of [A-Za-z0-9_-]. */
const PICKER_ID = 'dondocs-backup';

export const DEFAULT_BACKUP_FILE_NAME = 'dondocs-backup.json';

type DirectoryPicker = (options: { id: string; mode: 'readwrite'; startIn?: FileSystemFileHandle }) => Promise<FileSystemDirectoryHandle>;

export async function pickBackupDirectory(picker: DirectoryPicker, previous: FileSystemFileHandle | null): Promise<FileSystemDirectoryHandle> {
  const options = { id: PICKER_ID, mode: 'readwrite' } as const;
  // Start in the parent folder of a previously connected file when possible.
  if (!previous) return picker(options);
  try {
    return await picker({ ...options, startIn: previous });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    debug.error('Backup', 'directory picker rejected startIn; retrying without it', error);
    return picker(options);
  }
}

async function openBackupDestination(directory: FileSystemDirectoryHandle, previous: FileSystemFileHandle | null, current: () => boolean) {
  const preferredName = previous?.name ?? DEFAULT_BACKUP_FILE_NAME;
  const extension = preferredName.match(/\.json$/i)?.[0] ?? '';
  const stem = preferredName.slice(0, preferredName.length - extension.length);
  for (let index = 1; index <= 100; index++) {
    if (!current()) return null;
    const name = index === 1 ? preferredName : `${stem}-${index}${extension}`;
    let existing: FileSystemFileHandle;
    try {
      existing = await directory.getFileHandle(name);
    } catch (error) {
      if ((error as Error).name === 'TypeMismatchError') continue;
      if ((error as Error).name !== 'NotFoundError') throw error;
      return current() ? directory.getFileHandle(name, { create: true }) : null;
    }
    if (previous && await previous.isSameEntry(existing)) return existing;
  }
  throw new Error('This folder has too many backups with the same name. Choose another folder.');
}

// The live handle lives outside the store (not serializable UI state).
let handleRef: FileSystemFileHandle | null = null;
let backupWrites = 0;
export function isBackupWriteInProgress(): boolean { return backupWrites > 0; }
let handleGeneration = 0;
let setupRequest = 0;
let registrySaveGeneration = 0;
const pendingMirrorRequests = new Set<AbortController>();

function advanceHandleGeneration(): number {
  const generation = ++handleGeneration;
  for (const request of pendingMirrorRequests) request.abort();
  return generation;
}

// One mirror owns file writes, including handles that alias the same file.
let pendingWrite: Promise<void> = Promise.resolve();

function queueMirrorOperation(current: () => boolean, run: () => Promise<void>): Promise<void> {
  backupWrites++;
  const request = new AbortController();
  pendingMirrorRequests.add(request);
  const operation = pendingWrite.then(() => {
    if (!current()) return;
    return navigator.locks.request('dondocs-backup-mirror', { mode: 'exclusive', signal: request.signal }, async () => {
      pendingMirrorRequests.delete(request);
      if (current()) await run();
    });
  }).finally(() => { pendingMirrorRequests.delete(request); backupWrites--; });
  pendingWrite = operation.catch(() => {});
  return operation;
}

interface BackupState {
  status: BackupStatus;
  fileName: string | null;
  /** Set only when a failed write was followed by asking the file directly and
   *  finding it gone. Decides whether the way out is a new file or a block to
   *  lift — never assumed from the write error alone. */
  fileMissing: boolean;
  lastBackupAt: number | null;
  setupError: string | null;
  /** On app load: reconnect a previously-chosen file from IndexedDB. */
  init: () => Promise<void>;
  /** User gesture: choose a destination folder, then seed and link its file. */
  setupBackup: () => Promise<void>;
  /** User gesture: re-grant write access after a restart. */
  reconnect: () => Promise<void>;
  /** Stop auto-backup and forget the file. */
  disable: () => Promise<void>;
  /** Mirror the current library to the file now. */
  writeNow: () => Promise<void>;
}

export const useBackupStore = create<BackupState>((set, get) => ({
  status: isSupported ? 'off' : 'unsupported',
  fileName: null,
  fileMissing: false,
  lastBackupAt: null,
  setupError: null,

  init: async () => {
    if (!isSupported) return;
    const generation = advanceHandleGeneration();
    const handle = await idbGetBackupHandle();
    if (!handle || generation !== handleGeneration) return;
    handleRef = handle;
    const perm = await queryPerm(handle);
    if (generation !== handleGeneration) return;
    set({ fileName: handle.name, status: perm === 'granted' ? 'connected' : 'needs-permission' });
  },

  setupBackup: async () => {
    if (!isSupported) return;
    const request = ++setupRequest;
    const current = () => request === setupRequest;
    const previous = handleRef;
    set({ setupError: null });
    try {
      const picker = (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker.bind(window);
      // Opening a Save file picker can truncate an existing file. A directory
      // picker keeps the user gesture and leaves the destination unchanged.
      const directory = await pickBackupDirectory(picker, previous);
      if (!current()) return;
      await queueMirrorOperation(current, async () => {
        const capturedGeneration = registrySaveGeneration;
        const json = await buildBackup();
        if (!current()) return;
        const handle = await openBackupDestination(directory, previous, current);
        if (!handle || !current()) return;
        await writeToHandle(handle, json, current);
        if (!current()) return;
        if (!await idbSetBackupHandle(handle)) {
          throw new Error('The backup file was saved, but this browser could not link it for automatic updates. Try again.');
        }
        if (!current()) return;
        advanceHandleGeneration();
        handleRef = handle;
        set({ fileName: handle.name, status: 'connected', fileMissing: false, lastBackupAt: Date.now() });
        useOnboardingStore.getState().markComplete('first_backup');
        if (capturedGeneration !== registrySaveGeneration) scheduleBackup();
      });
    } catch (error) {
      if (!current() || (error as Error)?.name === 'AbortError') return;
      set({ setupError: error instanceof Error ? error.message : 'Could not set up auto-backup. Try again.' });
      debug.error('Backup', 'setup failed', error);
    }
  },

  reconnect: async () => {
    const handle = handleRef;
    if (!handle) return;
    const generation = handleGeneration;
    try {
      const perm = await requestPerm(handle);
      if (generation !== handleGeneration || handleRef !== handle) return;
      if (perm === 'granted') {
        set({ status: 'connected' });
        await get().writeNow();
      }
    } catch (err) {
      debug.error('Backup', 'reconnect failed', err);
    }
  },

  disable: async () => {
    setupRequest++;
    const generation = advanceHandleGeneration();
    if (backupTimer) clearTimeout(backupTimer);
    handleRef = null;
    await idbClearBackupHandle();
    if (generation !== handleGeneration) return;
    set({ status: isSupported ? 'off' : 'unsupported', fileName: null, lastBackupAt: null, fileMissing: false, setupError: null });
  },

  writeNow: () => {
    const status = get().status;
    const handle = handleRef;
    const generation = handleGeneration;
    if (!canMirror(status) || !handle) return Promise.resolve();
    const current = () => generation === handleGeneration && handleRef === handle;
    return queueMirrorOperation(current, async () => {
      try {
        const perm = await queryPerm(handle);
        if (!current()) return;
        if (perm !== 'granted') { set({ status: 'needs-permission' }); return; }
        const json = await buildBackupJson();
        if (!current()) return;
        if (json === null) { set({ status: 'error', fileMissing: false }); return; }
        await writeToHandle(handle, json, current);
        if (!current()) return;
        set({ lastBackupAt: Date.now(), status: 'connected', fileMissing: false });
        useOnboardingStore.getState().markComplete('first_backup');
      } catch (error) {
        if (!current()) return;
        if (error instanceof WorkspaceBackupTooLargeError) {
          set({ status: 'too-large', fileMissing: false });
          return;
        }
        const name = (error as Error)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') set({ status: 'needs-permission', fileMissing: false });
        else {
          const fileMissing = await isFileMissing(handle);
          if (current()) set({ status: 'error', fileMissing });
        }
        debug.error('Backup', 'write failed', error);
      }
    }).catch(error => {
      if (!current()) return;
      set({ status: 'error', fileMissing: false });
      debug.error('Backup', 'could not acquire mirror ownership', error);
    });
  },
}));

// Debounced auto-backup, teed off every registry save (see documentsStore).
let backupTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleBackup(): void {
  registrySaveGeneration++;
  const status = useBackupStore.getState().status;
  // Keep scheduling so a transient fault or a workspace reduced in size can recover.
  if (!canMirror(status)) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    void useBackupStore.getState().writeNow();
  }, 1500);
}
