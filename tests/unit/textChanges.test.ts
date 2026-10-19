import { expect, it } from 'vitest';
import fc from 'fast-check';
import { compareText } from '@/lib/textChanges';

it('marks only the words changed when restoring a sentence', () => {
  const result = compareText('Report by Friday, please.', 'Report by Monday, please.');
  expect(result.before.filter(part => part.changed).map(part => part.text).join('')).toBe('Friday');
  expect(result.after.filter(part => part.changed).map(part => part.text).join('')).toBe('Monday');
});

it.each([
  ['', 'Added'], ['Removed', ''], ['same', 'same'],
  ['one two one', 'one one'], ['αβ 文本\nline  2', 'αβ 変更\nline\t2'],
  ['Hello, world!', 'Hello world?'],
])('preserves exact text on both sides: %j → %j', (before, after) => {
  const result = compareText(before, after);
  expect(result.before.map(part => part.text).join('')).toBe(before);
  expect(result.after.map(part => part.text).join('')).toBe(after);
});

it('reconstructs arbitrary input without dropping or inventing characters', () => {
  fc.assert(fc.property(fc.string(), fc.string(), (before, after) => {
    const result = compareText(before, after);
    expect(result.before.map(part => part.text).join('')).toBe(before);
    expect(result.after.map(part => part.text).join('')).toBe(after);
    expect(result.before.filter(part => !part.changed).map(part => part.text).join(''))
      .toBe(result.after.filter(part => !part.changed).map(part => part.text).join(''));
  }), { numRuns: 100 });
});

it('bounds comparison work on large changed publications without truncating content', () => {
  const before = `Start ${'old text '.repeat(5000)}end`;
  const after = `Start ${'new content '.repeat(5000)}end`;
  const result = compareText(before, after);
  expect(result.before.map(part => part.text).join('')).toBe(before);
  expect(result.after.map(part => part.text).join('')).toBe(after);
  expect(result.before).toHaveLength(3);
  expect(result.after).toHaveLength(3);
});
