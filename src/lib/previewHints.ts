import { STARTER_PROFILE } from '@/data/starterCorrespondence';
import { format } from 'date-fns';
import { directiveFormatting, directiveHasCancellation, isDirective, isMarineDirective, isSecnavDirective } from './directiveFormats';
import { documentOutputConfig, jointMemoHeading } from './documentOutputConfig';
import { isStaffPaper } from './staffPapers';
import { resolveLetterheadMode } from './letterheadMode';
import { jointSignatories } from './signingAuthority';
import { splitAddressForLetterhead } from './unitAddress';
import type { CopyTo, Distribution, DocumentData, DocumentMode, Paragraph } from '@/types/document';

export const PREVIEW_HINT_URL = 'https://dondocs.invalid/preview-hint/';

export function previewHintKey(url: string | undefined): string | undefined {
  // Some LaTeX templates uppercase the link along with the printed text.
  const normalized = url?.toLowerCase();
  return normalized?.startsWith(PREVIEW_HINT_URL) ? normalized.slice(PREVIEW_HINT_URL.length) : undefined;
}

export const previewExamples = {
  subject: '[SUBJECT]',
  from: STARTER_PROFILE.from,
  to: '[RECIPIENT]',
  memoFor: 'Secretary of the Navy',
  unit: STARTER_PROFILE.unitLine1,
  signatory: 'J. A. DOE',
  firstName: 'John',
  middleName: 'A',
  lastName: 'DOE',
  rank: 'Lieutenant Colonel',
  seniorSignatory: 'J. A. SMITH',
  juniorSignatory: 'T. R. JONES',
  ssic: STARTER_PROFILE.ssic,
  senderCode: 'S-3',
  serial: '0123',
  officeCode: 'Originating office code',
  salutation: 'Dear Sir or Madam:',
  close: 'Sincerely,',
  body: '[Your content here. Click “Templates” to load a pre-built letter format.]',
} as const;

export const previewCopyTo = [
  ['copyToFirst', 'G-3/5'],
  ['copyToSecond', 'G-4'],
  ['copyToThird', 'Regimental S-3'],
] as const;

const starterExampleFields = {
  letterhead: ['unitLine1', 'unitLine2', 'unitAddress'],
  senderSymbols: ['ssic', 'serial'],
  addressing: ['from', 'to', 'via', 'subject', 'attnLine', 'throughLine', 'salutation', 'memorandumFor'],
  signature: ['sigFirst', 'sigMiddle', 'sigLast', 'sigRank', 'sigTitle', 'complimentaryClose', 'byDirectionAuthority', 'actingTitle'],
  basic: ['endorsementOrdinal', 'basicLetterId'],
  copyTo: [],
} as const satisfies Record<string, readonly (keyof DocumentData)[]>;

export type StarterExampleSection = keyof typeof starterExampleFields;
export const STARTER_EXAMPLE_SECTIONS = Object.keys(starterExampleFields) as StarterExampleSection[];

// Controls count when the author changes them. Their initial defaults must not
// suppress the sample in a blank draft, so keep them out of the text inventory.
const starterExampleControls = {
  letterhead: ['department', 'letterheadMode', 'letterheadStandard', 'stationerySize', 'sealType', 'letterheadColor'],
  senderSymbols: ['inReplyTo'],
  addressing: ['underlineSubject', 'showSubjectOnContinuation', 'includeEndorsementSubject'],
  signature: ['byDirection', 'acting', 'signatureType', 'signatureImageSigner'],
  basic: [],
  copyTo: [],
} as const satisfies Record<StarterExampleSection, readonly (keyof DocumentData)[]>;

interface StarterExampleDraft {
  docType: string;
  formData: Partial<DocumentData>;
  copyTos: readonly CopyTo[];
}

export function starterExampleText({ docType, formData, copyTos }: StarterExampleDraft, section: StarterExampleSection): string[] {
  if (section === 'copyTo') return copyTos.map(recipient => recipient.text).filter(Boolean);
  const fields: readonly (keyof DocumentData)[] = starterExampleFields[section];
  const values = fields.map(field => {
    const value = formData[field];
    return typeof value === 'string' ? value : '';
  });
  // Business formats have a date in Addressing and no Sender Symbols block.
  const config = documentOutputConfig(docType);
  if (section === (config.dateOnly || config.uiMode === 'executive' || config.uiMode === 'joint_memo' ? 'addressing' : 'senderSymbols')) {
    values.push(formData.date ?? '');
  }
  if (section === 'senderSymbols' && config.ssic && !isDirective(docType)) {
    values.push(formData.officeCode ?? '');
  }
  return values;
}

