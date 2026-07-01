import { describe, it, expect } from 'vitest';
import { composeBasicLetterId, refWordForDocType } from '@/lib/endorsement';

describe('refWordForDocType', () => {
  it('maps letters to ltr and memoranda to memo, defaulting to ltr', () => {
    expect(refWordForDocType('naval_letter')).toBe('ltr');
    expect(refWordForDocType('standard_memorandum')).toBe('memo');
    expect(refWordForDocType('mfr')).toBe('memo');
    expect(refWordForDocType('something_new')).toBe('ltr');
  });
});

describe('composeBasicLetterId', () => {
  it('composes originator + type + SSIC + Ser + date from the basic letter', () => {
    expect(
      composeBasicLetterId({
        docType: 'naval_letter',
        formData: {
          from: 'Commanding Officer, USS SCRANTON',
          ssic: '3000',
          serial: '001',
          date: '15 Jan 25',
        },
      })
    ).toBe('Commanding Officer, USS SCRANTON ltr 3000 Ser 001 of 15 Jan 25');
  });

  it('drops parts the basic letter does not have (no date → no "of")', () => {
    expect(
      composeBasicLetterId({ docType: 'naval_letter', formData: { from: 'CO', ssic: '5216' } })
    ).toBe('CO ltr 5216');
  });

  it('treats bracketed placeholders as absent', () => {
    expect(
      composeBasicLetterId({
        docType: 'naval_letter',
        formData: { from: '[FROM]', ssic: '[SSIC]', serial: '007', date: '' },
      })
    ).toBe('ltr Ser 007');
  });

  it('falls back to the unit letterhead line when From is empty', () => {
    expect(
      composeBasicLetterId({ docType: 'naval_letter', formData: { unitLine1: 'USS SCRANTON', ssic: '3000' } })
    ).toBe('USS SCRANTON ltr 3000');
  });

  it('uses the memo word for a memorandum being endorsed', () => {
    expect(
      composeBasicLetterId({ docType: 'standard_memorandum', formData: { from: 'CG', ssic: '1000' } })
    ).toBe('CG memo 1000');
  });
});
