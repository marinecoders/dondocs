import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { crc32, deflateSync } from 'node:zlib';
import { useDocumentStore } from '@/stores/documentStore';
import { commitCurrentDocument, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { persistAttachment } from '@/lib/attachments';
import { idbPutAttachment } from '@/lib/documentsDb';
import { startReviewRound } from '@/lib/reviewRoundActions';
import { storedExportAssets } from '@/services/exports/correspondence';
import { withWordReviewAssets } from '@/services/exports/wordReviewAssets';

beforeEach(() => { useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });useDocumentsStore.getState().newDocument(); });
afterEach(async () => { await flushDocumentWrites(); });
function png(red: number, green: number) {
  const chunk = (kind: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);view.setUint32(0, data.length);
    bytes.set(new TextEncoder().encode(kind), 4);bytes.set(data, 8);view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, -4)));return bytes;
  };
  const header = new Uint8Array(13), view = new DataView(header.buffer);view.setUint32(0, 1);view.setUint32(4, 1);header[8] = 8;header[9] = 6;
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', header), ...chunk('IDAT', deflateSync(new Uint8Array([0, red, green, 0, 255]))), ...chunk('IEND', new Uint8Array())]);
}
async function fixture(signature = false) {
  const original = png(0, 255), changed = png(255, 0), ref = await persistAttachment({ name: 'owned.png', type: 'image/png', size: original.length }, original.buffer);
  useDocumentStore.getState().updateParagraph(0, { text: 'Exact body.' });
  if (signature) useDocumentStore.getState().setField('signatureImage', { name: ref.name, size: ref.size, data: '', fileRef: ref });
  else useDocumentStore.getState().addParagraph('', 0);
  if (!signature) useDocumentStore.getState().updateParagraph(1, { text: 'Figure caption', figure: { name: ref.name, type: ref.type, fileRef: ref, placement: 'body' } });
  await commitCurrentDocument();return { round: await startReviewRound('Owned resources'), original, changed, ref };
}
it.each([false, true])('rejects actual stored bytes changed before the single owned capture (signature:%s)', async signature => {
  const { round, changed, ref } = await fixture(signature), rendered = vi.fn();
  await expect(withWordReviewAssets(round, { withAssets: async (ids, operation) => {
    expect(await idbPutAttachment({ ...ref, size: changed.length, data: changed.buffer })).toBe(true);
    return storedExportAssets.withAssets(ids, operation);
  } }, new AbortController().signal, rendered)).rejects.toThrow('baseline no longer matches');
  expect(rendered).not.toHaveBeenCalled();
});
it.each([false, true])('passes the same verified original bytes to rendering after live storage changes (signature:%s)', async signature => {
  const { round, changed, original, ref } = await fixture(signature);
  await withWordReviewAssets(round, { withAssets: (ids, operation) => storedExportAssets.withAssets(ids, async read => {
    await idbPutAttachment({ ...ref, size: changed.length, data: changed.buffer });return operation(read);
  }) }, new AbortController().signal, async assets => {
    await assets.withAssets([ref.id], async read => { const resource = read(ref.id);expect(new Uint8Array(resource.data)).toEqual(original);resource.data = changed.buffer; });
    await assets.withAssets([ref.id], async read => { expect(new Uint8Array(read(ref.id).data)).toEqual(original); });
  });
});
it('checks repeated expansion and unique byte budgets before acquiring or copying large resource sets', async () => {
  const { round } = await fixture(), source = round.baseline.session.paragraphs[1], acquire = vi.fn();
  source.figure!.fileRef!.size = 8 * 1024 * 1024;
  round.baseline.session.paragraphs = [round.baseline.session.paragraphs[0], ...Array.from({ length: 7 }, (_, index) => ({ ...structuredClone(source), id: `shared-${index}` }))];
  await expect(withWordReviewAssets(round, { withAssets: acquire }, new AbortController().signal, vi.fn())).rejects.toThrow('expanded resource limit');expect(acquire).not.toHaveBeenCalled();
});
