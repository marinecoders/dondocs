import { DOC_TYPE_CONFIG } from '@/types/document';
import { documentTextFields } from './documentFields';
import { enclosureStartNumber, isEndorsement } from './endorsement';
import { citationProtectedRanges } from './referenceCitations';
import { safeUrl } from './url-safety';
import type { ProofreadFinding, ProofreadSource } from './proofread';

const PUBLICATIONS = new Set(['sl3', 'sl4', 'i_type', 'tm_ietm_front_matter']);
const SUBJECT_FRAGMENT_TYPES = new Set(['naval_letter', 'standard_letter', 'multiple_address_letter', 'joint_letter', 'new_page_endorsement', 'same_page_endorsement']);

/** Additional advisory checks on printed correspondence, without changing a draft
 * or duplicating the existing formatting, readiness and classification engines. */
export function additionalProofreadFindings(source: ProofreadSource): ProofreadFinding[] {
  if (source.documentCategory !== 'correspondence' || PUBLICATIONS.has(source.docType)
    || !Object.hasOwn(DOC_TYPE_CONFIG, source.docType)) return [];
  const config = DOC_TYPE_CONFIG[source.docType], data = source.formData;
  const findings: ProofreadFinding[] = [];
  const add = (id: string, title: string, message: string, sectionId: string, field?: string,
    reference?: ProofreadFinding['source'], group: ProofreadFinding['group'] = 'formatting') => {
    findings.push({ id: `correspondence:${id}`, group, severity: 'warning', title, message,
      target: { sectionId, ...(field ? { field } : {}) }, ...(reference ? { source: reference } : {}) });
  };
  const dateFields = config.uiMode === 'moa'
    ? [['seniorDate', 'Senior party date'], ['juniorDate', 'Junior party date']] as const
    : config.uiMode === 'joint'
      ? [['date', 'Senior command date'], ['jointJuniorDate', 'Junior command date']] as const
      : [['date', 'Document date']] as const;
  const headingSection = config.uiMode === 'moa' ? 'moa'
    : config.uiMode === 'joint' ? 'joint' : config.uiMode === 'joint_memo' ? 'joint_memo'
      : config.uiMode === 'executive' ? 'executive' : 'addressing';
  for (const [field, label] of dateFields) {
    if (!data[field]?.trim()) add(`date:${field}`, `${label} is empty`,
      'Enter the date when it is known, or deliberately leave space for dating at signature.',
      headingSection, field, { chapter: 2, paragraph: '16', query: 'Dating Correspondence' });
  }
  const subjectField = config.uiMode === 'joint' ? 'jointSubject' : 'subject';
  const subjectPrinted = !config.skipSubject || isEndorsement(source.docType) && data.includeEndorsementSubject;
  if (subjectPrinted && SUBJECT_FRAGMENT_TYPES.has(source.docType) && /\.\s*$/.test(data[subjectField] ?? '')) {
    add('subject-period', 'Review subject punctuation',
      'The subject is normally a sentence fragment. Check whether its final period belongs in this subject.',
      headingSection, subjectField, { chapter: 7, paragraph: '9', query: 'Subject Line' });
  }
  if (isEndorsement(source.docType)) {
    // Match the generator's legacy subject fallback so an older, still printable
    // endorsement is not incorrectly treated as missing its basic-letter ID.
    const legacy = /^(.+?)\s+ENDORSEMENT(?:\s+on\s+(.+))?$/i.exec(data.subject ?? '');
    if (!data.basicLetterId?.trim() && !legacy?.[2]?.trim()) add('endorsement-id',
      'Identify the basic letter', 'Enter the identifier of the letter being endorsed.',
      'basic', 'basicLetterId', { chapter: 9, paragraph: '2', query: 'Endorsement Line' });
  }
  if (source.docType === 'multiple_address_letter') {
    const addresses = (data.to ?? '').split(/\r?\n/).filter(line => line.trim());
    if (addresses.length > 4) add('multiple-addresses', 'Review the addressee list',
      'The To field has more than four nonempty lines. If these are separate addressees, use the Distribution list. Wrapped address lines need human review.',
      'addressing', 'to', { chapter: 8, paragraph: '8-2', query: 'Listing Addressees' });
  }
  const signers = config.uiMode === 'joint'
    ? [['jointSeniorSigName', 'Senior command signer'], ['jointJuniorSigName', 'Junior command signer']] as const
    : config.uiMode === 'joint_memo'
      ? [['jointMemoSeniorSigName', 'Senior command signer'], ['jointMemoJuniorSigName', 'Junior command signer']] as const
      : config.uiMode === 'moa'
        ? [['seniorSigName', 'Senior party signer'], ['juniorSigName', 'Junior party signer']] as const : [];
  for (const [field, label] of signers) {
    if (!data[field]?.trim()) add(`signer:${field}`, `${label} is empty`,
      'Complete the signer for this party. A name does not establish signing authority.',
      config.uiMode === 'moa' ? 'moa' : config.uiMode === 'joint' ? 'joint' : 'joint_memo', field,
      { chapter: config.uiMode === 'joint' ? 7 : 10, query: 'signature' }, 'required');
  }
  if (data.classLevel === 'cui' || data.classLevel === 'custom' && /^CUI(?:$|\/\/)/i.test(data.customClassification ?? '')) {
    for (const [field, label] of [['cuiControlledBy', 'Controlled by'], ['cuiCategory', 'CUI category'], ['pocEmail', 'POC email']] as const) {
      if (!data[field]?.trim()) add(`cui:${field}`, `${label} is empty`,
        'Complete this field in the CUI designation block before delivery. This check assesses field completeness only.',
        'classification', field === 'pocEmail' ? (data.classLevel === 'custom' ? 'customCuiPocEmail' : 'cuiPocEmail')
          : data.classLevel === 'custom' ? `custom${field[0].toUpperCase()}${field.slice(1)}` : field, undefined, 'markings');
    }
    if (data.pocEmail?.trim() && !safeUrl(data.pocEmail.trim().replace(/^mailto:/i, ''))?.startsWith('mailto:')) {
      add('cui:poc-email-invalid', 'Review the CUI POC email',
        'Enter a valid contact email. This value cannot be printed as the document’s POC email.',
        'classification', data.classLevel === 'custom' ? 'customCuiPocEmail' : 'cuiPocEmail', undefined, 'markings');
    }
  }
  if (!(source.documentMode === 'custom' || config.compliance.allowEnclosures)) return findings;
  const start = enclosureStartNumber(source.docType, data.startingEnclosureNumber);
  source.enclosures.forEach((enclosure, index) => {
    if (!enclosure.title.trim()) add(`enclosure-title:${index}`, `Enclosure (${start + index}) needs a title`,
      'Describe the enclosed document in the enclosure list.', 'enclosures', undefined,
      { chapter: 7, paragraph: '11', query: 'Enclosures' }, 'references');
  });
  for (const field of documentTextFields(source, 'output').filter(f => f.path[0] === 'paragraphs')) {
    const protectedSpans = citationProtectedRanges(field.text);
    const seen = new Set<number>();
    for (const clause of field.text.matchAll(/\b(?:enclosures?|encls?\.?)\s*(?=\()/gi)) {
      if (protectedSpans.some(([a, b]) => clause.index >= a && clause.index < b)) continue;
      let cursor = clause.index + clause[0].length;
      for (;;) {
        const match = /^\(\s*(\d+)\s*\)/.exec(field.text.slice(cursor));
        if (!match) break;
        const number = Number(match[1]);
        if (!protectedSpans.some(([a, b]) => cursor >= a && cursor < b) && !seen.has(number)
          && !(isEndorsement(source.docType) && number > 0 && number < start)
          && (number < start || number >= start + source.enclosures.length)) {
          seen.add(number);
          const paragraphIndex = Number(field.path[1]), paragraph = source.paragraphs[paragraphIndex];
          findings.push({ id: `correspondence:enclosure-citation:${field.path.join(':')}:${number}`,
            group: 'references', severity: 'warning', title: `Check enclosure (${number})`,
            message: 'This explicit citation has no entry in this document’s enclosure list. Confirm its target before delivery.',
            target: { sectionId: 'body', ...(paragraph?.id ? { paragraphId: paragraph.id } : {}) },
            source: { chapter: 7, paragraph: '11', query: 'Enclosures' } });
        }
        cursor += match[0].length;
        const separator = /^(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|&)\s+)(?=\()/i.exec(field.text.slice(cursor));
        if (!separator) break;
        cursor += separator[0].length;
      }
    }
  }
  return findings;
}
