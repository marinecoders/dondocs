import { describe, it, expect } from 'vitest';
import { modificationInstruction, supplyInstruction, technicalInstruction, lubricationInstruction } from '@/data/templates/technical';
import { LETTER_TEMPLATES } from '@/data/templates';
import { validateFigures } from '@/lib/figures';

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
      'Figure 1 has no image. Choose a PNG or JPEG for it.',
      'Figure 1 has no title. Its text is the title that prints under it.',
    ]);
  });
});
