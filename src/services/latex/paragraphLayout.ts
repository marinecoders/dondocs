import type { DocTypeConfig } from '@/types/document';
import { subparagraphIndentIn, type LabelFont } from './subparagraphIndent';

/** Absolute offsets from the left margin; renderers choose their own markup. */
export function resolveParagraphLayout(level: number, ancestors: readonly string[], config: DocTypeConfig, font: LabelFont, fontSizePt: number) {
  const business = config.uiMode === 'business' && !config.compliance.numberedParagraphs;
  const firstLineIndentIn = business ? (level + 1) * 0.5 : subparagraphIndentIn(ancestors, font, fontSizePt);
  return Object.freeze({ firstLineIndentIn, continuationIndentIn: business && level > 0 ? firstLineIndentIn : 0, spaceBeforePt: 12 });
}
