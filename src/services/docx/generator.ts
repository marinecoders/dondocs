import { Document, Packer, Paragraph as DocxParagraph, Table } from 'docx';
import type { DocumentData, Reference, Enclosure, Paragraph, CopyTo, DocTypeConfig } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { getFontProps, PAGE_MARGINS, getTimesTabStop } from './styles';
import type { FontType, FontProps } from './styles';
import { styledRun } from './utils';

// Module imports
import { buildLetterhead } from './letterhead';
import {
  buildSSICBlock,
  buildInReplyTo,
  buildFromLine,
  buildToLine,
  buildViaLines,
  buildSubjectLine,
  buildReferences,
  buildEnclosures,
  buildRecipientAddress,
  buildSalutation,
} from './addressing';
import { buildBody } from './body';
import {
  buildSignature,
  buildBusinessSignature,
  buildMOADualSignature,
  buildJointDualSignature,
  buildJointMemoDualSignature,
} from './signature';
import { buildClassificationHeaders, buildCUIBlock, buildClassifiedBlock } from './classification';
import { buildCopyTo } from './copyto';
import { buildMemoHeader, buildDecisionBlock } from './memo';
import { buildMOASSICBlock, buildMOATitle } from './moa';
import {
  buildJointLetterhead,
  buildJointSSICBlock,
  buildJointFromLines,
  buildJointToLine,
  buildJointSubjectLine,
} from './joint';
import { buildSamePageEndorsementHeader, buildNewPageEndorsementHeader } from './endorsement';

export interface DocumentStore {
  docType: string;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
}

export async function generateDocx(store: DocumentStore): Promise<Uint8Array> {
  const data = store.formData;
  const config = DOC_TYPE_CONFIG[store.docType] || DOC_TYPE_CONFIG.naval_letter;
  const fontType: FontType = (data.fontFamily as FontType) || 'courier';
  const fp = getFontProps(fontType, data.fontSize);

  // Collect all section children (paragraphs and tables)
  const children: (DocxParagraph | Table)[] = [];

  // Dispatch on uiMode
  switch (config.uiMode) {
    case 'standard':
      buildStandardLayout(children, store, config, fp, fontType);
      break;
    case 'business':
      buildBusinessLayout(children, store, config, fp, fontType);
      break;
    case 'memo':
      buildMemoLayout(children, store, config, fp, fontType);
      break;
    case 'moa':
      buildMOALayout(children, store, config, fp, fontType);
      break;
    case 'joint':
      buildJointLayout(children, store, config, fp, fontType);
      break;
    case 'joint_memo':
      buildJointMemoLayout(children, store, config, fp, fontType);
      break;
  }

  // Classification info blocks (CUI or classified) — appended to all types
  children.push(...buildCUIBlock(data, fp));
  children.push(...buildClassifiedBlock(data, fp));

  // Build headers/footers for classification markings and page numbers
  const { headers, footers } = buildClassificationHeaders(data, fp, data.pageNumbering || 'none');

  const doc = new Document({
    sections: [
      {
        properties: {
          page: { margin: PAGE_MARGINS },
        },
        headers,
        footers,
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// Standard layout: naval letter, standard letter, multiple address letter, endorsements
function buildStandardLayout(
  children: (DocxParagraph | Table)[],
  store: DocumentStore,
  config: DocTypeConfig,
  fp: FontProps,
  fontType: FontType
) {
  const data = store.formData;

  // Endorsement headers
  if (store.docType === 'same_page_endorsement') {
    children.push(...buildSamePageEndorsementHeader(1, fp));
  } else if (store.docType === 'new_page_endorsement') {
    children.push(...buildNewPageEndorsementHeader(1, fp));
  }

  // Letterhead (if applicable)
  if (config.letterhead) {
    children.push(...buildLetterhead(data, fp));
  }

  // SSIC block
  if (config.ssic) {
    children.push(...buildSSICBlock(data, fp));
  }

  // In Reply To
  children.push(...buildInReplyTo(data, fp));

  // From/To/Via
  if (config.fromTo) {
    children.push(...buildFromLine(data, fp, fontType));
    children.push(...buildToLine(data, fp, fontType));
  }
  if (config.via) {
    children.push(...buildViaLines(data, fp, fontType));
  }

  // Subject
  children.push(...buildSubjectLine(data, fp, fontType));

  // References and Enclosures
  children.push(...buildReferences(store.references, fp, fontType));
  children.push(...buildEnclosures(store.enclosures, fp, fontType));

  // Body paragraphs
  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: config.compliance.numberedParagraphs,
    isBusinessLetter: false,
  }));

  // Signature
  children.push(...buildSignature(data, config, fp));

  // Copy-to
  children.push(...buildCopyTo(store.copyTos, fp));
}

// Business letter layout
function buildBusinessLayout(
  children: (DocxParagraph | Table)[],
  store: DocumentStore,
  config: DocTypeConfig,
  fp: FontProps,
  _fontType: FontType
) {
  const data = store.formData;

  // Letterhead
  if (config.letterhead) {
    children.push(...buildLetterhead(data, fp));
  }

  // Date only (no SSIC/Serial)
  children.push(...buildSSICBlock({ date: data.date }, fp));

  // Recipient address
  children.push(...buildRecipientAddress(data, fp));

  // Salutation
  children.push(...buildSalutation(data, fp));

  // Body (no numbered paragraphs, 0.5" first-line indent)
  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: false,
    isBusinessLetter: true,
  }));

  // Complimentary close + signature
  children.push(...buildBusinessSignature(data, fp));

  // Copy-to
  children.push(...buildCopyTo(store.copyTos, fp));
}

