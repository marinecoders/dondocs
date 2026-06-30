// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// backupStore reads `isSupported` (window.showSaveFilePicker) at module load, so
// each test re-imports it after stubbing the API. documentsDb is mocked because
// a real FileSystemFileHandle isn't structured-cloneable through IndexedDB.
let backupHandle: FakeHandle | null = null;
const setHandle = vi.fn(async () => true);
const clearHandle = vi.fn(async () => {});

vi.mock('@/lib/documentsDb', () => ({
  idbGetAllDocuments: vi.fn(async () => []),
  idbGetBackupHandle: vi.fn(async () => backupHandle),
  idbSetBackupHandle: (...a: unknown[]) => setHandle(...(a as [])),
  idbClearBackupHandle: (...a: unknown[]) => clearHandle(...(a as [])),
}));

interface FakeHandle {
  name: string;
  perm: 'granted' | 'prompt' | 'denied';
  writes: string[];
  queryPermission: (o: { mode: string }) => Promise<string>;
  requestPermission: (o: { mode: string }) => Promise<string>;
  createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
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

  it('writeNow flips to needs-permission when permission was revoked between saves', async () => {
    const handle = makeHandle('granted');
    const store = await loadStore(vi.fn(async () => handle));
    await store.getState().setupBackup(); // connected + one seed write
    handle.perm = 'prompt'; // permission revoked out from under us
    await store.getState().writeNow();
    expect(store.getState().status).toBe('needs-permission');
    expect(handle.writes).toHaveLength(1); // no second write once revoked
  });
});
