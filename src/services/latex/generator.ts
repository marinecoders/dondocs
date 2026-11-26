import { directiveAuthorityRows, directiveContinuation, directiveFormatting, isDirective, isMarineDirective } from '@/lib/directiveFormats';
import { directiveLayout } from './directiveLayout';
import { isStaffPaper } from '@/lib/staffPapers';
import { staffPaperLayout } from './staffPaperLayout';
import { usesDlaLetterhead } from '@/lib/dlaLetterhead';
import { correspondenceStationery, assertStationerySupport } from '@/lib/stationery';
import { additionalJointCommands, assertJointLetterCommandSupport } from '@/lib/jointLetterCommands';
import { getPreviewHints, isPreviewBodyParagraph, PREVIEW_HINT_URL, previewCopyTo, type PreviewHints, type StarterExampleSection } from '@/lib/previewHints';
import { unfilled } from '@/lib/requiredField';
import { resolveLetterheadMode } from '@/lib/letterheadMode';
import { bodyTableText, bodyTableLiteral } from './bodyTableText';
import { toTitleCase } from '@/lib/titleCase';
import { closingTailStart, hasBottomSignature, printableCorrespondenceParagraphs } from '@/lib/correspondenceClosing';
import { abbreviatedFullSignatoryName } from '@/lib/signatoryName';
import { resolveParagraphLayout, paragraphHasLabel } from './paragraphLayout';
import { documentOutputConfig, jointMemoHeading } from '@/lib/documentOutputConfig';
import { jointSignatories, signatureAuthorityLine, signaturePosition, supportsActingSignature } from '@/lib/signingAuthority';
import { resolvePageNumbering } from '@/lib/pageNumbering';
import { generateSl4Body } from './sl4Generator';
import { generateVolumeBody } from './volumeGenerator';
import { BREAKABLE_TEXT_COMMANDS } from './bodyTableText';
import { stockDefinitionText } from './stockPublicationHelpers';
import { generateManualFrontMatterData, manualPlainText } from './manualFrontMatterGenerator';
import { emptyManualFrontMatter } from '@/data/techpub/manualFrontMatter';
import { sl4Portions } from '@/data/techpub/sl4';
import { sl3Portions } from '@/data/techpub/sl3';
import { generateSl3Body } from './sl3Generator';
import { isTechnicalPublication } from '@/lib/publicationPreflight';
import { publicationReferences, FOOTNOTE_REFERENCE_TOKEN, type PublicationReference } from '@/lib/publicationReferences';
import { iTypeDestructionNotice } from '@/lib/iTypeClassification';
import { publicationReferenceText } from './publicationReferenceText';
import { publicationNavigation, navigationTex } from './publicationNavigation';
import { escapeLatex, escapeLatexUrl, keepTypedSpaces, latexLineBreaks, processBodyText, formatSubjectForLatex, formatAddressForLatex } from './escaper';
import { composeSenderSymbol } from './senderSymbol';
import { businessLetterClosing, businessLetterIdentification } from './businessLetter';
import { tableSpec } from '@/data/techpub/tables';
import { renderBodyTable } from './bodyTable';
import { assertRichBlockShape } from '@/lib/bodyTable';
import { publicationTypeName } from '@/data/techpub/publicationTypes';
import { composeDistributionStatement } from '@/data/techpub/distributionStatements';
import { documentDistributionStatement } from './distributionStatement';
import { formatPublicationDate } from '@/lib/publicationDate';
import { withTimeCompliance } from '@/lib/timeCompliance';
import { businessFigureFile, figureFile, volumeFigureFile } from '@/lib/figures';
import type { DocumentData, Reference, Enclosure, Paragraph, CopyTo, Distribution, EndItem, PublicationTableRow, CalloutKind, FileRef } from '@/types/document';
import { base64ToUint8Array } from '@/lib/encoding';
import { composeBasicLetterId, enclosureStartNumber, pageStartNumber } from '@/lib/endorsement';
import { calculateLabels } from './paragraphLabels';
import { agreementParagraphs } from './agreementLayout';
import { ancestorLabelsPerParagraph, type LabelFont } from './subparagraphIndent';
import { safeUrl } from '@/lib/url-safety';
import { ImageInputError, supportsCorrespondenceSignatureImage } from '@/services/docx/imageAssets';
import { splitAddressForLetterhead } from '@/lib/unitAddress';
import { hasBodyCaption } from '@/lib/bodyCaption';
import { formatViaLines } from '@/lib/viaLines';
import { parse as parseDate, isValid as isValidDate, format as formatDate } from 'date-fns';
import { deriveOverallClassLevel } from '@/lib/overallClassification';
import { cuiTransmittalNote } from '@/lib/enclosureMarkings';
import { windowEnvelopeLayout, windowEnvelopeRows } from '@/lib/windowEnvelope';
import { windowEnvelopeTex } from './windowEnvelope';
import { assertAppendedEndorsementsAddressed, resolveAppendedEndorsements } from '@/lib/appendedEndorsement';

interface DocumentStore {
  docType: string;
  documentMode?: import('@/types/document').DocumentMode;
  formData: Partial<DocumentData>;
  references: Reference[];
  /** Technical publication cover rows; absent for correspondence. */
  endItems?: EndItem[];
  /** Rows of the publication's fixed tables, keyed by table. */
  publicationTables?: Record<string, PublicationTableRow[]>;
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions: Distribution[];
}

/** Optional source instrumentation; absent for normal preview and exports. */
export interface LatexBodyAdapter {
  inline(index: number, part: 'label' | 'heading' | 'body', latex: string): string;
  tableCell?(index: number, row: number, column: number, header: boolean, latex: string): string;
  tableCaption?(index: number, latex: string): string;
  tableScope?(index: number): { begin: string; end: string };
  figure?(index: number, part: 'image' | 'caption' | 'mark', latex: string): string;
}

/**
 * Validate a Point-of-Contact email before it gets embedded in the
 * `\setPOC{}` macro (which the LaTeX template wraps in
 * `\href{mailto:\POCEmail}{...}`).
 *
 * The scheme is forced to `mailto:` by the template so there's no
 * scheme-injection risk, but a malformed email (no `@`, weird
 * whitespace, paste with control chars, etc.) still produces a broken
 * hyperlink in the rendered PDF. Routing through `safeUrl()` reuses
 * the same chokepoint that validates reference URLs, so any future
 * tightening of email validation lives in one place.
 *
 * Returns the cleaned bare email (no `mailto:` prefix — the template
 * adds that), or empty string when invalid. Empty string preserves
 * the prior behavior for unset/missing pocEmail; the LaTeX template
 * already handles `\setPOC{}` with empty content gracefully.
 */
/** The End Item table prints exactly this many rows. Unused ones stay blank
 *  rather than being deleted; a further item overflows to the next page. */
const END_ITEM_ROWS = 6;

/** Width reserved for a step label, so carry-over lines block under the text
 *  rather than under the label. Wide enough for the deepest form, "(a)". */
const PROCEDURE_LABEL_WIDTH = '0.35in';

/** A part number or NSN is a single token with no space or hyphen for TeX to
 *  break at, and TeX will not hyphenate a word containing digits -- so one
 *  longer than its column prints through the next column and off the sheet.
 *  These characters are the ones `escapeLatex` passes through untouched, so a
 *  breakpoint inserted between them cannot split an escape sequence. */
const UNBREAKABLE_RUN = /[A-Za-z0-9()./,]{12,}/g;
const breakLongTokens = (escaped: string) =>
  escaped.replace(UNBREAKABLE_RUN, (run) => run.split('').join('\\discretionary{}{}{}'));

function validatedPocEmail(raw: string | undefined | null): string {
  if (!raw) return '';
  // The user might paste `mailto:foo@bar.com` — strip the prefix so
  // safeUrl validates the bare email path.
  const stripped = raw.trim().replace(/^mailto:/i, '');
  if (!stripped) return '';
  const safe = safeUrl(stripped);
  if (safe && safe.startsWith('mailto:')) {
    return safe.slice('mailto:'.length);
  }
  return '';
}

/** Loaded in the preamble, before geometry finalizes the PDF media box. */
export function generateStationeryTex(store: Pick<DocumentStore, 'docType' | 'formData'>): string {
  assertStationerySupport(store.docType, store.formData);
  const stock = correspondenceStationery(store.docType, store.formData);
  return stock.small ? `\\def\\SmallStationery{1}
\\def\\StationeryDateAlignment{${stock.size === '7x9' ? 'center' : 'right'}}
\\geometry{paperwidth=${stock.width}in,paperheight=${stock.height}in,top=1in,bottom=1in,left=1in,right=1in}
` : '\\def\\SmallStationery{0}\n';
}

function previewHint(hints: PreviewHints | undefined, key: keyof PreviewHints, fallback: string, format = (value: string) => value): string {
  const hint = hints?.[key];
  if (!hint) return fallback;
  const url = PREVIEW_HINT_URL + key.toLowerCase();
  return latexLineBreaks(format(hint.text).split('\n').map(line => `\\PreviewHintLink{${url}}{${escapeLatex(line)}}`).join('\n'));
}

