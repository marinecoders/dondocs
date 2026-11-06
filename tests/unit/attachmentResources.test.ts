import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { persistAttachment } from '@/lib/attachments';
import { idbDeleteAttachment } from '@/lib/documentsDb';
import { copyAttachment, withAttachmentResources, type AttachmentResources } from '@/lib/attachmentResources';
import { sweepOrphanedAttachments } from '@/lib/attachmentGc';
it('owns independent bytes even if the original is removed during an operation', async () => {
  const ref = await persistAttachment({ name: 'held', size: 1, type: '' }, new Uint8Array([7]).buffer);
  await withAttachmentResources([ref.id], async resources => {
    await idbDeleteAttachment(ref.id);
    const first = copyAttachment(resources, ref.id); new Uint8Array(first.data)[0] = 9;
    expect(new Uint8Array(copyAttachment(resources, ref.id).data)[0]).toBe(7);
    expect(await sweepOrphanedAttachments()).toBeNull();
  });
});
it('rejects escaped and forged capabilities and releases resources on errors', async () => {
  let escaped!: AttachmentResources;
  await expect(withAttachmentResources([], async resources => { escaped = resources; throw new Error('Render failed'); })).rejects.toThrow('Render failed');
  expect(() => copyAttachment(escaped, 'a')).toThrow('released');
  expect(() => copyAttachment({ ...escaped }, 'a')).toThrow('not issued');
  await withAttachmentResources([], async resources => { expect(() => copyAttachment(resources, 'not-captured')).toThrow('not owned'); });
});
it('does not run a supposedly complete operation when a required attachment is missing', async () => {
  let ran = false;
  await expect(withAttachmentResources(['not-stored'], async () => { ran = true; })).rejects.toThrow('missing');
  expect(ran).toBe(false);
});
