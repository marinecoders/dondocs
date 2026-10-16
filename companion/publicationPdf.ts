import { publicationMarking } from '../src/lib/publicationMarking';
import { formatPublicationDate } from '../src/lib/publicationDate';
import { mergeEnclosures } from '../src/services/pdf/mergeEnclosures';
import { addSignatureField } from '../src/services/pdf/addSignatureField';
import type { GeneratedFiles } from '../src/services/latex/generator';
import type { GeneratorStore } from './letterInput';

// The shared enclosure merger keeps a page map for the current document.
// Serialize assembly so simultaneous tool calls cannot share that map.
let assembly: Promise<void> = Promise.resolve();

export function assemblePublicationPdf(pdf: Uint8Array, generated: GeneratedFiles, store: GeneratorStore): Promise<Uint8Array> {
  const result = assembly.then(async () => {
    const merged = await mergeEnclosures(pdf, generated.enclosures,
      publicationMarking(store.formData, store.paragraphs), generated.includeHyperlinks, generated.referenceUrls,
      { enclosureLabel: 'footer', header: { line1: store.formData.shortTitle ?? '', line2: formatPublicationDate(store.formData.date ?? '') } });
    if (merged.hasErrors) throw new Error(merged.errors.map((error) => error.error).join('\n'));
    return addSignatureField(merged.pdfBytes, {
      lastBasicPageIndex: merged.basicPageCount === undefined ? undefined : merged.basicPageCount - 1,
    });
  });
  assembly = result.then(() => {}, () => {});
  return result;
}
