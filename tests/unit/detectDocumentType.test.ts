import { describe, it, expect } from 'vitest';
import { detectDocumentType, IMPORTABLE_DOC_TYPES } from '@/lib/detectDocumentType';
import { DOC_TYPE_LABELS } from '@/types/document';

describe('detectDocumentType — strong markers (high confidence)', () => {
  it('recognizes a Memorandum for the Record', () => {
    const d = detectDocumentType('MEMORANDUM FOR THE RECORD\n\n1. This documents the meeting.');
    expect(d).toMatchObject({ docType: 'mfr', confidence: 'high' });
  });

  it('recognizes a Memorandum of Agreement', () => {
    const d = detectDocumentType('MEMORANDUM OF AGREEMENT BETWEEN A AND B');
    expect(d).toMatchObject({ docType: 'moa', confidence: 'high' });
  });

  it('recognizes a Memorandum of Understanding', () => {
    const d = detectDocumentType('MEMORANDUM OF UNDERSTANDING\n\n1. Purpose.');
    expect(d).toMatchObject({ docType: 'mou', confidence: 'high' });
  });

  it('recognizes an endorsement by its endorsement line (word ordinal)', () => {
    const d = detectDocumentType(
      'FIRST ENDORSEMENT on CO ltr 1650 Ser 024 of 15 Jan 25\n\nFrom: A\nTo: B'
    );
    expect(d).toMatchObject({ docType: 'new_page_endorsement', confidence: 'high' });
  });

  it('recognizes an endorsement by a numeric ordinal ("2nd Endorsement")', () => {
    const d = detectDocumentType('2nd Endorsement\n\nFrom: A\nTo: B');
    expect(d).toMatchObject({ docType: 'new_page_endorsement', confidence: 'high' });
  });

  it('prefers the record marker over the generic memorandum branch', () => {
    // "MEMORANDUM FOR THE RECORD" contains "MEMORANDUM" — the strong marker wins.
    const d = detectDocumentType('MEMORANDUM FOR THE RECORD');
    expect(d.docType).toBe('mfr');
    expect(d.confidence).toBe('high');
  });
});

describe('detectDocumentType — letters', () => {
  it('recognizes a full From/To/Subj naval letter (high confidence)', () => {
    const d = detectDocumentType(
      ['From: Commanding Officer', 'To: Sergeant Doe', '', 'Subj: APPOINTMENT', '', '1. Body.'].join('\n')
    );
    expect(d).toMatchObject({ docType: 'naval_letter', confidence: 'high' });
  });

  it('recognizes a business letter by salutation + close', () => {
    const d = detectDocumentType('Dear Senator Smith,\n\nThank you for your inquiry.\n\nSincerely,\n\nA. B. Jones');
    expect(d).toMatchObject({ docType: 'business_letter', confidence: 'high' });
  });

  it('does not call a From/To/Subj letter a business letter', () => {
    // Has "Dear"/"Sincerely" cues but a Subj line makes it naval, not business.
    const d = detectDocumentType(
      ['From: A', 'To: B', 'Subj: X', '', 'Dear Sir,', '', '1. Body.', '', 'Sincerely'].join('\n')
    );
    expect(d.docType).toBe('naval_letter');
  });
});

describe('detectDocumentType — low confidence prompts', () => {
  it('flags a generic memorandum for confirmation', () => {
    const d = detectDocumentType('MEMORANDUM FOR ALL HANDS\n\n1. Field day is Friday.');
    expect(d).toMatchObject({ docType: 'plain_paper_memorandum', confidence: 'low' });
  });

  it('flags partial addressing for confirmation', () => {
    const d = detectDocumentType('From: A\n\n1. Body with no To or Subj.');
    expect(d).toMatchObject({ docType: 'naval_letter', confidence: 'low' });
  });

  it('flags unrecognizable text for confirmation', () => {
    const d = detectDocumentType('just some free text with no structure at all');
    expect(d).toMatchObject({ docType: 'naval_letter', confidence: 'low' });
  });
});

describe('detectDocumentType — contract', () => {
  it('always returns an importable doc type', () => {
    const samples = [
      'MEMORANDUM FOR THE RECORD',
      'From: A\nTo: B\nSubj: C',
      'Dear X,\nSincerely',
      'nothing structured',
      'FIRST ENDORSEMENT',
    ];
    for (const s of samples) {
      expect(IMPORTABLE_DOC_TYPES).toContain(detectDocumentType(s).docType as (typeof IMPORTABLE_DOC_TYPES)[number]);
    }
  });

  it('every importable type has a UI label', () => {
    for (const t of IMPORTABLE_DOC_TYPES) {
      expect(DOC_TYPE_LABELS[t]).toBeTruthy();
    }
  });
});
