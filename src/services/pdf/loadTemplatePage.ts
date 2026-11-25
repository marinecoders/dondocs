import { formTemplateAttachmentId } from '@/lib/formTemplateAssets';
import { portableResourceDigest } from '@/lib/portableResources';

/** A reopened package can supply its exact template even without a network request. */
export async function readRetainedTemplatePage(sha256: string): Promise<ArrayBuffer | undefined> {
  const { idbReadAttachment } = await import('@/lib/documentsDb');
  const result = await idbReadAttachment(formTemplateAttachmentId(sha256));
  if (result.status !== 'found') return undefined;
  const { data } = result.attachment;
  if (await portableResourceDigest(data) !== sha256) throw new Error('The retained PDF template is corrupt.');
  return data;
}

/** Load a built-in PDF page with a bounded retry for a failed request or read. */
export async function loadTemplatePage(url: string): Promise<ArrayBuffer> {
  const read = async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Could not load PDF template (${response.status}).`);
    return response.arrayBuffer();
  };
  try { return await read(); }
  catch { return read(); }
}
