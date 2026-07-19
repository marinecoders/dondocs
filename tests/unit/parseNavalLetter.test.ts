import { describe, it, expect } from 'vitest';
import { parseNavalLetter } from '@/lib/parseNavalLetter';

// A complete, well-formed naval letter as pdftotext would render it: the
// identification block, the header, a two-level paragraph tree, and the
// signature. The parser's job is to reverse this into editable fields.
const FULL_LETTER = `
                                                            UNITED STATES MARINE CORPS
                                                        1ST BATTALION, 6TH MARINES
                                                        PSC BOX 20123
                                                        CAMP LEJEUNE, NC 28542-0123

                                                                        5216
                                                                        Ser 1710/024
                                                                        15 Jan 25

From:  Commanding Officer, 1st Battalion, 6th Marines
To:    Sergeant J. A. Doe, USMC

Subj:  APPOINTMENT AS MARINE SECURITY GUARD REPRESENTATIVE

Ref:   (a) SECNAVINST 5216.5
       (b) MCO 1500.5

Encl:  (1) Duty Roster dtd 1 Jan 25

1.  Per the references, you are hereby appointed as the MSG Representative.

    a.  This duty is effective immediately.

    b.  It is automatically revoked on transfer.

2.  Direct questions to the S-1.

                                                                        R. L. SMITH
`;

describe('parseNavalLetter — full letter', () => {
  const p = parseNavalLetter(FULL_LETTER);

  it('reads the identification block (SSIC / serial / date)', () => {
    expect(p.ssic).toBe('5216');
    expect(p.serial).toBe('1710/024');
    expect(p.date).toBe('15 Jan 25');
  });

  it('reads From / To / Subj', () => {
    expect(p.from).toBe('Commanding Officer, 1st Battalion, 6th Marines');
    expect(p.to).toBe('Sergeant J. A. Doe, USMC');
    expect(p.subject).toBe('APPOINTMENT AS MARINE SECURITY GUARD REPRESENTATIVE');
  });

  it('splits references and enclosures into titled items', () => {
    expect(p.references).toEqual(['SECNAVINST 5216.5', 'MCO 1500.5']);
    expect(p.enclosures).toEqual(['Duty Roster dtd 1 Jan 25']);
  });

  it('builds the paragraph tree with SECNAV levels', () => {
    expect(p.paragraphs).toEqual([
      { text: 'Per the references, you are hereby appointed as the MSG Representative.', level: 0 },
      { text: 'This duty is effective immediately.', level: 1 },
      { text: 'It is automatically revoked on transfer.', level: 1 },
      { text: 'Direct questions to the S-1.', level: 0 },
    ]);
  });

  it('reads the signature into initials + surname', () => {
    expect(p.signature).toEqual({ first: 'R', middle: 'L', last: 'SMITH' });
  });
});

describe('parseNavalLetter — via addressees', () => {
  it('stores multiple via as newline-separated entries, stripping source numbering', () => {
    // The generator re-adds "(1)/(2)"; the parsed value must not bake them in.
    const p = parseNavalLetter(
      ['From: A', 'Via:  (1) Commanding Officer', '      (2) Regional Commander', '', '1. Body.'].join('\n')
    );
    expect(p.via).toBe('Commanding Officer\nRegional Commander');
  });

  it('handles an inline numbered via on one line', () => {
    const p = parseNavalLetter('From: A\nVia: (1) First Official (2) Second Official\n\n1. Body.');
    expect(p.via).toBe('First Official\nSecond Official');
  });

  it('keeps a single via as one unnumbered line', () => {
    const p = parseNavalLetter('From: A\nVia: Assistant Chief of Staff, G-1\n\n1. Body.');
    expect(p.via).toBe('Assistant Chief of Staff, G-1');
  });
});

describe('parseNavalLetter — copy to', () => {
  it('captures a Copy to block after the signature, one recipient per line', () => {
    const p = parseNavalLetter(
      ['1. Body.', '', '                 R. L. SMITH', '', 'Copy to:', 'G-3/5', 'G-4', 'Regimental S-3'].join('\n')
    );
    expect(p.copyTos).toEqual(['G-3/5', 'G-4', 'Regimental S-3']);
  });

  it('captures an inline "Copy to: X" plus following lines', () => {
    const p = parseNavalLetter(['1. Body.', '', 'Copy to: First Command', 'Second Command'].join('\n'));
    expect(p.copyTos).toEqual(['First Command', 'Second Command']);
  });

  it('stops the copy-to list at a Distribution block', () => {
    const p = parseNavalLetter(
      ['1. Body.', '', 'Copy to:', 'Alpha Co', '', 'Distribution:', 'List B'].join('\n')
    );
    expect(p.copyTos).toEqual(['Alpha Co']);
  });

  it('is empty when there is no copy-to block', () => {
    expect(parseNavalLetter('1. Body.').copyTos).toEqual([]);
  });
});

