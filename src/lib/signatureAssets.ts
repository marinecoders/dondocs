import type { SignatureImage } from '@/types/document';
import { persistAttachment, readAttachment } from './attachments';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';

export async function persistSignature(image: SignatureImage): Promise<SignatureImage> {
  if (image.fileRef) return structuredClone(image);
  const bytes = base64ToUint8Array(image.data.replace(/^data:image\/[^;]+;base64,/, ''));
  if (!bytes.byteLength) throw new Error('The signature image is empty.');
  const fileRef = await persistAttachment({ name: image.name, size: bytes.byteLength, type: 'image/png' }, new Uint8Array(bytes).buffer);
  return { ...image, fileRef };
}

/** Missing assets are recoverable errors, never permission to borrow another signature. */
export async function resolveSignature(image: SignatureImage | undefined): Promise<SignatureImage | undefined> {
  if (!image || image.data || !image.fileRef) return image ? structuredClone(image) : undefined;
  const result = await readAttachment(image.fileRef.id);
  if (result.status !== 'found') throw new Error(`Signature image could not be read (${result.status}). Reattach it before exporting.`);
  return { ...image, data: uint8ArrayToBase64(new Uint8Array(result.attachment.data)) };
}

type SignatureBlock = { style?: string; image?: string; imageRef?: import('@/types/document').FileRef };
export async function resolveFormSignatures<T extends { signatureBlocks?: SignatureBlock[] }>(form: T, purpose: 'output' | 'transfer' = 'output'): Promise<T> {
  const owned = structuredClone(form);
  if (owned.signatureBlocks) owned.signatureBlocks = await Promise.all(owned.signatureBlocks.map(async block => {
    if ((purpose === 'output' && block.style !== 'image') || !block.imageRef || block.image) return block;
    const image = await resolveSignature({ name: block.imageRef.name, size: block.imageRef.size, data: '', fileRef: block.imageRef });
    return { ...block, image: image?.data };
  }));
  return owned;
}
