import { create } from 'zustand';
import {
  idbGetAllDocuments,
  idbGetBackupHandle,
  idbSetBackupHandle,
  idbClearBackupHandle,
} from '@/lib/documentsDb';
import { debug } from '@/lib/debug';

/**
 * Synced backup file (File System Access API). The user picks a file once; its
 * handle is persisted in IndexedDB (handles are structured-cloneable) so the
 * link survives reloads and restarts. Every registry save is mirrored to that
 * file, so it's always the latest copy — drop it in a synced folder for
 * cross-machine backup, all without a server.
 *
 * Chromium-desktop only. Elsewhere the status is 'unsupported' and the manual
 * "Back up all documents" export remains the fallback. Browsers require a fresh
 * user gesture to re-grant write access after a full restart ('needs-permission').
 * 'error' = the file can't be written (moved/deleted/locked/disk-full) or the
 * registry can't be read — surfaced instead of silently letting the mirror go
 * stale; later saves keep retrying and a success flips back to 'connected'.
 */
export type BackupStatus = 'off' | 'connected' | 'needs-permission' | 'error' | 'unsupported';

const isSupported =
  typeof window !== 'undefined' && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';

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

// Same shape exportLibrary() writes, built here to avoid importing documentsStore
// (which imports this module) — a leaf dependency on documentsDb instead.
// Returns null when the registry can't be read: mirroring a failed read would
// overwrite the user's one external safety copy with an empty library.
async function buildLibraryJson(): Promise<string | null> {
  const records = await idbGetAllDocuments();
  if (records === null) return null;
  return JSON.stringify({ kind: 'dondocs-library', version: 1, docs: records });
}

async function writeToHandle(handle: FileSystemFileHandle, json: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(json);
  await writable.close();
}

// The live handle lives outside the store (not serializable UI state).
let handleRef: FileSystemFileHandle | null = null;

interface BackupState {
  status: BackupStatus;
  fileName: string | null;
  lastBackupAt: number | null;
  /** On app load: reconnect a previously-chosen file from IndexedDB. */
  init: () => Promise<void>;
  /** User gesture: choose a file to auto-back-up to, then seed it. */
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
  lastBackupAt: null,

  init: async () => {
    if (!isSupported) return;
    const handle = await idbGetBackupHandle();
    if (!handle) return;
    handleRef = handle;
    const perm = await queryPerm(handle);
    set({ fileName: handle.name, status: perm === 'granted' ? 'connected' : 'needs-permission' });
  },

  setupBackup: async () => {
    if (!isSupported) return;
    try {
      const picker = (window as unknown as {
        showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker;
      const handle = await picker({
        suggestedName: 'dondocs-library.json',
        types: [{ description: 'DonDocs library', accept: { 'application/json': ['.json'] } }],
      });
      handleRef = handle;
      await idbSetBackupHandle(handle);
      set({ fileName: handle.name, status: 'connected' });
      await get().writeNow();
    } catch (err) {
      // AbortError = the user dismissed the file picker; that's not a failure.
      if ((err as Error)?.name !== 'AbortError') debug.error('Backup', 'setup failed', err);
    }
  },

  reconnect: async () => {
    if (!handleRef) return;
    try {
      const perm = await requestPerm(handleRef);
      if (perm === 'granted') {
        set({ status: 'connected' });
        await get().writeNow();
      }
    } catch (err) {
      debug.error('Backup', 'reconnect failed', err);
    }
  },

  disable: async () => {
    handleRef = null;
    await idbClearBackupHandle();
    set({ status: isSupported ? 'off' : 'unsupported', fileName: null, lastBackupAt: null });
  },

  writeNow: async () => {
    const status = get().status;
    // 'error' stays writable so the next save retries and can self-heal.
    if ((status !== 'connected' && status !== 'error') || !handleRef) return;
    try {
      const perm = await queryPerm(handleRef);
      if (perm !== 'granted') {
        set({ status: 'needs-permission' });
        return;
      }
      const json = await buildLibraryJson();
      if (json === null) {
        // Registry read failed — keep the existing backup file intact and do NOT
        // advance lastBackupAt; claiming success here would be a lie.
        debug.error('Backup', 'library read failed — skipped backup write');
        set({ status: 'error' });
        return;
      }
      await writeToHandle(handleRef, json);
      set({ lastBackupAt: Date.now(), status: 'connected' });
    } catch (err) {
      // Permission revoked mid-write reads as NotAllowedError; everything else
      // (file moved/deleted/locked, disk full) is a write fault. Either way the
      // mirror stopped updating — say so instead of staying 'connected'.
      const name = (err as Error)?.name;
      set({ status: name === 'NotAllowedError' || name === 'SecurityError' ? 'needs-permission' : 'error' });
      debug.error('Backup', 'write failed', err);
    }
  },
}));

// Debounced auto-backup, teed off every registry save (see documentsStore).
let backupTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleBackup(): void {
  const status = useBackupStore.getState().status;
  // Keep scheduling through 'error' so a transient fault (file briefly locked
  // by a sync client, disk momentarily full) heals on the next save.
  if (status !== 'connected' && status !== 'error') return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    void useBackupStore.getState().writeNow();
  }, 1500);
}
