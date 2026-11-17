import { withAttachmentResources, copyAttachment } from '@/lib/attachmentResources';
import { buildReviewCopy } from '@/lib/reviewRoundActions';
import type { ReviewRound } from '@/lib/reviewRounds';
import type { FileRef } from '@/types/document';
import type { StoredAttachment } from '@/lib/documentsDb';
import type { ExportAssets } from './correspondence';

const MAX_OWNED_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
function references(round: ReviewRound): FileRef[] {
  const session = round.baseline.session, data = session.formData;
  return [...session.enclosures.flatMap(item => item.fileRef ? [item.fileRef] : []),
    ...session.paragraphs.flatMap(item => item.figure?.fileRef ? [item.figure.fileRef] : []),
    ...(data.basicLetterFileRef ? [data.basicLetterFileRef] : []), ...(data.wordSource?.fileRef ? [data.wordSource.fileRef] : []),
    ...(data.signatureImage?.fileRef && !data.signatureImage.data ? [data.signatureImage.fileRef] : [])];
}
const boundedAssets: ExportAssets = { withAssets: (ids, operation) => withAttachmentResources(ids, scope => operation(id => copyAttachment(scope, id)), { maxBytes: MAX_OWNED_BYTES }) };

/** The complete baseline digest and renderer borrow ONE owned resource set.
 * Check repeated expansion before serialization and actual sizes before any
 * additional copies; the renderer cannot reopen or substitute live storage.
 */
export async function withWordReviewAssets<T>(round: ReviewRound, supplied: ExportAssets | undefined, signal: AbortSignal,
  operation: (assets: ExportAssets) => Promise<T>): Promise<T> {
  const refs = references(round), unique = new Map<string, FileRef>();
  let expanded = new TextEncoder().encode(JSON.stringify(round.baseline.session)).byteLength, metadataBytes = 0;
  if (expanded > MAX_EXPANDED_BYTES) throw new Error('This Word review baseline exceeds its 64 MB expanded resource limit. Use a native review copy.');
  for (const ref of refs) {
    if (!Number.isSafeInteger(ref.size) || ref.size < 0) throw new Error('A Word review resource has an invalid captured size.');
    expanded += Math.ceil(ref.size / 3) * 4;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error('This Word review baseline exceeds its 64 MB expanded resource limit. Use a native review copy.');
    const prior = unique.get(ref.id);
    if (prior && (prior.size !== ref.size || prior.name !== ref.name || prior.type !== ref.type)) throw new Error('A shared Word review resource has conflicting captured metadata.');
    if (!prior) { unique.set(ref.id, ref);metadataBytes += ref.size; }
    if (metadataBytes > MAX_OWNED_BYTES) throw new Error('Word review baselines are limited to 32 MB of unique retained files. Use a native review copy.');
  }
  signal.throwIfAborted();
  return (supplied ?? boundedAssets).withAssets([...unique.keys()], async read => {
    const records = new Map<string, StoredAttachment>();let actualBytes = 0;
    for (const [id, ref] of unique) {
      signal.throwIfAborted();const record = read(id);
      if (record.id !== id || record.size !== record.data.byteLength || record.size !== ref.size || record.size > MAX_OWNED_BYTES - actualBytes) throw new Error('A captured Word review resource changed size or exceeds its limit.');
      actualBytes += record.size;records.set(id, structuredClone(record));
    }
    let live = true;
    const scoped: ExportAssets = { withAssets: async (ids, run) => {
      if (!live) throw new Error('The owned Word review resource lease has expired.');
      for (const id of ids) if (!records.has(id)) throw new Error('The Word renderer requested a resource outside its verified baseline.');
      signal.throwIfAborted();
      return run(id => { signal.throwIfAborted();if (!live) throw new Error('The owned Word review resource lease has expired.');const record = records.get(id);if (!record) throw new Error('An owned Word review resource is unavailable.');return structuredClone(record); });
    } };
    try {
      await buildReviewCopy(round, async id => {
        signal.throwIfAborted();const record = records.get(id);if (!record) throw new Error('The Word baseline requested an uncaptured resource.');return record.data.slice(0);
      });
      signal.throwIfAborted();
      return await operation(scoped);
    } finally { live = false;records.clear(); }
  });
}
