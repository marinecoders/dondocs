/**
 * Every document type composes the sender's symbol the same way in both formats.
 *
 * The two generators build this block independently, and a fix applied to one
 * silently leaves the other behind: composing only `buildSSICBlock` left the
 * joint and MOA layouts printing a bare serial in Word while the PDF printed
 * `Ser Code 13/271`. Nothing failed — the documents just disagreed.
 *
 * So this walks every type rather than sampling one.
 */
import { describe, it, expect } from 'vitest';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';

/** Types that print a sender's symbols block. */
const WITH_SYMBOLS = [
  'naval_letter', 'standard_letter', 'letterhead_memorandum',
  'multiple_address_letter', 'mf', 'joint_letter', 'joint_memorandum', 'moa', 'mou',
];

const COMPOSED = 'Ser Code 13/271';

function store(docType: string) {
  return {
    docType,
    formData: {
      docType, fontSize: '12pt', fontFamily: 'times', pageNumbering: 'none', department: 'usmc',
      unitLine1: 'UNIT', unitAddress: 'ADDR', sealType: 'dow', letterheadColor: 'blue',
      ssic: '5216', serial: '271', officeCode: 'Code 13', date: '7 Sep 06',
      seniorSSIC: '5216', seniorSerial: '271', seniorDate: '7 Sep 06',
      juniorSSIC: '5216', juniorSerial: '099', juniorDate: '7 Sep 06',
      jointJuniorSSIC: '5216', jointJuniorSerial: '099', jointJuniorDate: '7 Sep 06',
      from: 'CO', to: 'CG', subject: 'S', jointSubject: 'S', moaSubject: 'S',
      sigFirst: 'J', sigLast: 'DOE', sigRank: 'LtCol', classLevel: 'unclassified',
    },
    references: [], enclosures: [], paragraphs: [{ text: 'B.', level: 0 }],
    copyTos: [], distributions: [],
  } as never;
}

describe('sender symbol parity across document types', () => {
  it.each(WITH_SYMBOLS)('%s composes it in the PDF output', (docType) => {
    expect(JSON.stringify(generateAllLatexFiles(store(docType)))).toContain(COMPOSED);
  });

  it.each(WITH_SYMBOLS)('%s composes it in the DOCX output', (docType) => {
    expect(generateFlatLatex(store(docType))).toContain(COMPOSED);
  });

  it('prints supplied symbols in business letters and omits them in executive correspondence', () => {
    const business = store('business_letter');
    expect(JSON.stringify(generateAllLatexFiles(business))).toContain(COMPOSED);
    expect(generateFlatLatex(business)).toContain(COMPOSED);
    const executive = store('executive_correspondence');
    expect(JSON.stringify(generateAllLatexFiles(executive))).not.toContain(COMPOSED);
    expect(generateFlatLatex(executive)).not.toContain(COMPOSED);
  });

  it('the junior side of a dual-command block gets the Ser prefix too', () => {
    // The document carries one office code, which belongs to the originator on
    // the senior side; the junior serial still needs its prefix.
    const docx = generateFlatLatex(store('moa'));
    expect(docx).toContain('Ser 099');
  });
});
