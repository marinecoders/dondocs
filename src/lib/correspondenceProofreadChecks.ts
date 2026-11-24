import { DOC_TYPE_CONFIG } from '@/types/document';
import { documentOutputConfig } from './documentOutputConfig';
import { canReviewReferenceOrder, citationProtectedRanges, scanReferenceCitations } from './referenceCitations';
import { plainInlineText } from './inlineText';
import { maskProtectedRanges } from './protectedCodeRanges';
import { documentTextFields } from './documentFields';
import { enclosureStartNumber, isEndorsement } from './endorsement';
import { inspectEnclosureCitations } from './enclosureCitations';
import { safeUrl } from './url-safety';
import { unfilled } from './requiredField';
import { deriveOverallClassLevel } from './overallClassification';
import { canAppendEndorsement, hasEndorsementContent } from './appendedEndorsement';
import { FIRST_ENDORSEMENT_EDITOR_ID, additionalEndorsementEditorId } from './endorsementEditorIds';
import { jointSignatories } from './signingAuthority';
import { isStaffPaper } from './staffPapers';
import type { ProofreadFinding, ProofreadSource } from './proofread';

const PUBLICATIONS = new Set(['sl3', 'sl4', 'i_type', 'tm_ietm_front_matter', 'technical_volume']);
const STANDARD_ADDRESS_TYPES = new Set(['naval_letter', 'standard_letter', 'multiple_address_letter', 'joint_letter', 'new_page_endorsement', 'same_page_endorsement']);
// Known naval terms keep all-caps English words such as MEETING out of this check.
const SUBJECT_ACRONYM = /\b(?:NATO|USMC|USN|USCG|USAF|DOD|HQMC|NROTC|ROTC|MCCDC|MCRC|MARCORSYSCOM|MAGTF|MEF|MARDIV|MARFORCOM|MARFORPAC|COMNAVSURFOR|COMNAVAIRFOR|SSIC|EDIPI|NJP|POAM)\b/i;
const CLASSIFIED_SERIAL_MARK = new Map([['confidential', 'C'], ['secret', 'S'], ['top_secret', 'TS']]);

export function supportsCorrespondenceProofread(source: Pick<ProofreadSource, 'documentCategory' | 'docType'>): boolean {
  return source.documentCategory === 'correspondence' && !PUBLICATIONS.has(source.docType)
    && Object.hasOwn(DOC_TYPE_CONFIG, source.docType);
}

export function supportsWordProofread(source: Pick<ProofreadSource, 'documentCategory' | 'docType'>): boolean {
  return source.docType !== 'coordination_page' && supportsCorrespondenceProofread(source);
}

/** Additional advisory checks on printed correspondence, without changing a draft
 * or duplicating the existing formatting, readiness and classification engines. */
