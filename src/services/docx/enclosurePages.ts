import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { loadAssemblyPdf } from '@/services/pdf/assemblyPdf';
import { mergeEnclosures, type ClassificationInfo, type EnclosureData } from '@/services/pdf/mergeEnclosures';

export const WORD_ENCLOSURE_LIMITS = { pages: 50, sourceBytes: 25 * 1024 * 1024, imageBytes: 25 * 1024 * 1024, outputBytes: 50 * 1024 * 1024 } as const;
export interface WordEnclosurePage { bytes: Uint8Array; width: number; height: number }
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** The existing assembly path owns enclosure numbering, covers and markings. */
export async function renderWordEnclosurePages(enclosures: readonly EnclosureData[], classification: ClassificationInfo | undefined, signal: AbortSignal): Promise<WordEnclosurePage[]> {
  signal.throwIfAborted();
  let inputBytes = 0, pageCount = 0;
  const prepared: EnclosureData[] = [];
  for (const enclosure of enclosures) {
    signal.throwIfAborted();
    if (!enclosure.data?.byteLength) throw new Error(`Attach the PDF for enclosure (${enclosure.number}) before including its pages in Word.`);
    inputBytes += enclosure.data.byteLength;
    if (inputBytes > WORD_ENCLOSURE_LIMITS.sourceBytes) throw new Error('Word enclosure originals must total 25 MB or less. Use the Word package to deliver larger originals separately.');
    const source = await loadAssemblyPdf(enclosure.data, signal);
    pageCount += source.pdf.getPageCount() + (enclosure.hasCoverPage ? 1 : 0);
    if (pageCount > WORD_ENCLOSURE_LIMITS.pages) throw new Error('Word enclosure page images are limited to 50 pages, including covers.');
    prepared.push({ ...enclosure, data: new Uint8Array(await source.pdf.save({ addDefaultPage: false })).buffer });
  }
  if (!prepared.length) return [];
  const empty = await PDFDocument.create();
  const merged = await mergeEnclosures(await empty.save({ addDefaultPage: false }), prepared, classification, false, [], { signal });
  if (merged.hasErrors) throw new Error(`Word enclosure assembly failed: ${merged.errors.map(error => `Enclosure (${error.enclosureNumber}): ${error.error}`).join(' ')}`);
  const pages: WordEnclosurePage[] = [];
  let imageBytes = 0;
  await loadAssemblyPdf(merged.pdfBytes, signal, { forcePageImages: true, onPageImage: page => {
    imageBytes += page.bytes.byteLength;
    if (pages.length >= WORD_ENCLOSURE_LIMITS.pages || imageBytes > WORD_ENCLOSURE_LIMITS.imageBytes) throw new Error('Word enclosure images exceed the delivery limit. Use the Word package with separate originals.');
    pages.push({ ...page, bytes: new Uint8Array(page.bytes) });
  } });
  if (pages.length !== pageCount) throw new Error('Word enclosure rendering did not preserve every captured page.');
  signal.throwIfAborted();
  return pages;
}

/** Append complete visual pages in a separate section, with explicit empty
 * headers/footers so the letter's banner cannot override enclosure markings. */
