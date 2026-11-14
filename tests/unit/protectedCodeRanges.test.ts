import { describe, expect, it } from 'vitest';
import { maskProtectedRanges, protectedCodeRanges } from '@/lib/protectedCodeRanges';

describe('protected code delimiters', () => {
  it.each([
    '```javascript\nconst citation = `reference (b)`;\n```\nUse reference (a).',
    '~~~javascript\nconst citation = `reference (b)`;\n~~~\nUse reference (a).',
    '````markdown\n```js\nreference (b)\n```\n````\nUse reference (a).',
    '``reference (b) with a ` short delimiter`` Use reference (a).',
    '```\r\nreference (b)\r\n```\r\nUse reference (a).',
  ])('keeps nested delimiters inside one code literal: %s', text => {
    const masked = maskProtectedRanges(text, protectedCodeRanges(text));
    expect(masked).not.toContain('reference (b)');
    expect(masked).toContain('Use reference (a).');
    expect(masked.length).toBe(text.length);
  });

  it.each(['```\nreference (b)', '~~~\nreference (b)', '``reference (b)'])('protects an unfinished code literal: %s', text => {
    expect(maskProtectedRanges(text, protectedCodeRanges(text)).trim()).toBe('');
  });

  it('keeps offsets stable for Unicode and ignores quotes inside code', () => {
    const text = '😀 ```literal``` Use reference (a).';
    const masked = maskProtectedRanges(text, protectedCodeRanges(text));
    expect(masked.indexOf('reference (a)')).toBe(text.indexOf('reference (a)'));
    expect(masked.slice(0, 2)).toBe('😀');
  });
});
