import { z } from 'zod';
import type { Paragraph } from '@/types/document';

export const paragraphIdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export function newParagraphId(): string {
  return crypto.randomUUID();
}

/** New content never borrows the identity of a template or duplicated node. */
export function freshParagraphs<T extends Paragraph>(paragraphs: readonly T[]): T[] {
  return paragraphs.map(paragraph => ({ ...paragraph, id: newParagraphId() }));
}

export function validateParagraphIds(paragraphs: readonly Paragraph[]): void {
  const seen = new Set<string>();
  for (const paragraph of paragraphs) {
    if (paragraph.id === undefined) continue;
    if (!paragraphIdSchema.safeParse(paragraph.id).success || seen.has(paragraph.id)) {
      throw new Error('Paragraph identities are invalid or duplicated. The current draft has not been replaced.');
    }
    seen.add(paragraph.id);
  }
}

function migrationFingerprint(paragraph: Paragraph): string {
  const content = JSON.stringify(Object.fromEntries(Object.entries(paragraph).filter(([key]) => key !== 'id').sort(([a], [b]) => a.localeCompare(b))));
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < content.length; index++) {
    const code = content.charCodeAt(index);
    for (let lane = 0; lane < hashes.length; lane++) hashes[lane] = Math.imul(hashes[lane] ^ code, 16777619 + lane * 2);
  }
  return hashes.map(hash => (hash >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Run at ingestion, never rendering or serialization. Legacy inputs without
 * IDs migrate deterministically until their first normal save. Once assigned,
 * an ID is retained through all edits; text and position never resolve anchors.
 * IDs reserved by detached comments cannot be assigned to a newly migrated node.
 */
export function ensureParagraphIds<T extends Paragraph>(paragraphs: readonly T[], reservedIds: readonly string[] = []): T[] {
  validateParagraphIds(paragraphs);
  const used = new Set([...reservedIds, ...paragraphs.flatMap(paragraph => paragraph.id ? [paragraph.id] : [])]);
  return paragraphs.map((paragraph, index) => {
    if (paragraph.id) return paragraph;
    const seed = `legacy-v1-${index.toString(36)}-${migrationFingerprint(paragraph)}`;
    let id = seed;
    let collision = 0;
    while (used.has(id)) id = `${seed}-${++collision}`;
    used.add(id);
    return { ...paragraph, id };
  });
}
