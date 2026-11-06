// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: LockOptions, run: () => Promise<unknown>) => run() } });
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

it('serializes overlapping writes and does not acknowledge a file before close', async () => {
  const handle = makeHandle(); const store = await loadStore(vi.fn(async () => handle)); await store.getState().setupBackup();
  const before = store.getState().lastBackupAt;
  let finish!: () => void; let entered!: () => void; const writing = new Promise<void>(done => { entered = done; });
  const create = vi.fn(async () => ({ write: async (value: string) => { handle.writes.push(value); }, close: async () => { entered(); await new Promise<void>(done => { finish = done; }); } }));
  handle.createWritable = create;
  const first = store.getState().writeNow(); await writing;
  const second = store.getState().writeNow(); await Promise.resolve();
  expect(create).toHaveBeenCalledOnce(); expect(store.getState().lastBackupAt).toBe(before);
  handle.createWritable = async () => ({ write: async value => { handle.writes.push(value); }, close: async () => {} });
  finish(); await Promise.all([first, second]); expect(handle.writes).toHaveLength(3);
});
it('abandons a pending backup after the destination is disabled', async () => {
  const handle = makeHandle(); const store = await loadStore(vi.fn(async () => handle)); await store.getState().setupBackup();
  let finish!: (json: string) => void; let entered!: () => void; const preparing = new Promise<void>(done => { entered = done; });
  buildBackup.mockImplementationOnce(() => { entered(); return new Promise(resolve => { finish = resolve; }); });
  const saving = store.getState().writeNow(); await preparing; await store.getState().disable();
  finish('{}'); await saving;
  expect(handle.writes).toHaveLength(1); expect(store.getState().status).toBe('off'); expect(store.getState().lastBackupAt).toBeNull();
});
it('does not let an old disable completion hide a newly connected destination', async () => {
  const first = makeHandle('granted', 'first.json'), second = makeHandle('granted', 'second.json');
  const picker = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const store = await loadStore(picker); await store.getState().setupBackup();
  let finish!: () => void; clearHandle.mockImplementationOnce(() => new Promise<void>(done => { finish = done; }));
  const disabling = store.getState().disable();
  await store.getState().setupBackup(); finish(); await disabling;
  expect(store.getState()).toMatchObject({ status: 'connected', fileName: 'second.json' });
});
it('aborts a failed file stream and permits a later retry', async () => {
  const handle = makeHandle(); const store = await loadStore(vi.fn(async () => handle)); await store.getState().setupBackup();
  const original = handle.createWritable, abort = vi.fn(async () => {});
  handle.createWritable = async () => ({ write: async () => { throw new Error('Disk full'); }, close: async () => {}, abort });
  await store.getState().writeNow(); expect(abort).toHaveBeenCalledOnce(); expect(store.getState().status).toBe('error');
  handle.createWritable = original; await store.getState().writeNow(); expect(store.getState().status).toBe('connected');
});
it('holds cross-tab ownership while building and closing the file', async () => {
  const trace: string[] = [];
  vi.stubGlobal('navigator', { locks: { request: async (name: string, options: LockOptions, run: () => Promise<void>) => {
    expect(name).toBe('dondocs-backup-mirror'); expect(options.mode).toBe('exclusive');
    trace.push('acquired'); try { await run(); } finally { trace.push('released'); }
  } } });
  const handle = makeHandle();
  handle.createWritable = async () => ({ write: async () => { trace.push('write'); }, close: async () => { trace.push('close'); } });
  buildBackup.mockImplementationOnce(async () => { trace.push('capture'); return '{}'; });
  const store = await loadStore(vi.fn(async () => handle)); await store.getState().setupBackup();
  expect(trace).toEqual(['acquired', 'capture', 'write', 'close', 'released']);
});
it('keeps automatic mirroring unsupported when cross-tab coordination is unavailable', async () => {
  vi.stubGlobal('navigator', {});
  const handle = makeHandle(); const store = await loadStore(vi.fn(async () => handle));
  await store.getState().setupBackup(); expect(store.getState().status).toBe('unsupported'); expect(handle.writes).toEqual([]);
});
it('orders two independent tabs through the shared file owner', async () => {
  let tail: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, _options: LockOptions, run: () => Promise<void>) => {
    const operation = tail.then(run); tail = operation.catch(() => {}); return operation;
  });
  vi.stubGlobal('navigator', { locks: { request } });
  const handle = makeHandle(); backupHandle = handle;
  const firstStore = await loadStore(vi.fn()); await firstStore.getState().init();
  const secondStore = await loadStore(vi.fn()); await secondStore.getState().init();
  let finish!: (json: string) => void, entered!: () => void;
  const capturing = new Promise<void>(done => { entered = done; });
  buildBackup.mockImplementationOnce(() => { entered(); return new Promise(resolve => { finish = resolve; }); }).mockResolvedValueOnce('NEW');
  const first = firstStore.getState().writeNow(); await capturing;
  const second = secondStore.getState().writeNow();
  try { await Promise.resolve(); await Promise.resolve(); expect(buildBackup).toHaveBeenCalledOnce(); }
  finally { finish('OLD'); await Promise.all([first, second]); }
  expect(handle.writes).toEqual(['OLD', 'NEW']);
});
it('reports lock acquisition failure without opening or acknowledging a file', async () => {
  vi.stubGlobal('navigator', { locks: { request: async () => { throw new Error('Lock denied'); } } });
  const handle = makeHandle(), store = await loadStore(vi.fn(async () => handle));
  await expect(store.getState().setupBackup()).resolves.toBeUndefined();
  expect(handle.writes).toEqual([]); expect(store.getState().status).toBe('error'); expect(store.getState().lastBackupAt).toBeNull();
});
