import type { Paragraph } from '@/types/document';

/**
 * Every appendix carries a title — "Appendix A: Title goes here" in the
 * MARCORSYSCOM template — and on the paragraph editor the heading is that
 * title. Reports each appendix that has none, by the letter it will print.
 */
export function validateAppendixTitles(paragraphs: Paragraph[]): { severity: 'warning'; message: string }[] {
  const findings: { severity: 'warning'; message: string }[] = [];
  let n = 0;
  for (const p of paragraphs) {
    if (!p.appendix) continue;
    const letter = String.fromCharCode(65 + n++);
    if (!p.header?.trim()) {
      findings.push({ severity: 'warning', message: `Appendix ${letter} has no title. Its heading is the title.` });
    }
  }
  return findings;
}
