import { describe, it, expect } from 'vitest';
import {
  getEditorSections,
  getFormSectionError,
  getSectionError,
  completenessFrom,
  ERROR_BEARING_IDS,
} from '@/components/layout/editorSections';
import { DOC_TYPE_CONFIG } from '@/types/document';

const ids = (docType: string) =>
  getEditorSections(DOC_TYPE_CONFIG[docType], docType).map((s) => s.id);

const labelOf = (docType: string, id: string) =>
  getEditorSections(DOC_TYPE_CONFIG[docType], docType).find((s) => s.id === id)?.label;

describe('getEditorSections — false-positive section fixes', () => {
  it('naval_letter keeps letterhead and signature', () => {
    const x = ids('naval_letter');
    expect(x[0]).toBe('letterhead');
    expect(x).toContain('signature');
  });

  it('letterhead:false default-branch type omits letterhead', () => {
    expect(DOC_TYPE_CONFIG.plain_paper_memorandum.letterhead).toBe(false);
    expect(ids('plain_paper_memorandum')).not.toContain('letterhead');
    expect(ids('plain_paper_memorandum')[0]).toBe('addressing');
  });

  it('information_memorandum (executive) omits signature', () => {
    const x = ids('information_memorandum');
    expect(x[0]).toBe('executive');
    expect(x).not.toContain('signature');
  });

  it('standard_memorandum / action_memorandum (executive) keep signature', () => {
    expect(ids('standard_memorandum')).toContain('signature');
    expect(ids('action_memorandum')).toContain('signature');
  });

  it('mfr drops letterhead/copy-to/distribution and labels the heading "Heading"', () => {
    const x = ids('mfr');
    expect(x).toEqual(['addressing', 'classification', 'body', 'references', 'enclosures', 'signature']);
    expect(x).not.toContain('letterhead');
    expect(x).not.toContain('copyto');
    expect(x).not.toContain('distribution');
    expect(labelOf('mfr', 'addressing')).toBe('Heading');
  });

  it('mfr is gated on docType, not the shared uiMode:memo (other memo types keep their sections)', () => {
    // letterhead_memorandum is also uiMode:'memo' but must NOT lose copy-to/distribution.
    expect(DOC_TYPE_CONFIG.letterhead_memorandum.uiMode).toBe('memo');
    expect(ids('letterhead_memorandum')).toContain('copyto');
    expect(ids('letterhead_memorandum')).toContain('distribution');
  });

  it('endorsements get a "Basic Letter" section ahead of addressing', () => {
    for (const t of ['same_page_endorsement', 'new_page_endorsement']) {
      const x = ids(t);
      expect(x).toContain('basic');
      expect(x.indexOf('basic')).toBeLessThan(x.indexOf('addressing'));
      expect(labelOf(t, 'basic')).toBe('Basic Letter');
    }
    // same-page has no letterhead (it sits on the basic letter); new-page does.
    expect(ids('same_page_endorsement')).not.toContain('letterhead');
    expect(ids('new_page_endorsement')).toContain('letterhead');
  });

  it('non-endorsement types have no Basic Letter section', () => {
    expect(ids('naval_letter')).not.toContain('basic');
  });
});

describe('getSectionError — letterhead respects optionalLetterhead', () => {
  const noParas: { text?: string }[] = [];
  it('flags an empty letterhead on a required-letterhead type (naval_letter)', () => {
    expect(getSectionError('letterhead', { unitLine1: '' }, noParas, DOC_TYPE_CONFIG.naval_letter)).toBe(true);
  });
  it('does NOT flag an empty letterhead when the type allows plain paper (mfr is optionalLetterhead)', () => {
    expect(DOC_TYPE_CONFIG.mfr.optionalLetterhead).toBe(true);
    expect(getSectionError('letterhead', { unitLine1: '' }, noParas, DOC_TYPE_CONFIG.mfr)).toBe(false);
  });
});

describe('getSectionError — addressing only flags fields the doc type exposes', () => {
  const noParas: { text?: string }[] = [];
  // Defaults a fresh doc ships with: To is a bracket placeholder, From/Subject blank.
  const blankish = { from: '', to: '[RECIPIENT]', subject: '' };

  it('flags From/To/Subject on a full From/To letter (naval_letter)', () => {
    expect(DOC_TYPE_CONFIG.naval_letter.fromTo).toBe(true);
    expect(getSectionError('addressing', blankish, noParas, DOC_TYPE_CONFIG.naval_letter)).toBe(true);
    expect(getSectionError('addressing', { from: 'CO', to: 'CG', subject: 'X' }, noParas, DOC_TYPE_CONFIG.naval_letter)).toBe(false);
  });

  it('does NOT flag From/To on MFR (fromTo:false, no recipientAddress) — only Subject is required', () => {
    expect(DOC_TYPE_CONFIG.mfr.fromTo).toBe(false);
    expect(DOC_TYPE_CONFIG.mfr.recipientAddress).toBeFalsy();
    // From/To are unfillable for MFR, so a Subject-only doc must be clean.
    expect(getSectionError('addressing', { ...blankish, subject: 'For the record' }, noParas, DOC_TYPE_CONFIG.mfr)).toBe(false);
    // ...but a blank Subject still errors.
    expect(getSectionError('addressing', { ...blankish, subject: '' }, noParas, DOC_TYPE_CONFIG.mfr)).toBe(true);
  });

  it('does NOT flag From on a business letter (recipientAddress, no From), but still checks To + Subject', () => {
    expect(DOC_TYPE_CONFIG.business_letter.fromTo).toBe(false);
    expect(DOC_TYPE_CONFIG.business_letter.recipientAddress).toBe(true);
    // From blank is fine (no From field); empty To still errors.
    expect(getSectionError('addressing', { from: '', to: '', subject: 'X' }, noParas, DOC_TYPE_CONFIG.business_letter)).toBe(true);
    expect(getSectionError('addressing', { from: '', to: 'Acme Corp', subject: 'X' }, noParas, DOC_TYPE_CONFIG.business_letter)).toBe(false);
  });

  it('flags the Memorandum For addressee (mf writes the MEMORANDUM FOR line from `to`)', () => {
    expect(DOC_TYPE_CONFIG.mf.fromTo).toBe(false);
    expect(DOC_TYPE_CONFIG.mf.memoTitle).toBe('MEMORANDUM FOR');
    // The addressee field is required — a blank (or placeholder) To errors...
    expect(getSectionError('addressing', { from: '', to: '', subject: 'X' }, noParas, DOC_TYPE_CONFIG.mf)).toBe(true);
    expect(getSectionError('addressing', { from: '', to: '[RECIPIENT]', subject: 'X' }, noParas, DOC_TYPE_CONFIG.mf)).toBe(true);
    // ...and a real addressee clears it (From stays unfillable, so blank From is fine).
    expect(getSectionError('addressing', { from: '', to: 'Distribution List', subject: 'X' }, noParas, DOC_TYPE_CONFIG.mf)).toBe(false);
  });
});

