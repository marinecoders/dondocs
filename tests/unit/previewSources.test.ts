import { describe, expect, it } from 'vitest';
import { sourcesOnPage, type PreviewSource } from '@/lib/previewSources';
const source: PreviewSource = { id: 'p1', label: 'Paragraph 1', sectionId: 'body', text: 'A unique paragraph to navigate.' };
describe('preview source anchors', () => {
  it('does not attribute a longer paragraph to a shorter paragraph embedded in it', () => {
    const longer = { ...source, id: 'p2', text: source.text + ' Additional instructions follow.' };
    expect(sourcesOnPage(longer.text, [source, longer])).toEqual([longer]);
    expect(sourcesOnPage(longer.text, [source, longer, { ...longer, id: 'p3' }])).toEqual([]);
  });
  it('does not match partial words or identifiers', () => {
    const field = { ...source, text: 'Personnel request' };
    expect(sourcesOnPage('Personnel requests', [field])).toEqual([]);
    expect(sourcesOnPage('xPersonnel request', [field])).toEqual([]);
  });
  it('matches wrapped PDF text without altering punctuation', () => {
    expect(sourcesOnPage('1. A UNIQUE paragraph\n to navigate.', [source])).toEqual([source]);
    expect(sourcesOnPage('A unique paragraph to navigate!', [source])).toEqual([]);
  });
  it('rejects ambiguous, short, empty and absent text', () => {
    expect(sourcesOnPage(source.text, [source, { ...source, id: 'p2' }])).toEqual([]);
    expect(sourcesOnPage('Hello', [{ ...source, text: 'Hello' }])).toEqual([]);
    expect(sourcesOnPage(source.text, [{ ...source, text: '' }])).toEqual([]);
    expect(sourcesOnPage('another page', [source])).toEqual([]);
    expect(sourcesOnPage('', [source])).toEqual([]);
  });
});
