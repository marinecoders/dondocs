import { describe, expect, it } from 'vitest';
import { captureTextRange, resolveTextRange, selectedTextRangeSchema, transformTextRange, transformTextRangeForText } from '@/lib/reviewTextRanges';
const source = { documentCategory: 'correspondence', docType: 'naval_letter', formData: {}, paragraphs: [{ id: 'first', level: 0, text: 'Before selected words after.' }] };
const capture = () => captureTextRange(source, 'first', 7, 21)!;

describe('exact selected-text range contract', () => {
  it('captures offsets against a unique stable paragraph and exact full context', () => {
    const range = capture();
    expect(range.context.slice(range.start, range.end)).toBe('selected words');
    expect(resolveTextRange({ ...source, paragraphs: [{ id: 'other', level: 0, text: range.context }, ...source.paragraphs] }, range)).toMatchObject({ status: 'current', start: 7, end: 21 });
    expect(captureTextRange({ ...source, paragraphs: [...source.paragraphs, ...source.paragraphs] }, 'first', 7, 21)).toBeNull();
    expect(resolveTextRange({ ...source, paragraphs: [{ ...source.paragraphs[0], id: 'replacement' }] }, range).status).toBe('unavailable');
  });
  it('keeps immutable context through outside edits and detaches changed or ambiguous selections', () => {
    const range = capture();
    const before = transformTextRange(range, range.context, { from: 0, to: 0, insert: 'New ' });
    const after = 'New ' + range.context;
    expect(before.context).toBe(range.context);
    expect(resolveTextRange({ ...source, paragraphs: [{ ...source.paragraphs[0], text: after }] }, before)).toMatchObject({ status: 'current', start: 11, end: 25 });
    expect(transformTextRange(range, range.context, { from: 10, to: 11, insert: 'x' }).detached).toBe(true);
    expect(transformTextRange(range, range.context, { from: 7, to: 7, insert: 'x' }).detached).toBe(true);
    const repeated = { ...range, context: 'aaaa', start: 1, end: 2 };
    expect(transformTextRangeForText(repeated, 'aaaa', 'aaaaa').detached).toBe(true);
    expect(transformTextRangeForText(range, range.context, 'X ' + range.context).tracking?.start).toBe(9);
    const detached = transformTextRange(range, range.context, { from: 7, to: 8, insert: 'x' });
    expect(transformTextRangeForText(detached, 'changed', range.context).detached).toBe(true);
  });
  it('accepts whole graphemes and rejects split Unicode, carets, malformed offsets and hidden structure', () => {
    const unicode = { ...source, paragraphs: [{ id: 'first', level: 0, text: 'A 😀 e\u0301 👨‍👩‍👧‍👦 Z' }] };
    expect(captureTextRange(unicode, 'first', 2, 4)).not.toBeNull();
    for (const [start, end] of [[2, 3], [5, 6], [0, 0], [-1, 1], [0, 99]]) expect(captureTextRange(unicode, 'first', start, end)).toBeNull();
    expect(captureTextRange(unicode, 'first', 0, 0, { allowCaret: true })).not.toBeNull();
    expect(selectedTextRangeSchema.safeParse({ ...capture(), end: 999 }).success).toBe(false);
    expect(selectedTextRangeSchema.safeParse({ ...capture(), tracking: { context: 'Wrong selected text', start: 0, end: 5 } }).success).toBe(false);
    for (const text of ['A **bold** word', 'Hello {{NAME}}', 'First\nSecond', '\\textbf{bold}', 'A __marked__ word']) expect(captureTextRange({ ...source, paragraphs: [{ id: 'first', level: 0, text }] }, 'first', 0, 1)).toBeNull();
    for (const extra of [{ header: 'Heading' }, { portionMarking: 'S' as const }, { figure: {} }, { tableKey: 'table' }]) expect(captureTextRange({ ...source, paragraphs: [{ ...source.paragraphs[0], ...extra }] }, 'first', 0, 1)).toBeNull();
  });
});