export function additionalProofreadFindings(source: ProofreadSource, catalog?: ReadonlySet<string>): ProofreadFinding[] {
  if (!supportsCorrespondenceProofread(source)) return [];
  const config = documentOutputConfig(source.docType, source.documentMode), data = source.formData;
  const staffPaper = isStaffPaper(source.docType);
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
  const headingSection = staffPaper ? 'staff-paper' : config.uiMode === 'moa' ? 'moa'
    : config.uiMode === 'joint' ? 'joint' : config.uiMode === 'joint_memo' ? 'joint_memo'
      : config.uiMode === 'executive' ? 'executive' : 'addressing';
  // Executive dates may be reserved for the signing office (Ch 12).
  const reviewDates = source.docType !== 'coordination_page' && source.docType !== 'executive_correspondence' && config.uiMode !== 'executive';
  for (const [field, label] of reviewDates ? dateFields : []) {
    if (unfilled(data[field])) add(`date:${field}`, `${label} is empty`,
      'Enter the date when it is known, or deliberately leave space for dating at signature.',
      headingSection, staffPaper ? 'admin-date' : field, { chapter: 2, paragraph: '16', query: 'Expressing Dates' });
  }
  const subjectField = config.uiMode === 'joint' ? 'jointSubject' : 'subject';
  const subjectPrinted = !config.skipSubject || isEndorsement(source.docType) && data.includeEndorsementSubject;
  if (subjectPrinted && STANDARD_ADDRESS_TYPES.has(source.docType) && /\.\s*$/.test(data[subjectField] ?? '')) {
    add('subject-period', 'Review subject punctuation',
      'The subject is normally a sentence fragment. Check whether its final period belongs in this subject.',
      headingSection, subjectField, { chapter: 7, paragraph: '9', query: 'Subject Line' });
  }
  if (subjectPrinted && STANDARD_ADDRESS_TYPES.has(source.docType) && SUBJECT_ACRONYM.test(data[subjectField] ?? '')) {
    add('subject-acronym', 'Review acronyms in the subject',
      'Spell out acronyms in standard correspondence subjects. If replying, check the manual before changing the incoming subject.',
      headingSection, subjectField, { chapter: 7, paragraph: '9', query: 'Subject Line' }, 'acronyms');
  }
  const standardAddress = STANDARD_ADDRESS_TYPES.has(source.docType);
  if (standardAddress && config.fromTo) {
    const toField = config.uiMode === 'joint' ? 'jointTo' : 'to';
    const to = data[toField] ?? '';
    if (/\(\s*(?:\d+|Code\s+[A-Z][A-Z0-9-]*)\s*\)/i.test(to)) add('to-office-code', 'Review the To-line office code',
      'Write Code before a numeric office code. Omit Code before an office code that starts with a letter.',
      headingSection, toField, { chapter: 7, paragraph: '7', query: 'To: Line' });
    if (/(?:^|[,(]\s*|\bAttn:?\s+)(?:Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?|Capt\.?|Captain|Lt\.?|Lieutenant|Maj\.?|Major|Col\.?|Colonel|Sgt\.?|Sergeant)\s+(?!Major\b|General\b|of\b)[\p{L}][\p{L}.'’-]*(?:\s+[\p{L}][\p{L}.'’-]*)?(?=\s*(?:[,;()\n]|$))/imu.test(to)) {
      add('to-named-person', 'Review the named To-line addressee',
        'Use the activity head, title or office code where possible. A named recipient may cause misrouting after personnel turnover.',
        headingSection, toField, { chapter: 7, paragraph: '7', query: 'To: Line' });
    }
  }
  if (standardAddress && config.ssic && config.uiMode !== 'joint') {
    const code = data.ssic?.trim() ?? '';
    if (/^WPC(?:[- ]+\d+)\s*$/i.test(data.serial?.trim() ?? '')) add('word-processing-center-id',
      'Confirm who assigned the document number',
      'If a word processing center assigned this number, keep it on the file copy and leave it out of the letter identification block.',
      headingSection, 'serial', { chapter: 7, paragraph: '3', query: 'Unauthorized Identification Symbols' });
    if (!unfilled(code) && (!/^\d{4,5}$/.test(code) || catalog && !catalog.has(code))) {
      add('ssic-catalog', 'Review the SSIC', /^\d{4,5}$/.test(code)
        ? 'This code is absent from the DonDocs catalog. Confirm the current code and that it fits the subject.'
        : 'Enter the four- or five-digit subject identification code. Confirm the correct code in the catalog.',
      headingSection, 'ssic', { chapter: 7, paragraph: '3', query: 'Standard Subject Identification Code' });
    }
    const requiredMark = CLASSIFIED_SERIAL_MARK.get(deriveOverallClassLevel(data.classLevel, source.paragraphs));
    const serialMark = /\/\s*(TS|S|C)?\s*\d+\s*$/i.exec(data.serial ?? '');
    if (requiredMark && serialMark && serialMark[1]?.toUpperCase() !== requiredMark) add('serial-mark',
      'Review the serial classification letter', `Check whether the serial uses ${requiredMark} between the slash and its number for the document’s overall marking.`,
      headingSection, 'serial', { chapter: 7, paragraph: '3', query: 'Classified Markings' }, 'markings');
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
      { id: 'first-endorsement', editorId: FIRST_ENDORSEMENT_EDITOR_ID, label: 'First endorsement', value: data },
      ...(data.additionalEndorsements ?? []).filter(hasEndorsementContent)
        .map(entry => ({ id: `additional:${entry.id}`, editorId: additionalEndorsementEditorId(entry.id), label: 'Additional endorsement', value: entry })),
    ];
    for (const entry of entries) {
      if (unfilled(entry.value.endorsementBody)) add(`endorsement-body:${entry.id}`,
        `${entry.label} needs text`, 'Complete the enabled endorsement text, or remove the endorsement if it is not needed.',
        'signature', `${entry.editorId}-body`, { chapter: 9, query: 'Endorsement' }, 'structure');
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
  if (deriveOverallClassLevel(data.classLevel, source.paragraphs) === 'cui') {
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
  if (staffPaper) return findings;
  // Only prose that will print can satisfy the reference or enclosure check.
  const citationFields = documentTextFields(source, 'output').filter(field =>
    field.path[0] === 'paragraphs' || field.path[0] === 'formData'
      && (field.path[1] === 'endorsementBody' || field.path[1] === 'additionalEndorsements' && field.path[3] === 'endorsementBody'));
  const prose = citationFields.filter(field => field.role === 'text' && field.text.trim());
  if (canReviewReferenceOrder(source) && source.references.length && prose.length) {
    const scans = prose.map(field => scanReferenceCitations(plainInlineText(maskProtectedRanges(field.text, citationProtectedRanges(field.text), '\uFFFC'))));
    if (scans.every(scan => !scan.issues.length)) {
      const mentioned = new Set(scans.flatMap(scan => scan.citations.map(citation => citation.letter)));
      source.references.forEach((reference, index) => {
        const label = reference.letter.toLowerCase();
        if (label && !unfilled(reference.title) && !mentioned.has(label)) add(`uncited-reference:${index}`,
          `Review uncited reference (${label})`, 'No explicit mention was found in the printed body. Cite the reference or review whether it belongs in the list.',
          'references', `reference-title-${index}`, { chapter: 7, paragraph: '10', query: 'Reference Line' }, 'references');
      });
    }
  }
  if (!(source.documentMode === 'custom' || config.compliance.allowEnclosures)) return findings;
  const start = enclosureStartNumber(source.docType, data.startingEnclosureNumber);
  const mentionedEnclosures = new Set<number>();
  const recordEnclosures = (first: number, last: number) => {
    for (let index = Math.max(0, first - start); index <= Math.min(last - start, source.enclosures.length - 1); index++) {
      mentionedEnclosures.add(index);
    }
  };
  let ambiguousEnclosure = false;
  source.enclosures.forEach((enclosure, index) => {
    if (unfilled(enclosure.title)) add(`enclosure-title:${index}`, `Enclosure (${start + index}) needs a title`,
      'Describe the enclosed document in the enclosure list.', 'enclosures', `enclosure-title-${index}`,
      { chapter: 7, paragraph: '11', query: 'Enclosures' }, 'references');
  });
  for (const field of citationFields) {
    const paragraph = field.path[0] === 'paragraphs' ? source.paragraphs[Number(field.path[1])] : undefined;
    const extra = field.path[1] === 'additionalEndorsements'
      ? data.additionalEndorsements?.[Number(field.path[2])] : undefined;
    const editorId = extra ? additionalEndorsementEditorId(extra.id) : FIRST_ENDORSEMENT_EDITOR_ID;
    const target = field.path[0] === 'paragraphs'
      ? { sectionId: 'body', ...(paragraph?.id ? { paragraphId: paragraph.id } : {}), paragraphPath: field.path.slice(2) }
      : { sectionId: 'signature', field: `${editorId}-body` };
    for (const issue of inspectEnclosureCitations(field.text, {
      first: start, count: source.enclosures.length, inherited: isEndorsement(source.docType),
    }, recordEnclosures)) {
      ambiguousEnclosure ||= issue.id.startsWith('manual:');
      findings.push({ id: `correspondence:enclosure-citation:${field.path.join(':')}:${issue.id}`,
        group: 'references', severity: 'warning', title: issue.title, message: issue.message, target,
        source: { chapter: 7, paragraph: '11', query: 'Enclosures' } });
    }
  }
  if (!ambiguousEnclosure && prose.length) source.enclosures.forEach((enclosure, index) => {
    const label = start + index;
    if (!unfilled(enclosure.title) && !mentionedEnclosures.has(index)) add(`uncited-enclosure:${index}`,
      `Review uncited enclosure (${label})`, 'No explicit mention was found in the printed body. Check whether the enclosure should be cited.',
      'enclosures', `enclosure-title-${index}`, { chapter: 7, paragraph: '11', query: 'Enclosures' }, 'references');
  });
  return findings;
}
