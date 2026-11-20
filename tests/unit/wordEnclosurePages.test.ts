import * as enclosureImages from '@/services/docx/enclosurePages';
import { renderPreparedCorrespondence } from '@/services/exports/correspondence';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { appendWordEnclosurePages, renderWordEnclosurePages, WORD_ENCLOSURE_LIMITS } from '@/services/docx/enclosurePages';
import { docxImageFixture } from '../_helpers/docxImageFixture';
import { loadAssemblyPdf } from '@/services/pdf/assemblyPdf';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { acknowledgePreparedExport, copyExportReview, prepareExport } from '@/lib/preparedExport';
import { validateLetter } from '../../companion/validateLetter';
vi.mock('@/services/pdf/assemblyPdf', async () => {
  const actual = await vi.importActual<typeof import('@/services/pdf/assemblyPdf')>('@/services/pdf/assemblyPdf');
  return { ...actual, loadAssemblyPdf: vi.fn(actual.loadAssemblyPdf) };
});
const signal = () => new AbortController().signal;
async function source() {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Retain my newer letter</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdOriginalHeader"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440"/></w:sectPr></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdOriginalHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>');
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file('word/header1.xml', '<w:hdr>Original marking remains with letter</w:hdr>');
  return new Blob([new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
beforeEach(() => { vi.clearAllMocks(); });
describe('Word PDF enclosure page images', () => {
  it('adds complete images, isolated page furniture and all required relationships without changing the source', async () => {
    const original = await source(), before = new Uint8Array(await original.arrayBuffer()), image = (await docxImageFixture()).figure;
    const result = await appendWordEnclosurePages(original, [{ bytes: image, width: 612, height: 792 }, { bytes: image, width: 792, height: 612 }], signal());
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(before);
    const zip = await JSZip.loadAsync(await result.arrayBuffer()), xml = await zip.file('word/document.xml')!.async('string'), rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    expect(xml).toContain('Retain my newer letter');
    expect(xml.match(/name="DonDocsEnclosurePage\d+"/g)).toHaveLength(2);
    expect(xml).toContain('w:w="15840" w:h="12240"');
    expect(xml.match(/r:id="rIdDonDocsEnclosureheader"/g)).toHaveLength(6);
    expect(xml).toContain('r:id="rIdOriginalHeader"');
    expect(await zip.file('word/dondocs-enclosure-header.xml')!.async('string')).not.toContain('Original marking');
    for (const [index] of [0, 1].entries()) {
      expect(rels).toContain(`Id="rIdDonDocsEnclosurePage${index + 1}"`);
      expect(await zip.file(`word/media/dondocs-enclosure-${index + 1}.png`)!.async('uint8array')).toEqual(new Uint8Array(image));
    }
    expect((await zip.file('[Content_Types].xml')!.async('string'))).toContain('image/png');
  });
  it('rejects omitted files, page limits, malformed input and cancelled work', async () => {
    await expect(renderWordEnclosurePages([{ number: 1, title: 'Missing' }], undefined, signal())).rejects.toThrow('Attach');
    const pdf = await PDFDocument.create();for (let index = 0; index <= WORD_ENCLOSURE_LIMITS.pages; index++) pdf.addPage();
    await expect(renderWordEnclosurePages([{ number: 1, title: 'Too long', data: new Uint8Array(await pdf.save()).buffer }], undefined, signal())).rejects.toThrow('50 pages');
    await expect(renderWordEnclosurePages([{ number: 1, title: 'Broken', data: new Uint8Array([1, 2, 3]).buffer }], undefined, signal())).rejects.toThrow();
    const controller = new AbortController();controller.abort();
    await expect(appendWordEnclosurePages(await source(), [], controller.signal)).rejects.toThrow();
    await expect(appendWordEnclosurePages(await source(), [{ bytes: new Uint8Array([1]), width: NaN, height: 792 }], signal())).rejects.toThrow('dimensions');
  });
  it('does not claim success when a raster renderer omits a captured page', async () => {
    const real = await vi.importActual<typeof import('@/services/pdf/assemblyPdf')>('@/services/pdf/assemblyPdf');
    vi.mocked(loadAssemblyPdf).mockImplementation(async (data, abort, options) => {
      if (options?.forcePageImages) return { pdf: await PDFDocument.create(), pageImages: true };
      return real.loadAssemblyPdf(data, abort, options);
    });
    const pdf = await PDFDocument.create();pdf.addPage().drawText('Retain this visible page');
    await expect(renderWordEnclosurePages([{ number: 1, title: 'Captured', data: new Uint8Array(await pdf.save()).buffer }], undefined, signal())).rejects.toThrow('every captured page');
    vi.mocked(loadAssemblyPdf).mockImplementation(real.loadAssemblyPdf);
  });
  it('binds the option to the captured Word operation and requires review of included original pages', () => {
    const captured = captureDocumentRevision({ documentId: 'source', epoch: 0, editSequence: 1, capturedAt: 1 }, { ...createBlankSession(), endItems: [], publicationTables: {}, enclosures: [{ title: 'Original PDF' }] });
    const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
    const result = prepareExport({ id: 'word-enclosures', captured, target: 'docx', filename: 'example.docx', policy, wordEnclosurePages: true });
    expect(result.status).toBe('needs-review');
    if (result.status !== 'needs-review') throw new Error('Expected original-page review');
    expect(copyExportReview(result.job).notices.join(' ')).toContain('noneditable images');
    expect(acknowledgePreparedExport(result.job).job.wordEnclosurePages).toBe(true);
    expect(prepareExport({ id: 'pdf-option', captured, target: 'pdf', filename: 'example.pdf', policy, wordEnclosurePages: true }).status).toBe('error');
    expect(validateLetter({ docType: 'naval_letter', subject: 'Example', paragraphs: [{ text: 'Body' }], wordEnclosurePages: true }).join(' ')).toContain('browser renderer');
  });
});

it('keeps Word-supported Unicode independent of PDF body-font qualification when including enclosures', async () => {
  const pdf = await PDFDocument.create();pdf.addPage().drawText('Original PDF');const data = new Uint8Array(await pdf.save()).buffer;
  const captured = captureDocumentRevision({ documentId: 'unicode', epoch: 0, editSequence: 1, capturedAt: 1 }, { ...createBlankSession(), endItems: [], publicationTables: {}, paragraphs: [{ text: '', level: 0, bodyTable: { rows: [['Heading'], ['訓練']], headerRows: 1 } }], enclosures: [{ title: 'Original PDF', file: { name: 'source.pdf', size: data.byteLength, data } }] });
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  const prepared = prepareExport({ id: 'unicode-word', captured, target: 'docx', filename: 'unicode.docx', policy, wordEnclosurePages: true });
  if (prepared.status !== 'needs-review') throw new Error('Expected original-content review');
  const render = vi.spyOn(enclosureImages, 'renderWordEnclosurePages').mockResolvedValue([]), convert = vi.fn(async (_latex: string) => new Blob(['synthetic unit converter']));
  try {
    await renderPreparedCorrespondence(acknowledgePreparedExport(prepared.job), { compile: async () => { throw new Error('Word must not compile PDF body text'); }, convertDocx: convert }, signal());
    expect(convert).toHaveBeenCalledOnce();expect(convert.mock.calls[0][0]).toContain('訓練');
    expect(render).toHaveBeenCalledOnce();
  } finally { render.mockRestore(); }
});