export function generateDocumentTex(store: DocumentStore, referenceDate = new Date(), hints?: PreviewHints): string {
  const data = directiveFormatting(store.docType, store.documentMode, store.formData);
  assertStationerySupport(store.docType, data, store.paragraphs, store.documentMode);
  const metadataText = store.docType === 'technical_volume' ? (value: string | undefined) => bodyTableLiteral(value ?? '') : escapeLatex;
  // config will be used for document-type specific variations
  const config = documentOutputConfig(store.docType, store.documentMode);
  const isMOAMode = config.uiMode === 'moa';
  const isJointMode = config.uiMode === 'joint' || config.uiMode === 'joint_memo';
  const isExecutiveMode = config.uiMode === 'executive';

  let tex = `%=============================================================================
% DOCUMENT CONFIGURATION - Generated by dondocs
%=============================================================================

\\setDocumentType{${store.docType}}
${hasBottomSignature(store.docType) ? '\\enableClosingKeep' : ''}
\\setFontSize{${data.fontSize || '12pt'}}
\\setFontFamily{${data.fontFamily || 'times'}}
${config.fromTo && !isTechnicalPublication(store.docType) ? '\\enableAddressFitCheck' : '% No opening address table'}
% Correspondence prints the spaces its author typed; TeX adds none after a sentence.
${isTechnicalPublication(store.docType) ? '\\nonfrenchspacing' : '\\frenchspacing'}
\\setPageNumberStyle{${resolvePageNumbering(store.docType, store.documentMode, data.pageNumbering)}}
${(() => {
  // Gated to endorsement types like the reference/enclosure continuations —
  // a leftover value must never offset another doc type's own sequence.
  const start = pageStartNumber(store.docType, data.startingPageNumber);
  return start > 1 ? `\\setStartingPageNumber{${start}}` : '% Page sequence starts at 1';
})()}

`;

  // For MOA/MOU: document-level SSIC/Serial/Date = Senior command values
  // For Joint Letter/Memo: document-level SSIC/Serial/Date used for Senior side
  //   in the template's \printDateAndTitle (joint_letter.tex uses \DocumentSSIC etc,
  //   joint_memorandum.tex uses \DocumentDate)
  const ssic = isMOAMode ? data.seniorSSIC : data.ssic;
  const serial = isMOAMode ? data.seniorSerial : data.serial;
  const docDate = isMOAMode ? data.seniorDate : data.date;
  // A publication prints its date in full ("30 April 2025"); a letter as stored.
  const printedDate = isTechnicalPublication(store.docType) ? formatPublicationDate(docDate || '', referenceDate) : docDate;
  const publicationDate = ['sl3', 'sl4', 'tm_ietm_front_matter'].includes(store.docType) ? printedDate?.toUpperCase() : printedDate;

  // For business letters and executive correspondence, set BusinessDate,
  // BusinessRecipientAddress, etc. Both use the same template address/salutation pattern.
  const isBusinessLetter = config.uiMode === 'business';

  // Joint letter and joint memo share the same joint* fields
  const memoHeading = config.uiMode === 'joint_memo' ? jointMemoHeading(data) : undefined;
  const fromLine = store.docType === 'mfr' ? '' : isJointMode ? data.jointSeniorFrom : data.from;
  const toLine = isDirective(store.docType) ? (isMarineDirective(store.docType) ? 'Distribution List' : '') : store.docType === 'mfr' ? '' : config.uiMode === 'joint' ? data.jointTo : memoHeading ? memoHeading.to : data.to;
  // Subject line casing per SECNAV M-5216.5:
  //   Executive types (Ch 12 ¶2l): Title Case (NOT ALL CAPS)
  //   This applies to all executive uiMode types AND executive_correspondence
  //   All other types: ALL CAPS
  // Also wrap at 57 characters per SECNAV formatting requirements
  const rawSubject = config.uiMode === 'joint' ? data.jointSubject : memoHeading ? memoHeading.subject : isMOAMode ? data.moaSubject : data.subject;
  const usesTitleCaseSubject = isExecutiveMode || store.docType === 'executive_correspondence';
  const formattedSubject = store.docType === 'technical_volume' ? bodyTableLiteral(rawSubject?.toUpperCase() ?? '') : usesTitleCaseSubject
    ? formatSubjectForLatex(toTitleCase(rawSubject || ''))
    : formatSubjectForLatex(rawSubject?.toUpperCase());
  // Wrap in \uline{} when the user has opted to underline the subject.
  // \uline is provided by the `ulem` package (already loaded in the template)
  // and handles multi-line subjects correctly via \newline breaks.
  const subjectKey = config.uiMode === 'joint' ? 'jointSubject' : isMOAMode ? 'moaSubject' : 'subject';
  const subjectLine = previewHint(hints, subjectKey, data.underlineSubject
    ? `\\uline{${formattedSubject}}` : formattedSubject);

  // `\enableInReplyReferTo` is a boolean toggle defined in main.tex —
  // flips `\ifInReplyEnabled` which the templates use to render the
  // static "IN REPLY REFER TO" header line. We deliberately do NOT
  // emit `\setInReplyReferTo{...}` here: that macro is not defined in
  // any template, the data.inReplyToText field has no rendering site,
  // and SwiftLaTeX silently swallowed the unknown control sequence
  // while xelatex (the integration matrix's engine) rejected it. See
  // tests/regressions/pr-066-setInReplyReferTo-undefined-macro.test.ts.
  // The originator's code lives on this line too, fused with the serial when
  // there is one (SECNAV M-5216.5 Ch 7 para 2a(2)). It used to be collected and
  // never printed.
  const directive = directiveLayout(store.docType, data, value => escapeLatex(value));
  const business = store.docType === 'business_letter' ? businessLetterIdentification(data) : undefined;
  const repeatSubject = data.showSubjectOnContinuation && (!business || store.documentMode === 'custom');
  const continuationHeading = directive ? directive.reference : repeatSubject && !hints?.[subjectKey] ? subjectLine : '';
  let senderSymbol = escapeLatex(business?.sender ?? composeSenderSymbol(data.officeCode, serial));
  if (directive) {
    senderSymbol = previewHint(hints, 'officeCode', escapeLatex(data.officeCode));
  } else if (hints?.officeCode || hints?.serial) {
    const code = previewHint(hints, 'officeCode', escapeLatex(data.officeCode?.trim()));
    const number = previewHint(hints, 'serial', escapeLatex(serial?.trim()));
    const prefix = hints.serial ? '\\PreviewHint{Ser}' : 'Ser';
    senderSymbol = `${prefix} ${code}\\PreviewHint{/}${number}`;
  }

  const windowEnvelope = windowEnvelopeLayout(store.docType, data);
  if (windowEnvelope) {
    // Measure the displayed values for the fixed slots. Only the preview
    // uses this copy of the data, and field links are inserted after escaping.
    const slotData = hints ? {
      ...data,
      ssic: hints.ssic?.text ?? data.ssic,
      officeCode: hints.officeCode?.text ?? data.officeCode,
      serial: hints.serial?.text ?? data.serial,
      date: hints.date?.text ?? data.date,
      to: hints.to?.text ?? data.to,
      salutation: hints.salutation?.text ?? data.salutation,
      subject: hints.subject?.text ?? data.subject,
    } : data;
    const rows = windowEnvelopeRows(windowEnvelope, slotData);
    tex += windowEnvelopeTex(rows, ({ text, field }) => {
      if (field === 'senderSymbol') return senderSymbol;
      if (field === 'subject' && hints?.subject) {
        const label = windowEnvelope === 'standard' ? 'Subj:' : 'SUBJECT:';
        return label + '  ' + previewHint(hints, field, '');
      }
      return previewHint(hints, field, escapeLatex(text));
    }, data.underlineSubject && windowEnvelope !== 'salutation');
  }
  if (directive) {
    tex += '\\def\\CorrespondenceTemplate{naval_letter}\n';
    tex += '\\def\\DirectiveDesignation{' + (hints?.directiveChangeNumber ? directive.designation + ' ' + previewHint(hints, 'directiveChangeNumber', '') : previewHint(hints, 'directiveNumber', directive.designation)) + '}\n';
    const authority = directiveAuthorityRows(data).map(([label, value]) => label + ' ' + escapeLatex(value));
    tex += '\\def\\DirectiveAuthority{' + authority.join('\\newline ') + '}\n';
    tex += '\\def\\DirectiveCancellation{' + previewHint(hints, 'directiveCancellation', directive.cancellation) + '}\n';
    tex += '\\def\\DirectiveReports{' + directive.reports + '}\n';
    if (!isMarineDirective(store.docType)) tex += '\\def\\DirectiveFromOnly{}\n';
    const continuation = directiveContinuation(store.docType, data);
    if (continuation?.alternate) tex += '\\def\\DirectiveAlternate{}\n';
  }
  if (isStaffPaper(store.docType)) {
    const staff = staffPaperLayout(store.docType, data, value => escapeLatex(value), false, hints && {
      subject: previewHint(hints, 'subject', ''),
      date: previewHint(hints, 'date', ''),
      officeCode: previewHint(hints, 'officeCode', ''),
      preparedBy: previewHint(hints, 'preparedBy', ''),
    });
    tex += '\\long\\def\\CorrespondenceTemplate{staff_paper}\n';
    tex += '\\long\\def\\StaffPaperHeading{' + staff.heading + '}\n';
    tex += '\\long\\def\\StaffPaperClosing{' + staff.closing + '}\n';
  }
  tex += `\\setSSIC{${directive ? directive.reference : config.ssic ? previewHint(hints, 'ssic', escapeLatex(business?.ssic ?? ssic)) : ''}}
\\setSerial{${config.ssic ? senderSymbol : ''}}
\\setDocumentDate{${previewHint(hints, 'date', metadataText(publicationDate))}}
${isBusinessLetter ? `\\setBusinessDate{${previewHint(hints, 'date', escapeLatex(business?.date ?? docDate))}}` : '% Not a business letter'}

${data.inReplyTo ? '\\enableInReplyReferTo' : '% No In Reply Refer To'}
${data.includeEndorsementSubject ? '\\enableEndorsementSubject' : '% Endorsement subject omitted (Ch 9)'}

\\setFrom
    {${previewHint(hints, 'from', formatAddressForLatex(fromLine))}}
    {}{}{}

${isBusinessLetter ? `% Business letter: format recipient address as block with line breaks
% Split by newlines (handle both \\n and \\r\\n), escape each line, join with \\\\
\\setBusinessRecipientAddress{${
  previewHint(hints, 'to', latexLineBreaks((toLine || '')
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => escapeLatex(line.trim()))
    .join('\n')))
}}` : `\\setTo
    {${previewHint(hints, config.uiMode === 'joint' ? 'jointTo' : 'to', formatAddressForLatex(toLine))}}
    {}{}{}{}`}

${data.via?.trim() ? (() => {
  const rows = formatViaLines(data.via).map((line, i) =>
    `\\tabularnewline ${i === 0 ? 'Via:\\hspace{5\\fontdimen2\\font}' : ''} & ${formatAddressForLatex(line)}`);
  return `\\setViaRows{${rows.join('\n')}}`;
})() : '% No Via'}

\\setSubject{${subjectLine}}
${['standard_memorandum', 'executive_memorandum'].includes(store.docType) ? `\\setReferenceLabel{${store.references.length > 1 ? 'Reference(s)' : 'Reference'}:\\hspace{1em}}` : ''}
${continuationHeading ? `\\setContinuationSubject{${continuationHeading}}` : '% Continuation heading disabled'}

\\setBusinessSalutation{${previewHint(hints, 'salutation', escapeLatex(data.salutation?.trim()))}}
\\setBusinessClose{${previewHint(hints, 'complimentaryClose', escapeLatex(data.complimentaryClose?.trim()))}}

\\setPOC{${metadataText(validatedPocEmail(data.pocEmail))}}
`;

  if (business) {
    const closing = businessLetterClosing(data, store.enclosures.length);
    tex += `\\def\\BusinessEnclosureLabel{${closing.label}}
\\def\\BusinessSeparateMailing{${escapeLatex(closing.separateMailing)}}
${closing.countOnly ? '\\def\\BusinessEnclosureCountOnly{}' : ''}
`;
  }

  // Memorandum For: addressee is embedded in the title ("MEMORANDUM FOR [addressee]")
  // The 'to' field holds the addressee text (e.g., "All Department Heads")
  if (store.docType === 'mf' && (data.to || hints?.to)) {
    tex += `\\setMemorandumForAddressee{${previewHint(hints, 'to', escapeLatex(data.to))}}\n`;
  }

  // Executive memo fields (standard_memorandum, action_memorandum, information_memorandum)
  // Each template defines its own commands — set the ones it expects
  if (isExecutiveMode) {
    // Standard memo + Action memo: \setMemorandumForAddressee
    if (config.headquartersMemo || store.docType === 'action_memorandum') {
      tex += `\\setMemorandumForAddressee{${previewHint(hints, 'memorandumFor', config.headquartersMemo ? formatAddressForLatex(data.memorandumFor) : escapeLatex(data.memorandumFor))}}\n`;
      if (config.headquartersMemo) {
        tex += `\\setMemoAddressLead{${escapeLatex(Array.from(data.memorandumFor?.trim() ?? '').slice(0, 2).join(''))}}\n`;
        tex += `\\setMemoAttention{${formatAddressForLatex(data.attnLine)}}\n`;
        tex += `\\setMemoThrough{${formatAddressForLatex(data.throughLine?.toUpperCase())}}\n`;
      }
    }

    // Action memo: \setActionFrom (FROM line in address block)
    if (store.docType === 'action_memorandum') {
      tex += `\\setActionFrom{${previewHint(hints, 'from', escapeLatex(data.from))}}\n`;
    }

    // Information memo: \setInfoMemoFor, \setInfoMemoFrom, \setInfoMemoCoordination, \setInfoMemoPreparedBy
    if (store.docType === 'information_memorandum') {
      tex += `\\setInfoMemoFor{${previewHint(hints, 'memorandumFor', escapeLatex(data.memorandumFor))}}\n`;
      tex += `\\setInfoMemoFrom{${previewHint(hints, 'from', escapeLatex(data.from))}}\n`;
      if (data.coordination) {
        tex += `\\setInfoMemoCoordination{${escapeLatex(data.coordination)}}\n`;
      }
      if (data.preparedBy) {
        tex += `\\setInfoMemoPreparedBy{${escapeLatex(data.preparedBy)}}\n`;
      }
    }

    // Action memo coordination/preparedBy — these aren't in the current .tex template
    // but could be added later; for now the body handles them via ParagraphsEditor
  }

  // Endorsements: set EndorsementOrdinal and BasicLetterID per SECNAV
  // M-5216.5 Ch 9 §2.1.b -- the rendered endorsement line is:
  //   "[ORDINAL] ENDORSEMENT on [basic letter id]"
  //
  // Prefer the structured fields populated by the AddressingSection UI
  // (`endorsementOrdinal` dropdown + `basicLetterId` input). Fall back
  // to regex-parsing the subject for sessions saved before those fields
  // existed -- legacy subjects looked like:
  //   "FIRST ENDORSEMENT on LCpl Garcia's Special Liberty Request..."
  if (store.docType === 'same_page_endorsement' || store.docType === 'new_page_endorsement') {
    let ordinal = data.endorsementOrdinal?.trim() || '';
    let basicLetterId = data.basicLetterId?.trim() || '';

    if (!ordinal || !basicLetterId) {
      // Backwards-compat: parse "ORDINAL ENDORSEMENT on BASIC_LETTER_ID"
      // out of the subject for legacy saved sessions. Only fills the
      // pieces that aren't already provided by the structured fields.
      const subjectText = data.subject || '';
      const match = subjectText.match(/^(.+?)\s+ENDORSEMENT(?:\s+on\s+(.+))?$/i);
      if (match) {
        if (!ordinal) ordinal = match[1].trim();
        if (!basicLetterId) basicLetterId = match[2]?.trim() || '';
      }
    }

    if (ordinal) {
      tex += `\\renewcommand{\\EndorsementOrdinal}{${escapeLatex(ordinal)}}\n`;
    }
    if (basicLetterId || hints?.basicLetterId) {
      tex += `\\renewcommand{\\BasicLetterID}{${previewHint(hints, 'basicLetterId', escapeLatex(basicLetterId))}}\n`;
    }
    // Always set serial and date for same-page endorsement, regardless
    // of whether ordinal was found via structured field or subject parse.
    if (store.docType === 'same_page_endorsement') {
      tex += `\\renewcommand{\\EndorsementSerial}{${escapeLatex(data.serial || '')}}\n`;
      tex += `\\renewcommand{\\EndorsementDate}{${previewHint(hints, 'date', escapeLatex(data.date || ''))}}\n`;
    }
  }

  // Technical publication cover. The End Item table always prints six rows --
  // the standard keeps unused ones blank rather than deleting them -- and a
  // seventh item moves the whole list to the back of the cover page.
  if (isTechnicalPublication(store.docType)) {
    const items = store.endItems ?? [];
    const endItemText = store.docType === 'tm_ietm_front_matter' ? stockDefinitionText : escapeLatex;
    const overflow = items.length > END_ITEM_ROWS;
    const shown = overflow ? [] : items.slice(0, END_ITEM_ROWS);
    // SL-3 reserves six borderless source rows; the existing I-Type keeps its rules.
    const rows = Array.from({ length: END_ITEM_ROWS }, (_, i) => {
      const item = shown[i];
      return item
        ? [item.nsn, item.tamcn, item.id, item.model].map((v) => endItemText(v || '')).join(' & ')
        : ' & & & ';
    }).join(['sl3', 'sl4', 'tm_ietm_front_matter'].includes(store.docType) ? ' \\\\ ' : ' \\\\ \\hline ');
    if (store.docType === 'sl4') tex += `\\def\\slFourTamcns{${[...new Set(items.map((item) => item.tamcn).filter(Boolean))].map(escapeLatex).join(', ')}}\n`;
    tex += `\\setNomenclature{${previewHint(hints, 'nomenclature', escapeLatex(data.nomenclature || ''))}}\n`;
    tex += `\\setEndItemRows{${rows}}\n`;
    tex += overflow ? '\\EndItemOverflowtrue\n' : '\\EndItemOverflowfalse\n';
    // The cover header carries the anticipated month and year of signature
    // ("JULY 2026"), not the day-level correspondence date the rest of the
    // document uses. Derived from the same date so the two cannot disagree.
    const signed = parseDate(data.date || '', 'd MMM yy', referenceDate);
    const coverDate = isValidDate(signed) ? formatDate(signed, 'MMMM yyyy').toUpperCase() : '';
    tex += `\\setCoverDate{${escapeLatex(['sl3', 'sl4', 'tm_ietm_front_matter'].includes(store.docType) ? formatPublicationDate(data.date || '', referenceDate).toUpperCase() : coverDate)}}\n`;
    tex += `\\setShortTitle{${previewHint(hints, 'shortTitle', metadataText(data.shortTitle || ''))}}\n`;
    tex += `\\setPCN{${previewHint(hints, 'pcn', escapeLatex(data.pcn || ''))}}\n`;
    tex += `\\setSupersedure{${escapeLatex(data.supersedure || '')}}\n`;
    tex += `\\setTimeCompliance{${escapeLatex((['sl3', 'sl4', 'tm_ietm_front_matter'].includes(store.docType) ? '' : ((data.publicationType ?? 'MI') === 'MI' ? data.miUrgency || 'normal' : 'normal')).toUpperCase())}}\n`;
    // The type names itself on the cover and the authentication page; only a
    // modification asks the unit to record its completion.
    tex += `\\setPublicationTypeName{${escapeLatex(store.docType === 'sl4' ? 'Components Stock List SL-4' : store.docType === 'sl3' ? 'Components Stock List SL-3' : publicationTypeName(data.publicationType))}}\n`;
    tex += store.docType === 'i_type' && (data.publicationType ?? 'MI') === 'MI' ? '\\RecordingInstructiontrue\n' : '\\RecordingInstructionfalse\n';
    // Appendices and enclosures are listed under DISTRIBUTION on the
    // authentication page, lettered as \startAppendix letters them.
    const attachments = [
      ...store.paragraphs.filter((p) => p.appendix).map((p, i) =>
        `Appendix ${String.fromCharCode(65 + i)}: ${escapeLatex(p.header?.trim() || '')}`),
      ...store.enclosures.map((e, i) => `Enclosure (${i + 1}): ${escapeLatex(e.title || '')}`),
    ];
    tex += `\\setAttachmentList{${attachments.join('\\par\\noindent ')}}\n`;
    tex += `\\setControllingOffice{${metadataText(data.controllingOffice || '')}}\n`;
    tex += data.exportRestricted ? '\\ExportRestrictedtrue\n' : '\\ExportRestrictedfalse\n';
    const destruction = iTypeDestructionNotice(data, store.paragraphs);
    const noticeText = (value: string, label: string) => ['sl3', 'sl4', 'tm_ietm_front_matter'].includes(store.docType) && value.startsWith(label)
      ? `\\textbf{\\uline{${escapeLatex(label)}}}${escapeLatex(value.slice(label.length))}`
      : escapeLatex(value);
    tex += `\\def\\ITypeDestructionNotice{${noticeText(destruction, 'DESTRUCTION NOTICE:')}}\n`;
    // The distribution statement prints in full on the cover: letter, text,
    // the reason and date of determination, and the office requests go to.
    const determined = parseDate(data.distDate || '', 'yyyy-MM-dd', referenceDate);
    const dist = composeDistributionStatement(data.cuiDistStatement || '', {
      reason: data.distReason,
      date: isValidDate(determined) ? formatDate(determined, 'd MMMM yyyy') : '',
      office: data.controllingOffice,
    });
    tex += `\\setDistStatementFull{${noticeText(dist, 'DISTRIBUTION STATEMENT')}}\n`;
    // When the cover defers, every end item is listed on its back -- there is
    // no six-row cap there, and no blank rows to keep.
    {
      const all = items
        .map((item) =>
          [item.nsn, item.tamcn, item.id, item.model].map((v) => endItemText(v || '')).join(' & ')
        )
        .join(' \\\\ ');
      tex += `\\setEndItemOverflowRows{${all}}\n`;
    }
  }

  if (store.docType === 'tm_ietm_front_matter') tex += generateManualFrontMatterData(data, referenceDate, hints && {
    subject: previewHint(hints, 'subject', ''),
    nomenclature: previewHint(hints, 'nomenclature', ''),
    pcn: previewHint(hints, 'pcn', ''),
  });
  return tex;
}