export async function appendWordEnclosurePages(blob: Blob, pages: readonly WordEnclosurePage[], signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  if (!pages.length) return blob;
  if (pages.length > WORD_ENCLOSURE_LIMITS.pages || blob.size > WORD_ENCLOSURE_LIMITS.outputBytes) throw new Error('The Word document exceeds the enclosure delivery limit.');
  let imageBytes = 0;
  for (const page of pages) {
    imageBytes += page.bytes.byteLength;
    if (!page.bytes.byteLength || imageBytes > WORD_ENCLOSURE_LIMITS.imageBytes || ![page.width, page.height].every(size => Number.isFinite(size) && size >= 72 && size <= 1584)) throw new Error('A Word enclosure page has unsupported dimensions or image size.');
  }
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const document = zip.file('word/document.xml'), relationships = zip.file('word/_rels/document.xml.rels'), contentTypes = zip.file('[Content_Types].xml');
  if (!document || !relationships || !contentTypes) throw new Error('Word output is missing a required document part.');
  let xml = await document.async('string'), rels = await relationships.async('string'), types = await contentTypes.async('string');
  if (!rels.includes('</Relationships>') || !types.includes('</Types>')) throw new Error('Word output has malformed relationship or content-type parts.');
  const sections = [...xml.matchAll(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g)];
  const section = sections.at(-1);
  if (!section || !/<\/w:sectPr>\s*<\/w:body>/.test(xml) || xml.includes('DonDocsEnclosurePage')) throw new Error('The Word document has unsupported enclosure section structure.');
  const additions: string[] = [];
  const relation = (id: string, type: string, target: string) => {
    if (rels.includes(`Id="${id}"`)) throw new Error('Word enclosure relationships collide with existing content.');
    additions.push(`<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`);
  };
  for (const kind of ['header', 'footer'] as const) {
    const filename = `dondocs-enclosure-${kind}.xml`;
    if (zip.file(`word/${filename}`)) throw new Error('Word enclosure parts already exist.');
    zip.file(`word/${filename}`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind === 'header' ? 'hdr' : 'ftr'} xmlns:w="${W}"><w:p/></w:${kind === 'header' ? 'hdr' : 'ftr'}>`);
    relation(`rIdDonDocsEnclosure${kind}`, kind, filename);
    types = types.replace('</Types>', `<Override PartName="/word/${filename}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/></Types>`);
  }
  const next = ['header', 'footer'].flatMap(kind => ['default', 'first', 'even'].map(type => `<w:${kind}Reference w:type="${type}" r:id="rIdDonDocsEnclosure${kind}"/>`)).join('');
  const pageSections: string[] = [];
  for (const [index, page] of pages.entries()) {
    signal.throwIfAborted();
    const path = `media/dondocs-enclosure-${index + 1}.png`, id = `rIdDonDocsEnclosurePage${index + 1}`;
    if (zip.file(`word/${path}`)) throw new Error('A Word enclosure image path already exists.');
    zip.file(`word/${path}`, new Uint8Array(page.bytes)); relation(id, 'image', path);
    const cx = Math.round(page.width * 12700), cy = Math.round(page.height * 12700);
    const drawing = `<w:r><w:drawing><wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${230000 + index}" name="DonDocsEnclosurePage${index + 1}" descr="Enclosure page ${index + 1}; image copy, not editable text or a verified signature"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Enclosure page ${index + 1}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
    const pageGeometry = `<w:sectPr>${next}<w:type w:val="nextPage"/><w:pgSz w:w="${Math.round(page.width * 20)}" w:h="${Math.round(page.height * 20)}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0"/></w:sectPr>`;
    // Every image owns a section, allowing portrait and landscape inputs.
    pageSections.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/>${index < pages.length - 1 ? pageGeometry : ''}</w:pPr>${drawing}</w:p>`);
    if (index === pages.length - 1) pageSections.push(pageGeometry);
  }
  const previousSection = section[0].replace(/<w:type\b[^>]*\/>/g, '');
  xml = xml.slice(0, section.index) + `<w:p><w:pPr>${previousSection}</w:pPr></w:p>` + pageSections.join('') + xml.slice(section.index! + section[0].length);
  rels = rels.replace('</Relationships>', `${additions.join('')}</Relationships>`);
  if (!/<Default\b[^>]*Extension="png"/.test(types)) types = types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  zip.file('word/document.xml', xml); zip.file('word/_rels/document.xml.rels', rels); zip.file('[Content_Types].xml', types);
  signal.throwIfAborted();
  const result = await zip.generateAsync({ type: 'blob', mimeType: blob.type, compression: 'DEFLATE' });
  if (result.size > WORD_ENCLOSURE_LIMITS.outputBytes) throw new Error('The Word document exceeds the 50 MB delivery limit. Use separate originals.');
  signal.throwIfAborted();
  return result;
}
