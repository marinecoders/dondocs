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
 * Note: we do not validate the state/zip format here (that's the
 * input's job). This function only handles assembly.
 */
export function composeUnitAddress(parts: UnitAddressParts): string {
  const street = parts.street.trim();
  const city = parts.city.trim();
  const state = parts.state.trim().toUpperCase();
  const zip = parts.zip.trim();

  // "State Zip" segment. State is only included when it's exactly 2
  // characters so we don't emit a half-typed state like "C 92055"
  // that would then fail to parse on the next round-trip.
  const stateZip =
    state.length === 2 && zip
      ? `${state} ${zip}`
      : zip || (state.length === 2 ? state : '');

  const cityStateZip = [city, stateZip].filter(Boolean).join(', ');
  return [street, cityStateZip].filter(Boolean).join(', ');
}
