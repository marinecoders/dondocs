import { describe, it, expect } from 'vitest';
import { validateClassificationMarkings } from '@/lib/classificationValidation';
import type { Paragraph, PortionMarking } from '@/types/document';

const para = (text: string, portionMarking?: PortionMarking): Paragraph => ({
  text,
  level: 0,
  portionMarking,
});

const severities = (classLevel: string, paragraphs: Paragraph[]) =>
  validateClassificationMarkings(classLevel, paragraphs).map((f) => f.severity);

describe('validateClassificationMarkings — under-marking (the serious case)', () => {
  it('errors when a portion outranks an UNCLASSIFIED banner', () => {
    const findings = validateClassificationMarkings('unclassified', [para('Body.', 'S')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toMatch(/\(S\)/);
    expect(findings[0].message).toMatch(/UNCLASSIFIED/);
  });

  it('errors when a portion outranks a CUI banner', () => {
    // A SECRET portion under a CUI banner is still under-marked.
    expect(severities('cui', [para('a', 'CUI'), para('b', 'S')])).toContain('error');
  });

  it('is clean when the banner equals the highest portion', () => {
    expect(validateClassificationMarkings('secret', [para('a', 'S'), para('b', 'C')])).toEqual([]);
  });
});

describe('validateClassificationMarkings — missing / partial marking', () => {
  it('warns when a classified banner has no portion markings', () => {
    const findings = validateClassificationMarkings('secret', [para('a'), para('b')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toMatch(/no paragraphs carry a portion marking/);
  });

  it('warns when only some paragraphs are marked', () => {
    const findings = validateClassificationMarkings('secret', [para('a', 'S'), para('b')]);
    expect(findings.some((f) => /1 of 2 paragraphs/.test(f.message))).toBe(true);
  });

  it('does not require portion markings on an UNCLASSIFIED document', () => {
    expect(validateClassificationMarkings('unclassified', [para('a'), para('b')])).toEqual([]);
  });

  it('ignores blank rows when counting marked vs unmarked', () => {
    // The trailing blank paragraph must not read as an "unmarked" body paragraph.
    expect(validateClassificationMarkings('secret', [para('a', 'S'), para('   ')])).toEqual([]);
  });
});

describe('validateClassificationMarkings — over-marking', () => {
  it('warns when the banner outranks every portion', () => {
    const findings = validateClassificationMarkings('secret', [para('a', 'C'), para('b', 'C')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toMatch(/highest paragraph marking is \(C\)/);
  });

  it('does not over-mark-warn on the custom (unaccredited) banner', () => {
    // 'custom' ranks with unclassified; a CUI portion under it is an
    // under-marking error, not an over-marking warning.
    expect(severities('custom', [para('a', 'CUI')])).toEqual(['error']);
  });
});

describe('validateClassificationMarkings — FOUO / CUI equivalence', () => {
  it('treats FOUO as CUI-rank (a FOUO portion under a CUI banner is consistent)', () => {
    expect(validateClassificationMarkings('cui', [para('a', 'FOUO')])).toEqual([]);
  });

  it('warns when CUI and legacy FOUO markings are mixed', () => {
    const findings = validateClassificationMarkings('cui', [para('a', 'CUI'), para('b', 'FOUO')]);
    expect(findings.some((f) => /mixes CUI and the legacy FOUO/.test(f.message))).toBe(true);
  });
});

describe('validateClassificationMarkings — no-ops', () => {
  it('returns nothing for an empty document', () => {
    expect(validateClassificationMarkings('secret', [])).toEqual([]);
    expect(validateClassificationMarkings('unclassified', [para('  ')])).toEqual([]);
  });

  it('a fully consistent CUI document has no findings', () => {
    expect(validateClassificationMarkings('cui', [para('a', 'CUI'), para('b', 'CUI')])).toEqual([]);
  });
});
