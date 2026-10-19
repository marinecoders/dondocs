import { safeReportUrl, BUG_REPORT_PRIVACY_NOTICE, BUG_REPORT_LOG_PROMPT } from './bugReport';

export const GITHUB_REPO_URL = 'https://github.com/marinecoders/dondocs';
const GITHUB_NEW_ISSUE_URL = 'https://github.com/marinecoders/dondocs/issues/new';

/**
 * Build a prefilled "New issue" URL for the Help-menu bug report button.
 * The app's general bug-report entry point. Includes only environment (user agent, sanitized URL, timestamp). The download-error modal
 * has its own builder that also carries the full compile log and a target.
 */
export function buildBugReportUrl(): string {

  const body = [
    BUG_REPORT_PRIVACY_NOTICE,
    '',
    '<!--',
    'Thanks for reporting a bug! Not every section below is required — fill',
    'in what you can and delete anything that does not apply. The more',
    'context you share, the faster we can track down and fix the issue.',
    '',
    'Reporting bugs and suggesting features is the fastest way to get them',
    'fixed or built — we triage every report.',
    '-->',
    '',
    '## What happened',
    '<!-- describe the bug in a sentence or two -->',
    '',
    '## Steps to reproduce',
    '<!-- 1. ...',
    '2. ...',
    '3. ... -->',
    '',
    '## Expected behavior',
    '<!-- what you expected to happen instead -->',
    '',
    '## Screenshots',
    '<!-- paste images here if relevant -->',
    '',
    BUG_REPORT_LOG_PROMPT,
    '',
    '## Environment',
    `- User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    `- URL: ${safeReportUrl()}`,
    `- Reported: ${new Date().toISOString()}`,
  ].join('\n');

  const params = new URLSearchParams({
    title: '[Bug] ',
    body,
    labels: 'bug',
  });
  return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}

/**
 * Build a prefilled "New issue" URL for the Help-menu feature-suggestion
 * button. Unlike the bug report, nothing is auto-embedded.
 */
export function buildFeatureRequestUrl(): string {
  const body = [
    BUG_REPORT_PRIVACY_NOTICE,
    '',
    '<!--',
    'Thanks for helping shape DonDocs. Tell us what you would like it to do.',
    'A rough idea is welcome; the more concrete, the faster we can build it.',
    '-->',
    '',
    '## What would you like to see',
    '<!-- the feature or change, in a sentence or two -->',
    '',
    '## Why it would help',
    '<!-- what it makes easier, faster, or possible -->',
    '',
    '## Anything else',
    '<!-- the document type it applies to, examples, references, or a mockup -->',
    '',
    '## Environment',
    `- URL: ${safeReportUrl()}`,
  ].join('\n');

  const params = new URLSearchParams({
    title: '[Feature] ',
    body,
    labels: 'enhancement',
  });
  return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}