describe('parseNavalLetter — paragraph levels', () => {
  it('maps 1. / a. / (1) / (a) to levels 0–3', () => {
    const p = parseNavalLetter(
      ['1.  Top.', '    a.  Sub.', '        (1) Subsub.', '            (a) Deep.'].join('\n')
    );
    expect(p.paragraphs.map((x) => x.level)).toEqual([0, 1, 2, 3]);
    expect(p.paragraphs.map((x) => x.text)).toEqual(['Top.', 'Sub.', 'Subsub.', 'Deep.']);
  });

  it('rejoins a paragraph wrapped across lines', () => {
    const p = parseNavalLetter('1.  This sentence was wrapped\nacross two output lines.');
    expect(p.paragraphs).toEqual([
      { text: 'This sentence was wrapped across two output lines.', level: 0 },
    ]);
  });

  it('does not read a paren item as an arabic paragraph', () => {
    // "(1)" must be level 2, never level 0 from a naive "1." test.
    const p = parseNavalLetter('(1) A subsubparagraph standing alone.');
    expect(p.paragraphs[0].level).toBe(2);
  });
});

describe('parseNavalLetter — resilience', () => {
  it('stops the body at a Copy to / Distribution block', () => {
    const p = parseNavalLetter(
      ['1.  Body paragraph.', '', 'Copy to:', 'Some Command'].join('\n')
    );
    expect(p.paragraphs).toEqual([{ text: 'Body paragraph.', level: 0 }]);
  });

  it('handles an inline Ref list on one line', () => {
    const p = parseNavalLetter('Ref:  (a) First (b) Second (c) Third\n\n1. Body.');
    expect(p.references).toEqual(['First', 'Second', 'Third']);
  });

  it('reads a one-initial signature (no middle name)', () => {
    const p = parseNavalLetter('1. Body.\n\n                 A. DOE');
    expect(p.signature).toEqual({ first: 'A', middle: '', last: 'DOE' });
  });

  it('keeps a prefixed surname capital (McNALLY)', () => {
    const p = parseNavalLetter('1. Body.\n\n                 P. W. McNALLY');
    expect(p.signature).toEqual({ first: 'P', middle: 'W', last: 'McNALLY' });
  });

  it('never throws on unstructured text, and treats it as body', () => {
    const p = parseNavalLetter('just some free text with no structure at all');
    expect(p.from).toBeUndefined();
    expect(p.references).toEqual([]);
    // No numbered paragraphs → nothing captured, but no crash.
    expect(p.paragraphs).toEqual([]);
  });

  it('accepts long-form labels (Subject:, Reference:, Enclosure:)', () => {
    const p = parseNavalLetter(
      ['From: A', 'Subject: THE SUBJECT', 'Reference: (a) X', 'Enclosure: (1) Y', '', '1. Body.'].join(
        '\n'
      )
    );
    expect(p.subject).toBe('THE SUBJECT');
    expect(p.references).toEqual(['X']);
    expect(p.enclosures).toEqual(['Y']);
  });

  it('reads a bare four-digit serial under the SSIC (DonDocs prints no "Ser")', () => {
    // The identification block stacks SSIC / serial / date; DonDocs renders the
    // serial as a bare "0042", which a shape-only test would drop as an SSIC.
    const p = parseNavalLetter(['1650', '0042', '4 Jan 26', '', 'From: A', '', '1. Body.'].join('\n'));
    expect(p.ssic).toBe('1650');
    expect(p.serial).toBe('0042');
    expect(p.date).toBe('4 Jan 26');
  });

  it('does not mistake a body number for an SSIC', () => {
    // 5216-shaped numbers below the header must not be claimed as identification.
    const p = parseNavalLetter('From: A\n\n1. Reference 5216 in the body.');
    expect(p.ssic).toBeUndefined();
  });
});
