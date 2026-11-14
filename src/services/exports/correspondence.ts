import { resolveSignature } from '@/lib/signatureAssets';
import { copyPreparedDocument, preparedExportMarking, type ReadyExportJob } from '@/lib/preparedExport';
import { createExportArtifact, type ExportArtifact } from '@/lib/exportExecution';
import { withAttachmentResources, copyAttachment } from '@/lib/attachmentResources';
import type { StoredAttachment } from '@/lib/documentsDb';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { loadFigureFiles } from '@/services/latex/figureAssets';
import { finishCorrespondencePdf } from '@/services/pdf/finishCorrespondencePdf';
import type { DocxConversionOptions, DocxProgressCallback } from '@/services/docx/pandoc-converter';
import { resolvePageNumbering } from '@/lib/pageNumbering';
import { pageStartNumber } from '@/lib/endorsement';
import { inspectRasterImage, prepareDocxImages, supportsCorrespondenceSignatureImage } from '@/services/docx/imageAssets';

export interface ExportAssets {
  withAssets<T>(ids: readonly string[], operation: (read: (id: string) => StoredAttachment) => Promise<T>): Promise<T>;
}
export const storedExportAssets: ExportAssets = {
  withAssets: (ids, operation) => withAttachmentResources(ids, scope => operation(id => copyAttachment(scope, id))),
};
export type CorrespondenceRenderPhase = 'pdf-compiling' | 'pdf-merging-enclosures' | 'pdf-saving' | 'docx-preparing';
export interface CorrespondenceRendererPorts {
  compile(files: Record<string, string | Uint8Array>): Promise<Uint8Array | null>;
  convertDocx(latex: string, options: DocxConversionOptions, onProgress?: DocxProgressCallback): Promise<Blob>;
  assets?: ExportAssets;
  onDocxProgress?: DocxProgressCallback;
  onProgress?: (phase: CorrespondenceRenderPhase) => void | Promise<void>;
}
function observeProgress<T>(observer: ((phase: T) => unknown) | undefined, phase: T): void {
  try { void Promise.resolve(observer?.(phase)).catch(() => {}); } catch { /* Observers do not own rendering. */ }
}
function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Export cancelled.');
}

/** Render only an approved, owned model. Resource callbacks outlive the worker
 * and expire after assembly; delivery belongs to the execution owner.
 */
