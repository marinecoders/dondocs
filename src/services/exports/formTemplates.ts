import { formTemplateFiles } from '@/services/forms/model';
import { loadOfficialPdfSource, officialPdfProfile } from '@/services/forms/officialPdfProfiles';
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
    for (const page of formTemplateFiles(definition)) pages[page.file] = new Uint8Array(await loadPackagePage(definition, page.file));
    return captureFormExportTemplates(content.kind, definition.formId, pages, JSON.stringify(definition));
  }
  const { formType, forms } = content.document;
  const edition = forms.officialPdfEdition;
  const profile = edition ? officialPdfProfile(formType, edition) : undefined;
  if (formType === 'navmc_10274' && profile)
    return captureFormExportTemplates(content.kind, formType, { official: new Uint8Array(await loadOfficialPdfSource(profile)) });
  const [printable, original] = await Promise.all([
    formType === 'navmc_10274' ? loadNavmc10274Templates() : loadNavmc11811Template(!!profile).then(page1 => ({ page1 })),
    profile ? loadOfficialPdfSource(profile) : undefined,
  ]);
  const pages = Object.fromEntries(Object.entries(printable).map(([name, bytes]) => [name, new Uint8Array(bytes)]));
  if (original) pages.official = new Uint8Array(original);
  return captureFormExportTemplates(content.kind, formType, pages);
}
