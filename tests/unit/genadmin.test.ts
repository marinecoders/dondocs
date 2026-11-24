import { describe, expect, it } from 'vitest';
import { EMPTY_GENADMIN_DRAFT, GENADMIN_LIMITS, prepareGenadmin } from '@/services/messages/genadmin';

const complete = {
  ...EMPTY_GENADMIN_DRAFT,
  from: 'training office quantico va',
  to: 'admin office quantico va\r\n\nsupport office quantico va',
  ssic: 'n05420',
  originator: 'training office',
  office: 'N7',
  month: 'apr',
  subject: 'schedule update',
  contactName: 'Pat Example',
  contactRank: 'Lt',
  contactOffice: 'training office',
  contactDetails: 'pat@example.invalid',
  remarks: '1. Please review the training schedule.\r\n\r\n2.\tSend comments by Friday.',
};

describe('prepareGenadmin', () => {
  it('renders a GENADMIN draft with recipient continuation and paragraph breaks', () => {
    expect(prepareGenadmin(complete)).toEqual({ text: [
      'FM TRAINING OFFICE QUANTICO VA',
      'TO ADMIN OFFICE QUANTICO VA',
      'SUPPORT OFFICE QUANTICO VA',
      '',
      'UNCLAS //N05420//',
      'MSGID/GENADMIN/TRAINING OFFICE/N7/APR//',
      'SUBJ/SCHEDULE UPDATE//',
      'POC/PAT EXAMPLE/LT/TRAINING OFFICE/PAT(AT)EXAMPLE.INVALID//',
      'RMKS/1. Please review the training schedule.',
      '',
      '2. Send comments by Friday.//',
      '',
    ].join('\n') });
  });

  it.each([
    ['(202) 555-0100', '(202) 555-0100'],
    ['+1 (202) 555-0100', '+1 (202) 555-0100'],
    ['+44 20 7946 0958', '+44 20 7946 0958'],
    ['dsn: 555-0100', 'DSN: 555-0100'],
    ['DSN (312) 555-0100', 'DSN (312) 555-0100'],
    ['555-0100', '555-0100'],
    ['pat+mail@example.invalid', 'PAT+MAIL(AT)EXAMPLE.INVALID'],
    ['pat(at)us.navy.mil', 'PAT(AT)US.NAVY.MIL'],
    ['TEL: (202) 555-0100', 'TEL: (202) 555-0100'],
    ['COMM: 202-555-0100', 'COMM: 202-555-0100'],
    ['TEL: DSN 555-0100', 'TEL: DSN 555-0100'],
    ['Email: pat@example.invalid', 'EMAIL: PAT(AT)EXAMPLE.INVALID'],
  ])('accepts a complete contact value %s', (contactDetails, printed) => {
    expect(prepareGenadmin({ ...complete, contactDetails }).text).toContain(`TRAINING OFFICE/${printed}//`);
  });

  it.each([
    'ABC123XYZ', 'call 202-555-0100', '202-555-0100 ASAP', '555-010', 'DSN555-0100',
    'DSN: 555', '+1 555-0100', '+0044 20 7946 0958', 'pat(at)example', 'pat@example..invalid',
    'pat..example@example.invalid', 'pat@-example.invalid', 'pat@example.invalid. extra',
    'pat@example.invalid 202-555-0100',
    'TEL: ABC123XYZ', 'EMAIL: 202-555-0100', 'COMM: pat@example.invalid',
  ])('rejects an incomplete or mixed contact value %s', contactDetails => {
    expect(prepareGenadmin({ ...complete, contactDetails })).toEqual({
      issues: { contactDetails: 'Enter one phone number, DSN number, or email address.' },
    });
  });

  it('places optional routing and references in source order and selects AMPN or NARR', () => {
    const draft = {
      ...complete, info: 'record office quantico va\nliaison quantico va',
      passTo: 'record office quantico va | n1',
      references: 'demo manual | 29FEB2024',
    };
    const single = prepareGenadmin(draft).text;
    expect(single).toContain('INFO RECORD OFFICE QUANTICO VA\nLIAISON QUANTICO VA');
    expect(single).toContain('PASS TO OFFICE CODES:\nRECORD OFFICE QUANTICO VA//N1//\nMSGID/');
    expect(single).toContain('REF/A/DOC/DEMO MANUAL/\n29FEB2024//\nAMPN/REF A IS DEMO MANUAL.//\nPOC/');
    expect(prepareGenadmin({ ...draft, references: draft.references + '\nsecond manual | 01APR2025' }).text)
      .toContain('REF/B/DOC/SECOND MANUAL/\n01APR2025//\nNARR/REF A IS DEMO MANUAL.\nREF B IS SECOND MANUAL.//\nPOC/');
  });

  it('returns errors for every missing required field and omits optional fields', () => {
    expect(Object.keys(prepareGenadmin(EMPTY_GENADMIN_DRAFT).issues ?? {})).toEqual([
      'from', 'to', 'ssic', 'originator', 'office', 'month', 'subject',
      'contactName', 'contactRank', 'contactOffice', 'contactDetails', 'remarks',
    ]);
  });

  it.each([
    ['from', 'TEAM//N7//'], ['from', 'TRAINING\nOFFICE'], ['to', 'INVALID/ROUTING'],
    ['to', 'FIRST COMMAND\nINFO SECOND COMMAND'], ['info', 'RECORDS OFFICE\nFM OTHER COMMAND'],
    ['from', 'FM FIRST COMMAND'], ['to', '...'], ['info', 'Office\u200b'], ['ssic', 'N1234'], ['office', 'N 7'], ['month', 'APRIL'],
    ['subject', 'First//\nSUBJ/Injected'], ['subject', 'Straße'], ['subject', 'X'.repeat(GENADMIN_LIMITS.line + 1)],
    ['passTo', 'unlisted | N1'], ['passTo', 'admin office quantico va | N1 | N2'],
    ['passTo', 'admin office quantico va | \u0131'], ['references', 'manual | 29FEB2023'],
    ['references', 'manual | 31APR2025'], ['references', 'manual | 01XXX2025'],
    ['references', 'manual | 01APR2025 | extra'], ['references', 'manual | 01APR2025\n'.repeat(27)],
    ['contactDetails', 'ask operations'], ['remarks', 'First//\nRMKS/Injected'],
    ['remarks', 'Trailing /'], ['remarks', 'Contains\u0000control'], ['remarks', 'Contains emoji \u{1f4dd}'],
    ['remarks', 'X'.repeat(GENADMIN_LIMITS.remarks + 1)],
  ] as const)('does not export an invalid %s value', (field, value) => {
    const output = prepareGenadmin({ ...complete, [field]: value });
    expect(output.issues?.[field]).toBeTruthy();
    expect(output.text).toBeUndefined();
  });
});
