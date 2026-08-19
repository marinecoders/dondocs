// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// backupStore reads `isSupported` (window.showSaveFilePicker) at module load, so
// each test re-imports it after stubbing the API. documentsDb is mocked because
// a real FileSystemFileHandle isn't structured-cloneable through IndexedDB.
let backupHandle: FakeHandle | null = null;
const setHandle = vi.fn(async () => true);
const clearHandle = vi.fn(async () => {});

vi.mock('@/lib/documentsDb', () => ({
  idbGetBackupHandle: vi.fn(async () => backupHandle),
  idbSetBackupHandle: (...a: unknown[]) => setHandle(...(a as [])),
  idbClearBackupHandle: (...a: unknown[]) => clearHandle(...(a as [])),
}));

// The mirror content comes from buildBackup(); mock it so the state-machine test
// stays about permissions/writes, decoupled from what a real backup contains.
const buildBackup = vi.fn(async () =>
  JSON.stringify({ kind: 'dondocs-backup', version: 3, documents: [], attachments: [] })
);
vi.mock('@/lib/backup', () => ({ buildBackup: () => buildBackup() }));

interface FakeHandle {
  name: string;
  perm: 'granted' | 'prompt' | 'denied';
  writes: string[];
  queryPermission: (o: { mode: string }) => Promise<string>;
  requestPermission: (o: { mode: string }) => Promise<string>;
  createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
  /** Asked after a failed write to tell a missing file from a refused one. */
  getFile: () => Promise<unknown>;
}

function makeHandle(perm: FakeHandle['perm'] = 'granted', name = 'dondocs-library.json'): FakeHandle {
  const h: FakeHandle = {
    name,
    perm,
    writes: [],
    queryPermission: async () => h.perm,
    requestPermission: async () => {
      h.perm = 'granted';
      return 'granted';
    },
    createWritable: async () => ({
      write: async (d: string) => {
        h.writes.push(d);
      },
      close: async () => {},
    }),
    getFile: async () => ({ size: 1 }),
  };
  return h;
}

async function loadStore(picker?: unknown) {
  vi.resetModules();
  (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = picker;
  return (await import('@/stores/backupStore')).useBackupStore;
}

beforeEach(() => {
  backupHandle = null;
  vi.clearAllMocks();
});

describe('backupStore permission state machine', () => {
  it('is unsupported when the File System Access API is absent', async () => {
    const store = await loadStore(undefined);
    expect(store.getState().status).toBe('unsupported');
  });

  it('init → connected when a saved handle still has write permission', async () => {
    backupHandle = makeHandle('granted');
    const store = await loadStore(vi.fn());
    await store.getState().init();
    expect(store.getState().status).toBe('connected');
    expect(store.getState().fileName).toBe('dondocs-library.json');
  });

  it('init → needs-permission when the saved handle lost permission after a restart', async () => {
    backupHandle = makeHandle('prompt');
    const store = await loadStore(vi.fn());
    await store.getState().init();
    expect(store.getState().status).toBe('needs-permission');
  });

  it('setupBackup picks a file, connects, and seeds it once', async () => {
    const handle = makeHandle('granted');
    const picker = vi.fn(async () => handle);
    const store = await loadStore(picker);
    await store.getState().setupBackup();
    expect(picker).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe('connected');
    expect(handle.writes).toHaveLength(1); // seeded on connect
  });

  it('mirrors a full-account backup bundle, not a docs-only library', async () => {
    const handle = makeHandle('granted');
    const store = await loadStore(vi.fn(async () => handle));
    await store.getState().setupBackup();
    expect(buildBackup).toHaveBeenCalled();
    expect(JSON.parse(handle.writes[0]).kind).toBe('dondocs-backup'); // not 'dondocs-library'
  });

  it('skips the write (and keeps the file intact) when the account can not be read', async () => {
    const handle = makeHandle('granted');
    const store = await loadStore(vi.fn(async () => handle));
    await store.getState().setupBackup(); // connected + one seed write
    const seededWrites = handle.writes.length;
    const before = store.getState().lastBackupAt;

    // buildBackup throws (e.g. unreadable registry): mirroring now would overwrite
    // the one external safety copy with an incomplete file — so we must not write.
    buildBackup.mockRejectedValueOnce(new Error('registry unreadable'));
    await store.getState().writeNow();
    expect(store.getState().status).toBe('error');
    expect(handle.writes).toHaveLength(seededWrites); // no overwrite
    expect(store.getState().lastBackupAt).toBe(before); // no fake success stamp
  });

  it('writeNow flips to needs-permission when permission was revoked between saves', async () => {
    const handle = makeHandle('granted');
    const store = await loadStore(vi.fn(async () => handle));
    await store.getState().setupBackup(); // connected + one seed write
    handle.perm = 'prompt'; // permission revoked out from under us
    await store.getState().writeNow();
    expect(store.getState().status).toBe('needs-permission');
    expect(handle.writes).toHaveLength(1); // no second write once revoked
  });

  it('a persistent write failure surfaces as error instead of silently staying connected', async () => {
    const handle = makeHandle('granted');
    const store = await loadStore(vi.fn(async () => handle));
    await store.getState().setupBackup(); // connected + seed write
    const before = store.getState().lastBackupAt;

    // The file was moved/locked/deleted — every write now throws.
    handle.createWritable = async () => {
      throw new DOMException('file gone', 'NotFoundError');
    };
    await store.getState().writeNow();
    expect(store.getState().status).toBe('error'); // not a silent stale mirror
    expect(store.getState().lastBackupAt).toBe(before); // no fake success stamp
  });

  it('offers a new file only after confirming the old one is really gone', async () => {
    const handle = makeHandle('granted');
    const store = await loadStore(vi.fn(async () => handle));
    await store.getState().setupBackup();

    handle.createWritable = async () => {
      throw new DOMException('file gone', 'NotFoundError');
    };
    handle.getFile = async () => {
      throw new DOMException('gone', 'NotFoundError');
    };
    await store.getState().writeNow();

    expect(store.getState().status).toBe('error');
    expect(store.getState().fileMissing).toBe(true);
  });

  it('does not call a file missing when it is still there and the write was refused', async () => {
    // The case that made users re-map: the write is blocked from outside, the
    // file is untouched, and offering a new one fixes nothing. The write error
    // alone cannot tell these apart, so the file is asked directly.
    const handle = makeHandle('granted');
    const store = await loadStore(vi.fn(async () => handle));
    await store.getState().setupBackup();

    handle.createWritable = async () => {
      throw new DOMException('blocked by policy', 'InvalidStateError');
    };
    // getFile still answers: the file is fine.
    await store.getState().writeNow();

    expect(store.getState().status).toBe('error');
    expect(store.getState().fileMissing).toBe(false);
  });

  it('recovers to connected when a later write succeeds after an error', async () => {
    const handle = makeHandle('granted');
    const store = await loadStore(vi.fn(async () => handle));
    await store.getState().setupBackup();

    const workingWritable = handle.createWritable;
    handle.createWritable = async () => {
      throw new DOMException('locked', 'NoModificationAllowedError');
    };
    await store.getState().writeNow();
    expect(store.getState().status).toBe('error');

    // The sync client released the file — the next save self-heals.
    handle.createWritable = workingWritable;
    await store.getState().writeNow();
    expect(store.getState().status).toBe('connected');
    expect(handle.writes.length).toBeGreaterThanOrEqual(2);
  });
});
