/**
 * An appointment letter carries the appointee's acknowledgement on its own
 * page: the appointing officer signs, a rule divides the sheet, the appointee
 * endorses back below it (#203). DonDocs could previously only emit the
 * endorsement as its own standalone document — never both halves together.
 *
 * These pin the resolver (who is addressed, when it renders at all) and that
 * both generators agree, since a PDF and a DOCX that disagree about a signed
 * appointment is the worst outcome here.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveAppendedEndorsement,
  appendedEndorsementSigner,
  canAppendEndorsement,
} from '@/lib/appendedEndorsement';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { generateSignatoryTex } from '@/services/latex/generator';

const base = {
  appendEndorsement: true,
  endorsementBody: 'I have read and understand the references listed above.\nI hereby assume the duties.',
  endorsementSigFirst: 'John',
  endorsementSigMiddle: 'A',
  endorsementSigLast: 'Doe',
  from: 'Commanding Officer, 1st Battalion, 6th Marines',
  to: 'Sergeant J. A. DOE, USMC',
};

describe('resolveAppendedEndorsement', () => {
  it('inverts the letter: the appointee answers back to the appointing officer', () => {
    const ack = resolveAppendedEndorsement('naval_letter', base)!;
    expect(ack.from).toBe('Sergeant J. A. DOE, USMC');
    expect(ack.to).toBe('Commanding Officer, 1st Battalion, 6th Marines');
  });

  it('lets an explicit addressee override the inversion', () => {
    const ack = resolveAppendedEndorsement('naval_letter', {
      ...base,
      endorsementFrom: 'Corporal R. J. LEE, USMC',
    })!;
    expect(ack.from).toBe('Corporal R. J. LEE, USMC');
    expect(ack.to).toBe('Commanding Officer, 1st Battalion, 6th Marines');
  });

  it('splits the body into numbered paragraphs, ignoring blank lines', () => {
    const ack = resolveAppendedEndorsement('naval_letter', {
      ...base,
      endorsementBody: 'One.\n\n  \nTwo.\n',
    })!;
    expect(ack.paragraphs).toEqual(['One.', 'Two.']);
  });

  it('renders nothing when the toggle is off', () => {
    expect(resolveAppendedEndorsement('naval_letter', { ...base, appendEndorsement: false })).toBeNull();
  });

  it('renders nothing without addressees to invert', () => {
    expect(
      resolveAppendedEndorsement('naval_letter', { ...base, from: '', to: '' })
    ).toBeNull();
  });

  // An endorsement belongs to a letter. Leaving a stale toggle on after
  // switching to a form or an endorsement must not staple one to it.
  it.each([
    ['naval_letter', true],
    ['standard_letter', true],
    ['same_page_endorsement', false],
    ['moa', false],
    ['business_letter', false],
  ])('%s eligible: %s', (docType, eligible) => {
    expect(canAppendEndorsement(docType)).toBe(eligible);
    if (!eligible) {
      expect(resolveAppendedEndorsement(docType, base)).toBeNull();
    }
  });
});

describe('appendedEndorsementSigner', () => {
  it('abbreviates to initials and surname per Ch 9', () => {
    expect(appendedEndorsementSigner(base)).toBe('J. A. DOE');
  });

  it('handles a missing middle initial', () => {
    expect(appendedEndorsementSigner({ ...base, endorsementSigMiddle: '' })).toBe('J. DOE');
  });
});

describe('both generators emit the acknowledgement', () => {
  const store = {
    docType: 'naval_letter',
    formData: { ...base, docType: 'naval_letter', subject: 'APPOINTMENT', sigFirst: 'Robert', sigLast: 'Smith' },
    references: [],
    enclosures: [],
    paragraphs: [{ text: 'You are hereby appointed.', level: 0 }],
    copyTos: [],
    distributions: [],
  } as never;

  it('flat generator (DOCX) draws the rule, the line, and the signer', () => {
    const tex = generateFlatLatex(store);
    expect(tex).toContain('\\rule{\\textwidth}{0.4pt}');
    expect(tex).toContain('FIRST ENDORSEMENT');
    expect(tex).toContain('Sergeant J. A. DOE, USMC');
    expect(tex).toMatch(/read and understand/);
  });

  it('PDF generator sets the macro main.tex renders', () => {
    const tex = generateSignatoryTex(store);
    expect(tex).toContain('\\setAppendedEndorsement');
    expect(tex).toContain('Sergeant J. A. DOE, USMC');
    expect(tex).toMatch(/read and understand/);
  });

  // Ch 9 ¶2.1a: the endorsement line sits below the date line, which the
  // same-page omission list does not cover. Both outputs must carry it, or a
  // PDF and a DOCX of the same appointment disagree about a signed document.
  it('both carry the endorsement\'s own date and serial', () => {
    const dated = {
      ...(store as Record<string, unknown>),
      formData: { ...base, docType: 'naval_letter', endorsementSerial: 'Ser 1710/024', endorsementDate: '3 Feb 25' },
    } as never;
    for (const tex of [generateFlatLatex(dated), generateSignatoryTex(dated)]) {
      expect(tex).toContain('Ser 1710/024');
      expect(tex).toContain('3 Feb 25');
    }
  });

  it('omits the serial row when hand-dated, without dropping the date line', () => {
    const tex = generateFlatLatex(store);
    expect(tex).not.toContain('Ser 1710/024');
    expect(tex).toContain('FIRST ENDORSEMENT');
  });

  it('neither emits anything when the letter carries no acknowledgement', () => {
    const plain = {
      ...(store as Record<string, unknown>),
      formData: { ...base, appendEndorsement: false, docType: 'naval_letter' },
    } as never;
    expect(generateFlatLatex(plain)).not.toContain('FIRST ENDORSEMENT');
    expect(generateSignatoryTex(plain)).not.toContain('\\setAppendedEndorsement');
  });
});
