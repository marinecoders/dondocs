import type { Paragraph } from '@/types/document';
import { paragraphMark, delimitParagraphMark, isUnderlinedLevel } from './paragraphLabel';

function getParagraphLabel(level: number, count: number, underline: boolean): string {
  const mark = paragraphMark(level, count);
  // Fig 7-8 underlines the counter itself at levels 4+; the period and the
  // parentheses stay plain, so the delimiter goes on outside the \uline.
  const underlined = underline && isUnderlinedLevel(level) ? `\\uline{${mark}}` : mark;
  return delimitParagraphMark(level, underlined);
}

export function calculateLabels(paragraphs: Paragraph[], letteredAppendices = false, underline = true): string[] {
  const labels: string[] = [];
  const counters = [0, 0, 0, 0, 0, 0, 0, 0];
  let appendixLetter = '';
  let appendixCount = 0;

  for (const para of paragraphs) {
    // A safety callout is not a numbered paragraph: it takes no label and does
    // not advance the count, so the steps around it stay consecutive. The empty
    // label keeps this array aligned with `paragraphs` by index.
    if (para.callout || para.figure) {
      labels.push('');
      continue;
    }
    // An appendix is numbered afresh: everything before it is done with.
    if (para.appendix) {
      counters.fill(0);
      if (letteredAppendices) appendixLetter = String.fromCharCode(65 + appendixCount++);
      labels.push('');
      continue;
    }
    for (let i = para.level + 1; i < 8; i++) {
      counters[i] = 0;
    }
    counters[para.level]++;
    const label = letteredAppendices && para.procedure && para.level === 4
      ? (underline ? `\\uline{${counters[para.level]}}` : String(counters[para.level])) : getParagraphLabel(para.level, counters[para.level], underline);
    labels.push(appendixLetter && para.level === 0 ? `${appendixLetter}-${label}` : label);
  }

  return labels;
}
