/**
 * Derive a readable question heading for a radio group from its harvested id.
 *
 * Config-form radio groups carry a slug of the PDF's qualified field name, e.g.
 * `form1_0_subform_1_MAPRecommendations_0`. The editor otherwise shows a radio
 * group with no question at all (just its option labels), so ~78% of groups
 * render as bare "0 / 1 / 2". A qualified name is `container_container_FIELD_idx`,
 * so this takes the LAST meaningful segment (the field name — `MAPRecommendations`),
 * splits camelCase, and Title-Cases it into "MAP Recommendations". Using only the
 * last segment avoids dragging LiveCycle container GUIDs (`QQAPBaeCADAAC…`) into
 * the heading.
 *
 * Returns `null` (render no heading — today's behavior) whenever the result is
 * junk rather than a real question, so a catch-all group named `radio` never
 * gets a fake-authoritative legend. A wrong heading on a signable form is worse
 * than none, so the gate is deliberately conservative.
 */

// XFA/LiveCycle container words that are page scaffolding, not the field name.
const SCAFFOLD = /^(form\d*|topmost|topmostsubform|subform|sub_?form|page\d*|area|exclgroup|figure|f)$/i;
// Widget-type prefixes LiveCycle glues onto field names (RadOrder, ChkYes).
const WIDGET_PREFIX = /^(rad|radio|chk|check|cb|rb|txt|text|list|btn|button)$/i;
// A remaining single token that is not a real question.
const STOPWORD = /^(radio|button|list|checkbox|check|field|group|option|yes|no|na|value|choice)$/i;

/** Is a raw slug segment the actual field name (vs a container / index)? */
function isContentSegment(seg: string): boolean {
  if (!seg || /^\d+$/.test(seg)) return false; // pure index
  if (seg.length < 2) return false; // stray single letter (GUID noise)
  if (SCAFFOLD.test(seg)) return false;
  return /[a-zA-Z]/.test(seg);
}

export function humanizeGroup(groupId: string): string | null {
  if (!groupId) return null;

  // The field name is the LAST content segment before trailing indices.
  const segments = groupId.split(/[_\s]+/).filter(Boolean);
  const fieldSeg = [...segments].reverse().find(isContentSegment);
  if (!fieldSeg) return null;

  // Split the field name into words: camelCase, ACRONYM boundaries, and glued
  // digits (Rad6East -> Rad 6 East), then drop numbers and a leading widget
  // prefix (RadOrder -> Order).
  let words = fieldSeg
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^\d+$/.test(w))
    .filter((w) => w.length > 1); // drop stray single letters
  // Strip widget scaffold words from both ends (RadioButtonList -> gated,
  // PaymentButton -> Payment, RadOrder -> Order), never from the middle so a
  // real word is kept.
  while (words.length > 1 && WIDGET_PREFIX.test(words[0])) words = words.slice(1);
  while (words.length > 1 && WIDGET_PREFIX.test(words[words.length - 1])) words = words.slice(0, -1);

  const compact = words.join('');
  // Quality gate — reject anything that would read as junk, not a question.
  if (compact.length <= 3) return null;
  if (!/[a-zA-Z]/.test(compact)) return null;
  if (words.length === 1 && STOPWORD.test(words[0])) return null;

  // Title-case, preserving all-caps acronyms already present (MAP, EDIPI, PFT).
  return words
    .map((w) => (/^[A-Z0-9]+$/.test(w) && w.length > 1 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}
