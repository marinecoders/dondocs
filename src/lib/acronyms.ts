/**
 * "Spell out on first use" check for naval correspondence (SECNAV M-5216.5
 * ¶17c): an acronym must be spelled out and defined in parentheses the first
 * time it's used — "North Atlantic Treaty Organization (NATO)" — after which the
 * acronym may stand alone. This finds acronyms in body text that are used before
 * (or without ever) being defined, so the drafter can fix them. Advisory only.
 *
 * ¶17a: established abbreviations (Mr., i.e., sonar, radar) don't need defining
 * — except in the most formal writing (directives), where every one must be.
 * That's the `strict` option. Pure and leaf; unit-tested.
 */

// Established/commonly-understood abbreviations that don't need a definition in
// ordinary correspondence (¶17a examples plus acronyms universally read within
// the DON). Normalized: uppercase, periods stripped. Not exhaustive — advisory.
export const CORRESPONDENCE_ALLOWLIST: ReadonlySet<string> = new Set([
  // ¶17a "established abbreviations"
  'MR', 'MRS', 'MS', 'DR', 'JR', 'SR', 'EG', 'IE', 'ETC', 'VIZ', 'VS', 'AM', 'PM',
  'SONAR', 'RADAR', 'LASER', 'SCUBA',
  // Universally read within the Department of the Navy
  'US', 'USA', 'USN', 'USMC', 'USCG', 'USAF', 'DOD', 'DON', 'HQMC',
  'SECNAV', 'OPNAV', 'CMC',
  'CO', 'XO', 'OIC', 'NCOIC', 'SNCO', 'NCO', 'POC',
  // Publication types a naval reader knows on sight
  'MCO', 'MCBUL', 'SECNAVINST', 'OPNAVINST', 'NAVMC', 'MARADMIN', 'ALNAV', 'JAG', 'JAGMAN',
  // Record identifiers
  'SSIC', 'EDIPI', 'MOS', 'SSN', 'UIC',
]);

// Small lowercase connector words dropped when forming an acronym; ignored so a
// bare "(NATO)" isn't judged against them. (Only used defensively below.)
const normalize = (token: string): string => token.toUpperCase().replace(/[./]/g, '');

// A candidate token: starts with a letter, ≥2 chars, may carry internal
// . & / - (so "U.S.", "C4ISR", "OPNAV/N1" are single tokens).
const TOKEN_RE = /[A-Za-z][A-Za-z0-9&/.-]*[A-Za-z0-9]/g;

// A WELL-FORMED Roman numeral (I..MMMCMXCIX). Deliberately strict: this must NOT
// match ordinary all-caps acronyms that happen to use only the letters I,V,X,L,
// C,D,M — "CID", "LCM", "DIV", "CIV" are not valid numerals and stay acronyms.
// (A valid numeral like "MI"/"CV" is only treated as a numeral in context — see
// precededByOrdinalWord — so "the MI shop" is still flagged.)
const ROMAN_RE = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
// Words that introduce a sequence number, so a following Roman numeral is an
// ordinal ("Phase IV", "World War II", "Appendix C") — not an acronym.
const ORDINAL_WORDS: ReadonlySet<string> = new Set([
  'phase', 'part', 'chapter', 'section', 'appendix', 'annex', 'article', 'enclosure', 'encl',
  'volume', 'vol', 'tab', 'figure', 'fig', 'table', 'paragraph', 'para', 'subpara', 'title',
  'war', 'world', 'step', 'tier', 'type', 'class', 'mark', 'option', 'phase', 'priority', 'level',
]);
// Slash-joined single letters — "N/A", "A/C", "C/O" are abbreviations, not
// acronyms that need a spelled-out definition.
const SLASHED_RE = /^[A-Z](\/[A-Z])+$/;
// Common English words that turn up in ALL CAPS for emphasis — not acronyms.
const EMPHASIS_WORDS: ReadonlySet<string> = new Set([
  'NOT', 'ALL', 'AND', 'THE', 'FOR', 'ARE', 'WAS', 'ANY', 'ONE', 'TWO', 'OUR', 'PER', 'VIA',
  'SEE', 'USE', 'DUE', 'YES', 'NO', 'MUST', 'SHALL', 'WILL', 'MAY', 'CAN', 'ONLY', 'ALSO',
  'THIS', 'THAT', 'WITH', 'FROM', 'INTO', 'UPON', 'EACH', 'BOTH', 'SUCH', 'NONE', 'NOTE',
  'APPROVED', 'DISAPPROVED', 'IMPORTANT', 'WARNING', 'CAUTION', 'REQUIRED', 'ATTENTION',
  // Verbs/labels routinely capitalized in endorsement and routing blocks.
  'ENDORSED', 'CONCUR', 'NONCONCUR', 'CONCURRENCE', 'FORWARDED', 'RECOMMEND', 'RECOMMENDED',
  'CERTIFIED', 'SIGNED', 'CANCELLED', 'CANCELED', 'RETURNED', 'SUBMITTED', 'ENCLOSED',
  'ATTACHED', 'REVISED', 'PENDING', 'COMPLETED', 'DENIED', 'GRANTED', 'VERIFIED', 'ROUTINE',
  'PRIORITY', 'IMMEDIATE', 'DRAFT', 'FINAL', 'VOID', 'SAMPLE', 'SUBJECT', 'REFERENCE',
]);

