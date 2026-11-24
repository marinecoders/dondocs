import type { Reference } from '@/types/document';

/** SECNAV M-5216.5 §7-2.10c continues (z) with (aa), (ab), and so on. */
export function referenceLetterAt(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index === Number.MAX_SAFE_INTEGER) return '';
  let label = '';
  for (let remaining = index + 1; remaining > 0; remaining = Math.floor((remaining - 1) / 26)) {
    label = String.fromCharCode(97 + (remaining - 1) % 26) + label;
  }
  return label;
}

export function isLegacyReferenceLetter(label: string): boolean {
  return /^a(?:0|[1-9]\d*)$/i.test(label);
}

/** Decode both printed sequences so inherited references in saved drafts keep their place. */
export function referenceLetterIndex(value: string): number | undefined {
  const label = value.trim().toLowerCase();
  if (!/^[a-z]{1,12}$/.test(label) && !isLegacyReferenceLetter(label)) return undefined;
  const ordinal = isLegacyReferenceLetter(label)
    ? Number(label.slice(1)) + 27
    : [...label].reduce((index, letter) => index * 26 + (letter.charCodeAt(0) - 96), 0);
  return Number.isSafeInteger(ordinal) ? ordinal - 1 : undefined;
}

export const reLetterReferences = (refs: Reference[], offset = 0): Reference[] =>
  refs.map((ref, index) => ({ ...ref, letter: referenceLetterAt(index + offset) }));
