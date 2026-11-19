import { DOC_TYPE_CONFIG } from '@/types/document';
import { documentTextFields } from './documentFields';
import { enclosureStartNumber, isEndorsement } from './endorsement';
import { citationProtectedRanges } from './referenceCitations';
import { maskProtectedRanges } from './protectedCodeRanges';
import { plainInlineText } from './inlineText';
import { safeUrl } from './url-safety';
import { unfilled } from './requiredField';
import { deriveOverallClassLevel } from './overallClassification';
import { canAppendEndorsement, hasEndorsementContent } from './appendedEndorsement';
import { jointSignatories } from './signingAuthority';
import type { ProofreadFinding, ProofreadSource } from './proofread';

const PUBLICATIONS = new Set(['sl3', 'sl4', 'i_type', 'tm_ietm_front_matter']);
const SUBJECT_FRAGMENT_TYPES = new Set(['naval_letter', 'standard_letter', 'multiple_address_letter', 'joint_letter', 'new_page_endorsement', 'same_page_endorsement']);

export function supportsCorrespondenceProofread(source: Pick<ProofreadSource, 'documentCategory' | 'docType'>): boolean {
  return source.documentCategory === 'correspondence' && !PUBLICATIONS.has(source.docType)
    && Object.hasOwn(DOC_TYPE_CONFIG, source.docType);
}

/** Additional advisory checks on printed correspondence, without changing a draft
 * or duplicating the existing formatting, readiness and classification engines. */