export function generateLetterheadTex(store: DocumentStore, hints?: PreviewHints): string {
  const data = directiveFormatting(store.docType, store.documentMode, store.formData);

  // Split `unitAddress` into letterhead lines 3 and 4 via the shared
  // helper (single source of truth — flat-generator.ts uses the same).
  const { line1: addressLine1, line2: addressLine2 } = splitAddressForLetterhead(
    data.unitAddress || ''
  );

  // Check if unit line 2 has content
  const hasLine2 = !!data.unitLine2?.trim() || !!hints?.unitLine2;

  // When line 2 is empty, shift content up to eliminate the gap
  // Line 2 empty: UnitName, Address1, Address2, (empty)
  // Line 2 has content: UnitName, UnitLine2, Address1, Address2
  const dla = usesDlaLetterhead(store.docType, data);
  const line = (value?: string) => escapeLatex(dla ? value?.toUpperCase() : value);
  const line1 = previewHint(hints, 'unitLine1', line(data.unitLine1));
  const street = previewHint(hints, 'unitAddress', line(addressLine1));
  const locality = previewHint(hints, 'addressLocality', line(addressLine2));
  const line2 = hasLine2 ? previewHint(hints, 'unitLine2', line(data.unitLine2)) : street;
  const line3 = hasLine2 ? street : locality;
  const line4 = hasLine2 ? locality : '';

  return `%=============================================================================
% LETTERHEAD CONFIGURATION - Generated by dondocs
% Per SECNAV M-5216.5: Unit name, address
%=============================================================================

% Seal type: dow (Department of War) or dod (Department of Defense)
\\setSealType{${dla ? 'dod' : data.sealType || 'dow'}}

% Department/Service: usmc, navy, or dod
\\setDepartment{${data.department || 'usmc'}}
${dla ? '\\enableDlaLetterhead' : ''}

% Letterhead color: blue (default) or black
\\setLetterheadColor{${data.letterheadColor || 'blue'}}
${resolveLetterheadMode(documentOutputConfig(store.docType, store.documentMode), data) === 'full' ? '' : `\\setLetterheadMode{${resolveLetterheadMode(documentOutputConfig(store.docType, store.documentMode), data)}}`}

\\setLetterhead
    {${line1}}
    {${line2}}
    {${line3}}
    {${line4}}
`;
}

