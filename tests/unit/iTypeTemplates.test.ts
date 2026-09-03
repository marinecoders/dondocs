import { describe, it, expect } from 'vitest';
import { modificationInstruction, supplyInstruction, technicalInstruction, lubricationInstruction } from '@/data/templates/technical';
import { LETTER_TEMPLATES } from '@/data/templates';
import { validateFigures, figureFile } from '@/lib/figures';

describe('the four I-Type templates', () => {
  it('name their publication type', () => {
    expect(modificationInstruction.publicationType).toBe('MI');
    expect(supplyInstruction.publicationType).toBe('SI');
    expect(technicalInstruction.publicationType).toBe('TI');
    expect(lubricationInstruction.publicationType).toBe('LI');
  });

  it('share the skeleton, less the paragraph that belongs to a modification', () => {
    const headers = (t: typeof modificationInstruction) => t.paragraphs.map((p) => p.header);
    expect(headers(modificationInstruction)).toContain('Time Compliance Period');
    for (const t of [supplyInstruction, technicalInstruction, lubricationInstruction]) {
      expect(headers(t)).not.toContain('Time Compliance Period');
      expect(headers(t)).toEqual(headers(modificationInstruction).filter((h) => h !== 'Time Compliance Period'));
      expect(t.docType).toBe('i_type');
    }
  });

  it('are all offered', () => {
    const ids = LETTER_TEMPLATES.map((t) => t.id);
    for (const id of ['modification-instruction', 'supply-instruction', 'technical-instruction', 'lubrication-instruction']) expect(ids).toContain(id);
  });
});

describe('figures', () => {
  it('names a figure missing its image or its title', () => {
    const findings = validateFigures([
      { text: '', level: 0, figure: {} },
      { text: 'Rail alignment', level: 0, figure: { fileRef: { id: 'x', name: 'r.png', size: 1, type: 'image/png' } } },
    ]);
    expect(findings.map((f) => f.message)).toEqual([
      'Figure 1 has no image. Choose a PNG, JPEG, or PDF for it.',
      'Figure 1 has no title. Its text is the title that prints under it.',
    ]);
  });

  it('warns when an image will print soft, from its pixel size', () => {
    const fileRef = { id: 'x', name: 'r.png', size: 1, type: 'image/png' };
    const soft = validateFigures([{ text: 'Rail', level: 0, figure: { fileRef, width: 640, height: 480 } }]);
    expect(soft[0].message).toMatch(/640 by 480 pixels and prints at about 98 dpi/);
    // 1600px across 6.5in is 246 dpi; a tall image prints narrower, so its dpi is higher.
    expect(validateFigures([{ text: 'Rail', level: 0, figure: { fileRef, width: 1600, height: 1200 } }])).toEqual([]);
    expect(validateFigures([{ text: 'Rail', level: 0, figure: { fileRef, width: 600, height: 2400 } }])).toEqual([]);
  });

  it('places a PDF page as a figure, and names the formats it takes', () => {
    expect(figureFile(2, 'application/pdf', 'drawing.pdf')).toBe('attachments/figure-2.pdf');
    expect(figureFile(3, undefined, 'scan.PDF')).toBe('attachments/figure-3.pdf');
    expect(figureFile(4, 'image/jpeg', 'photo.jpg')).toBe('attachments/figure-4.jpg');
    expect(validateFigures([{ text: 'x', level: 0, figure: {} }])[0].message).toMatch(/PNG, JPEG, or PDF/);
  });
});
