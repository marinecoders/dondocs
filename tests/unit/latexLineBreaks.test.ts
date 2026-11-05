import { expect, it } from 'vitest';
import { latexLineBreaks, processBodyText } from '@/services/latex/escaper';

it('preserves literal text that resembles a line-break sentinel', () => {
  expect(latexLineBreaks('ZZZBLANKLINEZZZ\nnext')).toBe('ZZZBLANKLINEZZZ\\\\\nnext');
});

it('converts blank lines and protects a bracket at the start of the next line', () => {
  expect(latexLineBreaks('\nfirst\n\n[second]\n')).toBe('first\\\\[\\baselineskip]\n{}[second]');
  expect(latexLineBreaks('first\n[second]')).toBe('first\\\\\n{}[second]');
});

it.each([' ', '  ', '\t', ' \t '])('protects a bracket after a line break and %j', (space) => {
  expect(latexLineBreaks(`first\n${space}[second]`)).toBe(`first\\\\\n${space}{}[second]`);
  expect(latexLineBreaks(`first\n\n${space}[second]`)).toBe(`first\\\\[\\baselineskip]\n${space}{}[second]`);
});

it('normalizes Windows line endings before trimming paragraph edges', () => {
  expect(latexLineBreaks('\r\nfirst\r\nsecond\r\n')).toBe(latexLineBreaks('\nfirst\nsecond\n'));
});

it.each(['', ' ', '  ', '\t'])('protects an asterisk after a line break and %j', (space) => {
  expect(latexLineBreaks(`first\n${space}* second`)).toBe(`first\\\\\n${space}{}* second`);
});

it('still reads bold and italic markers after a line break', () => {
  expect(processBodyText('first\n*second*')).toContain('\\textit{second}');
  expect(processBodyText('first\n**second**')).toContain('\\textbf{second}');
});
