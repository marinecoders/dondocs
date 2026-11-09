import type { SignatureImage } from '@/types/document';
type SignatureBlock = { image?: string; imageRef?: import('@/types/document').FileRef };

/** Strip only bytes that already have a durable owner; failed writes retain originals. */
export function storedSignature(image: SignatureImage | undefined): SignatureImage | undefined {
  return image ? { ...image, ...(image.fileRef ? { data: '', fileRef: { ...image.fileRef } } : {}) } : undefined;
}


export function storedFormSignatures<T extends { signatureBlocks?: SignatureBlock[] }>(form: T): T {
  return { ...form, signatureBlocks: form.signatureBlocks?.map(block => ({ ...block, ...(block.imageRef ? { image: undefined } : {}) })) };
}
