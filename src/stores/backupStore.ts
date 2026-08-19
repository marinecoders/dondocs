import { create } from 'zustand';
import {
  idbGetBackupHandle,
  idbSetBackupHandle,
  idbClearBackupHandle,
} from '@/lib/documentsDb';
import { buildBackup } from '@/lib/backup';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { debug } from '@/lib/debug';

/**
 * Synced backup file (File System Access API). The user picks a file once; its
 * handle is persisted in IndexedDB (handles are structured-cloneable) so the
 * link survives reloads and restarts. Every registry save is mirrored to that
 * file, so it's always the latest copy — drop it in a synced folder for
 * cross-machine backup, all without a server.
 *
 * The mirror is a full-account bundle (the same one "Back up everything"
 * downloads): documents, profiles + signatures, snippets, user templates, the
 * live NAVMC form fields, and enclosure file bytes. A restore from this file
 * therefore brings back everything, not just documents.
 *
 * Chromium-desktop only. Elsewhere the status is 'unsupported' and the manual
 * "Back up everything" export remains the fallback. Browsers require a fresh
 * user gesture to re-grant write access after a full restart ('needs-permission').
 * 'error' = the file can't be written (moved/deleted/locked/disk-full) or the
 * account can't be read — surfaced instead of silently letting the mirror go
 * stale; later saves keep retrying and a success flips back to 'connected'.
 */
export type BackupStatus = 'off' | 'connected' | 'needs-permission' | 'error' | 'unsupported';

/** The three ways a stalled mirror can be restarted. */
export type BackupAction = 'reconnect' | 'setup' | 'retry';

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
  return null; // 'connected' has nothing to fix; 'unsupported' has no way out.
}

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

async function writeToHandle(handle: FileSystemFileHandle, json: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(json);
  await writable.close();
}

// The live handle lives outside the store (not serializable UI state).
/** Stable id so the browser reopens the folder the user chose last time, even
 *  when we no longer hold a handle. Must be <=32 chars of [A-Za-z0-9_-]. */
const PICKER_ID = 'dondocs-backup';

/**
 * Re-picking a backup file should land where the last one lived. `startIn` with
 * a file handle opens that file's own folder, and carrying its name forward
 * means a re-pick targets the same file instead of quietly starting a second
 * one alongside it. `id` covers the case where the handle is gone: the browser
 * remembers the directory itself.
 *
 * The hints are an optimization, never a gate — if a browser rejects one, the
 * user still gets a picker.
 */
export async function pickFile(
  picker: (o: unknown) => Promise<FileSystemFileHandle>,
  previous: FileSystemFileHandle | null
): Promise<FileSystemFileHandle> {
  const base = {
    id: PICKER_ID,
    suggestedName: previous?.name ?? 'dondocs-backup.json',
    types: [{ description: 'DonDocs backup', accept: { 'application/json': ['.json'] } }],
  };
  if (!previous) return picker(base);
  try {
    return await picker({ ...base, startIn: previous });
  } catch (err) {
    // The user closing the dialog is an answer; anything else means the hint
    // itself was refused, so ask again without it.
    if ((err as Error)?.name === 'AbortError') throw err;
    debug.error('Backup', 'picker rejected startIn; retrying without it', err);
    return picker(base);
  }
}

let handleRef: FileSystemFileHandle | null = null;

interface BackupState {
  status: BackupStatus;
  fileName: string | null;
  /** Set only when a failed write was followed by asking the file directly and
   *  finding it gone. Decides whether the way out is a new file or a block to
   *  lift — never assumed from the write error alone. */
  fileMissing: boolean;
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
  fileMissing: false,
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
      const handle = await pickFile(picker, handleRef);
      handleRef = handle;
      await idbSetBackupHandle(handle);
      set({ fileName: handle.name, status: 'connected', fileMissing: false });
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
    set({ status: isSupported ? 'off' : 'unsupported', fileName: null, lastBackupAt: null, fileMissing: false });
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
      const json = await buildBackupJson();
      if (json === null) {
        // Account read failed — keep the existing backup file intact and do NOT
        // advance lastBackupAt; claiming success here would be a lie.
        set({ status: 'error', fileMissing: false });
        return;
      }
      await writeToHandle(handleRef, json);
      set({ lastBackupAt: Date.now(), status: 'connected', fileMissing: false });
      // A committed mirror write is a real backup → credit the checklist row.
      useOnboardingStore.getState().markComplete('first_backup');
    } catch (err) {
      // Permission revoked mid-write reads as NotAllowedError; everything else
      // (file moved/deleted/locked, disk full) is a write fault. Either way the
      // mirror stopped updating — say so instead of staying 'connected'.
      const name = (err as Error)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        set({ status: 'needs-permission', fileMissing: false });
      } else {
        set({ status: 'error', fileMissing: await isFileMissing(handleRef) });
      }
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
