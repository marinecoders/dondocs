import { normalizeDate } from '@/lib/dateFormatting';
import { composeSenderSymbol } from '@/services/latex/senderSymbol';

export const FORMAL_EMAIL_MANUAL = 'https://www.secnav.navy.mil/doni/SECNAV%20Manuals1/5216.5%20%20CH-1.pdf#page=33';
export const FORMAL_EMAIL_LIMITS = { line: 200, letterhead: 1_500, body: 20_000 } as const;

export const EMPTY_FORMAL_EMAIL = {
  letterhead: '', ssic: '', serial: '', date: '', from: '', to: '', via: '', subject: '',
  body: '', closing: '', signer: '', authority: '',
};
export type FormalNavalEmailDraft = typeof EMPTY_FORMAL_EMAIL;
type FormalEmailField = keyof FormalNavalEmailDraft;

// SECNAV M-5216.5 ¶4-2.2 uses a standard DON format with typed letterhead
// and a typed /s/ signature. This composer uses the Chapter 7 naval-letter layout.
export function prepareFormalNavalEmail(draft: FormalNavalEmailDraft) {
  const issues: Partial<Record<FormalEmailField, string>> = {};
  function field(name: FormalEmailField, required?: string) {
    const raw = draft[name];
    const value = raw.replace(/\r\n?|\u2028|\u2029/g, '\n').replaceAll('\t', ' ').trim();
    const limit = name === 'letterhead' || name === 'body' ? FORMAL_EMAIL_LIMITS[name] : FORMAL_EMAIL_LIMITS.line;
    if (!value && required) issues[name] = required;
    else if (raw.length > limit) issues[name] = `Use ${limit.toLocaleString()} characters or fewer.`;
    else if (/\p{Cc}/u.test(value.replaceAll('\n', ''))) issues[name] = 'Remove nonprinting characters.';
    else if (name !== 'letterhead' && name !== 'body' && name !== 'authority' && value.includes('\n')) issues[name] = 'Use one line.';
    return value;
  }

  const letterhead = field('letterhead', 'Enter the originating organization’s letterhead.');
  const ssic = field('ssic', 'Enter an SSIC.');
  if (ssic && !issues.ssic && !/^\d{4,5}$/.test(ssic)) issues.ssic = 'Enter a four- or five-digit SSIC.';
  const serial = field('serial', 'Enter the assigned serial number.');
  if (serial && !issues.serial && !/\d/.test(serial.split('/').at(-1) ?? '')) issues.serial = 'Include the number in the serial.';
  const rawDate = field('date', 'Enter the correspondence date.');
  const date = normalizeDate(rawDate, 'military');
  if (rawDate && !date && !issues.date) issues.date = 'Enter a valid date, such as 23 Nov 26.';
  const from = field('from', 'Enter the sender’s title and organization.');
  const to = field('to', 'Enter the correspondence addressee.');
  const via = field('via');
  const subject = field('subject', 'Enter a subject.').toUpperCase();
  const body = field('body', 'Enter the message body.');
  const closing = field('closing', 'Enter a complimentary closing.');
  const signer = field('signer', 'Enter the signer’s name.').toUpperCase();
  const authority = field('authority', 'Enter the signer’s official capacity or delegation.');

  const blocks = [
    letterhead,
    [ssic, composeSenderSymbol(undefined, serial.replace(/^ser\s+/i, '')), date ?? rawDate].filter(Boolean).join('\n'),
    [from && `From:  ${from}`, to && `To:      ${to}`, via && `Via:     ${via}`].filter(Boolean).join('\n'),
    subject && `Subj:   ${subject}`,
    body,
    closing,
    [signer && '/s/', signer, authority].filter(Boolean).join('\n'),
  ].filter(Boolean);

  return { text: blocks.length ? `${blocks.join('\n\n')}\n` : '', issues };
}
