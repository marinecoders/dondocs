/** Conservative text anchors: repeated or short text never selects a destination. */
export interface PreviewSource {
  id: string;
  label: string;
  sectionId: string;
  text: string;
  paragraphId?: string;
  fieldId?: string;
}

export const PREVIEW_SOURCE_LIMITS = { count: 512, sourceCharacters: 250_000, pages: 128, pageCharacters: 500_000 } as const;

/** Check raw sizes before normalization or pairwise source comparisons. */
export function previewSourcesWithinBudget(sources: readonly PreviewSource[], additionalCharacters = 0): boolean {
  if (sources.length > PREVIEW_SOURCE_LIMITS.count) return false;
  let characters = additionalCharacters;
  if (characters > PREVIEW_SOURCE_LIMITS.sourceCharacters) return false;
  for (const source of sources) {
    characters += source.text.length;
    if (characters > PREVIEW_SOURCE_LIMITS.sourceCharacters) return false;
  }
  return true;
}

export function normalizePreviewText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
}

/** Check boundaries at this occurrence, never at a later repeated substring. */
function isWholeTextAt(container: string, text: string, offset: number): boolean {
  // Two UTF-16 units preserve a neighbouring supplementary Unicode letter.
  const before = container.slice(Math.max(0, offset - 2), offset);
  const after = container.slice(offset + text.length, offset + text.length + 2);
  const startsWord = /^[\p{L}\p{N}\p{M}_]/u.test(text);
  const endsWord = /[\p{L}\p{N}\p{M}_]$/u.test(text);
  return (!startsWord || !/[\p{L}\p{N}\p{M}_]$/u.test(before))
    && (!endsWord || !/^[\p{L}\p{N}\p{M}_]/u.test(after));
}

/** A field name must not match the middle of a word or a longer identifier. */
function wholeTextMatchCount(container: string, text: string, limit: number): number {
  let offset = container.indexOf(text), count = 0;
  while (offset !== -1 && count < limit) {
    if (isWholeTextAt(container, text, offset)) count++;
    offset = container.indexOf(text, offset + 1);
  }
  return count;
}
function containsWholeText(container: string, text: string): boolean {
  return wholeTextMatchCount(container, text, 1) > 0;
}

export function sourcesOnPage(text: string, sources: readonly PreviewSource[]): PreviewSource[] {
  if (!previewSourcesWithinBudget(sources) || text.length > PREVIEW_SOURCE_LIMITS.pageCharacters) return [];
  const page = normalizePreviewText(text);
  if (!page) return [];
  const normalized = sources.map(source => ({ source, key: normalizePreviewText(source.text) }));
  const counts = new Map<string, number>();
  for (const { key } of normalized) counts.set(key, (counts.get(key) ?? 0) + 1);
  const matches = normalized.filter(({ key }) => key.length >= 12 && wholeTextMatchCount(page, key, 2) === 1);
  // A shorter paragraph quoted inside a longer one cannot establish that the
  // shorter paragraph itself is on this page. Withhold that ambiguous link.
  return matches.filter(candidate => counts.get(candidate.key) === 1
    && !normalized.some(other => other.key.length > candidate.key.length && containsWholeText(other.key, candidate.key)))
    .map(({ source }) => source);
}

/** Extend complete text matches over at most four measured adjacent pages.
 * Only the captured subject header may intervene; positioned footers are removed before matching.
 * Unknown banners, missing pages, short fragments and repeated text fail closed.
 */
