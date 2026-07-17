/**
 * Via-addressee numbering, shared by both generators (generator.ts for PDF,
 * flat-generator.ts for DOCX) so the rule lives in exactly one place and the
 * two outputs cannot drift.
 *
 * SECNAV M-5216.5 Ch 9 ¶2 ("Via:" Line): "If there is only one via addressee
 * remaining, do not number it. If there is more than one remaining, number
 * the remaining addresses starting with the number (1) in parenthesis and
 * consecutively number the rest." Fig 9-2's basic letter carries the same
 * "(1) … (2) …" numbering, so this applies to every doc type with a Via
 * line, not just endorsements.
 *
 * The form stores one bare addressee per line (the row badge in
 * AddressingSection shows the number); numbering is applied here, at the data
 * level, so the tex templates and the DOCX tabular rows both render the
 * returned lines verbatim.
 */
export function formatViaLines(via: string | undefined): string[] {
  const lines = (via ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return lines;
  return lines.map((line, i) => `(${i + 1}) ${line}`);
}