describe('getSectionError — executive/joint-memo heading sections validate their Subject', () => {
  const noParas: { text?: string }[] = [];

  it('the affected doc types really expose these section ids', () => {
    // standard_memorandum (uiMode:executive) → "Heading" id 'executive';
    // joint_memorandum (uiMode:joint_memo) → "Commands" id 'joint_memo'.
    expect(ids('standard_memorandum')).toContain('executive');
    expect(ids('joint_memorandum')).toContain('joint_memo');
  });

  it('flags an empty Subject on an executive memo heading (previously fell through to default:false)', () => {
    expect(getSectionError('executive', { subject: '' }, noParas, DOC_TYPE_CONFIG.standard_memorandum)).toBe(true);
    expect(getSectionError('executive', { subject: 'POLICY UPDATE' }, noParas, DOC_TYPE_CONFIG.standard_memorandum)).toBe(false);
  });

  it('flags an empty Subject on a joint memo Commands section', () => {
    expect(getSectionError('joint_memo', { subject: '' }, noParas, DOC_TYPE_CONFIG.joint_memorandum)).toBe(true);
    expect(getSectionError('joint_memo', { subject: 'JOINT GUIDANCE' }, noParas, DOC_TYPE_CONFIG.joint_memorandum)).toBe(false);
  });

  it('treats a bracket placeholder subject as unfilled', () => {
    expect(getSectionError('executive', { subject: '[SUBJECT]' }, noParas, DOC_TYPE_CONFIG.standard_memorandum)).toBe(true);
  });
});

describe('documentCompleteness — one rule feeds the rail and the readiness meter', () => {
  it('ERROR_BEARING_IDS stays in lockstep with getSectionError (incl. executive/joint_memo)', () => {
    // The rail dots filter by this list; if it drifts from getSectionError's
    // cases, a flagged section never shows a dot (the bug this consolidation fixed).
    for (const id of ['letterhead', 'addressing', 'body', 'signature', 'executive', 'joint_memo']) {
      expect(ERROR_BEARING_IDS).toContain(id);
    }
  });

  it('completenessFrom counts only required sections and reports readiness', () => {
    const required = ['letterhead', 'addressing', 'body', 'signature'];
    const allGood = completenessFrom(required, () => false);
    expect(allGood).toMatchObject({ required: 4, complete: 4, ratio: 1, isReady: true, missing: [] });

    const twoMissing = completenessFrom(required, (id) => id === 'body' || id === 'signature');
    expect(twoMissing).toMatchObject({ required: 4, complete: 2, isReady: false });
    expect(twoMissing.ratio).toBeCloseTo(0.5);
    expect(twoMissing.missing).toEqual(['body', 'signature']);
  });

  it('an empty required set is never "ready" (ratio 0, not 1)', () => {
    expect(completenessFrom([], () => false)).toMatchObject({ required: 0, ratio: 0, isReady: false });
  });
});

describe('getFormSectionError — forms parity', () => {
  it('flags 10274 addressing/content when essentials blank', () => {
    expect(getFormSectionError('navmc_10274', 'addressing', { from: '', to: '' })).toBe(true);
    expect(getFormSectionError('navmc_10274', 'addressing', { from: 'X', to: 'Y' })).toBe(false);
    expect(getFormSectionError('navmc_10274', 'content', { natureOfAction: '' })).toBe(true);
    expect(getFormSectionError('navmc_10274', 'content', { natureOfAction: 'PFT' })).toBe(false);
  });

  it('flags 11811 marine/content when essentials blank', () => {
    expect(getFormSectionError('navmc_118_11', 'marine', { lastName: '', firstName: '', edipi: '' })).toBe(true);
    expect(getFormSectionError('navmc_118_11', 'marine', { lastName: 'A', firstName: 'B', edipi: '1' })).toBe(false);
    expect(getFormSectionError('navmc_118_11', 'content', { remarksText: '' })).toBe(true);
    expect(getFormSectionError('navmc_118_11', 'content', { remarksText: 'note' })).toBe(false);
    // Two-column remarks: either column alone is valid; right-only must NOT error.
    expect(getFormSectionError('navmc_118_11', 'content', { remarksText: '', remarksTextRight: 'right' })).toBe(false);
    expect(getFormSectionError('navmc_118_11', 'content', { remarksText: '', remarksTextRight: '' })).toBe(true);
  });
});