export function sourcesAcrossPages(pageTexts: Readonly<Record<number, string>>, sources: readonly PreviewSource[], subject = ''): Map<number, PreviewSource[]> {
  const entries = Object.entries(pageTexts);
  const empty = () => new Map<number, PreviewSource[]>(entries.map(([page]) => [Number(page), []]));
  if (!previewSourcesWithinBudget(sources) || entries.length > PREVIEW_SOURCE_LIMITS.pages) return empty();
  let characters = 0;
  for (const [, text] of entries) {
    characters += text.length;
    if (characters > PREVIEW_SOURCE_LIMITS.pageCharacters) return empty();
  }
  const pages = new Map(entries.map(([page, text]) => [Number(page), normalizePreviewText(text)]));
  const result = new Map([...pages].map(([page, text]) => [page, sourcesOnPage(text, sources)]));
  const whole = new Set([...result.values()].flat());
  const keys = sources.map(source => normalizePreviewText(source.text));
  const header = normalizePreviewText(subject);
  const removeHeader = (text: string) => {
    if (!header) return text;
    for (const label of ['subj:', 'subject:']) {
      const prefix = `${label} ${header}`;
      if (text.startsWith(prefix + ' ')) return text.slice(prefix.length).trimStart();
    }
    return text;
  };
  for (const [sourceIndex, source] of sources.entries()) {
    const key = keys[sourceIndex];
    if (!source.paragraphId || whole.has(source) || key.length > 50_000 || key.split(' ').length < 8
      || keys.some((other, index) => index !== sourceIndex && containsWholeText(other, key))) continue;
    const anchor = key.split(' ').slice(0, 6).join(' ');
    if (anchor.length < 24) continue;
    const candidates: number[][] = [];
    for (const [firstPage, firstText] of pages) {
      const offset = firstText.indexOf(anchor);
      if (offset < 0 || firstText.indexOf(anchor, offset + 1) >= 0 || !isWholeTextAt(firstText, anchor, offset)) continue;
      let remaining = key;
      const matched: number[] = [];
      for (let page = firstPage; page < firstPage + 4; page++) {
        const measured = pages.get(page);
        if (!measured) break;
        const text = page === firstPage ? measured.slice(offset) : removeHeader(measured);
        if (text.startsWith(remaining) && isWholeTextAt(text, remaining, 0)) {
          if (remaining.length >= 24 && remaining.split(' ').length >= 4) {
            matched.push(page);
            if (matched.length > 1) candidates.push(matched);
          }
          break;
        }
        let common = 0;
        while (common < remaining.length && common < text.length && remaining[common] === text[common]) common++;
        const split = remaining.lastIndexOf(' ', common);
        if (split < 24 || remaining.slice(0, split).split(' ').length < 4
          || text.slice(split).trim() !== '') break;
        matched.push(page);
        remaining = remaining.slice(split + 1);
      }
    }
    if (candidates.length !== 1) continue;
    for (const page of candidates[0]) result.get(page)!.push(source);
  }
  for (const [page, matches] of result) {
    result.set(page, matches.filter(candidate => !matches.some(other => other !== candidate
      && normalizePreviewText(other.text) !== normalizePreviewText(candidate.text)
      && containsWholeText(normalizePreviewText(other.text), normalizePreviewText(candidate.text)))));
  }
  return result;
}

/** Native PDF streams may paint the letterhead last. Order upright text by
 * baseline and position before matching; rotated text is deliberately withheld. */
export function previewPageText(items: readonly ({ str: string; transform: number[] } | object)[]): string {
  const text = items.filter((item): item is { str: string; transform: number[] } =>
    'str' in item && typeof item.str === 'string' && 'transform' in item && Array.isArray(item.transform)
    && item.transform.length >= 6 && item.transform.every(Number.isFinite)
    && Math.abs(item.transform[1]) < 0.01 && Math.abs(item.transform[2]) < 0.01);
  const rows: { y: number; items: typeof text }[] = [];
  for (const item of text.sort((a, b) => b.transform[5] - a.transform[5])) {
    const previous = rows.at(-1);
    const row = previous && Math.abs(previous.y - item.transform[5]) < 2 ? previous : undefined;
    if (row) row.items.push(item);
    else rows.push({ y: item.transform[5], items: [item] });
  }
  return rows.flatMap(row => {
    const line = row.items.sort((a, b) => a.transform[4] - b.transform[4]).map(item => item.str).join(' ');
    // Native correspondence body baselines stay above the bottom one-inch
    // margin. Only a wholly numeric page-number row in the lower 0.75 inch
    // is a footer; body numbers and unknown markings remain matching evidence.
    return row.y >= 0 && row.y < 54 && /^\d+(?:\s+of\s+\d+)?$/.test(line.trim()) ? [] : [line];
  }).join(' ');
}
