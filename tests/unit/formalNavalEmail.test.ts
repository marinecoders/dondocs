import { describe, expect, it } from 'vitest';
import { EMPTY_FORMAL_EMAIL, FORMAL_EMAIL_LIMITS, prepareFormalNavalEmail } from '@/services/messages/formalNavalEmail';

const completeDraft = {
  letterhead: 'DEPARTMENT OF THE NAVY\r\nTRAINING COMMAND\r\nQUANTICO VA 22134',
  ssic: '5216', serial: 'ser N7/010', date: '2026-11-23',
  from: 'Commanding Officer, Training Command', to: 'Commanding Officer, Support Activity',
  via: 'Commander, Training Group', subject: 'Training schedule',
  body: '1. Review the résumé.\r\n\r\n2. Confirm receipt by Friday.', closing: 'Respectfully,',
  signer: 'A. B. Example', authority: 'Executive Officer\nBy direction of the Commanding Officer',
};

describe('formal naval email', () => {
  it('uses typed Chapter 4 letterhead and signature in a Chapter 7 naval-letter layout', () => {
    const output = prepareFormalNavalEmail(completeDraft);
    expect(output.issues).toEqual({});
    expect(output.text).toBe([
      'DEPARTMENT OF THE NAVY', 'TRAINING COMMAND', 'QUANTICO VA 22134', '',
      '5216', 'Ser N7/010', '23 Nov 26', '',
      'From:  Commanding Officer, Training Command', 'To:      Commanding Officer, Support Activity',
      'Via:     Commander, Training Group', '', 'Subj:   TRAINING SCHEDULE', '',
      '1. Review the résumé.', '', '2. Confirm receipt by Friday.', '', 'Respectfully,', '',
      '/s/', 'A. B. EXAMPLE', 'Executive Officer', 'By direction of the Commanding Officer', '',
    ].join('\n'));
  });

  it('omits the optional Via line and accepts an assigned five-digit SSIC', () => {
    const result = prepareFormalNavalEmail({ ...completeDraft, ssic: '05216', serial: '010', via: '' });
    expect(result.issues).toEqual({});
    expect(result.text).toContain('05216\nSer 010');
    expect(result.text).toContain('To:      Commanding Officer, Support Activity\n\nSubj:');
    expect(result.text).not.toContain('Via:');
  });

  it('requires the authorized signer’s actual authority without assuming one', () => {
    const empty = prepareFormalNavalEmail(EMPTY_FORMAL_EMAIL);
    expect(empty.text).toBe('');
    expect(Object.keys(empty.issues)).toEqual([
      'letterhead', 'ssic', 'serial', 'date', 'from', 'to', 'subject', 'body', 'closing', 'signer', 'authority',
    ]);
    const draft = prepareFormalNavalEmail({ ...completeDraft, authority: '' });
    expect(Object.keys(draft.issues)).toEqual(['authority']);
    expect(draft.text).not.toContain('By direction');
  });

  it('flags invalid dates, incomplete serials and multiline heading or nonprinting body text', () => {
    const result = prepareFormalNavalEmail({
      ...completeDraft, serial: 'N7/', date: '31 Apr 26', subject: 'Subject\u2028Injected line', body: 'Text\x00',
    });
    expect(Object.keys(result.issues)).toEqual(['serial', 'date', 'subject', 'body']);
    expect(prepareFormalNavalEmail({ ...completeDraft, body: 'X'.repeat(FORMAL_EMAIL_LIMITS.body + 1) }).issues.body).toBeTruthy();
  });
});
