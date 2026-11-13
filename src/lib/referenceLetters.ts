import type { Reference } from '@/types/document';

// Preserve the existing labels beyond (z), including saved a0/a1 references.
export const referenceLetterAt = (index: number): string =>
  'abcdefghijklmnopqrstuvwxyz'[index] || `a${index - 26}`;

export const reLetterReferences = (refs: Reference[], offset = 0): Reference[] =>
  refs.map((ref, index) => ({ ...ref, letter: referenceLetterAt(index + offset) }));
