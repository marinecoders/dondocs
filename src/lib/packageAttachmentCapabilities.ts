import { PDFDocument } from 'pdf-lib';
import { embedPdfFont } from '@/services/pdf/fonts';
import type { PackageAsset } from './actionPackages';
import { inspectRasterImage } from '@/services/docx/imageAssets';
import { readWordArchive, wordXml } from '@/services/docx/import/archive';
import { retainedWordText } from '@/services/docx/import/retainedText';
import { readWordParagraphText } from '@/services/docx/import/readWord';
import { reviewPackageText } from './actionPackageDisclosure';
import type { PolicyResolution } from './exportDeploymentPolicy';

const formats = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
export const PACKAGE_ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx';
export interface PackageAttachmentInspection {
  format: keyof typeof formats;
  type: string;
  text: string;
  canRenderPdf: boolean;
  notice: string;
  width?: number;
  height?: number;
}
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Validate the preserved format and inventory text without opening external links or running Office code. */
export async function inspectPackageAttachment(file: { name: string; type?: string; data: ArrayBuffer }, signal?: AbortSignal): Promise<PackageAttachmentInspection> {
  signal?.throwIfAborted();
  if (!file.data.byteLength || file.data.byteLength > 20 * 1024 * 1024) throw new Error('Choose a nonempty supporting file up to 20 MB.');
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (!extension || !Object.hasOwn(formats, extension)) throw new Error('Supported evidence files are PNG, JPEG, TXT, CSV, DOCX and XLSX.');
  const format = extension as keyof typeof formats, type = formats[format];
  if (file.type && file.type !== type && file.type !== 'application/octet-stream') throw new Error('The supporting file type does not match its extension.');
  const bytes = new Uint8Array(file.data);
  if (type.startsWith('image/')) {
    const mime = type as 'image/png' | 'image/jpeg';
    const image = await inspectRasterImage(bytes, mime);
    signal?.throwIfAborted();
    if (image.width * image.height > 12_000_000) throw new Error('Package evidence images support up to 12 megapixels. Resize this image before adding it.');
    // The actual PDF decoder must accept the complete bytes, not just the encoded dimensions.
    const document = await PDFDocument.create();
    if (mime === 'image/png') await document.embedPng(bytes); else await document.embedJpg(bytes);
    signal?.throwIfAborted();
    return { format, type, text: '', width: image.width, height: image.height, canRenderPdf: true,
      notice: 'Original image bytes are preserved. Review the image visually; text recognition has not been performed. PDF assembly uses an unsigned image derivative.' };
  }
  if (format === 'txt' || format === 'csv') {
    if (bytes.byteLength > 1024 * 1024) throw new Error('Text and CSV evidence supports up to 1 MB.');
    const text = decoder.decode(bytes);
    if (Array.from(text).some(character => { const code = character.charCodeAt(0); return code === 127 || code < 32 && !['\n', '\r', '\t'].includes(character); }))
      throw new Error('Text evidence must be UTF-8 without unsupported control characters.');
    let canRenderPdf = format === 'txt' && text.length <= 50_000;
    if (canRenderPdf) {
      const document = await PDFDocument.create(), font = await embedPdfFont(document, 'courier');
      try { font.encodeText(text.replace(/[\r\n\t]/g, ' ')); } catch { canRenderPdf = false; }
    }
    signal?.throwIfAborted();
    return { format, type, text, canRenderPdf, notice: canRenderPdf
      ? 'Original UTF-8 text is preserved. PDF assembly makes a paginated text derivative.'
      : 'This file is preserved for editable handoff and delivery. Export a reviewed PDF separately before including it in combined PDF assembly.' };
  }
  const entries = await readWordArchive(bytes, signal);
  const required = format === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
  if (!entries.has('[Content_Types].xml') || !entries.has(required)) throw new Error(`This file is not a valid ${format.toUpperCase()} document.`);
  const activeType = /vbaProject|activeX|oleObject|macroEnabled|macrosheet|aFChunk/i;
  const types = wordXml(entries.get('[Content_Types].xml'), 'content types');
  if (Array.from(types.getElementsByTagName('*')).some(element => activeType.test(element.getAttribute('ContentType') ?? '')))
    throw new Error('Office evidence with macros, active controls or embedded files is unsupported. Export a reviewed PDF instead.');
  for (const [path, value] of entries) {
    signal?.throwIfAborted();
    if (/vbaProject|activex|embeddings\//i.test(path)) throw new Error('Office evidence with macros, active controls or embedded files is unsupported. Export a reviewed PDF instead.');
    if (!/\.(?:xml|rels)$/i.test(path)) {
      if (!/\.(?:png|jpe?g|gif|emf|wmf|bin)$/i.test(path)) throw new Error('This Office file contains unsupported embedded content. Export a reviewed PDF instead.');
      continue;
    }
    const document = wordXml(value, `supporting file ${path}`);
    if (Array.from(document.getElementsByTagName('*')).some(element => element.localName === 'altChunk'
      || element.localName === 'Relationship' && activeType.test(element.getAttribute('Type') ?? '')))
      throw new Error('Office evidence with macros, active controls, alternate content or embedded files is unsupported. Export a reviewed PDF instead.');
  }
  const retained = retainedWordText(entries, (paragraph, view) => readWordParagraphText(paragraph, view, false, () => {}), 2_000_000);
  return { format, type, text: retained.text, canRenderPdf: false,
    notice: 'Original Office bytes, comments and tracked content are retained. Review this file in its source application. It is available for editable handoff and delivery; combined PDF assembly requires a separately reviewed PDF.' };
}

export async function validatePackageAttachment(asset: PackageAsset, bytes: ArrayBuffer, signal?: AbortSignal): Promise<PackageAttachmentInspection> {
  const inspection = await inspectPackageAttachment({ name: asset.name, type: asset.type, data: bytes }, signal);
  if (inspection.type !== asset.type) throw new Error('The retained attachment MIME type does not match its content.');
  return inspection;
}

export async function reviewPackageAttachment(asset: PackageAsset, bytes: ArrayBuffer, policy: PolicyResolution, signal?: AbortSignal) {
  const inspection = await validatePackageAttachment(asset, bytes, signal);
  const review = reviewPackageText(`${asset.name}\n${inspection.text}`, 'Captured supporting file, including retained text', policy);
  return { inspection, review: { ...review, notices: [...review.notices, inspection.notice] } };
}

/** Conversion is explicit and limited. Preserved source bytes are never rewritten or replaced. */
export async function renderPackageAttachment(asset: PackageAsset, bytes: ArrayBuffer, signal?: AbortSignal): Promise<ArrayBuffer> {
  const inspection = await validatePackageAttachment(asset, bytes, signal);
  if (!inspection.canRenderPdf) throw new Error(`${asset.name}: no qualified combined-PDF conversion is available. Retain it in the editable handoff or add a separately reviewed PDF.`);
  const document = await PDFDocument.create();
  if (inspection.type.startsWith('image/')) {
    const image = inspection.type === 'image/png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
    const page = document.addPage([612, 792]), scale = Math.min(540 / image.width, 720 / image.height, 1);
    const width = image.width * scale, height = image.height * scale;
    page.drawImage(image, { x: (612 - width) / 2, y: (792 - height) / 2, width, height });
  } else {
    const font = await embedPdfFont(document, 'courier'), size = 10, lineHeight = 13;
    const lines = inspection.text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n').flatMap(line => {
      const result: string[] = [];
      while (line.length > 85) { result.push(line.slice(0, 85)); line = line.slice(85); }
      result.push(line); return result;
    });
    if (Math.ceil(lines.length / 54) > 100) throw new Error('Text evidence needs more than 100 PDF pages. Split the source file.');
    for (let start = 0; start < lines.length; start += 54) {
      signal?.throwIfAborted(); const page = document.addPage([612, 792]);
      lines.slice(start, start + 54).forEach((line, index) => page.drawText(line, { x: 36, y: 756 - index * lineHeight, size, font }));
    }
  }
  signal?.throwIfAborted(); return new Uint8Array(await document.save()).buffer;
}
