import { copyCapturedDocument, type CapturedDocument } from '@/lib/capturedDocument';
import { applyPlaceholdersToNavmc11811, buildNavmc11811DefaultValues } from '@/lib/placeholders';
import { publicationMarking } from '@/lib/publicationMarking';
import { correspondencePortions, projectRenderedDocument } from '@/lib/renderedDocument';
import { windowEnvelopeProblems } from '@/lib/windowEnvelope';
import { renderCorrespondencePdf, type CorrespondenceRendererPorts } from '@/services/exports/correspondence';
import { renderForm } from '@/services/forms/render';
import { generateNavmc10274Pdf, loadNavmc10274Templates } from './navmc10274Generator';
import { generateNavmc11811Pdf, loadNavmc11811Template } from './navmc11811Generator';

export interface PrintRenderer {
  compile: CorrespondenceRendererPorts['compile'];
  waitForReady(timeoutMs?: number): Promise<boolean>;
}

/** Print the captured draft through the PDF renderers without reading the
 * live editor or requiring a completed form. */
export async function renderDocumentForPrint(captured: CapturedDocument, { compile, waitForReady }: PrintRenderer, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const content = copyCapturedDocument(projectRenderedDocument(captured));
  if (content.kind === 'configured-form') {
    return (await renderForm(content.document.genericForm, 'preview')).bytes;
  }
  if (content.kind === 'builtin-form') {
    const { formType, forms } = content.document;
    if (formType === 'navmc_10274') {
      const { page1, page2, page3 } = await loadNavmc10274Templates();
      signal.throwIfAborted();
      return generateNavmc10274Pdf(forms.navmc10274!, page1, page2, page3, { includeCoverPage: forms.includeCoverPage });
    }
    const template = await loadNavmc11811Template();
    signal.throwIfAborted();
    const form = forms.navmc11811!;
    return generateNavmc11811Pdf(applyPlaceholdersToNavmc11811(form, buildNavmc11811DefaultValues(form)), template);
  }

  const { document } = content;
  const portions = correspondencePortions(document);
  const windowIssues = windowEnvelopeProblems(document.docType, document.formData, portions, document.enclosures);
  if (windowIssues.length) throw new Error(windowIssues.join(' '));
  const referenceDate = new Date(captured.source.capturedAt);
  const marking = publicationMarking(document.formData, portions);
  const render = async () => {
    if (!await waitForReady(30_000)) throw new Error('The PDF engine did not become ready. Check the preview, then try printing again.');
    signal.throwIfAborted();
    return renderCorrespondencePdf(document, { referenceDate, marking }, { compile }, signal);
  };
  let result: Awaited<ReturnType<typeof render>>;
  try { result = await render(); }
  catch (error) {
    if (signal.aborted || !(error instanceof Error) || error.message !== 'ENGINE_RESET_NEEDED') throw error;
    result = await render();
  }
  if (result.errors.length) throw new Error(result.errors.map(issue => `${issue.title}: ${issue.error}`).join('\n'));
  return result.pdfBytes;
}
