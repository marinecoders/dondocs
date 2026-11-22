import { expect, it } from 'vitest';
import { sourcesOnPage, sourcesAcrossPages, type PreviewSource } from '@/lib/previewSources';
const source = (id: string, text: string): PreviewSource => ({ id, paragraphId: id, text, label: id, sectionId: 'body' });
it('withholds a paragraph quoted inside an unmeasured spanning paragraph', () => {
  const quoted = source('quoted', 'Coordinate all shared training requirements for the participating commands.');
  const spanning = source('spanning', `The preceding page introduces the coordinated operation in detail. ${quoted.text} The following instructions complete the longer paragraph.`);
  expect(sourcesAcrossPages({ 1: `${quoted.text} The following instructions complete the longer paragraph.` }, [quoted, spanning]).get(1)).toEqual([]);
});
it('requires the final continuation at the actual prefix to end on a word boundary', () => {
  const first = 'The unique introductory fragment contains several deliberate training requirements';
  const last = 'while all remaining words complete this shared paragraph';
  const paragraph = source('spanning', `${first} ${last}`);
  expect(sourcesAcrossPages({ 0: first, 1: last + 's unrelated content ' + last }, [paragraph]).get(0)).toEqual([]);
});
it('withholds an initial anchor embedded inside a longer identifier', () => {
  const first = 'The unique introductory fragment contains several deliberate training requirements';
  const last = 'while all remaining words complete this shared paragraph';
  const paragraph = source('spanning', `${first} ${last}`);
  expect(sourcesAcrossPages({ 0: 'prefix' + first, 1: last }, [paragraph]).get(0)).toEqual([]);
});

it('does not discard an unpositioned numeric body word as a page footer', () => {
  const first = 'The unique introductory fragment contains several deliberate training requirements';
  const last = 'while all remaining words complete this shared paragraph';
  const expected = source('elsewhere', `${first} ${last}`);
  const actual = source('actual', `${first} 99 ${last}`);
  expect(sourcesAcrossPages({ 0: first + ' 99', 1: last }, [actual, expected]).get(0)).toEqual([actual]);
});

it('withholds repeated printed occurrences even when only one editable source has that text', () => {
  const source = { id: 'body-label', paragraphId: 'body-label', sectionId: 'body', label: 'Paragraph', text: 'CONFIDENTIAL' };
  expect(sourcesOnPage('CONFIDENTIAL Other native content CONFIDENTIAL', [source])).toEqual([]);
  expect(sourcesOnPage('Other native content CONFIDENTIAL', [source])).toEqual([source]);
});