// Capitalize first letter of each word
function capitalizeWord(word: string | undefined): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function generateSignatoryTex(store: DocumentStore, hints?: PreviewHints): string {
  const data = store.formData;
  const signatureText = (value?: string) => store.docType === 'tm_ietm_front_matter' ? manualPlainText(value ?? '') : escapeLatex(value);
  const config = documentOutputConfig(store.docType, store.documentMode);

  // Check if this is a dual-signature document (MOA/MOU)
  if (config.uiMode === 'moa') {
    return generateMOASignatoryTex(store, hints);
  }

  // Check if this is a joint letter or joint memorandum (dual letterheads and signatures)
  if (config.uiMode === 'joint' || config.uiMode === 'joint_memo') {
    return generateJointLetterSignatoryTex(store, hints);
  }

  // Properly capitalize names: First Middle LAST
  const firstName = capitalizeWord(data.sigFirst);
  const middleName = capitalizeWord(data.sigMiddle);
  const lastName = data.sigLast?.toUpperCase() || '';
  const initial = (name: string) => name ? `${name[0].toUpperCase()}.` : '';
  const fullName = signatureText([firstName, middleName, lastName].filter(Boolean).join(' '));
  const abbrevName = signatureText([initial(firstName), initial(middleName), lastName].filter(Boolean).join(' '));
  const renderedLastName = previewHint(hints, 'sigLast', signatureText(lastName));
  const renderedName = (fallback: string, format: (value: string) => string) => hints?.sigFirst || hints?.sigMiddle || hints?.sigLast
    ? [previewHint(hints, 'sigFirst', signatureText(format(firstName)), format),
      previewHint(hints, 'sigMiddle', signatureText(format(middleName)), format), renderedLastName].filter(Boolean).join(' ')
    : fallback;

  // The cached template names this general authority slot ByDirection. Keep
  // that interface while rendering Acting as its own mutually exclusive line.
  const authorityLine = signatureAuthorityLine(data, supportsActingSignature(store.docType));
  const byDirectionTex = `\\setByDirection{${escapeLatex(authorityLine)}}`;
  const actingTitle = data.acting && supportsActingSignature(store.docType) && config.showSignatureRankTitle === false
    ? signaturePosition(data, config) : '';
  const actingTitleTex = `\\setActingTitle{${escapeLatex(actingTitle)}}`;

  // The appointee's acknowledgement, if this letter carries one. Body is
  // pre-numbered here because \setAppendedEndorsement takes it as one argument;
  // main.tex's \printAppendedEndorsement renders nothing when From is empty.
  const appendedEndorsementTex = resolveAppendedEndorsements(store.docType, data).map((ack) => {
    const body = ack.paragraphs.map((text, i) => {
      // Keep the last two paragraphs linked. Widow control in the template
      // also keeps two lines when a long final paragraph crosses a page.
      const keepNext = i === ack.paragraphs.length - 2 ? '\\nopagebreak[4]' : '';
      const gap = i < ack.paragraphs.length - 1 ? `${keepNext}\\vspace{12pt}` : '';
      return `\\noindent ${i + 1}.~~${keepTypedSpaces(escapeLatex(text))}\\par${gap}`;
    }).join('');
    return `\\addAppendedEndorsement
    {${escapeLatex(ack.ordinal)}}
    {${escapeLatex(ack.from)}}
    {${escapeLatex(ack.to)}}
    {${body}}
    {${escapeLatex(ack.signer)}}
    {${escapeLatex(ack.serial)}}
    {${escapeLatex(ack.date)}}`;
  }).join('\n');

  // Set signature type and image
  // signatureType: 'none' = just typed name, 'image' = uploaded signature, 'digital' = empty field for CAC signing
  const signatureType = data.signatureType || 'none';
  let signatureConfigTex: string;

  if (signatureType === 'image' && data.signatureImage?.data) {
    // Use uploaded signature image
    signatureConfigTex = '\\setSignatureImage{signature.png}';
  } else if (signatureType === 'digital') {
    // Create empty digital signature field
    signatureConfigTex = '\\setDigitalSignatureField';
  } else {
    // No signature image or field
    signatureConfigTex = '\\setSignatureImage{}';
  }

  return `%=============================================================================
% SIGNATURE CONFIGURATION - Generated by dondocs
%=============================================================================

\\setSignatory
    {${escapeLatex(firstName)}}
    {${escapeLatex(middleName)}}
    {${previewHint(hints, 'sigLast', escapeLatex(lastName))}}
    {${previewHint(hints, 'sigRank', escapeLatex(data.sigRank))}}
    {${previewHint(hints, 'sigTitle', signatureText(data.sigTitle))}}

\\setSignatoryName{${renderedName(fullName, value => value)}}
\\setSignatoryAbbrev{${renderedName(abbrevName, initial)}}

${byDirectionTex}
${actingTitleTex}

${appendedEndorsementTex ? `\\setAppendedEndorsementBasicLetter{${escapeLatex(composeBasicLetterId(store))}}` : ''}
${appendedEndorsementTex}

${signatureConfigTex}
`;
}

// Generate MOA/MOU specific signatory configuration (dual signatures)
// Uses ONLY commands that exist in the original cached template
function generateMOASignatoryTex(store: DocumentStore, hints?: PreviewHints): string {
  const data = store.formData;
  const signatureType = data.signatureType || 'none';

  // Digital signature field for dual signatures
  let signatureConfigTex = '';
  if (signatureType === 'digital') {
    signatureConfigTex = '\\setDigitalSignatureField';
  }

  const seniorFullName = data.seniorSigName || '';
  const seniorParts = seniorFullName.split(' ').filter(Boolean);
  const seniorFirstName = capitalizeWord(seniorParts[0]);
  const seniorLastName = (seniorParts[seniorParts.length - 1] || '').toUpperCase();
  const seniorAbbrev = abbreviatedFullSignatoryName(seniorFullName);
  const juniorAbbrev = abbreviatedFullSignatoryName(data.juniorSigName);

  // Use EXISTING commands only - Senior uses document-level fields + standard signatory
  // Junior uses Junior-prefixed fields (which already exist)
  return `%=============================================================================
% MOA/MOU DUAL SIGNATURE CONFIGURATION - Generated by dondocs
%=============================================================================

% Senior Command (Signs Last - Right Side)
% Uses SeniorCommandName (exists) + document-level SSIC/Serial/Date + standard signatory
\\renewcommand{\\SeniorCommandName}{${escapeLatex(data.seniorCommandName)}}

% Senior signatory uses standard signatory fields
\\setSignatory
    {${escapeLatex(seniorFirstName)}}
    {}
    {${escapeLatex(seniorLastName)}}
    {${escapeLatex(data.seniorSigRank)}}
    {${escapeLatex(data.seniorSigTitle)}}
\\setSignatoryName{${previewHint(hints, 'seniorSigName', escapeLatex(seniorFullName))}}
\\setSignatoryAbbrev{${previewHint(hints, 'seniorSigName', escapeLatex(seniorAbbrev))}}
\\setByDirection{${data.seniorActing ? 'Acting' : ''}}

% Junior Command (Signs First - Left Side) - uses Junior-prefixed fields
\\renewcommand{\\JuniorCommandName}{${escapeLatex(data.juniorCommandName)}}
\\renewcommand{\\JuniorSSIC}{${escapeLatex(data.juniorSSIC)}}
\\renewcommand{\\JuniorSerial}{${escapeLatex(composeSenderSymbol(undefined, data.juniorSerial))}}
\\renewcommand{\\JuniorDate}{${escapeLatex(data.juniorDate)}}
\\renewcommand{\\JuniorSignatoryName}{${previewHint(hints, 'juniorSigName', escapeLatex(juniorAbbrev))}}
\\renewcommand{\\JuniorSignatoryRank}{${escapeLatex(data.juniorSigRank)}}
\\renewcommand{\\JuniorSignatoryTitle}{${escapeLatex(data.juniorSigTitle)}}
\\renewcommand{\\JuniorByDirection}{${data.juniorActing ? 'Acting' : ''}}

${signatureConfigTex}
`;
}

// Generate Joint Letter / Joint Memorandum specific configuration
// Resolve the fields exposed by each joint editor, preserving legacy sessions.
function generateJointLetterSignatoryTex(store: DocumentStore, hints?: PreviewHints): string {
  const data = store.formData;
  assertJointLetterCommandSupport(store.docType, data);
  const memo = store.docType === 'joint_memorandum';
  const seniorSignerKey = memo ? 'jointMemoSeniorSigName' : 'jointSeniorSigName';
  const juniorSignerKey = memo ? 'jointMemoJuniorSigName' : 'jointJuniorSigName';
  const middle = store.docType === 'joint_letter' ? additionalJointCommands(data)[0] : undefined;
  const middleFields = middle ? {
    MiddleCommandName: middle.name.toUpperCase(), MiddleCommandZip: middle.location, MiddleCommandCode: middle.code,
    MiddleSSIC: middle.ssic, MiddleSerial: composeSenderSymbol(undefined, middle.serial), MiddleDate: middle.date,
    MiddleFromLine: middle.from,
    MiddleSignatoryTitle: middle.signatureTitle, MiddleByDirection: middle.acting ? 'Acting' : '',
  } : undefined;
  const signers = jointSignatories(data, store.docType === 'joint_memorandum');
  const middleConfig = middleFields ? [
    BREAKABLE_TEXT_COMMANDS,
    '\\providecommand{\\JointCommandCount}{3}',
    ...Object.entries({ ...middleFields,
      ThreeJuniorTitle: signers.juniorTitle, ThreeSeniorTitle: signers.seniorTitle,
    }).map(([key, value]) => `\\providecommand{\\${key}}{${bodyTableLiteral(value)}}`),
    `\\providecommand{\\ThreeJuniorSignature}{${previewHint(hints, juniorSignerKey, bodyTableLiteral(signers.juniorName.toUpperCase()))}}`,
    `\\providecommand{\\MiddleSignatoryName}{${previewHint(hints, 'jointMiddleSigner', bodyTableLiteral(middle?.signatureName.toUpperCase() ?? ''))}}`,
    `\\providecommand{\\ThreeSeniorSignature}{${previewHint(hints, seniorSignerKey, bodyTableLiteral(signers.seniorName.toUpperCase()))}}`,
    ...Object.entries({
      JuniorCommandCode: data.jointJuniorCode || '', JuniorSSIC: data.jointJuniorSSIC || '',
      JuniorSerial: composeSenderSymbol(undefined, data.jointJuniorSerial), JuniorDate: data.jointJuniorDate || '',
      SeniorCommandCode: data.jointSeniorCode || '', DocumentSSIC: data.ssic || '',
      DocumentSerial: composeSenderSymbol(data.officeCode, data.serial), DocumentDate: data.date || '',
    }).map(([key, value]) => `\\renewcommand{\\${key}}{${bodyTableLiteral(value)}}`),
  ].join('\n') : '';
  const signatureType = data.signatureType || 'none';

  // Digital signature field for dual signatures
  let signatureConfigTex = '';
  if (signatureType === 'digital') {
    signatureConfigTex = '\\setDigitalSignatureField';
  }

  // Parse senior signatory name (format: "J. A. SMITH" -> "J. A." first, "SMITH" last)
  const seniorFullName = signers.seniorName;
  const seniorParts = seniorFullName.split(' ');
  const seniorLastName = seniorParts[seniorParts.length - 1]?.toUpperCase() || '';
  const seniorFirstInitials = seniorParts.slice(0, -1).join(' ');
  const seniorAbbrev = seniorFullName.toUpperCase();

  // Junior signatory name (used as full uppercase name)
  const juniorFullName = signers.juniorName;

  return `%=============================================================================
% JOINT DUAL CONFIGURATION - Generated by dondocs
% Per SECNAV M-5216.5 Ch 7, Para 7-1.2; Figure 7-4
%=============================================================================

% Senior Command (Right Side - Signs Last)
\\renewcommand{\\SeniorCommandName}{${escapeLatex(data.jointSeniorName)}}
\\renewcommand{\\SeniorCommandZip}{${escapeLatex(data.jointSeniorZip)}}
\\renewcommand{\\SeniorCommandCode}{${escapeLatex(data.jointSeniorCode)}}
\\renewcommand{\\SeniorFromLine}{${escapeLatex(data.jointSeniorFrom)}}

% Senior signatory uses standard signatory fields
\\setSignatory
    {${escapeLatex(seniorFirstInitials)}}
    {}
    {${escapeLatex(seniorLastName)}}
    {}
    {${escapeLatex(signers.seniorTitle)}}
\\setSignatoryName{${previewHint(hints, seniorSignerKey, escapeLatex(seniorFullName))}}
\\setSignatoryAbbrev{${previewHint(hints, seniorSignerKey, escapeLatex(seniorAbbrev))}}
\\setByDirection{${data.seniorActing ? 'Acting' : ''}}

% Junior Command (Left Side - Signs First)
\\renewcommand{\\JuniorCommandName}{${escapeLatex(data.jointJuniorName)}}
\\renewcommand{\\JuniorCommandZip}{${escapeLatex(data.jointJuniorZip)}}
\\renewcommand{\\JuniorCommandCode}{${escapeLatex(data.jointJuniorCode)}}
\\renewcommand{\\JuniorSSIC}{${escapeLatex(data.jointJuniorSSIC)}}
\\renewcommand{\\JuniorSerial}{${escapeLatex(composeSenderSymbol(undefined, data.jointJuniorSerial))}}
\\renewcommand{\\JuniorDate}{${escapeLatex(data.jointJuniorDate)}}
\\renewcommand{\\JuniorFromLine}{${escapeLatex(data.jointJuniorFrom)}}
\\renewcommand{\\JuniorSignatoryName}{${previewHint(hints, juniorSignerKey, escapeLatex(juniorFullName.toUpperCase()))}}
\\renewcommand{\\JuniorSignatoryTitle}{${escapeLatex(signers.juniorTitle)}}
\\renewcommand{\\JuniorByDirection}{${data.juniorActing ? 'Acting' : ''}}

% Common location (appears in letterhead)
\\renewcommand{\\CommonLocation}{${escapeLatex(data.jointCommonLocation)}}

${middleConfig}
${signatureConfigTex}
`;
}

