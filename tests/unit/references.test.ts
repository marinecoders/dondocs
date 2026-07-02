import { describe, it, expect } from 'vitest';
import {
  ALL_REFERENCES,
  REFERENCE_CATEGORIES,
  formatReference,
  getReference,
  getReferencesByCategory,
  searchReferences,
  type Reference,
} from '@/data/references';

describe('references data integrity', () => {
  it('has unique ids', () => {
    const ids = ALL_REFERENCES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has a title, a category in the canonical list, and keywords', () => {
    for (const r of ALL_REFERENCES) {
      expect(r.title, r.id).toBeTruthy();
      expect(REFERENCE_CATEGORIES, r.id).toContain(r.category);
      expect(Array.isArray(r.keywords), r.id).toBe(true);
    }
  });
});

describe('formatReference', () => {
  const ref = (over: Partial<Reference>): Reference => ({
    id: 'x',
    type: 'MCO',
    number: '1',
    title: 't',
    category: 'Admin',
    keywords: [],
    ...over,
  });

  it('renders "TYPE NUMBER - TITLE" for standard directives', () => {
    expect(
      formatReference(ref({ type: 'MCO', number: '1610.7A', title: 'Performance Evaluation System' })),
    ).toBe('MCO 1610.7A - Performance Evaluation System');
  });

  it('hyphenates SECNAV manuals per citation style', () => {
    expect(
      formatReference(ref({ type: 'SECNAV M', number: '5216.5', title: 'Correspondence Manual' })),
    ).toBe('SECNAV M-5216.5 - Correspondence Manual');
  });

  it('leads with the acronym for Manual-type entries', () => {
    expect(
      formatReference(ref({ type: 'Manual', number: 'UCMJ', title: 'Uniform Code of Military Justice' })),
    ).toBe('UCMJ - Uniform Code of Military Justice');
  });

  it('renders UCMJ articles as "UCMJ Article N - TITLE"', () => {
    expect(
      formatReference(ref({ type: 'UCMJ', number: 'Article 86', title: 'Absence Without Leave' })),
    ).toBe('UCMJ Article 86 - Absence Without Leave');
  });

  it('renders no-number pseudo-entries as their title alone', () => {
    expect(formatReference(ref({ type: 'Common', number: '', title: 'Endorsement 1' }))).toBe('Endorsement 1');
  });
});

describe('searchReferences', () => {
  it('returns everything for an empty query', () => {
    expect(searchReferences('').length).toBe(ALL_REFERENCES.length);
    expect(searchReferences('   ').length).toBe(ALL_REFERENCES.length);
  });

  it('matches on keywords, not just the title', () => {
    // "fitrep" appears only in mco-1610-7's keywords, not its title.
    const hits = searchReferences('fitrep');
    expect(hits.some((r) => r.id === 'mco-1610-7')).toBe(true);
    expect(hits.every((r) => !r.title.toLowerCase().includes('fitrep'))).toBe(true);
  });

  it('requires every whitespace-separated token to match (AND semantics)', () => {
    const hits = searchReferences('fitness report');
    expect(hits.some((r) => r.id === 'mco-1610-7')).toBe(true);
    // A token that matches nothing collapses the result set.
    expect(searchReferences('fitrep zzzznope')).toHaveLength(0);
  });

  it('finds an added UCMJ article by its offense keyword', () => {
    expect(searchReferences('awol').some((r) => r.id === 'ucmj-art-86')).toBe(true);
  });
});

describe('getReference / getReferencesByCategory', () => {
  it('resolves a known id and returns undefined for an unknown one', () => {
    expect(getReference('mco-1610-7')?.number).toBe('1610.7A');
    expect(getReference('nope')).toBeUndefined();
  });

  it('groups in canonical category order and drops empty categories', () => {
    const grouped = getReferencesByCategory(searchReferences('awol')); // Legal only
    expect(Object.keys(grouped)).toEqual(['Legal']);
  });
});

// No-regression guard: every reference the two former inline arrays surfaced
// must still be discoverable via search. Each token below is the distinctive
// identifier from an original entry; a token that returns zero results means
// that reference vanished from the library.
describe('no regression vs the former inline modal arrays', () => {
  const MUST_BE_DISCOVERABLE = [
    // ReferenceLibraryModal (general)
    '5215.1L', '5216.20', '5210.11F', '1650.19', '1900.16', '1001R.1L', '1020.34H',
    '3000.11B', '3500.27C', '5580.2B', 'M-5210.1', '5216.5', '5211.5F', '5510.30C',
    '5510.36B', 'MCBul 5216', 'MCBul 1020', 'Navy Regulations', '5215.17A', 'MCRP',
    'MCWP', 'Reference (a)', 'Basic Correspondence', 'Endorsement 1',
    // FormReferenceLibraryModal (counseling)
    '1610.7A', '1070.12K', 'P1080.20', '6100.13A', '6110.3A', '5800.16A', '1752.5C',
    '5354.1', 'JAGMAN', 'P1100.72C', '5300.17A', '5300.6', '1050.3J', '1510.118',
    '5100.29C', '5100.19F', 'Article 86', 'Article 91', 'Article 92', 'Article 107',
    'Article 112a', 'Article 128', 'Article 134', '7220.52F',
  ];

  it.each(MUST_BE_DISCOVERABLE)('surfaces a result for "%s"', (token) => {
    expect(searchReferences(token).length).toBeGreaterThan(0);
  });
});