// Memo layout (MFR, MF, plain paper, letterhead, decision, executive)
function buildMemoLayout(
  children: (DocxParagraph | Table)[],
  store: DocumentStore,
  config: DocTypeConfig,
  fp: FontProps,
  fontType: FontType
) {
  const data = store.formData;

  // Letterhead (if applicable)
  if (config.letterhead) {
    children.push(...buildLetterhead(data, fp));
  }

  // SSIC block (if applicable)
  if (config.ssic) {
    children.push(...buildSSICBlock(data, fp));
  }

  // Memo header (centered title variant)
  if (config.memoHeader) {
    children.push(...buildMemoHeader(store.docType, fp));
  }

  // From/To (some memos have them, some don't)
  if (config.fromTo) {
    children.push(...buildFromLine(data, fp, fontType));
    children.push(...buildToLine(data, fp, fontType));
  }

  // Subject
  children.push(...buildSubjectLine(data, fp, fontType));

  // References and Enclosures
  children.push(...buildReferences(store.references, fp, fontType));
  children.push(...buildEnclosures(store.enclosures, fp, fontType));

  // Body
  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: config.compliance.numberedParagraphs,
    isBusinessLetter: false,
  }));

  // Decision block (for decision_memorandum)
  if (store.docType === 'decision_memorandum') {
    children.push(...buildDecisionBlock(fp));
  }

  // Signature
  children.push(...buildSignature(data, config, fp));

  // Copy-to
  children.push(...buildCopyTo(store.copyTos, fp));
}

// MOA/MOU layout
function buildMOALayout(
  children: (DocxParagraph | Table)[],
  store: DocumentStore,
  config: DocTypeConfig,
  fp: FontProps,
  fontType: FontType
) {
  const data = store.formData;

  // Letterhead
  if (config.letterhead) {
    children.push(...buildLetterhead(data, fp));
  }

  // Dual SSIC blocks
  children.push(...buildMOASSICBlock(data, fp));

  // Centered title ("MEMORANDUM OF AGREEMENT BETWEEN X AND Y")
  children.push(...buildMOATitle(data, store.docType, fp));

  // Subject (MOA uses moaSubject)
  if (data.moaSubject) {
    const tempData = { ...data, subject: data.moaSubject };
    children.push(...buildSubjectLine(tempData, fp, fontType));
  }

  // References and Enclosures
  children.push(...buildReferences(store.references, fp, fontType));
  children.push(...buildEnclosures(store.enclosures, fp, fontType));

  // Body
  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: config.compliance.numberedParagraphs,
    isBusinessLetter: false,
  }));

  // Dual signature (overscore style)
  children.push(...buildMOADualSignature(data, fp));

  // Copy-to
  children.push(...buildCopyTo(store.copyTos, fp));
}

// Joint letter layout
function buildJointLayout(
  children: (DocxParagraph | Table)[],
  store: DocumentStore,
  config: DocTypeConfig,
  fp: FontProps,
  fontType: FontType
) {
  const data = store.formData;

  // Joint letterhead (both commands centered)
  children.push(...buildJointLetterhead(data, fp));

  // Joint SSIC block
  children.push(...buildJointSSICBlock(data, fp));

  // Dual From lines
  children.push(...buildJointFromLines(data, fp, fontType));

  // To
  children.push(...buildJointToLine(data, fp, fontType));

  // Subject
  children.push(...buildJointSubjectLine(data, fp, fontType));

  // References and Enclosures
  children.push(...buildReferences(store.references, fp, fontType));
  children.push(...buildEnclosures(store.enclosures, fp, fontType));

  // Body
  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: config.compliance.numberedParagraphs,
    isBusinessLetter: false,
  }));

  // Dual signature (no overscore)
  children.push(...buildJointDualSignature(data, fp));

  // Copy-to
  children.push(...buildCopyTo(store.copyTos, fp));
}

// Joint memorandum layout
function buildJointMemoLayout(
  children: (DocxParagraph | Table)[],
  store: DocumentStore,
  config: DocTypeConfig,
  fp: FontProps,
  fontType: FontType
) {
  const data = store.formData;

  // Letterhead
  if (config.letterhead) {
    children.push(...buildLetterhead(data, fp));
  }

  // SSIC block
  if (config.ssic) {
    children.push(...buildSSICBlock(data, fp));
  }

  // Memo header
  children.push(...buildMemoHeader('joint_memorandum', fp));

  // From/To
  if (config.fromTo) {
    // Joint memo uses specific from fields
    const fromData = { ...data, from: data.jointMemoSeniorFrom };
    children.push(...buildFromLine(fromData, fp, fontType));

    // Junior from as continuation
    if (data.jointMemoJuniorFrom) {
      const isCourier = fontType === 'courier';
      children.push(
        new DocxParagraph({
          children: [
            styledRun('', fp),
            styledRun(isCourier ? ' '.repeat(8) : '\t', fp),
            styledRun(data.jointMemoJuniorFrom, fp),
          ],
          tabStops: isCourier ? undefined : [getTimesTabStop()],
        })
      );
    }

    children.push(...buildToLine(data, fp, fontType));
  }

  // Subject
  children.push(...buildSubjectLine(data, fp, fontType));

  // References and Enclosures
  children.push(...buildReferences(store.references, fp, fontType));
  children.push(...buildEnclosures(store.enclosures, fp, fontType));

  // Body
  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: config.compliance.numberedParagraphs,
    isBusinessLetter: false,
  }));

  // Dual signature
  children.push(...buildJointMemoDualSignature(data, fp));

  // Copy-to
  children.push(...buildCopyTo(store.copyTos, fp));
}