export function generateFlagsTex(store: DocumentStore): string {
  let flags = '% Flags - Generated by dondocs\n';
  // An I-Type names its affected publications in a paragraph, not a Ref: list.
  if (store.references.length > 0 && !isTechnicalPublication(store.docType)) {
    flags += '\\setHasReferences\n';
  }
  if (store.enclosures.length > 0) {
    flags += '\\setHasEnclosures\n';
  }
  if (store.formData.includeHyperlinks) {
    flags += '\\setHyperlinksEnabled\n';
  }
  return flags;
}

export function generateReferencesTex(store: DocumentStore): string {
  if (store.references.length === 0) {
    return '% No references\n';
  }

  return `%=============================================================================
% REFERENCES - Generated by dondocs
% Count: ${store.references.length} references
%=============================================================================

${store.references.map((r, i) => {
    if (store.references.length === 1 && ['standard_memorandum', 'executive_memorandum'].includes(store.docType)) {
      const uriHex = Array.from(new TextEncoder().encode(safeUrl(r.url) || ''), byte => byte.toString(16).padStart(2, '0')).join('');
      return `\\singlerefitem{${escapeLatex(r.title)}}{${uriHex}}`;
    }
    const cmd = i === store.references.length - 1 ? '\\lastrefitem' : '\\refitem';
    return `${cmd}{${escapeLatex(r.letter)}}{${escapeLatex(r.title)}}`;
  }).join('\n')}
`;
}

export function generateReferenceUrlsTex(store: DocumentStore): string {
  // Run each user-provided URL through safeUrl() to reject dangerous
  // schemes (javascript:, data:, file:, etc.) before the URL is
  // embedded in a `\href{}` annotation by the LaTeX templates. See
  // @/lib/url-safety for the threat model. Issue #17.
  //
  // Refs whose URL is unsafe or unparseable get no `\setRefURL{}`
  // line — the reference itself still renders in the bibliography
  // section, just without a clickable hyperlink.
  const safeRefs = store.references
    .map((r) => ({ letter: r.letter, url: safeUrl(r.url) }))
    .filter((r): r is { letter: string; url: string } => r.url !== null);

  if (safeRefs.length === 0) return '% No reference URLs\n';

  return `%=============================================================================
% REFERENCE URLS - Generated by dondocs
%=============================================================================

${safeRefs.map((r) => `\\setRefURL{${escapeLatex(r.letter)}}{${escapeLatexUrl(r.url)}}`).join('\n')}
`;
}

export function generateEnclosuresTex(store: DocumentStore): string {
  if (store.enclosures.length === 0) {
    return '% No enclosures\n';
  }

  return `%=============================================================================
% ENCLOSURES - Generated by dondocs
% Count: ${store.enclosures.length} enclosures
%=============================================================================

${store.enclosures
    .map((e, i) => {
      // Always use JSPDF marker - JavaScript handles ALL enclosure pages
      // This ensures correct ordering (text-only and PDF enclosures in sequence)
      // The start number lets an endorsement continue the basic letter's
      // enclosure numbering (Ch 9 ¶4); it is 1 for everything else.
      const n = enclosureStartNumber(store.docType, store.formData.startingEnclosureNumber) + i;
      return `\\enclosure{${n}}{JSPDF}{${escapeLatex(e.title || 'Untitled')}}`;
    })
    .join('\n')}
`;
}

export function generateCopyToTex(store: DocumentStore, hints?: PreviewHints): string {
  // A format switch retains letter recipients in state for switching back.
  // I-Type publications carry their own authentication/distribution pages.
  const showExamples = previewCopyTo.some(([key]) => hints?.[key]);
  const recipients = showExamples
    ? previewCopyTo.map(([key]) => previewHint(hints, key, ''))
    : store.copyTos.filter(recipient => !hints || recipient.text.trim()).map(recipient => escapeLatex(recipient.text));
  if (store.docType === 'i_type' || recipients.length === 0) {
    return '% No copy-to recipients\n';
  }

  // Label on its own line, every addressee flush beneath it. SECNAV M-5216.5
  // Ch 7 15c: listed "in a single column at the left margin and single spaced
  // below the 'Copy to:' line", which is how the manual renders it in all five
  // of its own Ch 7 examples. A tabular put the first addressee beside the
  // label and all of them 47pt in from the margin.
  const label = showExamples ? '\\PreviewHint{Copy to:}' : 'Copy to:';
  const rows = [label, ...recipients].map(row => `    \\noindent ${row}\\par`);

  return `%=============================================================================
% COPY TO - Generated by dondocs
% Count: ${recipients.length} recipients
%=============================================================================

\\setHasCopyTo
\\newcommand{\\CopyToRows}{%
${rows.join('\n')}
}
`;
}

export function generateDistributionTex(store: DocumentStore, preview = false): string {
  const recipients = preview ? store.distributions?.filter(row => row.text.trim()) : store.distributions;
  if (store.docType === 'i_type' || !recipients?.length) {
    return '% No distribution recipients\n';
  }

  // Same shape as the copy-to block: 15c ends "Use this format for the
  // 'Distribution:' lines as well."
  const rows = ['    \\noindent Distribution:\\par']
    .concat(recipients.map((d) => `    \\noindent ${escapeLatex(d.text)}\\par`));

  return `%=============================================================================
% DISTRIBUTION - Generated by dondocs
% Count: ${recipients.length} recipients
%=============================================================================

\\setHasDistribution
\\newcommand{\\DistributionRows}{%
${rows.join('\n')}
}
`;
}



/** Underline entire header text using ulem's \uline for proper positioning. */
function underlineWords(text: string): string {
  return `\\uline{${text}}`;
}

/**
 * One of the publication's fixed tables, drawn from its column set.
 *
 * "Consisting of" rows sit under their parent: the standard indents the first
 * line and hangs the rest, at 0.1in for the first level and 0.28in for the
 * second. An empty table prints nothing -- a table that does not apply is
 * removed, unlike the End Item table on the cover which keeps its six rows.
 */
function tableTitleTex(title: string): string {
  const match = /^(Table \S+)\s+(.+)$/.exec(title);
  return match ? `${escapeLatex(match[1])}\\hspace{2\\fontdimen2\\font}${escapeLatex(match[2])}` : escapeLatex(title);
}

