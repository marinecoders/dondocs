import { Paragraph as DocxParagraph } from 'docx';
import type { CopyTo } from '@/types/document';
import type { FontProps } from './styles';
import { SPACING, SINGLE_SPACING } from './styles';
import { styledRun } from './utils';

export function buildCopyTo(copyTos: CopyTo[], fp: FontProps): DocxParagraph[] {
  if (copyTos.length === 0) return [];

  const result: DocxParagraph[] = [];

  result.push(
    new DocxParagraph({
      children: [styledRun('Copy to:', fp, { bold: true })],
      spacing: { ...SINGLE_SPACING, before: SPACING.line },
    })
  );

  for (const ct of copyTos) {
    result.push(
      new DocxParagraph({
        children: [styledRun(ct.text, fp)],
        indent: { left: 720 }, // 0.5 inch
        spacing: { ...SINGLE_SPACING },
      })
    );
  }

  return result;
}
