import { describe, it, expect } from 'vitest';
import { generateDocumentTex, generateBodyTex } from '@/services/latex/generator';

const store = (endItems: Array<Record<string, string>>) => ({
  docType: 'i_type',
  formData: { docType: 'i_type', nomenclature: 'COMBAT OPERATIONS CENTER' },
  references: [], enclosures: [], paragraphs: [], copyTos: [], distributions: [],
  endItems,
}) as never;

const item = (n: number) => ({ nsn: `NSN${n}`, tamcn: `T${n}`, id: `I${n}`, model: `M${n}` });

describe('I-Type cover', () => {
  it('always prints six rows, keeping unused ones blank', () => {
    const tex = generateDocumentTex(store([item(1), item(2)]));
    // Five row separators means six rows, however few end items there are.
    expect(tex.match(/\\hline/g)?.length).toBe(5);
    expect(tex).toContain('NSN1 & T1 & I1 & M1');
    expect(tex).toContain('\\EndItemOverflowfalse');
  });

  it('moves the list off the cover once there is a seventh item', () => {
    const tex = generateDocumentTex(store(Array.from({ length: 7 }, (_, i) => item(i + 1))));
    expect(tex).toContain('\\EndItemOverflowtrue');
    // Nothing is listed on the cover itself in the overflow case.
    expect(tex).not.toContain('\\setEndItemRows{NSN1');
  });

  it('lists every end item on the back of the cover when it overflows', () => {
    const tex = generateDocumentTex(store(Array.from({ length: 7 }, (_, i) => item(i + 1))));
    const overflow = tex.match(/\\setEndItemOverflowRows\{([^}]*)\}/)?.[1] ?? '';
    // All seven, and no blank padding rows -- the six-row rule is the cover's.
    for (let n = 1; n <= 7; n++) expect(overflow).toContain(`NSN${n} & T${n}`);
    expect(overflow.split('\\\\').length).toBe(7);
  });

  it('carries the nomenclature', () => {
    expect(generateDocumentTex(store([]))).toContain('\\setNomenclature{COMBAT OPERATIONS CENTER}');
  });

  it('names the publication type, and asks only a modification to record completion', () => {
    const named = (publicationType?: string) => generateDocumentTex({
      ...store([]), formData: { docType: 'i_type', publicationType },
    } as never);
    expect(named(undefined)).toContain('\\setPublicationTypeName{Modification Instruction}');
    expect(named(undefined)).toContain('\\RecordingInstructiontrue');
    expect(named('TI')).toContain('\\setPublicationTypeName{Technical Instruction}');
    expect(named('TI')).toContain('\\RecordingInstructionfalse');
  });

  it('prints its date in full', () => {
    const tex = generateDocumentTex({ ...store([]), formData: { docType: 'i_type', date: '15 Dec 24' } } as never);
    expect(tex).toContain('\\setDocumentDate{15 December 2024}');
  });

  it('places a figure with its numbered title, and does not number it as a paragraph', () => {
    const tex = generateBodyTex({
      ...store([]), formData: { docType: 'i_type' },
      paragraphs: [
        { text: 'To provide instructions.', level: 0, header: 'Purpose' },
        { text: 'Rail alignment', level: 0, figure: { fileRef: { id: 'x', name: 'rail.png', size: 1, type: 'image/png' }, name: 'rail.png', type: 'image/png' } },
        { text: 'Remove the stock.', level: 0 },
      ],
    } as never);
    expect(tex).toContain('\\includegraphics[width=\\textwidth,height=5in,keepaspectratio]{attachments/figure-1.png}');
    expect(tex).toContain('Rail alignment}');
    expect(tex).toContain('\\textbf{2.}~~Remove the stock.');
  });

  it('carries the controlling office', () => {
    const tex = generateDocumentTex({ ...store([]), formData: { docType: 'i_type', controllingOffice: 'PM IW' } } as never);
    expect(tex).toContain('\\setControllingOffice{PM IW}');
  });

  it('numbers a figure afresh inside an appendix, with its letter, and drops a trailing period', () => {
    const fig = (text: string) => ({ text, level: 0, figure: { fileRef: { id: 'x', name: 'r.png', size: 1, type: 'image/png' }, name: 'r.png', type: 'image/png' } });
    const tex = generateBodyTex({
      ...store([]), formData: { docType: 'i_type' },
      paragraphs: [fig('Rail alignment.'), { text: 'Values.', level: 0, header: 'Torque Values', appendix: true }, fig('Torque chart')],
    } as never);
    expect(tex).toContain('\\textbf{Figure 1.\\hspace{2\\fontdimen2\\font}Rail alignment}');
    expect(tex).toContain('\\textbf{Figure A-1.\\hspace{2\\fontdimen2\\font}Torque chart}');
    // Files are numbered in sequence whatever the label says.
    expect(tex).toContain('attachments/figure-2.png');
  });

  it('sets a parts table as a longtable that repeats its boxhead under a Continued line', () => {
    const tex = generateBodyTex({
      ...store([]), formData: { docType: 'i_type' },
      paragraphs: [{ text: '', level: 0, header: 'Materiel Required', tableKey: 'materielRequired' }],
      publicationTables: { materielRequired: [{ values: { description: 'KIT', nsn: '1', pn: '2', qty: '1' } }] },
    } as never);
    expect(tex).toContain('\\begin{longtable}[l]');
    expect(tex).toContain('\\textit{Materiel Required -- Continued}');
    expect(tex).toContain('\\endhead');
    // No closing rule at the foot of a continued table; one at the last.
    expect(tex).toMatch(/\\endfoot\s+\\hline\s+\\endlastfoot/);
  });

  it('centres a CAGE code under the part number', () => {
    const tex = generateBodyTex({
      ...store([]), formData: { docType: 'i_type' },
      paragraphs: [{ text: '', level: 0, header: 'Materiel Required', tableKey: 'materielRequired' }],
      publicationTables: { materielRequired: [{ values: { description: 'CAP, Blank', nsn: '', pn: '74024019 (1CSL0)', qty: '4' } }] },
    } as never);
    expect(tex).toContain('74024019\\par\\centering(1CSL0)');
  });
});
