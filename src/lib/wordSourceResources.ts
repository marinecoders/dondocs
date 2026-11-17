import type { WordSourceMetadata } from './wordSource';

/** Verify bytes, not editable imported metadata, before retaining or sharing
 * an original source whose comments/deletions may be absent from clean output. */
export async function validateWordSourceFile(file: { data: ArrayBuffer }, metadata: WordSourceMetadata): Promise<void> {
  const { readRetainedWordSource, matchesLegacyWordSourceInventory } = await import('@/services/docx/import/readWord');
  const parsed = await readRetainedWordSource(new Uint8Array(file.data), metadata.name);
  if (parsed.sha256 !== metadata.sha256 || parsed.retainedText !== metadata.retainedText
    && !await matchesLegacyWordSourceInventory(new Uint8Array(file.data), metadata.name, metadata.sha256, metadata.retainedText)) {
    throw new Error('The original Word source does not match its retained content and identity.');
  }
}
