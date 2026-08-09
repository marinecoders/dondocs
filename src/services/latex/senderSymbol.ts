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
 * The code is printed exactly as the activity writes it. Ch 7 ¶2a(2): "Each
 * command or activity will determine makeup of the originator's code." The rule
 * about prefixing "Code" to an all-numeric code is ¶7a, and it governs the "To:"
 * line — someone else's office. Among the manual's own sender's-symbol examples
 * a bare numeric code is the norm (`Ser 02/318`, `Ser 00/451`, `Ser 301/403`,
 * `Ser 945/321` …) against two that carry it (`Ser Code 13/271`,
 * `Ser Code 10/049`), so an activity that writes "Code 13" types "Code 13".
 *
 * Until now the app collected an office code and never printed it, and printed a
 * serial bare — `001` rather than `Ser 001`.
 */

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

  if (code && ser) { return `Ser ${code}/${ser}`; }
  if (code) { return code; }
  if (ser) { return `Ser ${ser}`; }
  return '';
}
