import { loadPackagePage } from '@/services/forms/packages';
import { copyCapturedDocument, type CapturedDocument } from '@/lib/capturedDocument';
import { captureFormExportTemplates } from '@/lib/formExportTemplates';
import { loadNavmc10274Templates } from '@/services/pdf/navmc10274Generator';
import { loadNavmc11811Template } from '@/services/pdf/navmc11811Generator';

/** Capture only the selected form's templates; the editor is never consulted. */
export async function captureExportFormTemplates(captured: CapturedDocument) {
  const content = copyCapturedDocument(captured);
  if (content.kind === 'correspondence') return undefined;
  if (content.kind === 'configured-form') {
    const definition = content.document.genericForm.definition;
    const pages: Record<string, Uint8Array> = {};
    for (const page of definition.pages) pages[page.file] = new Uint8Array(await loadPackagePage(definition, page.file));
    return captureFormExportTemplates(content.kind, definition.formId, pages, JSON.stringify(definition));
  }
  if (content.document.formType === 'navmc_10274') {
    const pages = await loadNavmc10274Templates();
    return captureFormExportTemplates(content.kind, content.document.formType, Object.fromEntries(Object.entries(pages).map(([name, bytes]) => [name, new Uint8Array(bytes)])));
  }
  return captureFormExportTemplates(content.kind, content.document.formType, { page1: new Uint8Array(await loadNavmc11811Template()) });
}
