/**
 * Unit tests for the legacy-registry -> IndexedDB migration safety property.
 *
 * The data-loss-critical invariant under test: migrateLegacyRegistry only drops
 * the source localStorage blob once EVERY IndexedDB write is confirmed durable.
 * If any per-document put (or the currentId write) returns false, the blob must
 * be retained so the next load can retry rather than losing the user's only copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compressedStringify } from '@/lib/compressedStorage';

// Controllable stubs for the IndexedDB layer. Every named export the store
// imports from '@/lib/documentsDb' is provided so the module resolves; only the
// three the migration drives are configured per test.
const idbGetAllDocuments = vi.fn();
const idbPutDocument = vi.fn();
const idbSetCurrentId = vi.fn();
const idbDeleteDocument = vi.fn();
const idbGetCurrentId = vi.fn();

vi.mock('@/lib/documentsDb', () => ({
  idbGetAllDocuments: (...args: unknown[]) => idbGetAllDocuments(...args),
  idbPutDocument: (...args: unknown[]) => idbPutDocument(...args),
  idbSetCurrentId: (...args: unknown[]) => idbSetCurrentId(...args),
  idbDeleteDocument: (...args: unknown[]) => idbDeleteDocument(...args),
  idbGetCurrentId: (...args: unknown[]) => idbGetCurrentId(...args),
}));

// Imported after the mock is registered so the store binds to the stubs.
import { migrateLegacyRegistry } from '@/stores/documentsStore';

const LEGACY_KEY = 'dondocs_documents';

// Minimal SerializedSession — only the fields the migration copies through
// matter; it never inspects session internals, just `entry.meta && entry.session`.
const minimalSession = (subject: string) => ({
  documentMode: 'edit',
  documentCategory: 'correspondence',
  docType: 'naval_letter',
  formType: 'naval_letter',
  formData: { subject },
  references: [],
  enclosures: [],
  paragraphs: [{ text: 'body' }],
  copyTos: [],
  distributions: [],
  timestamp: 1,
});

const docEntry = (id: string, title: string) => ({
  meta: { id, title, docType: 'naval_letter', updatedAt: 1 },
  session: minimalSession(title),
});

// A valid compressed blob matching the LegacyRegistry { state: { docs, currentId } }
// shape the migration reads (it unwraps `parsed.state ?? parsed`).
function seedLegacyBlob(): void {
  const blob = compressedStringify({
    state: {
      docs: {
        d1: docEntry('d1', 'A'),
        d2: docEntry('d2', 'B'),
      },
      currentId: 'd1',
    },
  });
  localStorage.setItem(LEGACY_KEY, blob);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Sensible defaults; individual tests override as needed.
  idbGetAllDocuments.mockResolvedValue([]);
  idbPutDocument.mockResolvedValue(true);
  idbSetCurrentId.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('migrateLegacyRegistry — delete source only after all writes confirmed', () => {
  it('removes the legacy blob once every IndexedDB write succeeds', async () => {
    seedLegacyBlob();

    await migrateLegacyRegistry();

    // Blob dropped — migration confirmed durable.
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    // One put per document in the registry.
    expect(idbPutDocument).toHaveBeenCalledTimes(2);
    const putIds = idbPutDocument.mock.calls.map(([doc]) => (doc as { id: string }).id).sort();
    expect(putIds).toEqual(['d1', 'd2']);
    expect(idbSetCurrentId).toHaveBeenCalledWith('d1');
  });

  it('retains the legacy blob when any document put fails (no data loss)', async () => {
    seedLegacyBlob();
    // First put succeeds, second resolves false (write not confirmed durable).
    idbPutDocument.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await migrateLegacyRegistry();

    // Blob MUST survive so the next load retries rather than losing the copy.
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    expect(idbPutDocument).toHaveBeenCalledTimes(2);
  });

  it('retains the legacy blob when the currentId write fails (no data loss)', async () => {
    seedLegacyBlob();
    idbPutDocument.mockResolvedValue(true);
    idbSetCurrentId.mockResolvedValue(false);

    await migrateLegacyRegistry();

    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it('skips migration entirely when IndexedDB is already populated', async () => {
    seedLegacyBlob();
    const existingBlob = localStorage.getItem(LEGACY_KEY);
    idbGetAllDocuments.mockResolvedValue([docEntry('existing', 'X')]);

    await migrateLegacyRegistry();

    // No writes, and the blob is left untouched (byte-for-byte).
    expect(idbPutDocument).not.toHaveBeenCalled();
    expect(idbSetCurrentId).not.toHaveBeenCalled();
    expect(localStorage.getItem(LEGACY_KEY)).toBe(existingBlob);
  });
});
