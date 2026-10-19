import { expect, it } from 'vitest';
import { htmlResponseIndex } from '@/services/latex/logDiagnostics';

it('does not label TeX version banners or PDF dictionaries as HTML', () => {
  const log = 'LaTeX2e <2025-11-01>\n/A << /S /GoTo /D (itype.note.0.1) >>\n! Undefined control sequence.\n';
  expect(htmlResponseIndex(log)).toBe(-1);
});

it.each(['<!doctype html>', '<!DOCTYPE HTML>', '<html>', '<HTML lang="en">'])(
  'locates an HTML response beginning with %s', (html) => {
    expect(htmlResponseIndex(`(missing-package.sty)\n${html}\nNot found`)).toBe(22);
  },
);
