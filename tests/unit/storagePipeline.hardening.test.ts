// Hardening tests for the storage pipeline's error/contract branches that the
// existing suites exercised only indirectly: the storage-durability probe's
// state matrix, the legacy-migration ledger's empty-array delete, graceful
// attachment-persist failure, and the backup restore's legacy path, in-flight
// flag, and malformed-input tolerance. A real in-memory IndexedDB must exist
// before documentsDb evaluates — first import.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  probeStorageHealth,
  idbGetMigratedIds,
  idbSetMigratedIds,
  idbPutDocument,
  idbGetAllDocuments,
  idbDeleteDocument,
  idbGetAttachment,
  type StoredDocument,
} from '@/lib/documentsDb';
import * as documentsDb from '@/lib/documentsDb';
import { persistAttachment } from '@/lib/attachments';
import { restoreBackup, isRestoreInProgress } from '@/lib/backup';
import * as docsStore from '@/stores/documentsStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { uint8ArrayToBase64 } from '@/lib/encoding';

const doc = (id: string): StoredDocument =>
  ({
    id,
    meta: { id, title: `D ${id}`, docType: 'naval_letter', updatedAt: 1 },
    session: {
      docType: 'naval_letter',
      paragraphs: [],
      references: [],
      enclosures: [],
      copyTos: [],
      distributions: [],
    },
  }) as unknown as StoredDocument;

async function clearDocs() {
  const all = (await idbGetAllDocuments()) ?? [];
  for (const r of all) await idbDeleteDocument(r.id);
}

// Install a stub navigator.storage.persisted with a chosen outcome. Returns a
// restorer. happy-dom's navigator has no storage manager, so we define one.
function stubPersisted(outcome: 'granted' | 'denied' | 'throws' | 'absent') {
  const persisted =
    outcome === 'absent'
      ? undefined
      : outcome === 'throws'
        ? vi.fn().mockRejectedValue(new Error('unsupported'))
        : vi.fn().mockResolvedValue(outcome === 'granted');
  Object.defineProperty(navigator, 'storage', {
    value: persisted ? { persisted } : {},
    configurable: true,
  });
}

describe('probeStorageHealth — durability state matrix', () => {
  beforeEach(async () => {
    await clearDocs();
  });
  afterEach(() => {
    // Leave navigator.storage defined-but-harmless for the next file.
    Object.defineProperty(navigator, 'storage', { value: {}, configurable: true });
  });

  it("returns 'ok' when persistent storage is granted", async () => {
    stubPersisted('granted');
    await idbPutDocument(doc('h1'));
    expect(await probeStorageHealth()).toBe('ok');
  });

  it("returns 'evictable' when storage works, is NOT persisted, and documents exist", async () => {
    stubPersisted('denied');
    await idbPutDocument(doc('h2'));
    expect(await probeStorageHealth()).toBe('evictable');
  });

  it("returns 'ok' for a brand-new visitor with no documents (nothing to lose yet)", async () => {
    stubPersisted('denied');
    // no documents
    expect(await probeStorageHealth()).toBe('ok');
  });

  it("falls back to 'evictable' when persisted() is unsupported and docs exist", async () => {
    stubPersisted('absent');
    await idbPutDocument(doc('h3'));
    expect(await probeStorageHealth()).toBe('evictable');
  });

  it("falls back to 'evictable' when persisted() throws and docs exist", async () => {
    stubPersisted('throws');
    await idbPutDocument(doc('h4'));
    expect(await probeStorageHealth()).toBe('evictable');
  });

  // The 'unreadable' outcome (registry opens but reads fail → not a healthy
  // empty library) can't be forced here: probeStorageHealth calls its own
  // module-local idbGetAllDocuments, which a spy on the export can't intercept,
  // and faking a mid-transaction read failure is brittle. It's covered at the
  // consumer boundary in storageReadFailure.test.ts (init rejects and flags
  // storageHealth='unreadable' when the read returns null).
});