export function additionalProofreadFindings(source: ProofreadSource): ProofreadFinding[] {
  if (!supportsCorrespondenceProofread(source)) return [];
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
      ? [['jointJuniorDate', 'Junior command date']] as const
      : [['date', 'Document date']] as const;
  const headingSection = config.uiMode === 'moa' ? 'moa'
    : config.uiMode === 'joint' ? 'joint' : config.uiMode === 'joint_memo' ? 'joint_memo'
      : config.uiMode === 'executive' ? 'executive' : 'addressing';
  // Executive dates may be reserved for the signing office (Ch 12).
  const reviewDates = source.docType !== 'executive_correspondence' && config.uiMode !== 'executive';
  for (const [field, label] of reviewDates ? dateFields : []) {
    if (unfilled(data[field])) add(`date:${field}`, `${label} is empty`,
      'Enter the date when it is known, or deliberately leave space for dating at signature.',
      headingSection, field, { chapter: 2, paragraph: '16', query: 'Expressing Dates' });
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
    if (unfilled(data.basicLetterId) && unfilled(legacy?.[2])) add('endorsement-id',
      'Identify the basic letter', 'Enter the identifier of the letter being endorsed.',
      'basic', 'basicLetterId', { chapter: 9, paragraph: '1', query: 'Endorsement Line' });
  }
  if (data.appendEndorsement && canAppendEndorsement(source.docType)) {
    const entries = [
      { id: 'first-endorsement', label: 'First endorsement', value: data },
      ...(data.additionalEndorsements ?? []).filter(hasEndorsementContent)
        .map(entry => ({ id: entry.id, label: 'Additional endorsement', value: entry })),
    ];
    for (const entry of entries) {
      if (unfilled(entry.value.endorsementBody)) add(`endorsement-body:${entry.id}`,
        `${entry.label} needs text`, 'Complete the enabled endorsement text, or remove the endorsement if it is not needed.',
        'signature', `${entry.id}-body`, { chapter: 9, query: 'Endorsement' }, 'structure');
    }
  }
  if (source.docType === 'multiple_address_letter') {
    const addresses = (data.to ?? '').split(/\r?\n/).filter(line => line.trim());
    if (addresses.length > 4) add('multiple-addresses', 'Review the addressee list',
      'The To field has more than four nonempty lines. If these are separate addressees, use the Distribution list. Wrapped address lines need human review.',
      'addressing', 'to', { chapter: 8, query: 'Listing Addressees' });
  }
  const signers = config.uiMode === 'joint'
    ? [['jointSeniorSigName', 'Senior command signer'], ['jointJuniorSigName', 'Junior command signer']] as const
    : config.uiMode === 'joint_memo'
      ? [['jointMemoSeniorSigName', 'Senior command signer'], ['jointMemoJuniorSigName', 'Junior command signer']] as const
      : config.uiMode === 'moa'
        ? [['seniorSigName', 'Senior party signer'], ['juniorSigName', 'Junior party signer']] as const : [];
  const memoSigners = jointSignatories(data, true);
  for (const [field, label] of signers) {
    const value = config.uiMode === 'joint_memo'
      ? field === 'jointMemoSeniorSigName' ? memoSigners.seniorName : memoSigners.juniorName
      : data[field];
    if (unfilled(value)) add(`signer:${field}`, `${label} is empty`,
      'Complete the signer for this party. A name does not establish signing authority.',
      config.uiMode === 'moa' ? 'moa' : config.uiMode === 'joint' ? 'joint' : 'joint_memo', field,
      { chapter: config.uiMode === 'joint' ? 7 : 10, query: 'signature' }, 'required');
  }
  // Custom marking mode renders a banner only, not a CUI designation block.
  if (data.classLevel === 'cui' && deriveOverallClassLevel(data.classLevel, source.paragraphs) === 'cui') {
    for (const [field, label] of [['cuiControlledBy', 'Controlled by'], ['cuiCategory', 'CUI category'], ['pocEmail', 'POC email']] as const) {
      if (unfilled(data[field])) add(`cui:${field}`, `${label} is empty`,
        'Complete this field in the CUI designation block before delivery. This check assesses field completeness only.',
        'classification', field === 'pocEmail' ? 'cuiPocEmail' : field, undefined, 'markings');
    }
    if (!unfilled(data.pocEmail) && !safeUrl((data.pocEmail ?? '').trim().replace(/^mailto:/i, ''))?.startsWith('mailto:')) {
      add('cui:poc-email-invalid', 'Review the CUI POC email',
        'Enter a valid contact email. This value cannot be printed as the document’s POC email.',
        'classification', 'cuiPocEmail', undefined, 'markings');
    }
  }
  if (!(source.documentMode === 'custom' || config.compliance.allowEnclosures)) return findings;
  const start = enclosureStartNumber(source.docType, data.startingEnclosureNumber);
  source.enclosures.forEach((enclosure, index) => {
    if (unfilled(enclosure.title)) add(`enclosure-title:${index}`, `Enclosure (${start + index}) needs a title`,
      'Describe the enclosed document in the enclosure list.', 'enclosures', `enclosure-title-${index}`,
      { chapter: 7, paragraph: '11', query: 'Enclosures' }, 'references');
  });
  const citationFields = documentTextFields(source, 'output').filter(field =>
    field.path[0] === 'paragraphs' || field.path[0] === 'formData'
      && (field.path[1] === 'endorsementBody' || field.path[1] === 'additionalEndorsements' && field.path[3] === 'endorsementBody'));
  for (const field of citationFields) {
    // Hide literals before removing emphasis. A non-space mask prevents an
    // invented citation across a quote, such as enclosure "example" (2).
    const text = plainInlineText(maskProtectedRanges(field.text, citationProtectedRanges(field.text), '\uFFFC'));
    const seen = new Set<number>();
    for (const clause of text.matchAll(/\b(?:enclosures?|encls?\.?)\s*(?=\()/gi)) {
      let cursor = clause.index + clause[0].length;
      for (;;) {
        const match = /^\(\s*(\d+)\s*\)/.exec(text.slice(cursor));
        if (!match) break;
        const number = Number(match[1]);
        if (!seen.has(number)
          && !(isEndorsement(source.docType) && number > 0 && number < start)
          && (number < start || number >= start + source.enclosures.length)) {
          seen.add(number);
          const paragraph = field.path[0] === 'paragraphs' ? source.paragraphs[Number(field.path[1])] : undefined;
          const endorsement = field.path[1] === 'additionalEndorsements'
            ? data.additionalEndorsements?.[Number(field.path[2])]?.id : 'first-endorsement';
          const target: ProofreadFinding['target'] = field.path[0] === 'paragraphs'
            ? { sectionId: 'body', ...(paragraph?.id ? { paragraphId: paragraph.id } : {}) }
            : { sectionId: 'signature', field: `${endorsement}-body` };
          findings.push({ id: `correspondence:enclosure-citation:${field.path.join(':')}:${number}`,
            group: 'references', severity: 'warning', title: `Check enclosure (${number})`,
            message: 'This explicit citation has no entry in this document’s enclosure list. Confirm its target before delivery.',
            target,
            source: { chapter: 7, paragraph: '11', query: 'Enclosures' } });
        }
        cursor += match[0].length;
        const separator = /^(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|&)\s+)(?=\()/i.exec(text.slice(cursor));
        if (!separator) break;
        cursor += separator[0].length;
      }
    }
  }
  return findings;
}
