import { describe, it, expect } from 'vitest';
import { generateBodyTex } from '@/services/latex/generator';
import type { Paragraph } from '@/types/document';

const body = (paragraphs: Paragraph[], docType = 'i_type') =>
  generateBodyTex({
    docType, formData: { docType },
    references: [], enclosures: [], paragraphs, copyTos: [], distributions: [],
  } as never);

describe('appendix blocks', () => {
  it('letters appendices in order and takes the heading as the title', () => {
    const tex = body([
      { text: 'Body.', level: 0 },
      { text: '', level: 0, header: 'Torque Values', appendix: true },
      { text: '', level: 0, header: 'Wiring', appendix: true },
    ]);
    expect(tex).toContain('\\startAppendix{A}{Torque Values}');
    expect(tex).toContain('\\startAppendix{B}{Wiring}');
  });

  it('restarts paragraph numbering inside an appendix', () => {
    const tex = body([
      { text: 'One.', level: 0 },
      { text: 'Two.', level: 0 },
      { text: '', level: 0, header: 'Torque Values', appendix: true },
      { text: 'First again.', level: 0 },
    ]);
    expect(tex.match(/\\textbf\{1\.\}/g)).toHaveLength(2);
    expect(tex).not.toContain('\\textbf{3.}');
  });

  it('leads with the appendix text, unnumbered, when there is any', () => {
    const tex = body([{ text: 'Values apply at 20 C.', level: 0, header: 'Torque Values', appendix: true }]);
    expect(tex).toMatch(/\\startAppendix\{A\}\{Torque Values\}\n\\noindent Values apply at 20 C\./);
  });

  it('means nothing on a letter, where no appendix macro exists', () => {
    const tex = body([{ text: 'x', level: 0, header: 'T', appendix: true }], 'naval_letter');
    expect(tex).not.toContain('startAppendix');
  });
});
