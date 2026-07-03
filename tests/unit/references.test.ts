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

// No-regression guard: EVERY citation string the two former inline arrays
// surfaced (verbatim below) must still be discoverable in the unified dataset.
// The check derives the realistic search token from each original title (its
// order identifier, or the whole quick-insert phrase) and asserts a hit — so a
// directive dropped from the library, or silently regressed to an older
// revision letter, fails CI.
const FORMER_GENERAL_ARRAY = [
  'MCO 5215.1L - Directives Management Program',
  'MCO 5216.20 - Correspondence Manual',
  'MCO 5210.11F - Record Management Program',
  'MCO 1650.19K - Decorations and Awards',
  'MCO 1900.16 - Separation and Retirement',
  'MCO 1001R.1L - MCTFS User Manual',
  'MCO 1020.34H - Marine Corps Uniform Regulations',
  'MCO 3000.11B - Marine Air Ground Task Force Staff Training Program',
  'MCO 3500.27C - Operational Risk Management',
  'MCO 5580.2B - Law Enforcement Manual',
  'SECNAV M-5210.1 - Department of the Navy Records Management Manual',
  'SECNAV M-5216.5 - Department of the Navy Correspondence Manual',
  'SECNAV M-5239.2 - DON Cybersecurity Program',
  'SECNAVINST 5211.5F - Privacy Act',
  'SECNAVINST 5510.30C - DON Personnel Security Program',
  'SECNAVINST 5510.36B - DON Information Security Program',
  'MCBul 5216 - Correspondence Procedures',
  'MCBul 1020 - Uniform Board Decisions',
  'U.S. Navy Regulations, 1990',
  'OPNAVINST 5215.17A - Navy Directives Issuance System',
  'MCRP 3-0B - How to Conduct Training',
  'MCWP 5-10 - Marine Corps Planning Process',
  'Reference (a)',
  'Basic Correspondence',
  'Endorsement 1',
];
const FORMER_FORM_ARRAY = [
  'MCO 1610.7A - Performance Evaluation System',
  'MCO 1900.16 - Separation and Retirement Manual',
  'MCO 1070.12K - Individual Records Administration Manual',
  'MCO P1080.20 - Marine Corps Promotions Manual',
  'MCO 1001R.1L - MCTFS User Manual',
  'MCO 6100.13A W/CH 1 - Marine Corps Physical Fitness and Combat Fitness Tests',
  'MCO 6110.3A - Marine Corps Body Composition and Military Appearance Program',
  'MCO 5800.16A - Marine Corps Manual for Legal Administration (LEGADMINMAN)',
  'MCO 1752.5C - Sexual Assault Prevention and Response Program',
  'MCO 5354.1F - Marine Corps Prohibited Activities and Conduct Prevention',
  'JAGMAN - Manual of the Judge Advocate General',
  'MCO 1020.34H - Marine Corps Uniform Regulations',
  'MCO P1100.72C - Military Occupational Specialties Manual',
  'MCO 5300.17A - Marine Corps Substance Abuse Program',
  'MCO 5300.6 - Urinalysis Program',
  'MCO 1050.3J - Regulations for Leave, Liberty, and Administrative Absence',
  'MCO 1510.118 - Individual Training Standards',
  'MCO 3500.27C - Operational Risk Management',
  'MCO 5100.29C - Marine Corps Safety Program',
  'MCO 5100.19F - Marine Corps Traffic Safety Program',
  'UCMJ Article 86 - Absence Without Leave',
  'UCMJ Article 91 - Insubordinate Conduct',
  'UCMJ Article 92 - Failure to Obey Order or Regulation',
  'UCMJ Article 107 - False Official Statements',
  'UCMJ Article 112a - Wrongful Use of Controlled Substances',
  'UCMJ Article 128 - Assault',
  'UCMJ Article 134 - General Article',
  'MCO 7220.52F - Marine Corps Indebtedness Processing Procedures',
];

/** The token a user would realistically type to find a given original entry. */
function searchTokenFor(title: string): string {
  // Quick-insert pseudo-entries with no order number: search the whole phrase.
  if (!title.includes(' - ') && !title.includes('Article')) {
    return title.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const head = title.split(' - ')[0];
  const num = head.match(/\b([A-Z]?\d{3,5}[.-]\d+[A-Za-z]?|\d-\d+[A-Za-z]?|Article \d+[a-z]?)\b/);
  return num ? num[1] : head.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('no regression vs the former inline modal arrays', () => {
  it.each([...FORMER_GENERAL_ARRAY, ...FORMER_FORM_ARRAY])(
    'still surfaces "%s"',
    (originalTitle) => {
      expect(searchReferences(searchTokenFor(originalTitle)).length).toBeGreaterThan(0);
    },
  );
});
