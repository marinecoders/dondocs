import { describe, it, expect } from 'vitest';
import {
  mergeRecord,
  mergeById,
  classifyBackup,
  collectAttachmentIds,
  summarizeRestore,
  BACKUP_KIND,
} from '@/lib/backup';

describe('mergeRecord (non-destructive)', () => {
  it('adds absent keys and NEVER overwrites an existing one', () => {
    const current = { a: { v: 'local-A' }, b: { v: 'local-B' } };
    const backup = { a: { v: 'backup-A' }, c: { v: 'backup-C' } };
    const { merged, added } = mergeRecord(current, backup);
    expect(added).toBe(1); // only c is new
    expect(merged.a.v).toBe('local-A'); // local wins the collision — no clobber
    expect(merged.b.v).toBe('local-B');
    expect(merged.c.v).toBe('backup-C');
  });

  it('handles missing/empty backup', () => {
    expect(mergeRecord({ a: 1 }, undefined)).toEqual({ merged: { a: 1 }, added: 0 });
    expect(mergeRecord({ a: 1 }, {})).toEqual({ merged: { a: 1 }, added: 0 });
  });
});

describe('mergeById (non-destructive)', () => {
  it('appends only items whose id is new', () => {
    const current = [{ id: '1', t: 'local' }];
    const backup = [{ id: '1', t: 'backup' }, { id: '2', t: 'new' }];
    const { merged, added } = mergeById(current, backup);
    expect(added).toBe(1);
    expect(merged).toHaveLength(2);
    expect(merged.find((x) => x.id === '1')!.t).toBe('local'); // no clobber
    expect(merged.find((x) => x.id === '2')!.t).toBe('new');
  });

  it('ignores a non-array backup and returns the original reference', () => {
    const current = [{ id: '1' }];
    const out = mergeById(current, undefined);
    expect(out.added).toBe(0);
    expect(out.merged).toBe(current);
  });
});

describe('classifyBackup', () => {
  it('accepts the v2 bundle and the legacy library file', () => {
    expect(classifyBackup(JSON.stringify({ kind: BACKUP_KIND })).kind).toBe('dondocs-backup');
    expect(classifyBackup(JSON.stringify({ kind: 'dondocs-library', docs: [] })).kind).toBe('dondocs-library');
  });

  it('rejects foreign JSON and non-JSON', () => {
    expect(() => classifyBackup(JSON.stringify({ kind: 'something-else' }))).toThrow(/Not a DonDocs backup/);
    expect(() => classifyBackup('{not json')).toThrow(/valid JSON/);
  });
});

describe('collectAttachmentIds', () => {
  const doc = (ids: (string | undefined)[]) => ({
    session: { enclosures: ids.map((id) => (id ? { title: 't', fileRef: { id } } : { title: 't' })) },
  });

  it('gathers every distinct fileRef id across documents', () => {
    const ids = collectAttachmentIds([doc(['a', 'b']), doc(['b', 'c'])]);
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c'])); // deduped across docs
  });

  it('ignores enclosures without a fileRef and malformed shapes', () => {
    expect(collectAttachmentIds([doc([undefined, 'x'])])).toEqual(['x']);
    expect(collectAttachmentIds([{}, { session: {} }, { session: { enclosures: 'nope' } }])).toEqual([]);
    expect(collectAttachmentIds([])).toEqual([]);
  });
});

describe('summarizeRestore', () => {
  it('lists only the buckets that changed', () => {
    expect(
      summarizeRestore({ documents: { imported: 3, skipped: 1 }, profilesAdded: 2, snippetsAdded: 0, templatesAdded: 1, formsRestored: true, attachmentsAdded: 0 }),
    ).toBe('Restored 3 docs, 2 profiles, 1 template, form fields · kept 1 newer');
    expect(
      summarizeRestore({ documents: { imported: 1, skipped: 0 }, profilesAdded: 0, snippetsAdded: 0, templatesAdded: 0, formsRestored: false, attachmentsAdded: 0 }),
    ).toBe('Restored 1 doc');
  });

  it('reports restored attachments', () => {
    expect(
      summarizeRestore({ documents: { imported: 2, skipped: 0 }, profilesAdded: 0, snippetsAdded: 0, templatesAdded: 0, formsRestored: false, attachmentsAdded: 3 }),
    ).toBe('Restored 2 docs, 3 attachments');
  });
});
