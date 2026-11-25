import { loadAssemblyPdf } from '@/services/pdf/assemblyPdf';
import { copyPreparedDocument, copyPreparedFormTemplates, type ReadyExportJob } from '@/lib/preparedExport';
import { createExportArtifact } from '@/lib/exportExecution';
import { renderForm } from '@/services/forms/render';

export async function renderPreparedConfiguredForm(ready: ReadyExportJob, signal: AbortSignal, mode: 'editable' | 'printable' = 'editable') {
  const content = copyPreparedDocument(ready);
  if (content.kind !== 'configured-form' || ready.job.target !== 'pdf') throw new Error('This renderer accepts configured form PDF jobs.');
  const pages = copyPreparedFormTemplates(ready);
  if (signal.aborted) throw new Error('Export cancelled.');
  const result = await renderForm(content.document.genericForm, 'export', async (_directory, file) => {
    if (signal.aborted) throw new Error('Export cancelled.');
    if (!Object.hasOwn(pages, file)) throw new Error(`Captured form template missing: ${file}`);
    return new Uint8Array(pages[file]);
  });
  if (signal.aborted) throw new Error('Export cancelled.');
  if (mode === 'printable' && content.document.genericForm.definition.nativePdfEdition) {
    const { pdf } = await loadAssemblyPdf(result.bytes, signal);
    result.bytes = await pdf.save();
    signal.throwIfAborted();
  }
  return createExportArtifact(ready, new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' }));
}