function generatePublicationTable(tableKey: string, rows: PublicationTableRow[], heading: string, measure = false, references: PublicationReference[] = [], identifierMode?: 'stock' | 'software'): string {
  const fullSpec = tableSpec(tableKey, identifierMode);
  if (!fullSpec || rows.length === 0) return '';
  // "If Item Numbers are not needed in tables, remove column." Derived from the
  // rows rather than asked: a table where no row carries an item number prints
  // without the column.
  const itemUsed = rows.some((r) => (r.values.item ?? '').trim() !== '');
  const spec = itemUsed ? fullSpec : { ...fullSpec, columns: fullSpec.columns.filter((c) => c.key !== 'item') };

  // First-line and hanging indents the template gives a parent item and its
  // first- and second-level "consisting of" items. Cells set ragged: a
  // justified line in a narrow cell stretches its word spaces.
  const INDENT = [
    { first: '0in', hang: '0.1in' },
    { first: '0.1in', hang: '0.18in' },
    { first: '0.28in', hang: '0.18in' },
  ];
  // TeX subtracts the actual padding and rules. The final column receives
  // the remainder so rounding cannot move the table beyond the text block.
  const proportion = spec.columns.reduce((sum, c) => sum + parseFloat(c.width), 0);
  const widths = spec.columns.slice(0, -1).map((c) => `${(parseFloat(c.width) / proportion).toFixed(6)}\\dondocsTableWidth`);
  const colSpec = [...widths, `\\dimexpr\\dondocsTableWidth-${widths.join('-')}\\relax`].map((width) => `p{${width}}`).join('|');
  const setWidth = `\\dondocsSetTableWidth{${spec.columns.length}}`;
  const head = spec.columns.map((c) => c.key === 'softwareVersion'
    ? '\\raggedright\\textbf{Current\\newline Software/\\allowbreak Firmware\\newline (S/F) Version}'
    : `\\textbf{${escapeLatex(c.label)}}`).join(' & ');
  const descriptionIndex = spec.columns.findIndex((c) => c.key === 'description');
  const cellText = (text: string, level: number) => {
    const { first, hang } = INDENT[Math.min(level, INDENT.length - 1)];
    return `\\raggedright\\hangindent=${hang}\\hangafter=1 \\hspace*{${first}}${text}`;
  };

  // Keep parent/component boundaries together. Body rows have no horizontal
  // rules, so a continuation ends open and only the final foot closes it.
  const lines: string[] = [];
  const groups: string[][] = [];
  let groupStart = 0;
  let firstGroupLines = 0;
  rows.forEach((row, r) => {
    const level = row.level ?? 0;
    lines.push(spec.columns
      .map((c, i) => {
        const renderCell = (value: string) => publicationReferenceText(value, references, false, (text) => text.split(/(ZZZPUBLICATIONLINK\d+ZZZ)/).map((part) => /^ZZZPUBLICATIONLINK\d+ZZZ$/.test(part) ? part : breakLongTokens(escapeLatex(part))).join(''));
        const raw = row.values[c.key] ?? '';
        const cell = renderCell(raw);
        // Only the description carries the nesting; indenting every column
        // would break the grid.
        if (i === descriptionIndex) {
          const details = [row.identificationException, row.openPurchase?.manufacturer, row.openPurchase?.address].filter(Boolean).map((value) => renderCell(value!));
          return cellText([cell, ...details].join('\\par '), level);
        }
        // "74024019 (1CSL0)": an item with no NSN gives its CAGE centred in
        // parentheses under the PN.
        const cage = c.key === 'pn' ? /^(.*\S)\s+\((\w+)\)$/.exec(raw.replace(FOOTNOTE_REFERENCE_TOKEN, '').trim()) : null;
        return cage ? `\\raggedright ${breakLongTokens(escapeLatex(cage[1]))}\\par\\centering(${escapeLatex(cage[2])})${renderCell((raw.match(FOOTNOTE_REFERENCE_TOKEN) ?? []).join(''))}` : `\\raggedright ${cell}`;
      })
      .join(' & ') + ((rows[r + 1]?.level ?? 0) > level ? ' \\tabularnewline*' : ' \\tabularnewline'));
    // A parent item is followed by a "Consisting of:" row at its items'
    // indent, as the template lays the parts list out.
    const next = rows[r + 1];
    if (next && (next.level ?? 0) > level) {
      const cells = Array.from({ length: spec.columns.length }, () => '\\raggedright ');
      cells[descriptionIndex] = cellText('Consisting of:', next.level ?? 0);
      lines.push(cells.join(' & ') + ' \\tabularnewline*');
    } else {
      if (!firstGroupLines) firstGroupLines = lines.length;
      groups.push(lines.slice(groupStart));
      groupStart = lines.length;
    }
  });
  // \raggedright in a cell turns \\ into a line break; rows end with the
  // form no cell setting can capture.
  const body = lines.join('\n    ');
  const continuedTitle = `\\multicolumn{${spec.columns.length}}{@{}p{\\textwidth}@{}}{\\centering\\textbf{${tableTitleTex(heading)} -- Continued}\\par} \\tabularnewline`;
  if (measure) {
    const checks = groups.map((group, index) => `
\\setbox\\dondocsTableGroup=\\vbox{\\hsize=\\textwidth
{\\renewcommand{\\arraystretch}{1.3}\\begin{tabular}{|${colSpec}|}
${continuedTitle}
${head} \\tabularnewline \\hline
${group.join('\n')}
\\end{tabular}}}
\\ifdim\\dimexpr\\ht\\dondocsTableGroup+\\dp\\dondocsTableGroup+2\\baselineskip\\relax>\\textheight
  \\PackageError{I-Type}{${escapeLatex(fullSpec.name)} row group ${index + 1} exceeds one page; shorten or divide its content}{Each row and its attached component heading must fit below the repeated table heading.}
\\fi
`).join('');
    return `${setWidth}${checks}\\setbox\\dondocsTableStart=\\vbox{\\hsize=\\textwidth
{\\renewcommand{\\arraystretch}{1.3}\\begin{tabular}{|${colSpec}|}
\\hline ${head} \\tabularnewline \\hline
${lines.slice(0, firstGroupLines).join('\n')}
\\end{tabular}}}
\\dondocsNeedspace{\\ht\\dondocsTableStart+\\dp\\dondocsTableStart+6\\baselineskip+18bp}
`;
  }


  // A parts list can run to pages, so the table may break between rows. On a
  // continuation the title and "Continued" and the boxhead are repeated, the
  // closing rule is omitted at the foot of a continued table and the opening
  // rule at the head of its continuation (MIL-STD-38784C 4.7.9.2, 4.7.9.3).
  const continued = `${continuedTitle}\n    ${head} \\tabularnewline\n    \\hline\n    \\endhead`;
  return `\\vspace{18bp}
{\\renewcommand{\\arraystretch}{1.3}\\setlength{\\LTpre}{0pt}\\setlength{\\LTpost}{12pt}
${setWidth}
\\begin{longtable}[l]{|${colSpec}|}
    \\hline
    ${head} \\tabularnewline
    \\hline
    \\endfirsthead
    ${continued}
    \\endfoot
    \\hline
    \\endlastfoot
    ${body}
\\end{longtable}}

`;
}

/**
 * A safety callout: WARNING, CAUTION or NOTE.
 *
 * MIL-STD-38784C sets the shape. Both margins inset a quarter inch, the header
 * uppercase and bold, the body not bold. A WARNING is always entirely
 * uppercase; a CAUTION and a NOTE read in sentence case. Warnings and cautions
 * appear above the step they apply to and must never sit at the foot of a page
 * away from it.
 *
 * "Any single line warning, caution, or note is centred." Whether the text
 * takes one line is a typesetting fact we do not have here, so it is estimated
 * from the character count against the callout's width -- comfortably inside a
 * line at 12pt, and left-justified otherwise, which is the safe direction to be
 * wrong in.
 */
function generateCallout(kind: CalloutKind, text: string, keepWithNext = false, formatBody?: (text: string, uppercase: boolean) => string): string {
  const SINGLE_LINE_CHARS = 70;
  const body = formatBody ? formatBody(text, kind === 'warning') : kind === 'warning' ? `\\MakeUppercase{${processBodyText(text)}}` : processBodyText(text);
  const centred = text.trim().length <= SINGLE_LINE_CHARS;
  // The box is one line of its own paragraph, so every glue between it and
  // what follows sits behind a penalty; a `center` environment adds glue of
  // its own after the box, and a break there stranded the callout at the
  // foot of a page. A warning or caution precedes what it applies to and
  // may not end a page; a note may follow its subject, so it is free.
  const keep = kind === 'note' && !keepWithNext ? '' : '\\nopagebreak[4]';
  return `\\par\\vspace{12pt}
\\noindent\\makebox[\\textwidth]{\\begin{minipage}{\\dimexpr\\textwidth-0.5in\\relax}
\\centering\\textbf{${kind.toUpperCase()}}\\par\\vspace{6pt}
${centred ? '\\centering' : '\\raggedright'}
${body}\\par
\\end{minipage}}
\\par${keep}\\vspace{6pt}${keep}

`;
}

