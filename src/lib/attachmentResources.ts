import { readAttachment, withAttachmentStaging } from './attachments';
import type { StoredAttachment } from './documentsDb';

const resourceBrand = Symbol('attachment-resources');
export interface AttachmentResources { readonly [resourceBrand]: true }
const resources = new WeakMap<AttachmentResources, Map<string, StoredAttachment>>();

/** Borrow the retained resource set only within its owning operation. */
export async function withAttachmentResources<T>(ids: Iterable<string>, operation: (resources: AttachmentResources) => Promise<T>, limits?: { maxBytes: number }): Promise<T> {
  const requestedIds = new Set(ids);
  return withAttachmentStaging(async () => {
    const records = new Map<string, StoredAttachment>();
    let bytes = 0;
    for (const id of requestedIds) {
      const result = await readAttachment(id);
      if (result.status !== 'found') throw new Error(`Attachment ${id} could not be read (${result.status}).`);
      const record = result.attachment;
      if (record.size !== record.data.byteLength || limits && (record.data.byteLength > limits.maxBytes - bytes)) throw new Error('The captured attachment set exceeds its resource limit or has inconsistent bytes.');
      bytes += record.data.byteLength;records.set(id, structuredClone(record));
    }
    const scope: AttachmentResources = Object.freeze({ [resourceBrand]: true as const });
    resources.set(scope, records);
    try { return await operation(scope); }
    finally { resources.delete(scope); records.clear(); }
  });
}

/** The caller owns the returned copy; mutable buffers never alias the retained set. */
export function copyAttachment(resourcesScope: AttachmentResources, id: string): StoredAttachment {
  const records = resources.get(resourcesScope);
  if (!records) throw new Error('Attachment resources have been released or were not issued by this operation.');
  const record = records.get(id);
  if (!record) throw new Error(`Attachment ${id} is not owned by this operation.`);
  return structuredClone(record);
}
