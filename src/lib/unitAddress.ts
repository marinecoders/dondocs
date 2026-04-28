/**
 * Parse / compose helpers for the structured letterhead address.
 *
 * The `formData.unitAddress` field is a single string in the form
 * commonly seen on Navy/USMC letterheads, e.g.:
 *
 *   "PSC BOX 8050, CHERRY POINT, NC 28533-0050"   (street + city + state + zip)
 *   "PRESIDIO OF MONTEREY, CA 93944"              (no street; one comma)
 *   "NORFOLK VA 23511-2494"                       (no street, no comma)
 *
 * The downstream LaTeX generators consume that string directly and
 * split it on the first comma when there are 2+ commas (street goes
 * to letterhead line 3, city/state/zip to line 4). Keeping
 * `unitAddress` as the persisted representation means profiles, unit
 * directory entries, the example documents, and saved sessions
 * continue to work unchanged.
 *
 * The Letterhead form UI uses `parseUnitAddress` to derive structured
 * Street / City / State / ZIP fields for editing, and
 * `composeUnitAddress` to write the changes back as a single string.
 * No data-model migration, no generator change.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Round-trip stability — verified 2026-04-28 (PR #63):
 *
 *   Hand-curated codebase addresses          11/11 stable
 *     - 8 from src/data/exampleDocuments.ts
 *     - 1 documentStore default
 *     - 2 from src/stores/profileStore.ts
 *
 *   Unit directory (src/data/units.json)     3140/3140 stable
 *     - 17 entries lack a parseable State+ZIP tail (placeholder text
 *       like "CONTACT MI TO UPDATE ADDRESS" or non-standard "GUAM"
 *       in place of the 2-letter "GU"). The parser puts the whole
 *       string in `city` so nothing is silently dropped — the user
 *       sees the full text and can edit. compose() still emits the
 *       exact input back.
 *
 *   FPO/APO/DPO entries                      632/632 stable AND
 *                                            preserve "FPO AP NNNNN"
 *                                            (no comma between post
 *                                            designator and state)
 *                                            per USPS Pub 28 §38.
 *
 *   Edge cases (empty, partial, mid-typing, multi-comma, whitespace,
 *   null/undefined inputs)                   all stable
 *
 * Stability invariant tested:
 *   compose(parse(s)) === compose(parse(compose(parse(s))))
 *
 * "Comma-canonical" outputs (where input "CITY STATE ZIP" recomposes
 * to "CITY, STATE ZIP") are expected for civilian addresses and match
 * the format the LaTeX generator already produces. Military post
 * addresses are space-separated.
 * ─────────────────────────────────────────────────────────────────────
 */

export interface UnitAddressParts {
  /** Optional street, box, or building. e.g. "PSC BOX 8050" */
  street: string;
  /** Required city name. May contain spaces. e.g. "CHERRY POINT" */
  city: string;
  /** 2-letter state code. e.g. "NC". Empty while user is mid-type. */
  state: string;
  /** 5- or 9-digit ZIP. e.g. "28533" or "28533-0050" */
  zip: string;
}

const EMPTY_PARTS: UnitAddressParts = { street: '', city: '', state: '', zip: '' };

/**
 * Anchor regex: a State+ZIP pair at the end of the address.
 *
 *   - State is 2 letters (case-insensitive on input, normalized to
 *     uppercase in the result)
 *   - ZIP is 5 digits, optionally followed by `-NNNN`
 *   - Allow whitespace OR a comma separator before the State token,
 *     so we accept "City, State ZIP" and "City State ZIP" both
 */
const TAIL_REGEX = /[\s,]+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/;

/**
 * Parse a single-line unitAddress string into its structured parts.
 *
 * Returns the EMPTY_PARTS shape when the input is empty, and a
 * best-effort partial parse when the input doesn't end in a State+ZIP
 * tail (we put the whole string in `city` so nothing is silently
 * dropped while the user is mid-typing).
 */
