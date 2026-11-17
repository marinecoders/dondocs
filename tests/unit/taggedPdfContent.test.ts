import { describe, expect, it } from 'vitest';
import { byteString, byteStringBytes, readPdfContent } from '@/services/pdf/accessibility/contentStream';

describe('tagged PDF lexical reader', () => {
  it('keeps marker-like operators inside literals, nested strings, hex and comments opaque', () => {
    const source = '% /DDTag << /I 99 >> DP\nBT (literal \\( \\) (nested) /DDTag DP) Tj <2f4444546167204450> Tj ET';
    expect(readPdfContent(source).map(value => value.operator)).toEqual(['BT', 'Tj', 'Tj', 'ET']);
  });

  it('reads names, nested arrays and dictionaries without interpreting payload words', () => {
    const operations = readPdfContent('/DD#54ag << /N <abcd> /I 7 /B true >> DP [(a) -20 (b)] TJ');
    expect(operations[0].operands[0]).toMatchObject({ kind: 'name', value: 'DDTag' });
    expect(operations[0].operands[1].children).toHaveLength(6);
    expect(operations[1].operands[0].children).toHaveLength(3);
  });

  it.each([
    '(unterminated', '(bad\\', '<< /Odd >> DP', '[1 2 q] TJ', '/Bad#escape MP', '<nothex> Tj',
    '<< /A (x) DP', '1 2', 'BI /W 1 /H 1 ID a EI', 'unknownoperator', ')', '<< (not a key) 1 >> DP',
  ])('rejects malformed or unqualified input: %s', source => {
    expect(() => readPdfContent(source)).toThrow(/Unsupported PDF content/);
  });

  it('rejects nesting, count and page size excess before accepting an operation sequence', () => {
    expect(() => readPdfContent('['.repeat(50) + ']'.repeat(50) + ' TJ')).toThrow(/nesting limit/);
    expect(() => readPdfContent('q Q q Q', 2)).toThrow(/count limit/);
    expect(() => readPdfContent(' '.repeat(8 * 1024 * 1024 + 1))).toThrow(/8 MiB/);
  });

  it('preserves every byte rather than applying Windows-1252 text decoding', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_value, index) => index);
    expect(byteStringBytes(byteString(bytes))).toEqual(bytes);
  });
});