export function starterExampleValues(draft: StarterExampleDraft, section: StarterExampleSection): readonly unknown[] {
  const values: unknown[] = [...starterExampleText(draft, section), ...starterExampleControls[section].map(field => draft.formData[field])];
  // Retained sender codes do not fill the new format's Signature group.
  // An explicit edit to Office Code there still counts for that group.
  if (section === 'signature' && !documentOutputConfig(draft.docType).ssic && !isStaffPaper(draft.docType)) {
    values.push(draft.formData.officeCode ?? '');
  }
  return values;
}

export interface StarterExamplesControl {
  hiddenSections: readonly StarterExampleSection[];
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export interface PreviewHint {
  text: string;
  label: string;
  sectionId: string;
  fieldId: string;
  paragraphId?: string;
}

type HintKey = keyof DocumentData | 'body' | 'addressLocality' | 'jointMiddleSigner' | typeof previewCopyTo[number][0];
export type PreviewHints = Partial<Record<HintKey, PreviewHint>>;

export function isPreviewBodyParagraph(paragraph: Paragraph): boolean {
  return !paragraph.figure && !paragraph.bodyTable && !paragraph.tableKey && !paragraph.callout
    && !paragraph.appendix && !paragraph.procedure;
}

/** Describe only missing fields that have a corresponding editor and PDF slot. */
export function getPreviewHints({ docType, documentMode, formData, paragraphs, copyTos, distributions }: {
  docType: string;
  documentMode?: DocumentMode;
  formData: Partial<DocumentData>;
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions?: readonly Distribution[];
}, referenceDate = new Date(), hiddenSections?: readonly StarterExampleSection[]): PreviewHints {
  const config = documentOutputConfig(docType, documentMode);
  const dateExample = format(referenceDate, documentMode !== 'custom' && config.compliance.dateFormat === 'spelled' ? 'MMMM d, yyyy' : 'd MMM yy');
  const data = directiveFormatting(docType, documentMode, formData);
  const hints: PreviewHints = {};
  const showExamples = (section: StarterExampleSection) => !hiddenSections?.includes(section);
  const add = (key: keyof DocumentData, text: string, label: string, sectionId = 'addressing', fieldId: string = key, value = data[key]) => {
    if (typeof value !== 'string' || !value.trim()) hints[key] = { text, label, sectionId, fieldId };
  };
  const subject = (sectionId = 'addressing', fieldId = 'subject') => add('subject', previewExamples.subject, 'Subject', sectionId, fieldId);
  const signature = (sectionId = 'signature', idPrefix = '') => {
    if (showExamples('signature')) {
      add('sigFirst', previewExamples.firstName, 'Signer’s first name', sectionId, idPrefix + 'sigFirst');
      add('sigMiddle', previewExamples.middleName, 'Signer’s middle initial', sectionId, idPrefix + 'sigMiddle');
    }
    add('sigLast', previewExamples.lastName, 'Signer’s last name', sectionId, idPrefix + 'sigLast');
    if (showExamples('signature') && config.showSignatureRankTitle !== false) {
      if (docType !== 'i_type' && docType !== 'tm_ietm_front_matter' && !config.headquartersMemo) {
        add('sigRank', previewExamples.rank, 'Signer’s rank', sectionId, idPrefix + 'sigRank');
      }
    }
    if (docType === 'tm_ietm_front_matter' || (showExamples('signature') && config.showSignatureRankTitle !== false)) {
      add('sigTitle', STARTER_PROFILE.sigTitle, 'Signer’s title', sectionId, idPrefix + 'sigTitle');
    }
  };

  if (isStaffPaper(docType)) {
    if (docType !== 'coordination_page') {
      add('officeCode', previewExamples.officeCode, 'Office code', 'staff-paper', 'admin-officeCode');
      add('date', dateExample, 'Date', 'staff-paper', 'admin-date');
      add('preparedBy', 'Name of preparer', 'Prepared by', 'staff-paper', 'admin-preparedBy');
    }
    if (docType !== 'coordination_page' || data.coordinationLayout === 'hqmc') subject('staff-paper', 'admin-subject');
  } else if (config.publication) {
    if (docType === 'i_type') {
      subject('cover');
      add('shortTitle', 'MI 12345A-24/1', 'Short title', 'cover');
      add('pcn', '184 123456 00', 'Publication control number', 'cover');
      add('nomenclature', 'EQUIPMENT NOMENCLATURE', 'Nomenclature', 'cover');
      signature();
    } else if (docType === 'technical_volume') subject('volume-details', 'volume-title');
    else if (docType === 'sl3' || docType === 'sl4') {
      const section = docType + '-cover';
      add('subject', docType === 'sl4' ? 'REPAIR PARTS LIST FOR…' : 'COMPONENTS LIST FOR…', 'Subject', section, 'sl3-subject');
      add('shortTitle', docType.toUpperCase() + '-12345A', 'Short title', section, 'sl3-short-title');
      add('pcn', '123 123450 00', 'Publication control number', section, 'sl3-pcn');
    } else if (docType === 'tm_ietm_front_matter') {
      subject('manual-publication', 'manual-subject');
      add('shortTitle', 'TM 12345A', 'Short title', 'manual-publication', 'manual-shortTitle');
      add('pcn', '123 123450 00', 'Publication control number', 'manual-publication', 'manual-pcn');
      add('nomenclature', 'EQUIPMENT NOMENCLATURE', 'Nomenclature', 'manual-publication', 'manual-nomenclature');
      signature('manual-authentication', 'manual-');
    }
  } else if (config.uiMode === 'executive') {
    subject('executive', 'exec-subject');
    add('date', dateExample, 'Date', 'executive');
    add('memorandumFor', previewExamples.memoFor, 'Memorandum addressee', 'executive', 'exec-memo-for');
    if (!config.headquartersMemo) add('from', previewExamples.from, 'From', 'executive', 'exec-from');
    if (docType !== 'information_memorandum') signature();
  } else if (config.uiMode === 'joint' || config.uiMode === 'joint_memo' || config.uiMode === 'moa') {
    if (config.uiMode === 'joint_memo') {
      const heading = jointMemoHeading(data);
      add('subject', previewExamples.subject, 'Subject', 'joint_memo', undefined, heading.subject);
      add('to', previewExamples.to, 'To', 'joint_memo', undefined, heading.to);
      add('date', dateExample, 'Date', 'joint_memo');
      const signers = jointSignatories(data, true);
      add('jointMemoSeniorSigName', previewExamples.seniorSignatory, 'Senior signer', 'joint_memo', undefined, signers.seniorName);
      add('jointMemoJuniorSigName', previewExamples.juniorSignatory, 'Junior signer', 'joint_memo', undefined, signers.juniorName);
    } else if (config.uiMode === 'joint') {
      add('jointSubject', previewExamples.subject, 'Subject', 'joint');
      add('jointTo', previewExamples.to, 'To', 'joint');
      add('jointSeniorSigName', previewExamples.seniorSignatory, 'Senior signer', 'joint');
      add('jointJuniorSigName', previewExamples.juniorSignatory, 'Junior signer', 'joint');
      const middle = data.jointAdditionalCommands?.[0];
      if (middle && !middle.signatureName.trim()) {
        hints.jointMiddleSigner = { text: '[SIGNER NAME]', label: 'Middle signer', sectionId: 'joint', fieldId: 'joint-additional-signatureName' };
      }
    } else {
      add('moaSubject', previewExamples.subject, 'Subject', 'moa');
      add('seniorSigName', previewExamples.seniorSignatory, 'Senior signer', 'moa');
      add('juniorSigName', previewExamples.juniorSignatory, 'Junior signer', 'moa');
    }
  } else {
    if (config.letterhead && (documentMode === 'custom' || !isSecnavDirective(docType))) {
      const mode = resolveLetterheadMode(config, data);
      if (mode !== 'preprinted' && (!config.optionalLetterhead || showExamples('letterhead'))) add('unitLine1', previewExamples.unit, 'Unit name', 'letterhead');
      if (mode === 'full' && showExamples('letterhead')) {
        const address = splitAddressForLetterhead(STARTER_PROFILE.unitAddress);
        add('unitLine2', STARTER_PROFILE.unitLine2, 'Unit name line 2', 'letterhead');
        if (!data.unitAddress?.trim()) {
          add('unitAddress', address.line1, 'Street address', 'letterhead', 'addressStreet');
          hints.addressLocality = { text: address.line2, label: 'City, state and ZIP', sectionId: 'letterhead', fieldId: 'addressCity' };
        }
      }
    }
    if (config.fromTo && docType !== 'mfr') add('from', previewExamples.from, 'From');
    const usesDistributionInsteadOfTo = docType === 'multiple_address_letter' && distributions?.some(row => row.text.trim());
    if ((!isDirective(docType) && config.fromTo && !usesDistributionInsteadOfTo) || config.recipientAddress || docType === 'mf') {
      add('to', previewExamples.to, config.recipientAddress ? 'Recipient address' : 'To');
    }
    if ((!config.skipSubject || data.includeEndorsementSubject) && (config.uiMode !== 'business' || showExamples('addressing'))) subject();
    add('date', dateExample, 'Date');
    if (docType === 'new_page_endorsement' || (docType === 'same_page_endorsement' && (data.includeEndorsementSubject || showExamples('basic')))) {
      const legacy = /^(.+?)\s+ENDORSEMENT(?:\s+on\s+(.+))?$/i.exec(data.subject ?? '');
      add('basicLetterId', 'Basic letter identifier', 'Basic letter identifier', 'basic', undefined, data.basicLetterId?.trim() || legacy?.[2]);
    }
    // The MFR template prints its date but has no identification-symbol lines.
    if (config.ssic && !isDirective(docType) && docType !== 'mfr') {
      if (!config.optionalSSIC || showExamples('senderSymbols')) add('ssic', previewExamples.ssic, 'SSIC');
      if (showExamples('senderSymbols') && !/^ser\b/i.test(data.serial?.trim() ?? '')) {
        add('officeCode', previewExamples.senderCode, 'Office code', 'signature');
        add('serial', previewExamples.serial, 'Serial');
      }
    }
    if (isDirective(docType)) {
      add('directiveNumber', docType === 'change_transmittal' ? 'Directive being amended'
        : isMarineDirective(docType) ? 'Enter the directive number' : 'Enter the SECNAV identifier',
      'Directive identifier', 'directive', 'admin-directiveNumber');
      if (docType === 'change_transmittal' && !hints.directiveNumber) {
        add('directiveChangeNumber', 'Enter the change number', 'Change number', 'directive', 'admin-directiveChangeNumber');
      }
      if (directiveHasCancellation(docType)) add('directiveCancellation', 'Enter the cancellation date', 'Cancellation line', 'directive', 'admin-directiveCancellation');
      add('officeCode', previewExamples.officeCode, 'Office code', 'directive', 'admin-officeCode');
    }
    if (config.uiMode === 'business') {
      const compliant = documentMode !== 'custom';
      if ((compliant && config.compliance.requiresSalutation) || showExamples('addressing')) add('salutation', previewExamples.salutation, 'Salutation');
      if ((compliant && config.compliance.requiresComplimentaryClose) || showExamples('signature')) add('complimentaryClose', previewExamples.close, 'Complimentary close', 'signature');
    }
    signature();
  }

  if (showExamples('copyTo') && !copyTos.some(recipient => recipient.text.trim())
      && !config.publication && !isStaffPaper(docType) && !isDirective(docType) && docType !== 'mfr') {
    for (const [index, [key, text]] of previewCopyTo.entries()) {
      hints[key] = {
        text, label: `Copy-to recipient ${index + 1}`, sectionId: 'copyto',
        fieldId: copyTos[index] ? `copyto-recipient-${index + 1}` : 'copyto-add',
      };
    }
  }

  if ((!config.publication || docType === 'i_type') && docType !== 'coordination_page'
      && !paragraphs.some(paragraph => paragraph.text.trim()
        || paragraph.bodyTable?.rows.some(row => row.some(cell => cell.trim()))
        || (paragraph.figure?.fileRef && (config.publication || docType === 'business_letter' || paragraph.figure.placement === 'body')))) {
    const paragraphId = paragraphs.find(isPreviewBodyParagraph)?.id;
    hints.body = { text: previewExamples.body, label: 'First paragraph', sectionId: 'body', fieldId: 'add-body-paragraph', paragraphId };
  }
  return hints;
}
