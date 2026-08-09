/**
 * The second line of the sender's symbols block.
 *
 * SECNAV M-5216.5 Ch 7 ¶2a lists three parts: the SSIC, then the originator's
 * code "by itself or in a serial number", then the date. The manual's own
 * examples:
 *
 *     5216                  5800                  5216
 *     Code 13               N00J                  Ser Code 13/271
 *
 * So the code sits immediately under the SSIC. Given a serial it fuses with it
 * as `Ser <code>/<serial>` — one line, no spaces around the slash — and without
 * one it stands alone with no `Ser` prefix.
 *
 * `Code` precedes an all-numeric code and is omitted when the code starts with a
 * letter (Ch 7 ¶7a states the rule for the "To:" line; the sender's-symbol
 * examples follow it — `Code 13` against `N00J`).
 *
 * Until now the app collected an office code and never printed it, and printed a
 * serial bare — `001` rather than `Ser 001`.
 */

/** True when the code is only digits, which is when "Code" precedes it. */
function needsCodePrefix(code: string): boolean {
  return /^\d+$/.test(code);
}

/**
 * Compose the code/serial line. Returns '' when neither is set, which the
 * templates render as an omitted line rather than a blank one.
 *
 * A value the user already composed by hand is passed through: someone who
 * typed "Ser 12/001" into the serial field was working around the gap this
 * fixes, and must not end up with "Ser Ser 12/001".
 */
export function composeSenderSymbol(officeCode?: string, serial?: string): string {
  const code = (officeCode ?? '').trim();
  const ser = (serial ?? '').trim();

  if (/^ser\b/i.test(ser)) { return ser; }

  const label = code && needsCodePrefix(code) ? `Code ${code}` : code;

  if (label && ser) { return `Ser ${label}/${ser}`; }
  if (label) { return label; }
  if (ser) { return `Ser ${ser}`; }
  return '';
}