export function parseUnitAddress(raw: string | undefined | null): UnitAddressParts {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { ...EMPTY_PARTS };

  const tailMatch = trimmed.match(TAIL_REGEX);
  if (!tailMatch) {
    // No State+ZIP tail. Don't lose the data — surface the whole
    // string in `city` so the user sees what's there and can adjust.
    return { ...EMPTY_PARTS, city: trimmed };
  }

  const state = tailMatch[1].toUpperCase();
  const zip = tailMatch[2];
  // Everything before the matched " STATE ZIP" tail. Strip a trailing
  // comma if the tail's leading separator was a comma+space.
  const beforeTail = trimmed
    .slice(0, tailMatch.index!)
    .replace(/,\s*$/, '')
    .trim();

  // If there are 2+ comma-separated parts in beforeTail, the first is
  // street, the rest is city (joined back with commas in case the city
  // itself contains commas, which is rare but possible).
  const parts = beforeTail.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      street: parts[0],
      city: parts.slice(1).join(', '),
      state,
      zip,
    };
  }

  return { street: '', city: beforeTail, state, zip };
}

/**
 * Compose structured parts back into the single-line unitAddress
 * format consumed by the existing generator.
 *
 * Skips empty pieces gracefully so a half-filled form doesn't produce
 * orphan separators like ", , CA 92055". Specifically:
 *
 *   - Empty street → no leading "Street, "
 *   - State with fewer than 2 chars (mid-type) → omitted from the
 *     "State Zip" join (just "Zip" survives)
 *   - All-empty parts → empty string
 *
 * Military post offices (FPO/APO/DPO) are space-separated from their
 * state code per USPS Publication 28 §38, e.g. "FPO AP 96604-5602"
 * not "FPO, AP 96604-5602". Civilian addresses keep the comma between
 * city and state, matching the format the LaTeX letterhead generator
 * has historically emitted (e.g. "CAMP PENDLETON, CA 92055-5190").
 *
 * Note: we do not validate the state/zip format here (that's the
 * input's job). This function only handles assembly.
 */
const MILITARY_POST_REGEX = /^(FPO|APO|DPO)$/i;

export function composeUnitAddress(parts: UnitAddressParts): string {
  const street = parts.street.trim();
  const city = parts.city.trim();
  const state = parts.state.trim().toUpperCase();
  const zip = parts.zip.trim();

  // "State Zip" segment. State is only included when it's exactly 2
  // characters so we don't emit a half-typed state like "C 92055"
  // that would then fail to parse on the next round-trip.
  const validState = state.length === 2 ? state : '';
  const stateZip = [validState, zip].filter(Boolean).join(' ');

  // FPO/APO/DPO addresses use space (not comma) between the post
  // designator and the state code. This preserves the canonical
  // 632-entry-strong unit-directory format on round-trip.
  const isMilitaryPost = MILITARY_POST_REGEX.test(city) && (validState || zip);
  const cityStateZip = isMilitaryPost
    ? [city, stateZip].filter(Boolean).join(' ')
    : [city, stateZip].filter(Boolean).join(', ');

  return [street, cityStateZip].filter(Boolean).join(', ');
}

/**
 * Split a `unitAddress` string into the two address lines the LaTeX
 * letterhead expects: line 3 (street/box) and line 4 (city/state/zip).
 *
 * Convention: when the address has 2+ commas, split on the FIRST one —
 * the street goes to line 3, the rest (city, state, zip) to line 4.
 * Addresses with only 1 comma (e.g. "PRESIDIO OF MONTEREY, CA 93944"
 * — no street) stay on a single line. Addresses with 0 commas (just
 * "NORFOLK VA 23511-2494") also stay on a single line.
 *
 * Both `generator.ts` (DOCX) and `flat-generator.ts` (PDF) had identical
 * inline copies of this logic before extraction — keeping it here as the
 * single source of truth ensures the two output formats stay in sync.
 */
export function splitAddressForLetterhead(rawAddress: string): {
  line1: string;
  line2: string;
} {
  const trimmed = (rawAddress || '').trim();
  const commaCount = (trimmed.match(/,/g) || []).length;
  if (commaCount >= 2) {
    const firstComma = trimmed.indexOf(',');
    return {
      line1: trimmed.slice(0, firstComma).trim(),
      line2: trimmed.slice(firstComma + 1).trim(),
    };
  }
  return { line1: trimmed, line2: '' };
}
