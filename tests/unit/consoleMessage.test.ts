import { describe, expect, it } from 'vitest';
import { formatConsoleMessage } from '@/lib/consoleMessage';

describe('plain-text console messages', () => {
  it('removes styling without losing later substitutions or diagnostic data', () => {
    expect(formatConsoleMessage(['%cLoaded %s%c', 'color: blue', 'document', '', { pages: 2 }]))
      .toBe('Loaded document {\n  "pages": 2\n}');
  });
  it('preserves unfilled markers and literal percentages', () => {
    expect(formatConsoleMessage(['literal %c'])).toBe('literal %c');
    expect(formatConsoleMessage(['%s: 100%%, %c', 'Done'])).toBe('Done: 100%, %c');
  });
  it('retains useful errors and handles circular or missing values', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(formatConsoleMessage([new Error('offline'), undefined, circular])).toBe('Error: offline undefined [object Object]');
  });
  it('keeps numeric and object substitutions aligned before style arguments', () => {
    expect(formatConsoleMessage(['%i %f %c%o', 12.8, 2.5, 'font-weight:bold', { ok: true }]))
      .toBe('12 2.5 {\n  "ok": true\n}');
  });
});
