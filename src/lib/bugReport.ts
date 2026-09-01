/**
 * Shared helpers for the "Report a bug" flows.
 *
 * These flows open a prefilled GitHub issue (a public, commercial, non-.mil
 * service). dondocs advertises "no data ever leaves your browser", so the
 * bug-report URL must NOT carry document content off-device:
 *   - The full URL (`window.location.href`) includes the `#s=<ciphertext>`
 *     share payload when the app was opened from a share link — so we strip
 *     the hash AND query and report only origin+pathname.
 *   - Compile logs and in-app logs contain verbatim document body text, so
 *     they are no longer auto-embedded; the user is asked to paste what they
 *     have reviewed, with a visible warning that the report is public.
 */

/** A reportable page location with no hash (share payload) and no query. */
export function safeReportUrl(): string {
  if (typeof window === 'undefined') return 'unknown';
  return `${window.location.origin}${window.location.pathname}`;
}

/** One-line warning placed at the top of every prefilled issue body. */
export const BUG_REPORT_PRIVACY_NOTICE =
  '> ⚠️ This issue is filed on **public GitHub**. Do not paste names, EDIPIs, ' +
  'unit rosters, CUI, or any document content — in the text, in screenshots, ' +
  'or in attachments. Logs may contain your letter text — review before ' +
  'pasting. A made-up example reproduces nearly every bug just as well.';

/** Markdown block instructing the user to paste logs manually (never auto-embedded). */
export const BUG_REPORT_LOG_PROMPT =
  '## Logs\n' +
  '<!-- Use the "Copy logs" button in the app, REVIEW the text for sensitive ' +
  'content, then paste it between the fences below. Leave empty if none. -->\n' +
  '```\n\n```';
