/**
 * Best-effort read of an imported document's security classification from its
 * extracted text: the overall banner marking (top/bottom of every page) and, if
 * the document is classified, the derivative-classification authority block at
 * the foot ("Classified by / Derived from / Declassify on / Reason").
 *
 * The banner is the authority for the overall level — "highest classification
 * wins" (DoDM 5200.01 Vol 2), so we take the highest marking found among the
 * standalone banner lines. Portion markings inside paragraphs are recovered
 * separately by the letter parser; this module reads only the document-level
 * markings so the importer can pre-set the Classification section.
 *
 * Pure and leaf — unit-tested against text fixtures, independent of whether the
 * text came from a PDF or a DOCX.
 */

import type { ClassificationLevel } from '@/lib/domainClassification';

export interface ClassificationDetection {
  /** The detected banner level; 'unclassified' when nothing was marked. */
  classLevel: ClassificationLevel;
  /** Derivative-classification authority block, when the document carries one. */
  classifiedBy?: string;
  derivedFrom?: string;
  declassifyOn?: string;
  classReason?: string;
  /** True when any classification marking (banner or authority line) was found. */
  found: boolean;
  /** Human-readable summary for the review UI. */
  reason: string;
}

// A standalone banner line → its level. Order matters: the most specific /
// highest markings are tested first so "TOP SECRET//SCI" isn't read as plain
// "TOP SECRET", and "SECRET" doesn't swallow a "TOP SECRET" line.
//
// Each pattern anchors the WHOLE (trimmed) line: the base marking, optionally
// followed by a "//" control string (e.g. "SECRET//NOFORN", "CUI//SP-CTI").
// Requiring the trailer to start with "//" is deliberate — it keeps a prose
// line that merely starts with the word ("SECRET SERVICE DETAIL",
// "CONFIDENTIAL sources report…") from being mistaken for a banner.
const TRAILER = String.raw`(?:\s*\/\/.*)?$`;
const BANNER_MARKINGS: { re: RegExp; level: ClassificationLevel; label: string }[] = [
  { re: new RegExp(String.raw`^top\s+secret\s*\/\/\s*sci${TRAILER}`, 'i'), level: 'top_secret_sci', label: 'TOP SECRET//SCI' },
  { re: new RegExp(String.raw`^top\s+secret${TRAILER}`, 'i'), level: 'top_secret', label: 'TOP SECRET' },
  { re: new RegExp(String.raw`^secret${TRAILER}`, 'i'), level: 'secret', label: 'SECRET' },
  { re: new RegExp(String.raw`^confidential${TRAILER}`, 'i'), level: 'confidential', label: 'CONFIDENTIAL' },
  { re: new RegExp(String.raw`^(?:cui|controlled\s+unclassified\s+information)${TRAILER}`, 'i'), level: 'cui', label: 'CUI' },
  // Legacy FOUO banner (retired into CUI, DoDI 5200.48) — common on older
  // Marine correspondence, so recognize it and map it to CUI.
  { re: new RegExp(String.raw`^(?:for\s+official\s+use\s+only|unclassified\s*\/\/\s*fouo)${TRAILER}`, 'i'), level: 'cui', label: 'CUI (FOUO)' },
  { re: new RegExp(String.raw`^unclassified${TRAILER}`, 'i'), level: 'unclassified', label: 'UNCLASSIFIED' },
];

const LEVEL_RANK: Record<ClassificationLevel, number> = {
  unclassified: 0,
  cui: 1,
  confidential: 2,
  secret: 3,
  top_secret: 4,
  top_secret_sci: 5,
};

/** Human label for a detected level, for the review summary. */
export const CLASSIFICATION_LABELS: Record<ClassificationLevel, string> = {
  unclassified: 'UNCLASSIFIED',
  cui: 'CUI',
  confidential: 'CONFIDENTIAL',
  secret: 'SECRET',
  top_secret: 'TOP SECRET',
  top_secret_sci: 'TOP SECRET//SCI',
};

// Derivative-classification authority block labels (DoDM 5200.01 Vol 2 §7).
const AUTHORITY_LABELS: { key: 'classifiedBy' | 'derivedFrom' | 'declassifyOn' | 'classReason'; re: RegExp }[] = [
  { key: 'classifiedBy', re: /^classified\s+by\s*:/i },
  { key: 'derivedFrom', re: /^derived\s+from\s*:/i },
  { key: 'declassifyOn', re: /^declassify\s+on\s*:/i },
  { key: 'classReason', re: /^reason\s*:/i },
];

/** The banner level of a standalone line, or null if it isn't a banner. */
function bannerLevelOf(line: string): { level: ClassificationLevel; label: string } | null {
  for (const m of BANNER_MARKINGS) {
    if (m.re.test(line)) return { level: m.level, label: m.label };
  }
  return null;
}

export function detectClassification(rawText: string): ClassificationDetection {
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');

  // Highest standalone banner marking wins.
  let banner: { level: ClassificationLevel; label: string } | null = null;
  const authority: Partial<Record<'classifiedBy' | 'derivedFrom' | 'declassifyOn' | 'classReason', string>> = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const b = bannerLevelOf(line);
    if (b && (!banner || LEVEL_RANK[b.level] > LEVEL_RANK[banner.level])) banner = b;

    for (const a of AUTHORITY_LABELS) {
      if (authority[a.key] === undefined && a.re.test(line)) {
        const value = line.slice(line.indexOf(':') + 1).trim();
        if (value) authority[a.key] = value;
      }
    }
  }

  const hasAuthority = Object.keys(authority).length > 0;
  const classLevel = banner?.level ?? 'unclassified';
  const found = banner !== null || hasAuthority;

  let reason: string;
  if (banner && banner.level !== 'unclassified') {
    reason = `Detected a ${banner.label} banner${hasAuthority ? ' and a classification authority block' : ''}.`;
  } else if (banner) {
    reason = 'Marked UNCLASSIFIED.';
  } else if (hasAuthority) {
    reason = 'Found a classification authority block but no banner — please confirm the level.';
  } else {
    reason = 'No classification marking found — set to Unclassified.';
  }

  return { classLevel, ...authority, found, reason };
}
