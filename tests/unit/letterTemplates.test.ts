import { describe, it, expect } from 'vitest';
import { LETTER_TEMPLATES } from '@/data/templates';

/**
 * Registry invariants for the letter templates. Each template is hand-authored
 * data; these catch the mistakes a reviewer would — a duplicated id shadowing
 * another template in the browser, a reference list whose letters collide, or
 * an empty body that loads as a blank letter.
 */
describe('LETTER_TEMPLATES registry', () => {
  it('has unique ids', () => {
    const ids = LETTER_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every template is loadable: name, subject, and a non-empty body', () => {
    for (const t of LETTER_TEMPLATES) {
      expect(t.name, t.id).toBeTruthy();
      expect(t.subject, t.id).toBeTruthy();
      expect(t.docType, t.id).toBeTruthy();
      expect(t.paragraphs.length, t.id).toBeGreaterThan(0);
      for (const p of t.paragraphs) {
        expect(p.text.trim(), t.id).not.toBe('');
        expect(p.level, t.id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('reference letters are unique within each template', () => {
    for (const t of LETTER_TEMPLATES) {
      const letters = (t.references ?? []).map((r) => r.letter);
      expect(new Set(letters).size, t.id).toBe(letters.length);
    }
  });

  it('includes the issue-28 templates', () => {
    const ids = new Set(LETTER_TEMPLATES.map((t) => t.id));
    expect(ids.has('records-discrepancy')).toBe(true);
    expect(ids.has('ua-statement')).toBe(true);
    expect(ids.has('certificate-of-relief')).toBe(true);
  });
});