export function generateBodyTex(store: DocumentStore, adapter?: LatexBodyAdapter, hints?: PreviewHints): string {
  if (store.docType === 'technical_volume') return generateVolumeBody(store, { allowEmptyContent: hints !== undefined });
  if (store.docType === 'tm_ietm_front_matter') return '';
  if (store.docType === 'sl4') return generateSl4Body(store);
  if (store.docType === 'sl3') return generateSl3Body(store);
  if (store.docType === 'i_type' && (store.formData.publicationType ?? 'MI') === 'MI') {
    store = { ...store, paragraphs: withTimeCompliance(store.paragraphs, store.formData.miUrgency ?? 'normal', store.formData.miCompletionDate) };
  }
  const config = documentOutputConfig(store.docType, store.documentMode);
  if (config.uiMode === 'moa') {
    store = { ...store, paragraphs: agreementParagraphs(store.paragraphs) };
  }
  if (!isTechnicalPublication(store.docType)) {
    store = { ...store, paragraphs: printableCorrespondenceParagraphs(store.paragraphs) };
  }
  let hintIndex = -1;
  if (hints?.body) {
    hintIndex = store.paragraphs.findIndex(paragraph => isPreviewBodyParagraph(paragraph) && unfilled(paragraph.text));
    if (hintIndex < 0) {
      hintIndex = 0;
      store = { ...store, paragraphs: [{ level: 0, text: '' }, ...store.paragraphs] };
    }
  }
  const crossReferences = publicationReferences(store.paragraphs, store.publicationTables);
  const bodyText = store.docType === 'i_type' ? (text: string) => publicationReferenceText(text, crossReferences) : processBodyText;
  const navigation = store.docType === 'i_type' ? publicationNavigation(store.paragraphs, store.publicationTables, toTitleCase) : new Map();
  const labels = calculateLabels(store.paragraphs, store.docType === 'i_type');
  // Where each subparagraph's label must sit: under its parent's text, per
  // Figure 7-8. flat-generator.ts computes the identical number for Word.
  const ancestors = ancestorLabelsPerParagraph(labels, store.paragraphs.map((p) => p.level));
  const bodyFont: LabelFont = (store.formData.fontFamily || 'times') === 'courier' ? 'courier' : 'times';
  const bodySizePt = parseFloat(store.formData.fontSize || '12pt') || 12;

  // Business letters (Ch 11 ¶6, "Do not number main paragraphs") and executive
  // correspondence (Ch 12 ¶3.2c(2), "Do not number the paragraphs") don't
  // number theirs. Endorsements do -- see the Ch 9 note in
  // DOC_TYPE_CONFIG.
  const useNumberedParagraphs = config.compliance.numberedParagraphs;
  // Business letters and executive correspondence use 0.5" first-line indent instead of numbers
  const isBusinessLetter = config.uiMode === 'business' && !useNumberedParagraphs;

  // Build the body via array-push-then-join. The previous `latex += ...`
  // pattern inside the paragraph loop is O(n²) under naive implementations
  // (each += allocates a new string equal to the accumulated length).
  // Modern engines optimize this with rope strings, but the array form
  // is unambiguously linear and matches the pattern we use elsewhere.
  const parts: string[] = [
    `%=============================================================================
% DOCUMENT BODY - Generated by dondocs
% SECNAV M-5216.5 Ch 7 ¶13: "Do not indent the continuation lines of a subparagraph."
% Continuation lines return to the left margin.
%=============================================================================

`,
  ];

  // The instruction closes with END OF INSTRUCTION, before any appendix.
  const END_OF_INSTRUCTION = '\\par\\vspace{12pt}\n\\begin{center}\\textbf{END OF INSTRUCTION}\\end{center}\n\n';
  let ended = false;
  let appendixCount = 0;
  // Figures number consecutively, and afresh within each appendix with its
  // letter in front (MIL-STD-38784C 4.7.4.1.4): Figure 2, then Figure A-1.
  let printedFigureNumber = 0;
  // The position and attachment identity must match generateAllLatexFiles.
  let figureFileIndex = 0;
  let appendixLetter = '';
  // A one-line closing still needs preceding body text on the signature page
  // (Ch 7 ¶13). Connect the final written paragraphs after removing empty
  // closing rows; the template attaches signatures and widow protection keeps lines.
  const tailStart = closingTailStart(store.docType, store.paragraphs);
  for (let i = 0; i < store.paragraphs.length; i++) {
    const para = store.paragraphs[i];
    assertRichBlockShape(para);
    if (tailStart !== undefined && i > tailStart) parts.push('\\nopagebreak[4]\n');
    const label = paragraphHasLabel(para.level, config) ? labels[i] : '';
    const layout = resolveParagraphLayout(para.level, ancestors[i], config, bodyFont, bodySizePt);
    const spacing = `\\vspace{${layout.spaceBeforePt}pt}`;
    const headerText = para.header?.trim();
    // Portion marking prefix, e.g. "(S) " — previously rendered only on the
    // DOCX path; the PDF silently dropped it (DoDM 5200.01 V2 requires
    // portion marks on the primary output too). Enum-constrained, LaTeX-safe.
    const portionPrefix = para.portionMarking ? `(${para.portionMarking}) ` : '';
    if (para.bodyTable) {
      const caption = hasBodyCaption(para) ? `${portionPrefix}${[headerText ? bodyText(headerText) : '', para.text ? bodyText(para.text) : ''].filter(Boolean).join(' ')}` : '';
      if (caption) parts.push(`\\par\\noindent ${adapter?.tableCaption?.(i, caption) ?? caption}\\par\n`);
      parts.push(renderBodyTable(para.bodyTable, text => store.docType === 'i_type'
        ? publicationReferenceText(text, crossReferences, false, (value, protectedTokens) => bodyTableText(value, [], 0, protectedTokens), bodyTableLiteral)
        : bodyTableText(text), {
        scope: adapter?.tableScope?.(i),
        cellAdapter: adapter?.tableCell ? (row, column, header, cell) => adapter.tableCell!(i, row, column, header, cell) : undefined,
      }));
      continue;
    }
    if (para.figure?.placement === 'body') {
      if (!para.figure.fileRef) throw new Error('A body image is missing. Reattach it before exporting.');
      const file = (store.docType === 'business_letter' ? businessFigureFile : figureFile)(++figureFileIndex, para.figure.type, para.figure.name, para.figure.fileRef.id);
      const graphicMark = para.figure.portionMarking ?? para.portionMarking;
      const caption = hasBodyCaption(para) ? `${portionPrefix}${[headerText ? bodyText(headerText) : '', para.text ? bodyText(para.text) : ''].filter(Boolean).join(' ')}` : '';
      const stock = correspondenceStationery(store.docType, store.formData);
      const graphic = `\\includegraphics[width=\\textwidth,height=${Math.min(5, stock.textHeight - 1)}in,keepaspectratio]{${file}}`;
      const mark = graphicMark ? `(${escapeLatex(graphicMark)})` : '';
      const tagFigure = (part: 'image' | 'caption' | 'mark', latex: string) => adapter?.figure?.(i, part, latex) ?? latex;
      parts.push(`\\par\\vspace{12pt}\\begin{center}${mark ? `${tagFigure('mark', mark)}\\\\*` : ''}${tagFigure('image', graphic)}${caption ? '\\\\[6pt]' + tagFigure('caption', caption) : ''}\\end{center}\n`);
      continue;
    }

    // A figure: the image, then its numbered title beneath. The framed
    // fallback stands in until the image is loaded, as the seal's does.
    if (para.figure && (store.docType === 'i_type' || store.docType === 'business_letter')) {
      const file = (store.docType === 'business_letter' ? businessFigureFile : figureFile)(++figureFileIndex, para.figure.type, para.figure.name, para.figure.fileRef?.id);
      const number = ++printedFigureNumber;
      const label = appendixLetter ? `${appendixLetter}-${number}` : String(number);
      // A figure title carries no period at the end (MIL-STD-38784C 4.7.9.1).
      const graphicMark = para.figure.portionMarking ?? para.portionMarking;
      const title = (para.portionMarking ? `(${escapeLatex(para.portionMarking)}) ` : '') + bodyText(para.text.trim().replace(/\.$/, ''));
      parts.push(
        `\\par\\vspace{12pt}\n\\begin{center}\n${navigationTex(navigation.get(`itype.figure.${i}`))}${graphicMark ? `(${escapeLatex(graphicMark)})\\\\*` : ""}` +
          `\\IfFileExists{${file}}{\\includegraphics[width=\\textwidth,height=5in,keepaspectratio]{${file}}}` +
          `{\\framebox[3in][c]{\\parbox[c][1.5in][c]{2.8in}{\\centering\\scriptsize Figure ${label}\\\\(add image)}}}\\\\*[6pt]\n` +
          `\\textbf{Figure ${label}.\\hspace{2\\fontdimen2\\font}${title}}\n\\end{center}\n\\vspace{12pt}\n\n`
      );
      continue;
    }

    // A safety callout replaces the paragraph rather than decorating it.
    if (para.callout) {
      if (store.docType === 'i_type') {
        let end = i;
        while (end + 1 < store.paragraphs.length && store.paragraphs[end + 1].callout) end++;
        const group = store.paragraphs.slice(i, end + 1);
        const safety = group.some((p) => p.callout !== 'note');
        const content = group.map((p) => generateCallout(p.callout!, `${p.portionMarking ? `(${p.portionMarking}) ` : ''}${p.text}`, safety, (text, uppercase) => publicationReferenceText(text, crossReferences, uppercase))).join('');
        if (safety) {
          parts.push(`\\setbox\\dondocsSafetyGroup=\\vbox{\\hsize=\\textwidth ${content}}\n`);
          parts.push(`\\dondocsNeedspace{\\ht\\dondocsSafetyGroup+\\dp\\dondocsSafetyGroup+4\\baselineskip}\n`);
        }
        parts.push(content);
        i = end;
      } else {
        parts.push(generateCallout(para.callout, `${portionPrefix}${para.text}`));
      }
      continue;
    }

    // An appendix opens on its own page, lettered in order, titled by its
    // heading; its text, if any, leads unnumbered. Only a publication type
    // defines the macro, so elsewhere the flag is ignored.
    if (para.appendix && store.docType === 'i_type') {
      if (!ended) { parts.push(END_OF_INSTRUCTION); ended = true; }
      const letter = String.fromCharCode(65 + appendixCount++);
      appendixLetter = letter;
      printedFigureNumber = 0;
      parts.push(`\\renewcommand{\\dondocsAppendixNavigation}{${navigationTex(navigation.get(`itype.p.${i}`))}}\n`);
      parts.push(`\\startAppendix{${letter}}{${escapeLatex(headerText || '')}}\n`);
      if (para.text.trim()) {
        parts.push(`\\noindent ${portionPrefix}${bodyText(para.text)}\\par\n\n`);
      }
      continue;
    }

    // A procedural step blocks: carry-over lines start under the first letter
    // of the step rather than returning to the margin, which is the opposite
    // of every other paragraph (MIL-STD-38784C 4.7.11.5.3). Steps are indented
    // from the margin and their substeps align under the text above them.
    if (para.procedure) {
      const stepIndent = 0.25 + para.level * 0.25;
      parts.push(navigationTex(navigation.get(`itype.p.${i}`)) || (store.docType === 'i_type' ? `\\dondocsReferenceAnchor{itype.p.${i}}\n` : ''));
      parts.push(
        `\\vspace{12pt}\n{\\leftskip=${stepIndent}in\n` +
          `\\noindent\\hangindent=\\dimexpr${PROCEDURE_LABEL_WIDTH}+2\\fontdimen2\\font\\relax\\hangafter=1 ` +
          `\\makebox[${PROCEDURE_LABEL_WIDTH}][r]{\\textbf{${label}}}\\hspace{2\\fontdimen2\\font}` +
          `${portionPrefix}${headerText ? escapeLatex(toTitleCase(headerText.replace(/\.$/, ''))) + '. ' : ''}${bodyText(para.text)}\\par}\n\n`
      );
      continue;
    }

    // The two spaces belong to the label. Business letters and executive
    // correspondence number nothing, so an empty label must not leave the gap
    // behind — it would push the first line right of its own wrapped lines.
    // A technical publication sets its paragraph numbers in bold (the
    // MARCORSYSCOM template); correspondence does not.
    const tag = (part: 'label' | 'heading' | 'body', latex: string) => adapter?.inline(i, part, latex) ?? latex;
    const shownLabel = store.docType === 'i_type' && label ? `\\textbf{${label}}` : label;
    const renderedLabel = i === hintIndex && !headerText && shownLabel ? `\\PreviewHint{${shownLabel}}` : shownLabel;
    const labelGap = renderedLabel ? `${tag('label', renderedLabel)}~~` : '';

    // The period belongs to the sentence the heading introduces, not to the
    // heading — so a heading that introduces nothing does not get one. ¶13d
    // says only to underline the heading and Title Case it, but the manual
    // demonstrates the rule throughout: of its own 75 standalone Title Case
    // headings, 69 are bare ("14. Signature Line", "a. General"), and the ones
    // carrying a period are sentence fragments rather than headings. The
    // Adjutant master template states it outright: "1. Format" — no period.
    const headingDot = para.text.trim() || i === hintIndex ? '.' : '';

    // Authors type the period themselves out of habit, and the generator adds
    // its own, so "Format." printed as "Format..". Drop a trailing one — the
    // DOCX path has always done this. Costs the period on a heading that ends
    // in an abbreviation, which is the rarer case by far.
    const formattedHeader = headerText ? toTitleCase(headerText.replace(/\.$/, '')) : '';
    const renderedHeader = headerText ? tag('heading', `${underlineWords(escapeLatex(formattedHeader))}${headingDot}`) : '';
    const renderedBody = tag('body', `${portionPrefix}${i === hintIndex ? previewHint(hints, 'body', '') : bodyText(para.text)}`);

    if (store.docType === 'i_type' && para.tableKey && store.publicationTables?.[para.tableKey]?.length) {
      parts.push(generatePublicationTable(para.tableKey, store.publicationTables[para.tableKey], navigation.get(`itype.table.${i}`)?.title || headerText || '', true, crossReferences, para.tableIdentifierMode));
    }
    if (store.docType === 'i_type' && headerText && !para.tableKey) parts.push('\\dondocsNeedspace{4\\baselineskip}\n');
    parts.push(navigationTex(navigation.get(`itype.p.${i}`)) || (store.docType === 'i_type' ? `\\dondocsReferenceAnchor{itype.p.${i}}\n` : ''));
    if (para.level === 0) {
      // Level 0: Main paragraph with optional underlined header
      // Per SECNAV M-5216.5 Ch 7 ¶13d: "Underline any heading and capitalize its key words"
      if (isBusinessLetter || (config.headquartersMemo && !useNumberedParagraphs)) {
        // Business letter: 0.5" first-line indent, no numbers
        if (headerText) {
          parts.push(`${spacing}\n\\noindent\\hspace{${layout.firstLineIndentIn}in}${renderedHeader}~~${renderedBody}\n\n`);
        } else {
          parts.push(`${spacing}\n\\noindent\\hspace{${layout.firstLineIndentIn}in}${renderedBody}\n\n`);
        }
      } else if (headerText) {
        parts.push(`${spacing}\n\\noindent ${labelGap}${renderedHeader}~~${renderedBody}\n\n`);
      } else {
        parts.push(`${spacing}\n\\noindent ${labelGap}${renderedBody}\n\n`);
      }
    } else {
      const body = headerText
        ? `${labelGap}${renderedHeader}~~${renderedBody}`
        : `${labelGap}${renderedBody}`;

      if (isBusinessLetter) {
        parts.push(`${spacing}\n{\\leftskip=${layout.continuationIndentIn}in\n\\noindent ${body}\\par}\n\n`);
      } else {
        parts.push(`${spacing}\n\\noindent\\hspace*{${layout.firstLineIndentIn}in}${body}\n\n`);
      }
    }

    // Type switches preserve publication metadata. Only I-Type loads the
    // table/navigation macros; other templates must not render those blocks.
    if (store.docType === 'i_type' && para.tableKey) {
      const entry = navigation.get(`itype.table.${i}`);
      if (entry) parts.push('\\dondocsNeedspace{\\ht\\dondocsTableStart+\\dp\\dondocsTableStart+2\\baselineskip+18bp}\n');
      parts.push(navigationTex(entry));
      if (entry) parts.push(`{\\centering\\textbf{${tableTitleTex(entry.title)}}\\par}\\nopagebreak[4]\n`);
      parts.push(generatePublicationTable(para.tableKey, store.publicationTables?.[para.tableKey] ?? [], entry?.title || headerText || '', false, crossReferences, para.tableIdentifierMode));
      for (const note of para.tableFootnotes ?? []) {
        if (!/^[a-z0-9]+$/i.test(note.id)) continue;
        parts.push(`\\par\\noindent\\hspace*{5\\fontdimen2\\font}\\dondocsReferenceAnchor{itype.note.${i}.${note.id.toUpperCase()}}${escapeLatex(note.id)}\\hspace{2\\fontdimen2\\font}${bodyText(note.text)}\\par\n`);
      }
    }
  }
  if (store.docType === 'i_type' && !ended && store.paragraphs.length > 0) parts.push(END_OF_INSTRUCTION);

  return parts.join('');
}