export async function renderPreparedCorrespondence(ready: ReadyExportJob, ports: CorrespondenceRendererPorts, signal: AbortSignal): Promise<ExportArtifact> {
  const captured = copyPreparedDocument(ready);
  if (captured.kind !== 'correspondence') throw new Error('This renderer accepts correspondence jobs.');
  const document = captured.document;
  if (ready.job.target !== 'docx' && document.formData.signatureType === 'image' && supportsCorrespondenceSignatureImage(document.docType)) document.formData.signatureImage = await resolveSignature(document.formData.signatureImage);
  const referenceDate = new Date(ready.job.source.capturedAt);
  const { target, texMode } = ready.job;
  const marking = preparedExportMarking(ready);
  const resolvedLevel = document.formData.classLevel ?? 'unclassified';
  const { compile, convertDocx, onProgress, onDocxProgress } = ports;
  const reportProgress = (phase: CorrespondenceRenderPhase) => {
    observeProgress(onProgress, phase);
    checkCancellation(signal);
  };
  checkCancellation(signal);
  if (target === 'docx') {
    reportProgress('docx-preparing');
    const data = document.formData;
    const figureIds = document.paragraphs.flatMap(paragraph => paragraph.figure?.fileRef ? [paragraph.figure.fileRef.id] : []);
    if (data.signatureType === 'image' && !data.signatureImage?.data && data.signatureImage?.fileRef) figureIds.push(data.signatureImage.fileRef.id);
    return (ports.assets ?? storedExportAssets).withAssets(figureIds, async read => {
      const mediaFiles = await prepareDocxImages(document, async id => read(id).data);
      checkCancellation(signal);
      const blob = await convertDocx(generateFlatLatex(document, resolvedLevel), {
        mediaFiles,
        docType: document.docType, sealType: data.sealType, letterheadColor: data.letterheadColor,
        fontFamily: data.fontFamily, fontSize: data.fontSize, classLevel: resolvedLevel, customClassification: data.customClassification,
        showSubjectOnContinuation: data.showSubjectOnContinuation,
        pageNumbering: resolvePageNumbering(document.docType, document.documentMode, data.pageNumbering),
        startingPageNumber: pageStartNumber(document.docType, data.startingPageNumber),
      }, onDocxProgress ? phase => observeProgress(onDocxProgress, phase) : undefined);
      checkCancellation(signal);
      return createExportArtifact(ready, blob);
    });
  }
  if (target === 'tex') {
    const text = texMode === 'flat' ? generateFlatLatex(document, resolvedLevel, 'tex')
      : `% DonDocs configuration fragments. Templates and binary assets are transferred separately.\n% Captured: ${new Date(ready.job.source.capturedAt).toISOString()}\n\n`
        + Object.entries(generateAllLatexFiles(document, resolvedLevel, referenceDate).texFiles).map(([name, contents]) => `% ===== ${name} =====\n${contents}`).join('\n');
    return createExportArtifact(ready, new Blob([text], { type: 'text/plain' }));
  }
  const ids = new Set<string>();
  if (document.docType === 'new_page_endorsement' && document.formData.basicLetterFileRef && !document.formData.basicLetterFile?.data) ids.add(document.formData.basicLetterFileRef.id);
  for (const enclosure of document.enclosures) if (enclosure.fileRef && !enclosure.file?.data) ids.add(enclosure.fileRef.id);
  for (const paragraph of document.paragraphs) if (paragraph.figure?.fileRef) ids.add(paragraph.figure.fileRef.id);
  const assets = ports.assets ?? storedExportAssets;
  return assets.withAssets([...ids], async read => {
    checkCancellation(signal);
    if (document.docType === 'new_page_endorsement' && document.formData.basicLetterFileRef && !document.formData.basicLetterFile?.data) {
      const ref = document.formData.basicLetterFileRef;
      const record = read(ref.id);
      document.formData.basicLetterFile = { name: record.name, size: record.data.byteLength, data: record.data };
    }
    for (const enclosure of document.enclosures) {
      if (enclosure.fileRef && !enclosure.file?.data) {
        const record = read(enclosure.fileRef.id);
        enclosure.file = { name: record.name, size: record.data.byteLength, data: record.data };
      } else if ((enclosure as { hasFile?: boolean }).hasFile && !enclosure.file) throw new Error(`Reattach enclosure “${enclosure.title}” before export.`);
    }
    const generated = generateAllLatexFiles(document, resolvedLevel, referenceDate);
    const files: Record<string, string | Uint8Array> = { ...generated.texFiles };
    if (generated.signatureImage) files['attachments/signature.png'] = generated.signatureImage;
    await loadFigureFiles(files, generated.figures, async id => {
      const bytes = new Uint8Array(read(id).data);
      if (document.docType === 'business_letter') {
        const figure = generated.figures.find(figure => figure.ref.id === id)!;
        await inspectRasterImage(bytes, figure.file.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
      }
      return bytes;
    });
    checkCancellation(signal);
    reportProgress('pdf-compiling');
    const pdf = await compile(files);
    // A cancelled worker is still awaited before releasing its resource set.
    checkCancellation(signal);
    if (!pdf) throw new Error('The PDF engine produced no document.');
    reportProgress('pdf-merging-enclosures');
    const finished = await finishCorrespondencePdf(pdf, document.docType, document.formData, generated, document.paragraphs, { marking, referenceDate });
    checkCancellation(signal);
    reportProgress('pdf-saving');
    return createExportArtifact(ready, new Blob([new Uint8Array(finished.pdfBytes)], { type: 'application/pdf' }), finished.errors.map(error => ({ message: error.error, asset: error.title })));
  });
}
