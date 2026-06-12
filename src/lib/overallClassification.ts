/**
 * Derive the overall (banner) classification from the document level and
 * the highest per-paragraph portion marking.
 *
 * SECNAV M-5216.5 / DoDM 5200.01 Vol 2: the banner must reflect the highest
 * classification of any portion in the document. Previously the banner was
 * driven solely by the document-level `classLevel`, so a CUI document with
 * an `(S)` paragraph rendered a CUI banner over SECRET content — an
 * under-marked document. Both generators (PDF and DOCX) now derive the
 * banner through this single chokepoint.
 *
 * `custom` is never derived over/under: free-text markings can't be ranked,
 * so a custom document keeps its custom banner unchanged.
 */
import type { ClassificationLevel } from '@/lib/domainClassification';
import type { Paragraph, PortionMarking } from '@/types/document';

const LEVEL_RANK: Record<string, number> = {
  unclassified: 0,
  cui: 1,
  confidential: 2,
  secret: 3,
  top_secret: 4,
  top_secret_sci: 5,
};

/** Portion mark → the document-level classification it implies.
 *  FOUO maps to CUI (FOUO was retired into the CUI program, DoDI 5200.48). */
const PORTION_TO_LEVEL: Record<PortionMarking, ClassificationLevel> = {
  U: 'unclassified',
  CUI: 'cui',
  FOUO: 'cui',
  C: 'confidential',
  S: 'secret',
  TS: 'top_secret',
};

/**
 * Returns the higher of the document-level classification and the highest
 * portion marking present in `paragraphs`. Returns the input unchanged for
 * `custom` (unrankable) or unknown levels.
 */
export function deriveOverallClassLevel(
  classLevel: string | undefined,
  paragraphs: Array<Pick<Paragraph, 'portionMarking'>>
): string {
  const docLevel = classLevel || 'unclassified';
  if (docLevel === 'custom' || !(docLevel in LEVEL_RANK)) return docLevel;

  let maxRank = LEVEL_RANK[docLevel];
  let maxLevel = docLevel;
  for (const para of paragraphs) {
    if (!para.portionMarking) continue;
    const level = PORTION_TO_LEVEL[para.portionMarking];
    const rank = level ? LEVEL_RANK[level] : undefined;
    if (rank !== undefined && rank > maxRank) {
      maxRank = rank;
      maxLevel = level;
    }
  }
  return maxLevel;
}
