import { describe, it, expect } from 'vitest';
import { generateBodyTex } from '@/services/latex/generator';
import type { Paragraph } from '@/types/document';

const body = (paragraphs: Paragraph[]) =>
  generateBodyTex({
    docType: 'i_type', formData: { docType: 'i_type' },
    references: [], enclosures: [], paragraphs, copyTos: [], distributions: [],
  } as never);

describe('safety callouts', () => {
  it('takes no number and does not break the sequence around it', () => {
    const tex = body([
      { text: 'First step.', level: 0 },
      { text: 'Mind the torque.', level: 0, callout: 'warning' },
      { text: 'Second step.', level: 0 },
    ]);
    // The steps either side stay 1 and 2 — the callout consumed nothing.
    expect(tex).toContain('1.');
    expect(tex).toContain('2.');
    expect(tex).not.toContain('3.');
  });

  it('sets a warning entirely in upper case, and the others in sentence case', () => {
    expect(body([{ text: 'Mind the torque.', level: 0, callout: 'warning' }]))
      .toContain('\\MakeUppercase{');
    expect(body([{ text: 'Mind the torque.', level: 0, callout: 'caution' }]))
      .not.toContain('\\MakeUppercase{');
  });

  it('centres a single line and left-justifies a long one', () => {
    expect(body([{ text: 'Short.', level: 0, callout: 'note' }])).toContain('\\centering');
    const long = 'x'.repeat(200);
    expect(body([{ text: long, level: 0, callout: 'note' }])).toContain('\\raggedright');
  });

  it('keeps every callout with what follows -- none may end a page', () => {
    for (const kind of ['warning', 'caution', 'note'] as const) {
      expect(body([{ text: 'a', level: 0, callout: kind }])).toContain('\\nopagebreak');
    }
  });

  it('names the callout in its own heading', () => {
    for (const kind of ['warning', 'caution', 'note'] as const) {
      expect(body([{ text: 'a', level: 0, callout: kind }])).toContain(`\\textbf{${kind.toUpperCase()}}`);
    }
  });
});