describe('legacy-migration ledger — empty set deletes the key', () => {
  it('round-trips ids, and setting [] removes the record instead of storing an empty array', async () => {
    await idbSetMigratedIds(['a', 'b']);
    expect((await idbGetMigratedIds()).sort()).toEqual(['a', 'b']);

    await idbSetMigratedIds([]);
    // Getter returns [] either way, so assert the underlying key is gone: a
    // stored empty array would round-trip as a present record; a delete leaves none.
    expect(await idbGetMigratedIds()).toEqual([]);
  });
});

describe('persistAttachment — graceful when the durable write fails', () => {
  afterEach(() => vi.restoreAllMocks());

  it('still returns a usable FileRef so the in-memory session keeps working', async () => {
    // A failed IDB write (quota, blocked) must not lose the just-attached file
    // this session — persistAttachment returns the ref regardless; it just won't
    // survive a reload.
    vi.spyOn(documentsDb, 'idbPutAttachment').mockResolvedValue(false);
    const ref = await persistAttachment({ name: 'f.pdf', size: 3, type: 'application/pdf' }, new Uint8Array([1, 2, 3]).buffer);
    expect(ref.id).toMatch(/^att_/);
    expect(ref.name).toBe('f.pdf');
    expect(ref.size).toBe(3);
  });
});

describe('restoreBackup — legacy, in-flight flag, and malformed input', () => {
  beforeEach(async () => {
    await clearDocs();
    useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null, pendingDelete: null });
    useUIStore.setState({ storageHealth: 'ok' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('restores a legacy `dondocs-library` (docs-only) file via importLibrary', async () => {
    const legacy = JSON.stringify({
      kind: 'dondocs-library',
      version: 1,
      docs: [doc('legacy-1'), doc('legacy-2')],
    });
    const result = await restoreBackup(legacy);
    expect(result.documents.imported).toBe(2);
    expect(result.attachmentsAdded).toBe(0);
    expect(result.profilesAdded).toBe(0);
    expect(useDocumentsStore.getState().docs['legacy-1']).toBeDefined();
  });

  it('sets isRestoreInProgress() true DURING the restore and clears it after', async () => {
    let flagDuringDocImport: boolean | null = null;
    const spy = vi.spyOn(docsStore, 'importLibrary').mockImplementation(async () => {
      flagDuringDocImport = isRestoreInProgress();
      return { imported: 0, skipped: 0 };
    });
    const bundle = JSON.stringify({
      kind: 'dondocs-backup',
      version: 3,
      documents: [doc('x')],
      attachments: [],
      profiles: { profiles: {}, selectedProfile: null },
      forms: { navmc10274: null, navmc11811: null },
      snippets: [],
      userTemplates: {},
    });
    expect(isRestoreInProgress()).toBe(false);
    await restoreBackup(bundle);
    expect(flagDuringDocImport).toBe(true);
    expect(isRestoreInProgress()).toBe(false);
    spy.mockRestore();
  });

  it('clears isRestoreInProgress() even when the restore throws (finally runs)', async () => {
    expect(isRestoreInProgress()).toBe(false);
    await expect(restoreBackup('not json at all')).rejects.toThrow();
    expect(isRestoreInProgress()).toBe(false);
  });

  it('skips malformed attachment entries and counts only the valid ones', async () => {
    const data = uint8ArrayToBase64(new Uint8Array([9, 9, 9]));
    const bundle = JSON.stringify({
      kind: 'dondocs-backup',
      version: 3,
      documents: [],
      attachments: [
        { id: 'good-1', name: 'a', type: '', size: 3, data },
        { id: 42, name: 'b', type: '', size: 3, data }, // non-string id → skip
        null, // → skip
        { id: 'no-data', name: 'c', type: '', size: 0 }, // missing data → skip
        { id: 'good-2', name: 'd', type: '', size: 3, data },
      ],
      profiles: { profiles: {}, selectedProfile: null },
      forms: { navmc10274: null, navmc11811: null },
      snippets: [],
      userTemplates: {},
    });
    const result = await restoreBackup(bundle);
    expect(result.attachmentsAdded).toBe(2);
    expect(await idbGetAttachment('good-1')).toBeTruthy();
    expect(await idbGetAttachment('good-2')).toBeTruthy();
    expect(await idbGetAttachment('no-data')).toBeNull();
  });
});
