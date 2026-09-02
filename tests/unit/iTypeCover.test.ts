import { describe, it, expect } from 'vitest';
import { generateDocumentTex } from '@/services/latex/generator';

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

  it('carries the controlling office', () => {
    const tex = generateDocumentTex({ ...store([]), formData: { docType: 'i_type', controllingOffice: 'PM IW' } } as never);
    expect(tex).toContain('\\setControllingOffice{PM IW}');
  });
});
