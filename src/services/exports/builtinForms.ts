import { copyPreparedDocument, copyPreparedFormTemplates, type ReadyExportJob } from '@/lib/preparedExport';
import { createExportArtifact } from '@/lib/exportExecution';
import { generateNavmc10274Pdf } from '@/services/pdf/navmc10274Generator';
import { generateNavmc11811Pdf } from '@/services/pdf/navmc11811Generator';

export async function renderPreparedBuiltinForm(ready: ReadyExportJob, signal: AbortSignal) {
  const content = copyPreparedDocument(ready);
  if (content.kind !== 'builtin-form' || ready.job.target !== 'pdf') throw new Error('This renderer accepts built-in form PDF jobs.');
  const pages = copyPreparedFormTemplates(ready);
  const { forms, formType } = content.document;
  if (signal.aborted) throw new Error('Export cancelled.');
  const page = (name: string) => {
    if (!pages[name]) throw new Error(`Form template missing: ${name}`);
    return new Uint8Array(pages[name]).buffer;
  };
  const bytes = formType === 'navmc_10274'
    ? await generateNavmc10274Pdf(forms.navmc10274!, page('page1'), page('page2'), page('page3'), { includeCoverPage: forms.includeCoverPage })
    : await generateNavmc11811Pdf(forms.navmc11811!, page('page1'));
  if (signal.aborted) throw new Error('Export cancelled.');
  return createExportArtifact(ready, new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
}
