import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CORRESPONDENCE_MANUAL as source, findManualMatch, findManualParagraphMatch, loadManualResource, locateManualPage, parseCorrespondenceManual, searchCorrespondenceManual } from '@/lib/correspondenceManual';

const bytes = new Uint8Array(await readFile(`public/${source.textPath}`));
const manual = parseCorrespondenceManual(bytes);
afterEach(() => vi.unstubAllGlobals());

describe('pinned correspondence manual', () => {
  it('matches the reviewed source PDF and exact extracted resource', async () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.textSha256);
    expect(createHash('sha256').update(await readFile(`public/${source.pdfPath}`)).digest('hex')).toBe(source.sourceSha256);
    expect(createHash('sha256').update(await readFile('docs/references/5216.5  CH-1.pdf')).digest('hex')).toBe(source.sourceSha256);
    expect(manual.pages).toHaveLength(159);
    expect(manual.sections).toHaveLength(18);
  });

  it('locates actual chapter 2 paragraph 19 on PDF page 28, printed page 2-12', () => {
    expect(locateManualPage(manual, { chapter: 2, paragraph: '19' })).toEqual({ page: 28, foundParagraph: true });
    expect(manual.pages[27]).toMatchObject({ label: '2-12', section: '2' });
    expect(manual.pages[27].text).toContain('19. Proofreading.');
    expect(manual.pages[28].text).toContain('Lastly, read for content.');
    expect(locateManualPage(manual, { chapter: 12 })).toEqual({ page: 106, foundParagraph: true });
  });

  it('keeps unknown or ambiguous locators visible rather than guessing', () => {
    expect(locateManualPage(manual, { chapter: 2, paragraph: '999' })).toEqual({ page: 17, foundParagraph: false });
    expect(locateManualPage(manual, { chapter: 99, paragraph: '1' })).toEqual({ page: 1, foundParagraph: false });
    expect(locateManualPage(manual, { chapter: 2, paragraph: '.*' })).toEqual({ page: 17, foundParagraph: false });
    expect(locateManualPage(manual, { query: 'Are enclosure markings correct?' })).toEqual({ page: 28, foundParagraph: true });
  });

  it('opens the real subject, enclosure, addressee and endorsement sources', () => {
    const sources = [
      [{ chapter: 7, paragraph: '9', query: 'Subject Line' }, 52, '9.   Subject Line'],
      [{ chapter: 7, paragraph: '11', query: 'Enclosure Line' }, 57, '11. Enclosure Line'],
      [{ chapter: 8, query: 'Listing Addressees' }, 74, '8-2 Listing Addressees'],
      [{ chapter: 9, paragraph: '1', query: 'Endorsement Line' }, 80, 'Endorsement Line'],
    ] as const;
    for (const [location, page, text] of sources) {
      expect(locateManualPage(manual, location)).toEqual({ page, foundParagraph: true });
      expect(manual.pages[page - 1].text).toContain(text);
    }
  });

  it('identifies paragraph-only source headings on the actual cited pages', () => {
    for (const location of [{ chapter: 2, paragraph: '17' }, { chapter: 7, paragraph: '13' }]) {
      const target = locateManualPage(manual, location), text = manual.pages[target.page - 1].text;
      const match = findManualParagraphMatch(text, location.paragraph);
      expect(match).toBeDefined();
      expect(text.slice(match!.start, match!.end)).toMatch(new RegExp(`^${location.paragraph}\\.`));
    }
    expect(findManualParagraphMatch('A reference to paragraph 17. in prose', '17')).toBeUndefined();
    expect(findManualParagraphMatch('17. Heading', '.*')).toBeUndefined();
  });

  it('searches literal case-insensitive phrases across extracted line breaks', () => {
    const text = 'Alpha\n  ENCLOSURE   markings. [a+b]';
    expect(findManualMatch(text, 'enclosure markings')).toEqual({ start: 8, end: 28 });
    expect(findManualMatch(text, '[a+b]')).toEqual({ start: 30, end: 35 });
    expect(findManualMatch(text, '.*')).toBeUndefined();
    expect(findManualMatch(text, 'a')).toBeUndefined();
    expect(findManualMatch(text, 'a'.repeat(161))).toBeUndefined();
    const results = searchCorrespondenceManual(manual, 'Are enclosure markings correct?');
    expect(results.results.some(r => r.page === 28)).toBe(true);
    expect(searchCorrespondenceManual(manual, 'correspondence').results.length).toBe(50);
  });

  it('rejects missing/renumbered pages and inconsistent chapter ranges', () => {
    for (const alter of [(data: typeof manual) => { data.pages[27].number = 29; }, (data: typeof manual) => { data.sections[2].firstPage = 18; }]) {
      const data = structuredClone(manual);alter(data);
      expect(() => parseCorrespondenceManual(new TextEncoder().encode(JSON.stringify(data)))).toThrow();
    }
  });

  it('works without cache permission and rejects oversized or mismatched responses', async () => {
    vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('Private browsing')) });
    const fetcher = vi.fn().mockResolvedValue(new Response(bytes));vi.stubGlobal('fetch', fetcher);
    expect(await loadManualResource('text', new AbortController().signal)).toMatchObject({ cached: false, bytes });
    fetcher.mockResolvedValue(new Response('incorrect'));
    await expect(loadManualResource('text', new AbortController().signal)).rejects.toThrow('integrity');
    fetcher.mockResolvedValue(new Response('too big', { headers: { 'Content-Length': String(source.textBytes + 1) } }));
    await expect(loadManualResource('text', new AbortController().signal)).rejects.toThrow('unavailable');
  });

  it('reads a verified cached manual offline and discards corrupt cached bytes', async () => {
    const cache = { match: vi.fn().mockResolvedValue(new Response(bytes)), delete: vi.fn().mockResolvedValue(true), put: vi.fn(), keys: vi.fn().mockResolvedValue([]) };
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) });
    const fetcher = vi.fn().mockRejectedValue(new Error('Offline'));vi.stubGlobal('fetch', fetcher);
    expect(await loadManualResource('text', new AbortController().signal)).toMatchObject({ cached: true });
    expect(fetcher).not.toHaveBeenCalled();
    cache.match.mockResolvedValue(new Response('corrupt'));
    await expect(loadManualResource('text', new AbortController().signal)).rejects.toThrow('Offline');
    expect(cache.delete).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation before fetching', async () => {
    const controller = new AbortController();controller.abort();
    const fetcher = vi.fn();vi.stubGlobal('fetch', fetcher);vi.stubGlobal('caches', undefined);
    await expect(loadManualResource('text', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
