import { expect, it } from 'vitest';
import { PREVIEW_SOURCE_LIMITS, previewSourcesWithinBudget, sourcesAcrossPages, sourcesOnPage, type PreviewSource } from '@/lib/previewSources';
const source = (id: string, text = 'A uniquely worded source paragraph for navigation.'): PreviewSource => ({ id, paragraphId: id, text, label: id, sectionId: 'body' });
it('withholds oversized source counts before touching or normalizing their text', () => {
  const sources = Array.from({ length: PREVIEW_SOURCE_LIMITS.count + 1 }, (_, index) => source(String(index)));
  Object.defineProperty(sources[0], 'text', { get: () => { throw new Error('Text must not be read above the count limit'); } });
  expect(previewSourcesWithinBudget(sources)).toBe(false);
  expect(sourcesOnPage('A visible paragraph.', sources)).toEqual([]);
  expect(sourcesAcrossPages({ 0: 'A visible paragraph.' }, sources).get(0)).toEqual([]);
});
it('bounds aggregate source text instead of allowing many individually bounded long paragraphs', () => {
  const sources = Array.from({ length: 1000 }, (_, index) => source(String(index), 'Detailed common guidance. '.repeat(400) + index));
  expect(previewSourcesWithinBudget(sources)).toBe(false);
  expect(sourcesAcrossPages({ 0: 'No reliable match.' }, sources).get(0)).toEqual([]);
  const individuallySmall = [source('one', 'a'.repeat(125_001)), source('two', 'b'.repeat(125_000))];
  expect(previewSourcesWithinBudget(individuallySmall)).toBe(false);
  expect(sourcesOnPage(individuallySmall[0].text, individuallySmall)).toEqual([]);
});
it('withholds excessive measured-page counts and cumulative page text', () => {
  const sources = [source('one')];
  const pages = Object.fromEntries(Array.from({ length: PREVIEW_SOURCE_LIMITS.pages + 1 }, (_, index) => [index, sources[0].text]));
  expect(sourcesAcrossPages(pages, sources).get(0)).toEqual([]);
  const large = 'x'.repeat(PREVIEW_SOURCE_LIMITS.pageCharacters + 1);
  expect(sourcesOnPage(large, sources)).toEqual([]);
  expect(sourcesAcrossPages({ 0: large.slice(0, 250_000), 1: large.slice(250_000) }, sources).get(0)).toEqual([]);
});
it('retains matching at the supported source count and aggregate boundary', () => {
  const sources = Array.from({ length: PREVIEW_SOURCE_LIMITS.count }, (_, index) => source(String(index), `Unique paragraph ${index} has a distinct trailing identifier ${index}.`));
  expect(previewSourcesWithinBudget(sources)).toBe(true);
  expect(sourcesOnPage(sources[0].text, sources)).toEqual([sources[0]]);
  expect(previewSourcesWithinBudget([source('one', 'x'.repeat(PREVIEW_SOURCE_LIMITS.sourceCharacters))])).toBe(true);
});
