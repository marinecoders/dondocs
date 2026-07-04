// A real (in-memory) IndexedDB must exist before documentsDb evaluates its
// module-load `hasIndexedDb` probe. Must be the first import.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { newAttachmentId, persistAttachment, loadAttachment, loadAllAttachments } from '@/lib/attachments';

const bytes = (values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

describe('newAttachmentId', () => {
  it('is prefixed, hex, and unique across calls', () => {
    const a = newAttachmentId();
    const b = newAttachmentId();
    expect(a).toMatch(/^att_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('persistAttachment → loadAttachment (fake-indexeddb)', () => {
  it('round-trips the exact bytes and returns a faithful ref', async () => {
    const data = bytes([1, 2, 3, 4, 250]);
    const ref = await persistAttachment({ name: 'encl.pdf', size: 5, type: 'application/pdf' }, data);

    expect(ref).toMatchObject({ name: 'encl.pdf', size: 5, type: 'application/pdf' });
    expect(ref.id).toMatch(/^att_/);

    const loaded = await loadAttachment(ref.id);
    expect(loaded).not.toBeNull();
    expect([...new Uint8Array(loaded!)]).toEqual([1, 2, 3, 4, 250]);
  });

  it('returns null for an unknown id', async () => {
    expect(await loadAttachment('att_does_not_exist')).toBeNull();
  });

  it('stores each attachment under its own id (no clobber)', async () => {
    const r1 = await persistAttachment({ name: 'a', size: 1, type: '' }, bytes([9]));
    const r2 = await persistAttachment({ name: 'b', size: 1, type: '' }, bytes([8]));
    expect(r1.id).not.toBe(r2.id);

    const all = await loadAllAttachments();
    expect(all).not.toBeNull();
    const byId = new Map(all!.map((a) => [a.id, a]));
    expect([...new Uint8Array(byId.get(r1.id)!.data)]).toEqual([9]);
    expect([...new Uint8Array(byId.get(r2.id)!.data)]).toEqual([8]);
  });
});