/**
 * True when a token reads as an acronym: all uppercase (no lowercase letters, so
 * a CamelCase rank like "LCpl" or a plural "POCs" is excluded), two or more
 * capital letters, and not a slashed abbreviation or an ordinary word written in
 * caps. (Roman-numeral ordinals are excluded in context by the caller, not here,
 * so genuine acronyms like "CID"/"MI" that use numeral letters still qualify.)
 */
function isAcronym(token: string): boolean {
  if (/[a-z]/.test(token)) return false;
  if ((token.match(/[A-Z]/g)?.length ?? 0) < 2) return false;
  if (SLASHED_RE.test(token)) return false;
  const bare = token.replace(/[^A-Z]/g, '');
  if (EMPHASIS_WORDS.has(bare)) return false;
  return true;
}

/**
 * True when the token at `index` is a Roman-numeral ordinal in context — a
 * well-formed numeral immediately preceded by a word that introduces a sequence
 * ("Phase IV", "World War II"). Both conditions are required, so a valid numeral
 * used as an acronym ("the MI shop", "the CV deployed") is still treated as an
 * acronym.
 */
function isOrdinalNumeral(text: string, token: string, index: number): boolean {
  if (!ROMAN_RE.test(normalize(token))) return false;
  const before = text.slice(0, index).match(/([A-Za-z]+)\W*$/);
  return before ? ORDINAL_WORDS.has(before[1].toLowerCase()) : false;
}

export interface AcronymFinding {
  /** The acronym as written. */
  acronym: string;
  /** Index of its first (undefined) use in the text. */
  index: number;
}

export interface AcronymCheckOptions {
  /** Override the allowlist (e.g. for tests). */
  allowlist?: ReadonlySet<string>;
  /** Directives: every acronym must be defined, even established ones. */
  strict?: boolean;
}

/**
 * Acronyms in `text` used before being defined as "Spelled Out (ACRONYM)".
 * Deduped by normalized form, in first-use order. An acronym is fine when its
 * first appearance is inside its own defining parentheses; it's flagged when a
 * bare use comes first or it's never parenthesized. Definitions are matched by
 * normalized form so "(NATO)" defines a later "N.A.T.O." and vice-versa.
 *
 * Note: the presence of "(ACRONYM)" is taken as the definition; we don't verify
 * that the preceding words spell it out, because acronyms routinely draw several
 * letters from one word ("Headquarters" → H,Q) and a stricter initials check
 * would wrongly flag legitimate definitions like "Joint Task Force Headquarters
 * (JTFHQ)".
 */
export function findUndefinedAcronyms(text: string, options: AcronymCheckOptions = {}): AcronymFinding[] {
  const allowlist = options.allowlist ?? CORRESPONDENCE_ALLOWLIST;

  // First (earliest) occurrence of each acronym, keyed by normalized form.
  const firstSeen = new Map<string, { display: string; index: number }>();
  for (const m of text.matchAll(TOKEN_RE)) {
    const token = m[0];
    if (!isAcronym(token)) continue;
    if (isOrdinalNumeral(text, token, m.index)) continue;
    const key = normalize(token);
    if (!firstSeen.has(key)) firstSeen.set(key, { display: token, index: m.index });
  }

  // Earliest parenthetical definition of each normalized form.
  const defAt = new Map<string, number>();
  for (const m of text.matchAll(/\(([^)]{1,40})\)/g)) {
    const key = normalize(m[1].trim());
    if (key && !defAt.has(key)) defAt.set(key, m.index);
  }

  const findings: AcronymFinding[] = [];
  for (const [key, { display, index }] of firstSeen) {
    if (!options.strict && allowlist.has(key)) continue;
    const dAt = defAt.get(key);
    const definedFirst = dAt !== undefined && index >= dAt;
    if (!definedFirst) findings.push({ acronym: display, index });
  }

  return findings.sort((a, b) => a.index - b.index);
}
