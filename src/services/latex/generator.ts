import { escapeLatex, escapeLatexUrl, processBodyText, formatSubjectForLatex, formatAddressForLatex } from './escaper';
import { composeSenderSymbol } from './senderSymbol';
import { tableSpec } from '@/data/techpub/tables';
import { publicationTypeName } from '@/data/techpub/publicationTypes';
import type { DocumentData, Reference, Enclosure, Paragraph, CopyTo, Distribution, EndItem, PublicationTableRow, CalloutKind } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { base64ToUint8Array } from '@/lib/encoding';
import { enclosureStartNumber, pageStartNumber } from '@/lib/endorsement';
import { paragraphMark, delimitParagraphMark, isUnderlinedLevel } from './paragraphLabel';
import { subparagraphIndentIn, ancestorLabelsPerParagraph, type LabelFont } from './subparagraphIndent';
import { safeUrl } from '@/lib/url-safety';
import { splitAddressForLetterhead } from '@/lib/unitAddress';
import { formatViaLines } from '@/lib/viaLines';
import { parse as parseDate, isValid as isValidDate, format as formatDate } from 'date-fns';
import { deriveOverallClassLevel } from '@/lib/overallClassification';
import {
  resolveAppendedEndorsement,
  appendedEndorsementSigner,
} from '@/lib/appendedEndorsement';

