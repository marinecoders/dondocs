/** Conservative text anchors: repeated or short text never selects a destination. */
export interface PreviewSource {
  id: string;
  label: string;
  sectionId: string;
  text: string;
  paragraphId?: string;
  fieldId?: string;
}

export function normalizePreviewText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
}

/** A field name must not match the middle of a word or a longer identifier. */
function containsWholeText(container: string, text: string): boolean {
  let offset = container.indexOf(text);
  while (offset !== -1) {
    // Two UTF-16 units preserve a neighbouring supplementary Unicode letter.
    const before = container.slice(Math.max(0, offset - 2), offset);
    const after = container.slice(offset + text.length, offset + text.length + 2);
    const startsWord = /^[\p{L}\p{N}\p{M}_]/u.test(text);
    const endsWord = /[\p{L}\p{N}\p{M}_]$/u.test(text);
    if ((!startsWord || !/[\p{L}\p{N}\p{M}_]$/u.test(before))
      && (!endsWord || !/^[\p{L}\p{N}\p{M}_]/u.test(after))) return true;
    offset = container.indexOf(text, offset + 1);
  }
  return false;
}

export function sourcesOnPage(text: string, sources: readonly PreviewSource[]): PreviewSource[] {
  const page = normalizePreviewText(text);
  if (!page) return [];
  const normalized = sources.map(source => ({ source, key: normalizePreviewText(source.text) }));
  const counts = new Map<string, number>();
  for (const { key } of normalized) counts.set(key, (counts.get(key) ?? 0) + 1);
  const matches = normalized.filter(({ key }) => key.length >= 12 && containsWholeText(page, key));
  // A shorter paragraph quoted inside a longer one cannot establish that the
  // shorter paragraph itself is on this page. Withhold that ambiguous link.
  return matches.filter(candidate => counts.get(candidate.key) === 1
    && !matches.some(other => other.key !== candidate.key && containsWholeText(other.key, candidate.key)))
    .map(({ source }) => source);
}