export function generateClassificationTex(store: DocumentStore, resolvedLevel?: string): string {
  assertStationerySupport(store.docType, { ...store.formData, ...(resolvedLevel ? { classLevel: resolvedLevel } : {}) }, store.paragraphs, store.documentMode);
  const data = store.formData;
  const metadataText = store.docType === 'technical_volume' ? (value: string | undefined) => bodyTableLiteral(value ?? '') : escapeLatex;

  // Banner reflects the HIGHEST portion marking, not just the document
  // level (SECNAV M-5216.5 / DoDM 5200.01 Vol 2). A CUI document with an
  // (S) paragraph must render a SECRET banner. `custom` passes through
  // unchanged (unrankable free text).
  const overallLevel = resolvedLevel ?? deriveOverallClassLevel(data.classLevel, store.paragraphs);

  if (overallLevel === 'unclassified') {
    return '% Unclassified - no classification markings\n';
  }

  if (overallLevel === 'cui') {
    // \setClassification{CUI} is the canonical entry point — it sets
    // \ClassificationMarking, flips \ClassificationEnabledtrue, and
    // detects the literal "CUI" arg to flip \CUIEnabledtrue (see
    // tex/main.tex `\setClassification`). Previously emitted `\setCUI`,
    // which is not defined anywhere; SwiftLaTeX silently swallowed the
    // unknown control sequence in production, but xelatex's strict mode
    // catches it. Caught by the integration compile-matrix on this PR.
    return `%=============================================================================
% CUI CONFIGURATION - Generated by dondocs
%=============================================================================

\\setClassification{CUI}
\\setCUIControlledBy{${metadataText(data.cuiControlledBy)}}
\\setCUICategory{${metadataText(data.cuiCategory)}}
\\setCUITransmittalNote{${escapeLatex(cuiTransmittalNote(data, store.paragraphs, store.enclosures, store.docType) ?? '')}}
\\setCUIDissemination{${metadataText(data.cuiDissemination)}}
\\setCUIDistStatement{${escapeLatex(isTechnicalPublication(store.docType) ? data.cuiDistStatement : documentDistributionStatement(data))}}
\\setPOC{${metadataText(validatedPocEmail(data.pocEmail))}}
`;
  }

  // Handle custom classification - just output the text verbatim as banner only
  // Uses \setCustomClassification which sets banners but NOT the classified info block.
  if (overallLevel === 'custom') {
    // No marking text yet → emit nothing. We MUST NOT fall through to the
    // classified branch below: that path's `\setClassification{...}` setter
    // had a `|| 'SECRET'` fallback which silently rendered fake SECRET
    // banners on every Custom-mode preview where the user hadn't yet typed
    // a marking. That's a real safety problem — a tool that fabricates
    // classified markings out of thin air is worse than no marking at all.
    if (!data.customClassification) {
      return '% Custom classification — no marking entered yet, no banners rendered\n';
    }
    return `%=============================================================================
% CUSTOM CLASSIFICATION - Generated by dondocs
%=============================================================================

\\setCustomClassification{${escapeLatex(data.customClassification)}}
`;
  }

  const classLevelMap: Record<string, string> = {
    confidential: 'CONFIDENTIAL',
    secret: 'SECRET',
    top_secret: 'TOP SECRET',
    top_secret_sci: 'TOP SECRET//SCI',
  };

  // Hard refusal — if the classLevel is some unrecognized value, do NOT
  // silently default to SECRET. Render the doc as unclassified rather than
  // fabricating a classification marking the user did not select.
  const marking = classLevelMap[overallLevel];
  if (!marking) {
    return '% Unrecognized classLevel — no classification markings rendered\n';
  }

  return `%=============================================================================
% CLASSIFICATION CONFIGURATION - Generated by dondocs
%=============================================================================

\\setClassification{${marking}}
${isTechnicalPublication(store.docType) ? `\\def\\ITypeClassificationBasis{${data.classificationBasis === 'original' ? 'original' : 'derivative'}}` : ''}
\\setClassifiedBy{${escapeLatex(data.classifiedBy)}}
\\setDerivedFrom{${escapeLatex(data.derivedFrom)}}
\\setDeclassifyOn{${escapeLatex(data.declassifyOn)}}
\\setClassificationReason{${escapeLatex(data.classReason)}}
\\setPOC{${escapeLatex(validatedPocEmail(data.classifiedPocEmail))}}
`;
}

export interface EnclosureData {
  number: number;
  title: string;
  marking?: Enclosure['marking'];
  data?: ArrayBuffer; // undefined = text-only enclosure (no PDF)
  pageStyle?: 'border' | 'fullpage' | 'fit';
  hasCoverPage?: boolean;
  coverPageDescription?: string;
}

export interface ReferenceUrlData {
  letter: string;
  url: string;
}

export interface GeneratedFiles {
  texFiles: Record<string, string>;
  enclosures: EnclosureData[];
  includeHyperlinks: boolean;
  signatureImage?: Uint8Array; // PNG data for signature image
  referenceUrls: ReferenceUrlData[]; // URLs for reference hyperlinks
  hasPreviewHints?: boolean;
  /** Figure images to place, by the file the body names and the attachment
   *  that holds the bytes. The caller loads and supplies them. */
  figures: { file: string; ref: FileRef }[];
}

/** Read enclosure output metadata without invoking a document-body renderer. */
export function enclosureRenderData(store: Pick<DocumentStore, 'docType' | 'formData' | 'enclosures'>): EnclosureData[] {
  const start = enclosureStartNumber(store.docType, store.formData.startingEnclosureNumber);
  return store.enclosures.map((enclosure, index) => ({ number: start + index, title: enclosure.title || 'Untitled', data: enclosure.file?.data,
    pageStyle: enclosure.pageStyle, hasCoverPage: enclosure.hasCoverPage, coverPageDescription: enclosure.coverPageDescription,
    ...('marking' in enclosure ? { marking: enclosure.marking } : {}),
  }));
}

export function generateAllLatexFiles(store: DocumentStore, resolvedLevel?: string, referenceDate = new Date(), bodyAdapter?: LatexBodyAdapter, options?: { previewHints?: boolean; hiddenStarterSections?: readonly StarterExampleSection[] }): GeneratedFiles {
  const hints = options?.previewHints && !bodyAdapter ? getPreviewHints(store, referenceDate, options.hiddenStarterSections) : undefined;
  if (!hints) assertAppendedEndorsementsAddressed(store.docType, store.formData);
  if (isDirective(store.docType)) store = { ...store, formData: {
    ...store.formData, via: '', inReplyTo: false, appendEndorsement: false, additionalEndorsements: undefined,
  } };
  if (isStaffPaper(store.docType)) store = {
    ...store, paragraphs: store.docType === 'coordination_page' ? [] : store.paragraphs,
    enclosures: [], copyTos: [], distributions: [], formData: { ...store.formData, appendEndorsement: false, additionalEndorsements: undefined },
  };
  if (store.docType === 'technical_volume') store = { ...store, formData: Object.fromEntries(Object.entries(store.formData).map(([key, value]) => [key, typeof value === 'string' ? value.normalize('NFC') : value])) };
  if (store.docType === 'business_letter') {
    let number = 0;
    for (const paragraph of store.paragraphs) {
      if (!paragraph.figure) continue;
      number++;
      if (!paragraph.figure.fileRef) throw new Error(`Figure ${number} has no image. Choose a PNG or JPEG before exporting.`);
      if (/\.pdf$/i.test(figureFile(number, paragraph.figure.type, paragraph.figure.name))) throw new Error(`Figure ${number} is a PDF. Choose a PNG or JPEG for business-letter figures.`);
    }
  }
  const config = documentOutputConfig(store.docType, store.documentMode);
  store = { ...store, references: config.compliance.allowReferences ? store.references : [], enclosures: config.compliance.allowEnclosures ? store.enclosures : [] };
  if (store.docType === 'tm_ietm_front_matter') store = {
    ...store, endItems: (store.formData.manualFrontMatter ?? emptyManualFrontMatter()).endItems,
    paragraphs: [], enclosures: [], references: [], copyTos: [], distributions: [],
  };
  // A format switch retains correspondence data for switching back, but those
  // attachments and address lists are not part of an SL-4 publication.
  if (store.docType === 'sl4') store = { ...store, paragraphs: store.paragraphs.filter((paragraph) => paragraph.figure), enclosures: [], references: [], copyTos: [], distributions: [] };
  if (store.docType === 'sl4' && store.formData.sl4) store = { ...store, paragraphs: [...store.paragraphs, ...sl4Portions(store.formData.sl4, store.paragraphs)] };
  if (store.docType === 'sl3' && store.formData.sl3) store = { ...store, paragraphs: [...store.paragraphs, ...sl3Portions(store.formData.sl3)] };
  // Files are written to root level to match \input{} paths in latex-templates.js
  const texFiles: Record<string, string> = {
    'stationery.tex': generateStationeryTex(store),
    'document.tex': generateDocumentTex(store, referenceDate, hints),
    'letterhead.tex': generateLetterheadTex(store, hints),
    'signatory.tex': generateSignatoryTex(store, hints),
    'flags.tex': generateFlagsTex(store),
    'references.tex': generateReferencesTex(store),
    'reference-urls.tex': generateReferenceUrlsTex(store),
    'encl-config.tex': generateEnclosuresTex(store),
    'copyto-config.tex': generateCopyToTex(store, hints),
    'distribution-config.tex': generateDistributionTex(store, hints !== undefined),
    'body.tex': store.docType === 'coordination_page'
      ? staffPaperLayout(store.docType, store.formData, value => escapeLatex(value)).body
      : generateBodyTex(store, bodyAdapter, hints),
    'classification.tex': generateClassificationTex(store, resolvedLevel),
  };
  if (store.docType === 'technical_volume') texFiles['volume-format.tex'] = BREAKABLE_TEXT_COMMANDS;

  // Collect ALL enclosures for JavaScript handling (maintains correct order).
  // The number must match the one printed in the Encl: list and used for the
  // `\enclosure{n}` hyperlink anchor — the merge stamps page markers and
  // resolves "Encl (n)" links by it, so an endorsement's continued numbering
  // has to reach here too.
  const enclosures = enclosureRenderData(store);

  // Convert signature image from base64 to Uint8Array if present
  let signatureImage: Uint8Array | undefined;
  if (store.formData.signatureType === 'image' && supportsCorrespondenceSignatureImage(store.docType) && store.formData.signatureImage?.data) {
    try { signatureImage = base64ToUint8Array(store.formData.signatureImage.data.replace(/^data:image\/png;base64,/, '')); }
    catch (error) { throw new ImageInputError('The signature image is not valid base64. Reattach a valid PNG before exporting.', { cause: error }); }
  }

  // Collect reference URLs for hyperlink creation
  const referenceUrls: ReferenceUrlData[] = store.references
    .filter((r) => r.url?.trim())
    .map((r) => ({ letter: r.letter, url: r.url! }));

  const figures: GeneratedFiles['figures'] = [];
  {
    let figureFileIndex = 0;
    for (const p of store.paragraphs) {
      if (!p.figure || !isTechnicalPublication(store.docType) && store.docType !== 'business_letter' && p.figure.placement !== 'body') continue;
      figureFileIndex++;
      if (p.figure.fileRef) figures.push({ file: (store.docType === 'business_letter' ? businessFigureFile : store.docType === 'technical_volume' ? volumeFigureFile : figureFile)(figureFileIndex, p.figure.type, p.figure.name, p.figure.fileRef.id), ref: p.figure.fileRef });
    }
  }
  return { texFiles, enclosures, includeHyperlinks: !!store.formData.includeHyperlinks, signatureImage, referenceUrls, figures, ...(hints ? { hasPreviewHints: Object.keys(hints).length > 0 } : {}) };
}
