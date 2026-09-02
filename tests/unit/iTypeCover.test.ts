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
    expect(tex).not.toContain('NSN1 & T1');
  });

  it('carries the nomenclature', () => {
    expect(generateDocumentTex(store([]))).toContain('\\setNomenclature{COMBAT OPERATIONS CENTER}');
  });
});
