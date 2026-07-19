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
  'CO', 'XO', 'OIC', 'NCOIC', 'SNCO', 'NCO', 'POC',
  // Publication types a naval reader knows on sight
  'MCO', 'MCBUL', 'SECNAVINST', 'OPNAVINST', 'NAVMC', 'MARADMIN', 'ALNAV', 'JAG', 'JAGMAN',
  // Record identifiers
  'SSIC', 'EDIPI', 'MOS', 'SSN', 'UIC',
]);

const normalize = (token: string): string => token.toUpperCase().replace(/\./g, '');

// A candidate token: starts with a letter, ≥2 chars, may carry internal
// . & / - (so "U.S.", "C4ISR", "OPNAV/N1" are single tokens).
const TOKEN_RE = /[A-Za-z][A-Za-z0-9&/.-]*[A-Za-z0-9]/g;

/** True when a token reads as an acronym (two or more capital letters). */
function isAcronym(token: string): boolean {
  return (token.match(/[A-Z]/g)?.length ?? 0) >= 2;
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
 * Acronyms in `text` that are used before being defined as "Spelled Out (ACRONYM)".
 * Deduped, in first-use order. An acronym is fine when its first appearance is
 * inside its own defining parentheses; it's flagged when a bare use comes first
 * or it's never defined.
 */
export function findUndefinedAcronyms(text: string, options: AcronymCheckOptions = {}): AcronymFinding[] {
  const allowlist = options.allowlist ?? CORRESPONDENCE_ALLOWLIST;
  const firstIndex = new Map<string, number>(); // token → earliest position

  for (const m of text.matchAll(TOKEN_RE)) {
    const token = m[0];
    if (!isAcronym(token)) continue;
    if (!firstIndex.has(token)) firstIndex.set(token, m.index);
  }

  const findings: AcronymFinding[] = [];
  for (const [token, index] of firstIndex) {
    if (!options.strict && allowlist.has(normalize(token))) continue;
    // Defined when "(TOKEN)" appears at or before the first bare use.
    const defAt = text.indexOf(`(${token})`);
    const definedFirst = defAt !== -1 && index >= defAt;
    if (!definedFirst) findings.push({ acronym: token, index });
  }

  return findings.sort((a, b) => a.index - b.index);
}
