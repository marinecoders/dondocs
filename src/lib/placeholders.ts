/**
 * Shared placeholder detection / replacement utilities.
 *
 * Documents in this app can contain placeholders like `{{NAME}}` or
 * `{{ENTRY_DATE}}`. These are filled in at PDF-generation time. There are
 * two flows that need to substitute them:
 *
 *  - **Batch mode** (BatchModal.tsx) — substitutes from per-row values
 *    pasted from a CSV / table.
 *  - **Normal mode** (App.tsx download paths) — substitutes from the
 *    form's own field values (e.g. `{{NAME}}` resolves to the joined
 *    `lastName, firstName, middleName`). Without this, normal download
 *    would render `{{NAME}}` as literal yellow-highlighted text in the
 *    output PDF (issue #13).
 *
 * Both flows now use the same primitives here. Placeholders that have no
 * value in the supplied map fall through unchanged — `replacePlaceholders`
 * never invents values, and the generators yellow-highlight any remaining
 * `{{...}}` so users can see what's still unfilled.
 */

import type { FormSession, Navmc11811Data, NavmcForm10274Data } from '@/stores/formStore';
import type { SerializedSession } from '@/stores/documentStore';
import { documentTextFields, mapSessionText } from './documentFields';

/**
 * Map from placeholder name (uppercased, no braces) to its value.
 *
 * Lookups are case-insensitive — keys are uppercased on insert and
 * uppercased on lookup, so `{{name}}` and `{{NAME}}` resolve to the
 * same value.
 */
export type PlaceholderValues = Record<string, string>;

const PLACEHOLDER_RE = /\{\{([A-Za-z0-9_]+)\}\}/g;
const PLACEHOLDER_AND_SPACE_RE = new RegExp(`${PLACEHOLDER_RE.source}( ?)`, 'g');

/**
 * Detect all unique placeholder names used in `text`.
 *
 * Returns uppercased names with braces stripped — e.g. given
 * `"On {{date}}, {{NAME}} did X"` returns `["DATE", "NAME"]`.
 */
export function detectPlaceholders(text: string): string[] {
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  // Use a fresh regex copy so concurrent callers don't share lastIndex.
  const re = new RegExp(PLACEHOLDER_RE.source, PLACEHOLDER_RE.flags);
  while ((match = re.exec(text)) !== null) {
    seen.add(match[1].toUpperCase());
  }
  return Array.from(seen);
}

/**
 * Replace every `{{NAME}}` occurrence in `text` with `values[NAME]`.
 *
 * Case-insensitive — `{{name}}` looks up `NAME`. If the key isn't in
 * `values`, the original `{{name}}` is left in place so the generator's
 * placeholder-highlight can still flag it.
 *
 * A blank value starting a word takes the space after it too. Typed spaces print,
 * so `John {{MI}} Smith` with no middle initial would otherwise show a double gap.
 */
export function replacePlaceholders(text: string, values: PlaceholderValues): string {
  return text.replace(PLACEHOLDER_AND_SPACE_RE, (match, key: string, space: string, offset: number) => {
    const upper = key.toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(values, upper)) return match;
    const startsWord = offset === 0 || /\s/.test(text[offset - 1]);
    return values[upper] === '' && startsWord ? '' : values[upper] + space;
  });
}

/**
 * Build a default placeholder map from an NAVMC 118(11) form's own field
 * values. Used for normal (non-batch) downloads so cross-field
 * placeholders like `{{NAME}}` and `{{DATE}}` resolve to what the user
 * already entered.
 *
 * The keys here MUST match the documented placeholder names in
 * `NAVMC_118_11_PLACEHOLDERS` (constants.ts) plus a handful of common
 * aliases. Custom user-defined placeholders that aren't in this map will
 * fall through to `replacePlaceholders` unchanged and end up
 * yellow-highlighted in the output — which is the right signal that
 * "this variable has no value yet".
 */
export function buildNavmc11811DefaultValues(data: Navmc11811Data): PlaceholderValues {
  const fullName = [data.lastName, data.firstName, data.middleName]
    .filter(Boolean)
    .join(', ')
    .toUpperCase();

  return {
    // Composite — matches NAVMC_118_11_PLACEHOLDERS example "DOE, JOHN MICHAEL"
    NAME: fullName,
    // Per-component aliases. Allow both underscored and joined spellings
    // so a user typing `{{LASTNAME}}` or `{{LAST_NAME}}` both work.
    LASTNAME: data.lastName,
    LAST_NAME: data.lastName,
    FIRSTNAME: data.firstName,
    FIRST_NAME: data.firstName,
    MIDDLENAME: data.middleName,
    MIDDLE_NAME: data.middleName,
    // Middle initial
    MI: data.middleName ? data.middleName[0].toUpperCase() : '',
    EDIPI: data.edipi,
    BOX11: data.box11,
    BOX_11: data.box11,
    // Date — both DATE (per placeholder list) and ENTRY_DATE (the field name)
    DATE: data.entryDate,
    ENTRY_DATE: data.entryDate,
  };
}

/**
 * Apply placeholder substitution to every text field of a Navmc11811Data.
 * Returns a NEW object — does not mutate `data`.
 *
 * Pass `values = buildNavmc11811DefaultValues(data)` for the normal
 * download path, or per-row values from BatchModal for batch mode.
 */
export function applyPlaceholdersToNavmc11811(
  data: Navmc11811Data,
  values: PlaceholderValues
): Navmc11811Data {
  return substituteForm('navmc_118_11', {
    includeCoverPage: false,
    navmc11811: { ...data, remarksTextRight: data.remarksTextRight ?? '', signatureBlocks: data.signatureBlocks ?? [] },
  }, values).navmc11811!;
}

/**
 * Apply placeholder substitution to every text field of an NavmcForm10274Data.
 * Uses the same editable-text policy as document and batch substitution.
 */
export function applyPlaceholdersToNavmc10274(
  data: NavmcForm10274Data,
  values: PlaceholderValues
): NavmcForm10274Data {
  return substituteForm('navmc_10274', {
    includeCoverPage: false,
    navmc10274: { ...data, signatureBlocks: data.signatureBlocks ?? [] },
  }, values).navmc10274!;
}

/** Detection and replacement share the same editable-text policy. */
export function detectSessionPlaceholders(session: SerializedSession): string[] {
  return [...new Set(documentTextFields(session, 'substitution').flatMap(field => detectPlaceholders(field.text)))];
}

export function applyPlaceholdersToSession(session: SerializedSession, values: PlaceholderValues): SerializedSession {
  return mapSessionText(session, field => replacePlaceholders(field.text, values));
}

function substituteForm(formType: 'navmc_10274' | 'navmc_118_11', forms: FormSession, values: PlaceholderValues): FormSession {
  return applyPlaceholdersToSession({
    documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType,
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 0, forms,
  }, values).forms!;
}
