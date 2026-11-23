export const GENADMIN_FORMAT_SOURCE =
  'https://www.netc.navy.mil/Portals/46/NETC/staff%20inst/23001G.pdf';

export const GENADMIN_LIMITS = { line: 160, list: 5_000, remarks: 20_000 } as const;

export interface GenadminDraft {
  from: string;
  to: string;
  info: string;
  ssic: string;
  originator: string;
  office: string;
  month: string;
  subject: string;
  passTo: string;
  references: string;
  contactName: string;
  contactRank: string;
  contactOffice: string;
  contactDetails: string;
  remarks: string;
}

export const EMPTY_GENADMIN_DRAFT: GenadminDraft = {
  from: '', to: '', info: '', ssic: '', originator: '', office: '', month: '', subject: '',
  passTo: '', references: '', contactName: '', contactRank: '', contactOffice: '', contactDetails: '',
  remarks: '',
};

type Field = keyof GenadminDraft;
type Issues = Partial<Record<Field, string>>;
type DraftResult = { text: string; issues?: never } | { issues: Issues; text?: never };

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const HEADER_VALUE = /^[ -~]+$/;
const MULTILINE_VALUE = /^[ -~\n]*$/;
const ADDRESS = /^[A-Za-z0-9 .&(),'-]+$/;
const OFFICE_CODE = /^[A-Z0-9-]+$/;
const ROUTING_PREFIX = /^(?:FM|TO|INFO|UNCLAS|BT)(?: |$)/i;

function isAddress(value: string): boolean {
  return ADDRESS.test(value) && /[A-Z0-9]/i.test(value) && !ROUTING_PREFIX.test(value);
}

function normalize(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
}

function lines(value: string): string[] {
  return normalize(value).split('\n').map(line => line.trim()).filter(Boolean);
}

function formatAddressBlock(prefix: string, addresses: string[]): string[] {
  return addresses.map((address, index) => (index === 0 ? prefix + ' ' : '') + address.toUpperCase());
}

function isReferenceDate(value: string): boolean {
  const match = /^(\d{2})([A-Z]{3})(\d{4})$/.exec(value);
  if (!match) return false;
  const month = MONTHS.indexOf(match[2]);
  const date = new Date(value.slice(-4) + '-' + String(month + 1).padStart(2, '0') + '-' + match[1] + 'T00:00:00Z');
  return month >= 0 && date.getUTCDate() === Number(match[1]);
}

/** Renders a local GENADMIN administrative draft using the NETC sample layout. */
export function prepareGenadmin(draft: GenadminDraft): DraftResult {
  const issues: Issues = {};
  const header = (field: Field, label: string) => {
    const value = normalize(draft[field]);
    if (!value) issues[field] = 'Enter ' + label + '.';
    else if (draft[field].length > GENADMIN_LIMITS.line || !HEADER_VALUE.test(value) || value.includes('/')) {
      issues[field] = 'Use one plain-text line without slashes.';
    }
    return value.toUpperCase();
  };

  const from = header('from', 'the From address');
  if (from && !isAddress(from)) issues.from = 'Enter one plain-language address without routing labels or office codes.';

  const to = lines(draft.to);
  const info = lines(draft.info);
  if (!to.length) issues.to = 'Enter at least one action addressee.';
  for (const [field, addresses] of [['to', to], ['info', info]] as const) {
    if (draft[field].length > GENADMIN_LIMITS.list
      || addresses.some(address => address.length > GENADMIN_LIMITS.line || !isAddress(address))) {
      issues[field] = 'Enter one plain-language address per line, without routing labels or office codes.';
    }
  }

  const ssic = normalize(draft.ssic).toUpperCase().replace(/^N/, '');
  if (!/^\d{5}$/.test(ssic)) issues.ssic = 'Enter a five-digit SSIC, such as 05420.';
  const originator = header('originator', 'the message originator');
  const office = header('office', 'the originator office code');
  if (office && !OFFICE_CODE.test(office)) issues.office = 'Use letters, numbers or hyphens for the office code.';
  const month = normalize(draft.month).toUpperCase();
  if (!MONTHS.includes(month)) issues.month = 'Enter a three-letter month, such as APR.';
  const subject = header('subject', 'a subject');

  const passTo = lines(draft.passTo).map(line => line.toUpperCase().split('|').map(part => part.trim()));
  const addressees = new Set([...to, ...info].map(address => address.toUpperCase()));
  if (draft.passTo.length > GENADMIN_LIMITS.list || !MULTILINE_VALUE.test(normalize(draft.passTo)) || passTo.some(([address, code, ...extra]) =>
    extra.length || !addressees.has(address) || !code || code.length > GENADMIN_LIMITS.line || !OFFICE_CODE.test(code),
  )) issues.passTo = 'Use an exact To or Info address followed by | and an office code, one per line.';

  const refs = lines(draft.references).map(line => line.toUpperCase().split('|').map(part => part.trim()));
  if (draft.references.length > GENADMIN_LIMITS.list || !MULTILINE_VALUE.test(normalize(draft.references)) || refs.length > 26 || refs.some(([title, date, ...extra]) =>
    extra.length || !title || title.length > GENADMIN_LIMITS.line || !HEADER_VALUE.test(title)
    || title.includes('/') || !date || !isReferenceDate(date),
  )) issues.references = 'Use document title | DDMMMYYYY, with a valid date, one per line (up to 26).';

  const contactName = header('contactName', 'the contact name');
  const contactRank = header('contactRank', 'the contact rank or title');
  const contactOffice = header('contactOffice', 'the contact office');
  const contactDetails = header('contactDetails', 'a phone number or email').replaceAll('@', '(AT)');
  if (contactDetails && !issues.contactDetails
    && !/\d{3}/.test(contactDetails) && !/[^\s]+\(AT\)[^\s]+/.test(contactDetails)) {
    issues.contactDetails = 'Enter a phone number or email address.';
  }

  const remarks = normalize(draft.remarks);
  if (!remarks) issues.remarks = 'Enter the remarks.';
  else if (draft.remarks.length > GENADMIN_LIMITS.remarks || !MULTILINE_VALUE.test(remarks) || remarks.includes('//') || remarks.endsWith('/')) {
    issues.remarks = 'Use plain ASCII text without double slashes or a trailing slash.';
  }

  if (Object.keys(issues).length) return { issues };

  const output = [
    'FM ' + from,
    ...formatAddressBlock('TO', to),
    ...formatAddressBlock('INFO', info),
    '',
    'UNCLAS //N' + ssic + '//',
  ];
  if (passTo.length) {
    output.push('PASS TO OFFICE CODES:', ...passTo.map(([address, code]) => address + '//' + code + '//'));
  }
  output.push('MSGID/GENADMIN/' + originator + '/' + office + '/' + month + '//', 'SUBJ/' + subject + '//');
  refs.forEach(([title, date], index) => {
    output.push('REF/' + String.fromCharCode(65 + index) + '/DOC/' + title + '/', date + '//');
  });
  if (refs.length) {
    const narrative = refs.map(([title], index) => 'REF ' + String.fromCharCode(65 + index) + ' IS ' + title + '.');
    output.push((refs.length === 1 ? 'AMPN/' : 'NARR/') + narrative.join('\n') + '//');
  }
  output.push('POC/' + [contactName, contactRank, contactOffice, contactDetails].join('/') + '//', 'RMKS/' + remarks + '//');
  return { text: output.join('\n') + '\n' };
}
