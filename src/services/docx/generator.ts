import { Document, Packer, Paragraph as DocxParagraph, Table } from 'docx';
import type { DocumentData, Reference, Enclosure, Paragraph, CopyTo, DocTypeConfig } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { getFontProps, PAGE_MARGINS, SINGLE_SPACING, getTimesTabStop } from './styles';
import type { FontType, FontProps } from './styles';
import { styledRun } from './utils';

// Module imports
import { buildLetterhead, getSealFilename } from './letterhead';
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

// Context passed to all layout builders
interface LayoutContext {
  store: DocumentStore;
  config: DocTypeConfig;
  fp: FontProps;
  fontType: FontType;
  sealImageData?: Uint8Array;
  includeHyperlinks: boolean;
}

// Fetch seal image from public/attachments/
async function fetchSealImage(sealType: string | undefined, letterheadColor: string | undefined): Promise<Uint8Array | undefined> {
  try {
    const filename = getSealFilename(sealType, letterheadColor);
    const url = `${import.meta.env.BASE_URL}attachments/${filename}`;
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    console.warn('Failed to fetch seal image — DOCX will be generated without seal');
    return undefined;
  }
}

export async function generateDocx(store: DocumentStore): Promise<Blob> {
  const data = store.formData;
  const config = DOC_TYPE_CONFIG[store.docType] || DOC_TYPE_CONFIG.naval_letter;
  const fontType: FontType = (data.fontFamily as FontType) || 'times';
  const fp = getFontProps(fontType, data.fontSize);

  // Fetch seal image if letterhead is used
  let sealImageData: Uint8Array | undefined;
  if (config.letterhead) {
    sealImageData = await fetchSealImage(data.sealType, data.letterheadColor);
  }

  const ctx: LayoutContext = {
    store, config, fp, fontType, sealImageData,
    includeHyperlinks: !!data.includeHyperlinks,
  };

  // Collect all section children (paragraphs and tables)
  const children: (DocxParagraph | Table)[] = [];

  // Dispatch on uiMode
  switch (config.uiMode) {
    case 'standard':
      buildStandardLayout(children, ctx);
      break;
    case 'business':
      buildBusinessLayout(children, ctx);
      break;
    case 'memo':
      buildMemoLayout(children, ctx);
      break;
    case 'moa':
      buildMOALayout(children, ctx);
      break;
    case 'joint':
      buildJointLayout(children, ctx);
      break;
    case 'joint_memo':
      buildJointMemoLayout(children, ctx);
      break;
    default:
      buildStandardLayout(children, ctx);
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

  return await Packer.toBlob(doc);
}

// Standard layout: naval letter, standard letter, multiple address letter, endorsements
function buildStandardLayout(children: (DocxParagraph | Table)[], ctx: LayoutContext) {
  const { store, config, fp, fontType, sealImageData, includeHyperlinks } = ctx;
  const data = store.formData;

  if (store.docType === 'same_page_endorsement') {
    children.push(...buildSamePageEndorsementHeader(1, fp));
  } else if (store.docType === 'new_page_endorsement') {
    children.push(...buildNewPageEndorsementHeader(1, fp));
  }

  if (config.letterhead) children.push(...buildLetterhead(data, fp, sealImageData));
  if (config.ssic) children.push(...buildSSICBlock(data, fp));
  children.push(...buildInReplyTo(data, fp));

  if (config.fromTo) {
    children.push(...buildFromLine(data, fp, fontType));
    children.push(...buildToLine(data, fp, fontType));
  }
  if (config.via) children.push(...buildViaLines(data, fp, fontType));

  children.push(...buildSubjectLine(data, fp, fontType));
  children.push(...buildReferences(store.references, fp, fontType, includeHyperlinks));
  children.push(...buildEnclosures(store.enclosures, fp, fontType));

  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: config.compliance.numberedParagraphs,
    isBusinessLetter: false,
  }));

  children.push(...buildSignature(data, config, fp));
  children.push(...buildCopyTo(store.copyTos, fp));
}

// Business letter layout
function buildBusinessLayout(children: (DocxParagraph | Table)[], ctx: LayoutContext) {
  const { store, config, fp, sealImageData } = ctx;
  const data = store.formData;

  if (config.letterhead) children.push(...buildLetterhead(data, fp, sealImageData));
  children.push(...buildSSICBlock({ date: data.date }, fp));
  children.push(...buildRecipientAddress(data, fp));
  children.push(...buildSalutation(data, fp));

  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: false,
    isBusinessLetter: true,
  }));

  children.push(...buildBusinessSignature(data, fp));
  children.push(...buildCopyTo(store.copyTos, fp));
}

