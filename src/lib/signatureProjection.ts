import type { SignatureImage } from '@/types/document';
type SignatureBlock = { image?: string; imageRef?: import('@/types/document').FileRef };

/** Keep an inline fallback for supported clients that do not understand handles. */
export function storedSignature(image: SignatureImage | undefined): SignatureImage | undefined {
  return image ? { ...image, ...(image.fileRef ? { fileRef: { ...image.fileRef } } : {}) } : undefined;
}


export function storedFormSignatures<T extends { signatureBlocks?: SignatureBlock[] }>(form: T): T {
  return { ...form, signatureBlocks: form.signatureBlocks?.map(block => ({ ...block, ...(block.imageRef ? { imageRef: { ...block.imageRef } } : {}) })) };
}

/** Hydrating redundant bytes does not edit an image with an immutable asset ID. */
export function signatureForComparison(image: SignatureImage | undefined): SignatureImage | undefined {
  const owned = storedSignature(image);
  return owned?.fileRef ? { ...owned, data: '' } : owned;
}

export function formSignaturesForComparison<T extends { signatureBlocks?: SignatureBlock[] }>(form: T): T {
  const owned = storedFormSignatures(form);
  return { ...owned, signatureBlocks: owned.signatureBlocks?.map(block => block.imageRef ? { ...block, image: undefined } : block) };
}
