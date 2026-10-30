import { expect, it } from 'vitest';
import { latexLineBreaks } from '@/services/latex/escaper';

it('preserves literal text that resembles a line-break sentinel', () => {
  expect(latexLineBreaks('ZZZBLANKLINEZZZ\nnext')).toBe('ZZZBLANKLINEZZZ\\\\\nnext');
});

it('converts blank lines and protects a bracket at the start of the next line', () => {
  expect(latexLineBreaks('\nfirst\n\n[second]\n')).toBe('first\\\\[\\baselineskip]\n[second]');
  expect(latexLineBreaks('first\n[second]')).toBe('first\\\\\n{}[second]');
});

it('normalizes Windows line endings before trimming paragraph edges', () => {
  expect(latexLineBreaks('\r\nfirst\r\nsecond\r\n')).toBe(latexLineBreaks('\nfirst\nsecond\n'));
});