// Memo layout (MFR, MF, plain paper, letterhead, decision, executive)
function buildMemoLayout(children: (DocxParagraph | Table)[], ctx: LayoutContext) {
  const { store, config, fp, fontType, sealImageData, includeHyperlinks } = ctx;
  const data = store.formData;

  if (config.letterhead) children.push(...buildLetterhead(data, fp, sealImageData));
  if (config.ssic) children.push(...buildSSICBlock(data, fp));
  if (config.memoHeader) children.push(...buildMemoHeader(store.docType, fp));

  if (config.fromTo) {
    children.push(...buildFromLine(data, fp, fontType));
    children.push(...buildToLine(data, fp, fontType));
  }

  children.push(...buildSubjectLine(data, fp, fontType));
  children.push(...buildReferences(store.references, fp, fontType, includeHyperlinks));
  children.push(...buildEnclosures(store.enclosures, fp, fontType));

  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: config.compliance.numberedParagraphs,
    isBusinessLetter: false,
  }));

  if (store.docType === 'decision_memorandum') children.push(...buildDecisionBlock(fp));
  children.push(...buildSignature(data, config, fp));
  children.push(...buildCopyTo(store.copyTos, fp));
}

// MOA/MOU layout
function buildMOALayout(children: (DocxParagraph | Table)[], ctx: LayoutContext) {
  const { store, config, fp, fontType, sealImageData, includeHyperlinks } = ctx;
  const data = store.formData;

  if (config.letterhead) children.push(...buildLetterhead(data, fp, sealImageData));
  children.push(...buildMOASSICBlock(data, fp));
  children.push(...buildMOATitle(data, store.docType, fp));

  if (data.moaSubject) {
    const tempData = { ...data, subject: data.moaSubject };
    children.push(...buildSubjectLine(tempData, fp, fontType));
  }

  children.push(...buildReferences(store.references, fp, fontType, includeHyperlinks));
  children.push(...buildEnclosures(store.enclosures, fp, fontType));

  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: config.compliance.numberedParagraphs,
    isBusinessLetter: false,
  }));

  children.push(...buildMOADualSignature(data, fp));
  children.push(...buildCopyTo(store.copyTos, fp));
}

// Joint letter layout
function buildJointLayout(children: (DocxParagraph | Table)[], ctx: LayoutContext) {
  const { store, config, fp, fontType, includeHyperlinks } = ctx;
  const data = store.formData;

  children.push(...buildJointLetterhead(data, fp));
  children.push(...buildJointSSICBlock(data, fp));
  children.push(...buildJointFromLines(data, fp, fontType));
  children.push(...buildJointToLine(data, fp, fontType));
  children.push(...buildJointSubjectLine(data, fp, fontType));
  children.push(...buildReferences(store.references, fp, fontType, includeHyperlinks));
  children.push(...buildEnclosures(store.enclosures, fp, fontType));

  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: config.compliance.numberedParagraphs,
    isBusinessLetter: false,
  }));

  children.push(...buildJointDualSignature(data, fp));
  children.push(...buildCopyTo(store.copyTos, fp));
}

// Joint memorandum layout
function buildJointMemoLayout(children: (DocxParagraph | Table)[], ctx: LayoutContext) {
  const { store, config, fp, fontType, sealImageData, includeHyperlinks } = ctx;
  const data = store.formData;

  if (config.letterhead) children.push(...buildLetterhead(data, fp, sealImageData));
  if (config.ssic) children.push(...buildSSICBlock(data, fp));
  children.push(...buildMemoHeader('joint_memorandum', fp));

  if (config.fromTo) {
    const fromData = { ...data, from: data.jointMemoSeniorFrom };
    children.push(...buildFromLine(fromData, fp, fontType));

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
          spacing: { ...SINGLE_SPACING },
        })
      );
    }

    children.push(...buildToLine(data, fp, fontType));
  }

  children.push(...buildSubjectLine(data, fp, fontType));
  children.push(...buildReferences(store.references, fp, fontType, includeHyperlinks));
  children.push(...buildEnclosures(store.enclosures, fp, fontType));

  children.push(...buildBody(store.paragraphs, fp, {
    numberedParagraphs: config.compliance.numberedParagraphs,
    isBusinessLetter: false,
  }));

  children.push(...buildJointMemoDualSignature(data, fp));
  children.push(...buildCopyTo(store.copyTos, fp));
}