interface DocumentStore {
  docType: string;
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

/** Distribution statements as they print on a technical publication cover
 *  (DoDI 5230.24). The editor stores only the letter. */
const DISTRIBUTION_STATEMENT_TEXT: Record<string, string> = {
  A: 'DISTRIBUTION STATEMENT A: Approved for public release; distribution is unlimited.',
  B: 'DISTRIBUTION STATEMENT B: Distribution authorized to U.S. Government agencies only.',
  C: 'DISTRIBUTION STATEMENT C: Distribution authorized to U.S. Government agencies and their contractors.',
  D: 'DISTRIBUTION STATEMENT D: Distribution authorized to the Department of Defense and U.S. DoD contractors only.',
  E: 'DISTRIBUTION STATEMENT E: Distribution authorized to DoD Components only.',
  F: 'DISTRIBUTION STATEMENT F: Further dissemination only as directed by the controlling DoD office.',
};

/** Width reserved for a step label, so carry-over lines block under the text
 *  rather than under the label. Wide enough for the deepest form, "(a)". */
const PROCEDURE_LABEL_WIDTH = '0.35in';

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

function getParagraphLabel(level: number, count: number): string {
  const mark = paragraphMark(level, count);
  // Fig 7-8 underlines the counter itself at levels 4+; the period and the
  // parentheses stay plain, so the delimiter goes on outside the \uline.
  const underlined = isUnderlinedLevel(level) ? `\\uline{${mark}}` : mark;
  return delimitParagraphMark(level, underlined);
}

function calculateLabels(paragraphs: Paragraph[]): string[] {
  const labels: string[] = [];
  const counters = [0, 0, 0, 0, 0, 0, 0, 0];

  for (const para of paragraphs) {
    // A safety callout is not a numbered paragraph: it takes no label and does
    // not advance the count, so the steps around it stay consecutive. The empty
    // label keeps this array aligned with `paragraphs` by index.
    if (para.callout) {
      labels.push('');
      continue;
    }
    // An appendix is numbered afresh: everything before it is done with.
    if (para.appendix) {
      counters.fill(0);
      labels.push('');
      continue;
    }
    for (let i = para.level + 1; i < 8; i++) {
      counters[i] = 0;
    }
    counters[para.level]++;
    labels.push(getParagraphLabel(para.level, counters[para.level]));
  }

  return labels;
}

export function generateDocumentTex(store: DocumentStore): string {
  const data = store.formData;
  // config will be used for document-type specific variations
  const config = DOC_TYPE_CONFIG[store.docType] || DOC_TYPE_CONFIG.naval_letter;
  const isMOAMode = config.uiMode === 'moa';
  const isJointMode = config.uiMode === 'joint' || config.uiMode === 'joint_memo';
  const isExecutiveMode = config.uiMode === 'executive';

  let tex = `%=============================================================================
% DOCUMENT CONFIGURATION - Generated by dondocs
%=============================================================================

\\setDocumentType{${store.docType}}
\\setFontSize{${data.fontSize || '12pt'}}
\\setFontFamily{${data.fontFamily || 'times'}}
\\setPageNumberStyle{${data.pageNumbering || 'none'}}
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

  // For business letters and executive correspondence, set BusinessDate,
  // BusinessRecipientAddress, etc. Both use the same template address/salutation pattern.
  const isBusinessLetter = config.uiMode === 'business';

  // Joint letter and joint memo share the same joint* fields
  const fromLine = isJointMode ? data.jointSeniorFrom : data.from;
  const toLine = isJointMode ? data.jointTo : data.to;
  // Subject line casing per SECNAV M-5216.5:
  //   Executive types (Ch 12 ¶2l): Title Case (NOT ALL CAPS)
  //   This applies to all executive uiMode types AND executive_correspondence
  //   All other types: ALL CAPS
  // Also wrap at 57 characters per SECNAV formatting requirements
  const rawSubject = isJointMode ? data.jointSubject : (isMOAMode ? data.moaSubject : data.subject);
  const usesTitleCaseSubject = isExecutiveMode || store.docType === 'executive_correspondence';
  const formattedSubject = usesTitleCaseSubject
    ? formatSubjectForLatex(toTitleCase(rawSubject || ''))
    : formatSubjectForLatex(rawSubject?.toUpperCase());
  // Wrap in \uline{} when the user has opted to underline the subject.
  // \uline is provided by the `ulem` package (already loaded in the template)
  // and handles multi-line subjects correctly via \newline breaks.
  const subjectLine = data.underlineSubject
    ? `\\uline{${formattedSubject}}`
    : formattedSubject;

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
  const senderSymbol = composeSenderSymbol(data.officeCode, serial);
  tex += `\\setSSIC{${config.ssic ? escapeLatex(ssic) : ''}}
\\setSerial{${config.ssic ? escapeLatex(senderSymbol) : ''}}
\\setDocumentDate{${escapeLatex(docDate)}}
${isBusinessLetter ? `\\setBusinessDate{${escapeLatex(docDate)}}` : '% Not a business letter'}

${data.inReplyTo ? '\\enableInReplyReferTo' : '% No In Reply Refer To'}
${data.includeEndorsementSubject ? '\\enableEndorsementSubject' : '% Endorsement subject omitted (Ch 9)'}

\\setFrom
    {${formatAddressForLatex(fromLine)}}
    {}{}{}

${isBusinessLetter ? `% Business letter: format recipient address as block with line breaks
% Split by newlines (handle both \\n and \\r\\n), escape each line, join with \\\\
\\setBusinessRecipientAddress{${
  (toLine || '')
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => escapeLatex(line.trim()))
    .join('\\\\\n')
}}` : `\\setTo
    {${formatAddressForLatex(toLine)}}
    {}{}{}{}`}

${data.via?.trim() ? (() => {
  // formatViaLines numbers the addressees when more than one remains
  // (Ch 9 ¶2) — shared with flat-generator.ts so PDF and DOCX agree. The
  // templates render \ViaLineOne..Four verbatim, so numbering here fixes
  // every template at once. Pad to 4 lines so indices 0..3 are always
  // defined; empty strings are rendered as empty LaTeX groups.
  const viaLines = formatViaLines(data.via);
  const [l0 = '', l1 = '', l2 = '', l3 = ''] = viaLines;
  return `\\setVia
    {${escapeLatex(l0)}}
    {${escapeLatex(l1)}}
    {${escapeLatex(l2)}}
    {${escapeLatex(l3)}}`;
})() : '% No Via'}

\\setSubject{${subjectLine}}
${data.showSubjectOnContinuation ? `\\setContinuationSubject{${subjectLine}}` : '% Continuation subject disabled'}

\\setBusinessSalutation{${escapeLatex((data.salutation || 'Dear Sir or Madam:').trim())}}
\\setBusinessClose{${escapeLatex(data.complimentaryClose || 'Sincerely,')}}

\\setPOC{${escapeLatex(validatedPocEmail(data.pocEmail))}}
`;

  // Memorandum For: addressee is embedded in the title ("MEMORANDUM FOR [addressee]")
  // The 'to' field holds the addressee text (e.g., "All Department Heads")
  if (store.docType === 'mf' && data.to) {
    tex += `\\setMemorandumForAddressee{${escapeLatex(data.to)}}\n`;
  }

  // Executive memo fields (standard_memorandum, action_memorandum, information_memorandum)
  // Each template defines its own commands — set the ones it expects
  if (isExecutiveMode) {
    // Standard memo + Action memo: \setMemorandumForAddressee
    if (store.docType === 'standard_memorandum' || store.docType === 'action_memorandum') {
      tex += `\\setMemorandumForAddressee{${escapeLatex(data.memorandumFor)}}\n`;
    }

    // Action memo: \setActionFrom (FROM line in address block)
    if (store.docType === 'action_memorandum') {
      tex += `\\setActionFrom{${escapeLatex(data.from)}}\n`;
    }

    // Information memo: \setInfoMemoFor, \setInfoMemoFrom, \setInfoMemoCoordination, \setInfoMemoPreparedBy
    if (store.docType === 'information_memorandum') {
      tex += `\\setInfoMemoFor{${escapeLatex(data.memorandumFor)}}\n`;
      tex += `\\setInfoMemoFrom{${escapeLatex(data.from)}}\n`;
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
    if (basicLetterId) {
      tex += `\\renewcommand{\\BasicLetterID}{${escapeLatex(basicLetterId)}}\n`;
    }
    // Always set serial and date for same-page endorsement, regardless
    // of whether ordinal was found via structured field or subject parse.
    if (store.docType === 'same_page_endorsement') {
      tex += `\\renewcommand{\\EndorsementSerial}{${escapeLatex(data.serial || '')}}\n`;
      tex += `\\renewcommand{\\EndorsementDate}{${escapeLatex(data.date || '')}}\n`;
    }
  }

  // Technical publication cover. The End Item table always prints six rows --
  // the standard keeps unused ones blank rather than deleting them -- and a
  // seventh item moves the whole list to the back of the cover page.
  if (store.docType === 'i_type') {
    const items = store.endItems ?? [];
    const overflow = items.length > END_ITEM_ROWS;
    const shown = overflow ? [] : items.slice(0, END_ITEM_ROWS);
    const rows = Array.from({ length: END_ITEM_ROWS }, (_, i) => {
      const item = shown[i];
      return item
        ? [item.nsn, item.tamcn, item.id, item.model].map((v) => escapeLatex(v || '')).join(' & ')
        : ' & & & ';
    // Each row is ruled, as in the source table -- six visibly distinct rows
    // whether or not they carry an end item.
    }).join(' \\\\ \\hline ');
    tex += `\\setNomenclature{${escapeLatex(data.nomenclature || '')}}\n`;
    tex += `\\setEndItemRows{${rows}}\n`;
    tex += overflow ? '\\EndItemOverflowtrue\n' : '\\EndItemOverflowfalse\n';
    // The cover header carries the anticipated month and year of signature
    // ("JULY 2026"), not the day-level correspondence date the rest of the
    // document uses. Derived from the same date so the two cannot disagree.
    const signed = parseDate(data.date || '', 'd MMM yy', new Date());
    const coverDate = isValidDate(signed) ? formatDate(signed, 'MMMM yyyy').toUpperCase() : '';
    tex += `\\setCoverDate{${escapeLatex(coverDate)}}\n`;
    tex += `\\setShortTitle{${escapeLatex(data.shortTitle || '')}}\n`;
    tex += `\\setPCN{${escapeLatex(data.pcn || '')}}\n`;
    tex += `\\setSupersedure{${escapeLatex(data.supersedure || '')}}\n`;
    tex += `\\setTimeCompliance{${escapeLatex((data.miUrgency || 'normal').toUpperCase())}}\n`;
    // The type names itself on the cover and the authentication page; only a
    // modification asks the unit to record its completion.
    tex += `\\setPublicationTypeName{${escapeLatex(publicationTypeName(data.publicationType))}}\n`;
    tex += (data.publicationType ?? 'MI') === 'MI' ? '\\RecordingInstructiontrue\n' : '\\RecordingInstructionfalse\n';
    // Appendices and enclosures are listed under DISTRIBUTION on the
    // authentication page, lettered as \startAppendix letters them.
    const attachments = [
      ...store.paragraphs.filter((p) => p.appendix).map((p, i) =>
        `Appendix ${String.fromCharCode(65 + i)}: ${escapeLatex(p.header?.trim() || '')}`),
      ...store.enclosures.map((e, i) => `Enclosure (${i + 1}): ${escapeLatex(e.title || '')}`),
    ];
    tex += `\\setAttachmentList{${attachments.join('\\par\\noindent ')}}\n`;
    tex += data.exportRestricted ? '\\ExportRestrictedtrue\n' : '\\ExportRestrictedfalse\n';
    // The distribution statement prints in full on the cover, letter and text
    // together, as the standard words it.
    const dist = DISTRIBUTION_STATEMENT_TEXT[(data.cuiDistStatement || '').trim().charAt(0).toUpperCase()];
    tex += `\\setDistStatementFull{${dist ? escapeLatex(dist) : ''}}\n`;
    // When the cover defers, every end item is listed on its back -- there is
    // no six-row cap there, and no blank rows to keep.
    if (overflow) {
      const all = items
        .map((item) =>
          [item.nsn, item.tamcn, item.id, item.model].map((v) => escapeLatex(v || '')).join(' & ')
        )
        .join(' \\\\ \\hline ');
      tex += `\\setEndItemOverflowRows{${all}}\n`;
    }
  }

  return tex;
}

export function generateLetterheadTex(store: DocumentStore): string {
  const data = store.formData;

  // Split `unitAddress` into letterhead lines 3 and 4 via the shared
  // helper (single source of truth — flat-generator.ts uses the same).
  const { line1: addressLine1, line2: addressLine2 } = splitAddressForLetterhead(
    data.unitAddress || ''
  );

  // Check if unit line 2 has content
  const hasLine2 = !!data.unitLine2?.trim();

  // When line 2 is empty, shift content up to eliminate the gap
  // Line 2 empty: UnitName, Address1, Address2, (empty)
  // Line 2 has content: UnitName, UnitLine2, Address1, Address2
  const line1 = escapeLatex(data.unitLine1);
  const line2 = hasLine2 ? escapeLatex(data.unitLine2) : escapeLatex(addressLine1);
  const line3 = hasLine2 ? escapeLatex(addressLine1) : escapeLatex(addressLine2);
  const line4 = hasLine2 ? escapeLatex(addressLine2) : '';

  return `%=============================================================================
% LETTERHEAD CONFIGURATION - Generated by dondocs
% Per SECNAV M-5216.5: Unit name, address
%=============================================================================

% Seal type: dow (Department of War) or dod (Department of Defense)
\\setSealType{${data.sealType || 'dow'}}

% Department/Service: usmc, navy, or dod
\\setDepartment{${data.department || 'usmc'}}

% Letterhead color: blue (default) or black
\\setLetterheadColor{${data.letterheadColor || 'blue'}}

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

export function generateSignatoryTex(store: DocumentStore): string {
  const data = store.formData;
  const config = DOC_TYPE_CONFIG[store.docType] || DOC_TYPE_CONFIG.naval_letter;

  // Check if this is a dual-signature document (MOA/MOU)
  if (config.uiMode === 'moa') {
    return generateMOASignatoryTex(store);
  }

  // Check if this is a joint letter or joint memorandum (dual letterheads and signatures)
  if (config.uiMode === 'joint' || config.uiMode === 'joint_memo') {
    return generateJointLetterSignatoryTex(store);
  }

  // Properly capitalize names: First Middle LAST
  const firstName = capitalizeWord(data.sigFirst);
  const middleName = capitalizeWord(data.sigMiddle);
  const lastName = data.sigLast?.toUpperCase() || '';

  const fullName = [firstName, middleName, lastName]
    .filter(Boolean)
    .join(' ');

  // Abbreviated format: F. M. LASTNAME
  const abbrevName = [
    firstName ? `${firstName[0].toUpperCase()}.` : '',
    middleName ? `${middleName[0].toUpperCase()}.` : '',
    lastName,
  ]
    .filter(Boolean)
    .join(' ');

  let byDirectionTex = '';
  if (data.byDirection) {
    // Per SECNAV M-5216.5 Ch 7 ¶14b(4)-(5) the bare "By direction" is the norm;
    // the "of the <activity head>" long form is reserved for correspondence
    // affecting pay and allowances, so it only appears when one is named.
    const authority = (data.byDirectionAuthority || '').trim();
    const line = authority ? `By direction of ${escapeLatex(authority)}` : 'By direction';
    byDirectionTex = `\\setByDirection{${line}}`;
  }

  // The appointee's acknowledgement, if this letter carries one. Body is
  // pre-numbered here because \setAppendedEndorsement takes it as one argument;
  // main.tex's \printAppendedEndorsement renders nothing when From is empty.
  let appendedEndorsementTex = '';
  const ack = resolveAppendedEndorsement(store.docType, data);
  if (ack) {
    // Label spacing matches generateBodyTex's `${label}  ${text}` exactly. The
    // acknowledgement sits on the same sheet as the letter it answers, so its
    // "1." must align with the letter's "1."; \hspace here put the text 2.3pt
    // further right than the body above it.
    const body = ack.paragraphs
      .map((text, i) => `\\noindent ${i + 1}.~~${escapeLatex(text)}\\par\\vspace{12pt}`)
      .join('');
    appendedEndorsementTex = `\\setAppendedEndorsement
    {${escapeLatex(ack.from)}}
    {${escapeLatex(ack.to)}}
    {${body}}
    {${escapeLatex(appendedEndorsementSigner(data))}}
    {${escapeLatex(ack.serial)}}
    {${escapeLatex(ack.date)}}`;
  }

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
    {${escapeLatex(lastName)}}
    {${escapeLatex(data.sigRank)}}
    {${escapeLatex(data.sigTitle)}}

\\setSignatoryName{${escapeLatex(fullName)}}
\\setSignatoryAbbrev{${escapeLatex(abbrevName)}}

${byDirectionTex}

${appendedEndorsementTex}

${signatureConfigTex}
`;
}

// Generate MOA/MOU specific signatory configuration (dual signatures)
// Uses ONLY commands that exist in the original cached template
function generateMOASignatoryTex(store: DocumentStore): string {
  const data = store.formData;
  const signatureType = data.signatureType || 'none';

  // Digital signature field for dual signatures
  let signatureConfigTex = '';
  if (signatureType === 'digital') {
    signatureConfigTex = '\\setDigitalSignatureField';
  }

  // Senior signatory name formatting (same as standard signatory).
  // Split once and read first/last word safely (see #20). When the input
  // has a single word or is empty, `first` === `last` === that word (or
  // empty string), which is the same behavior the old `?.split(...)[0]` /
  // `?.slice(-1)[0] || ''` chain produced but without the repeated splits
  // or the implicit-undefined pitfalls.
  const seniorFullName = data.seniorSigName || '';
  const seniorParts = seniorFullName.split(' ').filter(Boolean);
  const seniorFirstName = capitalizeWord(seniorParts[0]);
  const seniorLastName = (seniorParts[seniorParts.length - 1] || '').toUpperCase();
  const seniorAbbrev = seniorFirstName ? `${seniorFirstName[0]}. ${seniorLastName}` : seniorLastName;

  // Junior signatory name formatting (abbreviated like senior: "R. CHIOFALO")
  const juniorFullName = data.juniorSigName || '';
  const juniorParts = juniorFullName.split(' ').filter(Boolean);
  const juniorFirstName = capitalizeWord(juniorParts[0]);
  const juniorLastName = (juniorParts[juniorParts.length - 1] || '').toUpperCase();
  const juniorAbbrev = juniorFirstName ? `${juniorFirstName[0]}. ${juniorLastName}` : juniorLastName;

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
\\setSignatoryName{${escapeLatex(seniorFullName)}}
\\setSignatoryAbbrev{${escapeLatex(seniorAbbrev)}}

% Junior Command (Signs First - Left Side) - uses Junior-prefixed fields
\\renewcommand{\\JuniorCommandName}{${escapeLatex(data.juniorCommandName)}}
\\renewcommand{\\JuniorSSIC}{${escapeLatex(data.juniorSSIC)}}
\\renewcommand{\\JuniorSerial}{${escapeLatex(composeSenderSymbol(undefined, data.juniorSerial))}}
\\renewcommand{\\JuniorDate}{${escapeLatex(data.juniorDate)}}
\\renewcommand{\\JuniorSignatoryName}{${escapeLatex(juniorAbbrev)}}
\\renewcommand{\\JuniorSignatoryRank}{${escapeLatex(data.juniorSigRank)}}
\\renewcommand{\\JuniorSignatoryTitle}{${escapeLatex(data.juniorSigTitle)}}

${signatureConfigTex}
`;
}

// Generate Joint Letter / Joint Memorandum specific configuration
// Both use the same joint* fields (shared UI) — only the designation text differs
function generateJointLetterSignatoryTex(store: DocumentStore): string {
  const data = store.formData;
  const signatureType = data.signatureType || 'none';

  // Digital signature field for dual signatures
  let signatureConfigTex = '';
  if (signatureType === 'digital') {
    signatureConfigTex = '\\setDigitalSignatureField';
  }

  // Parse senior signatory name (format: "J. A. SMITH" -> "J. A." first, "SMITH" last)
  const seniorFullName = data.jointSeniorSigName || '';
  const seniorParts = seniorFullName.split(' ');
  const seniorLastName = seniorParts[seniorParts.length - 1]?.toUpperCase() || '';
  const seniorFirstInitials = seniorParts.slice(0, -1).join(' ');
  const seniorAbbrev = seniorFullName.toUpperCase();

  // Junior signatory name (used as full uppercase name)
  const juniorFullName = data.jointJuniorSigName || '';

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
    {${escapeLatex(data.jointSeniorSigTitle)}}
\\setSignatoryName{${escapeLatex(seniorFullName)}}
\\setSignatoryAbbrev{${escapeLatex(seniorAbbrev)}}

% Junior Command (Left Side - Signs First)
\\renewcommand{\\JuniorCommandName}{${escapeLatex(data.jointJuniorName)}}
\\renewcommand{\\JuniorCommandZip}{${escapeLatex(data.jointJuniorZip)}}
\\renewcommand{\\JuniorCommandCode}{${escapeLatex(data.jointJuniorCode)}}
\\renewcommand{\\JuniorSSIC}{${escapeLatex(data.jointJuniorSSIC)}}
\\renewcommand{\\JuniorSerial}{${escapeLatex(composeSenderSymbol(undefined, data.jointJuniorSerial))}}
\\renewcommand{\\JuniorDate}{${escapeLatex(data.jointJuniorDate)}}
\\renewcommand{\\JuniorFromLine}{${escapeLatex(data.jointJuniorFrom)}}
\\renewcommand{\\JuniorSignatoryName}{${escapeLatex(juniorFullName.toUpperCase())}}
\\renewcommand{\\JuniorSignatoryTitle}{${escapeLatex(data.jointJuniorSigTitle)}}

% Common location (appears in letterhead)
\\renewcommand{\\CommonLocation}{${escapeLatex(data.jointCommonLocation)}}

${signatureConfigTex}
`;
}

export function generateFlagsTex(store: DocumentStore): string {
  let flags = '% Flags - Generated by dondocs\n';
  // An I-Type names its affected publications in a paragraph, not a Ref: list.
  if (store.references.length > 0 && store.docType !== 'i_type') {
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
    const cmd = i === store.references.length - 1 ? '\\lastrefitem' : '\\refitem';
    return `${cmd}{${r.letter}}{${escapeLatex(r.title)}}`;
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

${safeRefs.map((r) => `\\setRefURL{${r.letter}}{${escapeLatexUrl(r.url)}}`).join('\n')}
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

export function generateCopyToTex(store: DocumentStore): string {
  if (store.copyTos.length === 0) {
    return '% No copy-to recipients\n';
  }

  // Label on its own line, every addressee flush beneath it. SECNAV M-5216.5
  // Ch 7 15c: listed "in a single column at the left margin and single spaced
  // below the 'Copy to:' line", which is how the manual renders it in all five
  // of its own Ch 7 examples. A tabular put the first addressee beside the
  // label and all of them 47pt in from the margin.
  const rows = ['    \\noindent Copy to:\\par']
    .concat(store.copyTos.map((ct) => `    \\noindent ${escapeLatex(ct.text)}\\par`));

  return `%=============================================================================
% COPY TO - Generated by dondocs
% Count: ${store.copyTos.length} recipients
%=============================================================================

\\setHasCopyTo
\\newcommand{\\CopyToRows}{%
${rows.join('\n')}
}
`;
}

export function generateDistributionTex(store: DocumentStore): string {
  if (!store.distributions || store.distributions.length === 0) {
    return '% No distribution recipients\n';
  }

  // Same shape as the copy-to block: 15c ends "Use this format for the
  // 'Distribution:' lines as well."
  const rows = ['    \\noindent Distribution:\\par']
    .concat(store.distributions.map((d) => `    \\noindent ${escapeLatex(d.text)}\\par`));

  return `%=============================================================================
% DISTRIBUTION - Generated by dondocs
% Count: ${store.distributions.length} recipients
%=============================================================================

\\setHasDistribution
\\newcommand{\\DistributionRows}{%
${rows.join('\n')}
}
`;
}

/** A word the author typed entirely in capitals, i.e. an acronym rather than
 * an ordinary word. Single letters are excluded so "A" stays a minor word. */
function isAcronym(word: string): boolean {
  return word.length >= 2 && word === word.toUpperCase() && word !== word.toLowerCase();
}

/** Title Case per SECNAV M-5216.5 Ch 7 ¶13d, raising a word's first letter
 * but never lowering the rest.
 *
 * MCO 5216.20B Ch 13 ¶5b keeps an acronym in capitals: all caps "will not be
 * followed in correspondence unless the abbreviation is made up entirely of
 * the initial letters of major words, (i.e., unless it is an acronym)" —
 * HQMC, USMC, MedEvac. Lowercasing the tail of each word turned those into
 * Hqmc, Usmc and Medevac, and did the same to TCCOR, 1st MarDiv and
 * COMMARFORPAC. ¶13d asks only that key words be capitalized; nothing in
 * either manual licenses lowering a letter the author typed.
 *
 * Checked against 190 real headings — the 174 in SECNAV M-5216.5 plus those
 * in the Adjutant master template and a letter reviewed in the field. 188
 * pass through untouched; the two that change ("Copy To") are the existing
 * minor-word list below, which behaves the same as it always has.
 *
 * flat-generator.ts carries the same function for the DOCX path — fix both.
 */
function toTitleCase(str: string): string {
  // Words that should remain lowercase (unless first word)
  const lowercaseWords = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet'];
  
  return str.split(' ').map((word, index) => {
    const lower = word.toLowerCase();
    // Always capitalize first word, otherwise check if it's a lowercase word
    if (index === 0 || !lowercaseWords.includes(lower)) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    // A minor word gets lowercased, unless the author typed it in capitals —
    // AT (Anti-Terrorism), SO (Special Operations) and OR all spell one.
    return isAcronym(word) ? word : lower;
  }).join(' ');
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
function generatePublicationTable(tableKey: string, rows: PublicationTableRow[]): string {
  const fullSpec = tableSpec(tableKey);
  if (!fullSpec) return '';
  // "If Item Numbers are not needed in tables, remove column." Derived from the
  // rows rather than asked: a table where no row carries an item number prints
  // without the column.
  const itemUsed = rows.some((r) => (r.values.item ?? '').trim() !== '');
  const spec = itemUsed ? fullSpec : { ...fullSpec, columns: fullSpec.columns.filter((c) => c.key !== 'item') };
  if (!spec || rows.length === 0) return '';

  const CONSISTING_INDENT = ['0in', '0.1in', '0.28in'];
  const colSpec = spec.columns.map((c) => `p{${c.width}}`).join('|');
  const head = spec.columns.map((c) => `\\textbf{${escapeLatex(c.label)}}`).join(' & ');

  const body = rows
    .map((row) => {
      const indent = CONSISTING_INDENT[Math.min(row.level ?? 0, CONSISTING_INDENT.length - 1)];
      return spec.columns
        .map((c, i) => {
          const cell = escapeLatex(row.values[c.key] ?? '');
          // Only the description carries the nesting; indenting every column
          // would break the grid.
          return i === 1 && indent !== '0in' ? `\\hspace{${indent}}${cell}` : cell;
        })
        .join(' & ');
    })
    .join(' \\\\ \\hline\n    ');

  return `\\vspace{6pt}
\\noindent\\renewcommand{\\arraystretch}{1.3}
\\begin{tabular}{|${colSpec}|}
    \\hline
    ${head} \\\\
    \\hline
    ${body} \\\\ \\hline
\\end{tabular}
\\par\\vspace{12pt}

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
function generateCallout(kind: CalloutKind, text: string): string {
  const SINGLE_LINE_CHARS = 70;
  const body = kind === 'warning' ? `\\MakeUppercase{${processBodyText(text)}}` : processBodyText(text);
  const centred = text.trim().length <= SINGLE_LINE_CHARS;
  // The box is one line of its own paragraph, so every glue between it and
  // what follows sits behind a penalty; a `center` environment adds glue of
  // its own after the box, and a break there stranded the callout at the
  // foot of a page. A warning or caution precedes what it applies to and
  // may not end a page; a note may follow its subject, so it is free.
  const keep = kind === 'note' ? '' : '\\nopagebreak[4]';
  return `\\par\\vspace{12pt}
\\noindent\\makebox[\\textwidth]{\\begin{minipage}{\\dimexpr\\textwidth-0.5in\\relax}
\\centering\\textbf{${kind.toUpperCase()}}\\par\\vspace{6pt}
${centred ? '\\centering' : '\\raggedright'}
${body}\\par
\\end{minipage}}
\\par${keep}\\vspace{6pt}${keep}

`;
}

export function generateBodyTex(store: DocumentStore): string {
  const labels = calculateLabels(store.paragraphs);
  // Where each subparagraph's label must sit: under its parent's text, per
  // Figure 7-8. flat-generator.ts computes the identical number for Word.
  const ancestors = ancestorLabelsPerParagraph(labels, store.paragraphs.map((p) => p.level));
  const bodyFont: LabelFont = (store.formData.fontFamily || 'times') === 'courier' ? 'courier' : 'times';
  const bodySizePt = parseFloat(store.formData.fontSize || '12pt') || 12;
  const config = DOC_TYPE_CONFIG[store.docType] || DOC_TYPE_CONFIG.naval_letter;

  // Business letters (Ch 11 ¶6, "Do not number main paragraphs") and executive
  // correspondence (Ch 12 ¶3.2c(2), "Do not number the paragraphs") don't
  // number theirs. Endorsements do -- see the Ch 9 note in
  // DOC_TYPE_CONFIG.
  const useNumberedParagraphs = config.compliance.numberedParagraphs;
  // Business letters and executive correspondence use 0.5" first-line indent instead of numbers
  const isBusinessLetter = config.uiMode === 'business';

  // Build the body via array-push-then-join. The previous `latex += ...`
  // pattern inside the paragraph loop is O(n²) under naive implementations
  // (each += allocates a new string equal to the accumulated length).
  // Modern engines optimize this with rope strings, but the array form
  // is unambiguously linear and matches the pattern we use elsewhere.
  const parts: string[] = [
    `%=============================================================================
% DOCUMENT BODY - Generated by dondocs
% SECNAV M-5216.5 Ch 7 ¶13: "Do not indent the continuation lines of a subparagraph."
% Continuation lines return to the label position using \\leftskip
%=============================================================================

`,
  ];

  let appendixCount = 0;
  for (let i = 0; i < store.paragraphs.length; i++) {
    const para = store.paragraphs[i];
    const label = useNumberedParagraphs ? labels[i] : '';
    const headerText = para.header?.trim();
    // Portion marking prefix, e.g. "(S) " — previously rendered only on the
    // DOCX path; the PDF silently dropped it (DoDM 5200.01 V2 requires
    // portion marks on the primary output too). Enum-constrained, LaTeX-safe.
    const portionPrefix = para.portionMarking ? `(${para.portionMarking}) ` : '';

    // A safety callout replaces the paragraph rather than decorating it.
    if (para.callout) {
      parts.push(generateCallout(para.callout, para.text));
      continue;
    }

    // An appendix opens on its own page, lettered in order, titled by its
    // heading; its text, if any, leads unnumbered. Only a publication type
    // defines the macro, so elsewhere the flag is ignored.
    if (para.appendix && store.docType === 'i_type') {
      const letter = String.fromCharCode(65 + appendixCount++);
      parts.push(`\\startAppendix{${letter}}{${escapeLatex(headerText || '')}}\n`);
      if (para.text.trim()) {
        parts.push(`\\noindent ${portionPrefix}${processBodyText(para.text)}\\par\n\n`);
      }
      continue;
    }

    // A procedural step blocks: carry-over lines start under the first letter
    // of the step rather than returning to the margin, which is the opposite
    // of every other paragraph (MIL-STD-38784C 4.7.11.5.3). Steps are indented
    // from the margin and their substeps align under the text above them.
    if (para.procedure) {
      const stepIndent = 0.25 + para.level * 0.25;
      parts.push(
        `\\vspace{6pt}\n{\\leftskip=${stepIndent}in\n` +
          `\\noindent\\hangindent=${PROCEDURE_LABEL_WIDTH}\\hangafter=1 ` +
          `\\textbf{${label}}  ${portionPrefix}${processBodyText(para.text)}\\par}\n\n`
      );
      continue;
    }

    // The two spaces belong to the label. Business letters and executive
    // correspondence number nothing, so an empty label must not leave the gap
    // behind — it would push the first line right of its own wrapped lines.
    // A technical publication sets its paragraph numbers in bold (the
    // MARCORSYSCOM template); correspondence does not.
    const shownLabel = store.docType === 'i_type' && label ? `\\textbf{${label}}` : label;
    const labelGap = shownLabel ? `${shownLabel}~~` : '';

    // The period belongs to the sentence the heading introduces, not to the
    // heading — so a heading that introduces nothing does not get one. ¶13d
    // says only to underline the heading and Title Case it, but the manual
    // demonstrates the rule throughout: of its own 75 standalone Title Case
    // headings, 69 are bare ("14. Signature Line", "a. General"), and the ones
    // carrying a period are sentence fragments rather than headings. The
    // Adjutant master template states it outright: "1. Format" — no period.
    const headingDot = para.text.trim() ? '.' : '';

    // Authors type the period themselves out of habit, and the generator adds
    // its own, so "Format." printed as "Format..". Drop a trailing one — the
    // DOCX path has always done this. Costs the period on a heading that ends
    // in an abbreviation, which is the rarer case by far.
    const formattedHeader = headerText ? toTitleCase(headerText.replace(/\.$/, '')) : '';

    if (para.level === 0) {
      // Level 0: Main paragraph with optional underlined header
      // Per SECNAV M-5216.5 Ch 7 ¶13d: "Underline any heading and capitalize its key words"
      if (isBusinessLetter) {
        // Business letter: 0.5" first-line indent, no numbers
        if (headerText) {
          parts.push(`\\vspace{12pt}\n\\noindent\\hspace{0.5in}${underlineWords(escapeLatex(formattedHeader))}${headingDot}~~${portionPrefix}${processBodyText(para.text)}\n\n`);
        } else {
          parts.push(`\\vspace{12pt}\n\\noindent\\hspace{0.5in}${portionPrefix}${processBodyText(para.text)}\n\n`);
        }
      } else if (headerText) {
        parts.push(`\\vspace{12pt}\n\\noindent ${labelGap}${underlineWords(escapeLatex(formattedHeader))}${headingDot}~~${portionPrefix}${processBodyText(para.text)}\n\n`);
      } else {
        parts.push(`\\vspace{12pt}\n\\noindent ${labelGap}${portionPrefix}${processBodyText(para.text)}\n\n`);
      }
    } else {
      // Subparagraphs indent their FIRST LINE only.
      //
      // SECNAV M-5216.5 Ch 7 ¶13: "Start all continuation lines at the left
      // margin... When using a subparagraph, the first line is always indented
      // the appropriate number of spaces depending on the level of
      // subparagraphing. All other lines of a subparagraph continue at the left
      // margin. Do not indent the continuation lines of a subparagraph."
      // Figure 7-8 shows the same shape.
      //
      // This was `\leftskip`, which shifts EVERY line of the paragraph — the
      // comment here claimed ¶13 wanted continuation lines at the label
      // position, which is the opposite of what ¶13 says. `\hspace*` indents
      // only the line it sits on, matching the DOCX path's
      // \dondocsfirstindent → w:ind w:firstLine.
      //
      // Business letters keep the block indent (Ch 11 has no such rule), which
      // is also what the DOCX path does for them.
      // The step is the parent's label width plus its gap, not a constant:
      // Figure 7-8 prints a subdivision under "10." further right than one
      // under "1." for exactly that reason. See subparagraphIndent.ts.
      const levelIndent = isBusinessLetter
        ? (para.level + 1) * 0.5
        : subparagraphIndentIn(ancestors[i], bodyFont, bodySizePt);
      const body = headerText
        ? `${labelGap}${underlineWords(escapeLatex(formattedHeader))}${headingDot}~~${portionPrefix}${processBodyText(para.text)}`
        : `${labelGap}${portionPrefix}${processBodyText(para.text)}`;

      // 12pt is one blank line at 12pt type — the same gap top-level paragraphs
      // get, because ¶13 draws no distinction: "each paragraph OR SUBPARAGRAPH
      // begins on the second line below the previous paragraph or subparagraph."
      // Figure 7-8 prints a hard return between every pair it shows, including
      // (1)/(2) and a./b. This was 6pt, which reads as a half-height gap and is
      // what a reviewer in the field marked up.
      if (isBusinessLetter) {
        parts.push(`\\vspace{12pt}\n{\\leftskip=${levelIndent}in\n\\noindent ${body}\\par}\n\n`);
      } else {
        parts.push(`\\vspace{12pt}\n\\noindent\\hspace*{${levelIndent}in}${body}\n\n`);
      }
    }

    // A publication paragraph may carry one of its fixed tables.
    if (para.tableKey) {
      parts.push(generatePublicationTable(para.tableKey, store.publicationTables?.[para.tableKey] ?? []));
    }
  }

  return parts.join('');
}

export function generateClassificationTex(store: DocumentStore): string {
  const data = store.formData;

  // Banner reflects the HIGHEST portion marking, not just the document
  // level (SECNAV M-5216.5 / DoDM 5200.01 Vol 2). A CUI document with an
  // (S) paragraph must render a SECRET banner. `custom` passes through
  // unchanged (unrankable free text).
  const overallLevel = deriveOverallClassLevel(data.classLevel, store.paragraphs);

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
\\setCUIControlledBy{${escapeLatex(data.cuiControlledBy)}}
\\setCUICategory{${escapeLatex(data.cuiCategory)}}
\\setCUIDissemination{${escapeLatex(data.cuiDissemination)}}
\\setCUIDistStatement{${escapeLatex(data.cuiDistStatement)}}
\\setPOC{${escapeLatex(validatedPocEmail(data.pocEmail))}}
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
}

export function generateAllLatexFiles(store: DocumentStore): GeneratedFiles {
  // Files are written to root level to match \input{} paths in latex-templates.js
  const texFiles: Record<string, string> = {
    'document.tex': generateDocumentTex(store),
    'letterhead.tex': generateLetterheadTex(store),
    'signatory.tex': generateSignatoryTex(store),
    'flags.tex': generateFlagsTex(store),
    'references.tex': generateReferencesTex(store),
    'reference-urls.tex': generateReferenceUrlsTex(store),
    'encl-config.tex': generateEnclosuresTex(store),
    'copyto-config.tex': generateCopyToTex(store),
    'distribution-config.tex': generateDistributionTex(store),
    'body.tex': generateBodyTex(store),
    'classification.tex': generateClassificationTex(store),
  };

  // Collect ALL enclosures for JavaScript handling (maintains correct order).
  // The number must match the one printed in the Encl: list and used for the
  // `\enclosure{n}` hyperlink anchor — the merge stamps page markers and
  // resolves "Encl (n)" links by it, so an endorsement's continued numbering
  // has to reach here too.
  const enclStart = enclosureStartNumber(store.docType, store.formData.startingEnclosureNumber);
  const enclosures: EnclosureData[] = store.enclosures.map((encl, i) => ({
    number: enclStart + i,
    title: encl.title || 'Untitled',
    data: encl.file?.data, // undefined if no PDF attached
    pageStyle: encl.pageStyle,
    hasCoverPage: encl.hasCoverPage,
    coverPageDescription: encl.coverPageDescription,
  }));

  // Convert signature image from base64 to Uint8Array if present
  const signatureImage = store.formData.signatureImage?.data
    ? base64ToUint8Array(store.formData.signatureImage.data)
    : undefined;

  // Collect reference URLs for hyperlink creation
  const referenceUrls: ReferenceUrlData[] = store.references
    .filter((r) => r.url?.trim())
    .map((r) => ({ letter: r.letter, url: r.url! }));

  return { texFiles, enclosures, includeHyperlinks: !!store.formData.includeHyperlinks, signatureImage, referenceUrls };
}
