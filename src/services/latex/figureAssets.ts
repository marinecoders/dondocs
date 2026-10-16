import { PDFDocument } from 'pdf-lib';
import type { GeneratedFiles } from './generator';

/** Figures support one sheet. Multi-sheet drawings belong in an enclosure. */
export async function validateFigureAsset(bytes: Uint8Array, name: string): Promise<void> {
  if (/\.pdf$/i.test(name)) {
    let pdf: PDFDocument;
    try { pdf = await PDFDocument.load(bytes); }
    catch { throw new Error(`Cannot read figure "${name}". Choose an unencrypted, valid PDF.`); }
    if (pdf.getPageCount() !== 1) {
      throw new Error(`Figure "${name}" has ${pdf.getPageCount()} pages. Use a single-page figure or attach the complete drawing as an enclosure.`);
    }
  } else {
    try {
      const pdf = await PDFDocument.create();
      if (/\.jpe?g$/i.test(name)) await pdf.embedJpg(bytes);
      else await pdf.embedPng(bytes);
    } catch { throw new Error(`Cannot read figure "${name}". Choose a valid PNG, JPEG, or single-page PDF.`); }
  }
}

export async function loadFigureFiles(
  files: Record<string, string | Uint8Array>,
  figures: GeneratedFiles['figures'],
  load: (id: string) => Promise<ArrayBuffer | Uint8Array | undefined | null>
): Promise<void> {
  const loaded: Record<string, Uint8Array> = {};
  for (const figure of figures) {
    const data = await load(figure.ref.id);
    if (!data) throw new Error(`Figure "${figure.ref.name}" is unavailable. Reattach it before generating the PDF.`);
    const bytes = new Uint8Array(data);
    await validateFigureAsset(bytes, figure.file);
    loaded[figure.file] = bytes;
  }
  Object.assign(files, loaded);
}

/** Check the current job, never the persistent engine filesystem. */
export async function validateFigureFiles(files: Record<string, string | Uint8Array>): Promise<void> {
  const body = files['body.tex'];
  if (typeof body !== 'string') return;
  const paths = new Set(body.match(/attachments\/figure-[A-Za-z0-9-]+\.(?:pdf|png|jpg)/g) ?? []);
  for (const path of paths) {
    const bytes = files[path];
    if (!(bytes instanceof Uint8Array)) throw new Error(`Figure asset ${path} is missing from this document. Reattach the image.`);
    await validateFigureAsset(bytes, path);
  }
}
