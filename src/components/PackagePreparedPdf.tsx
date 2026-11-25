import { lazy, Suspense, useState } from 'react';
import type { preparePackagePdfOutput } from '@/lib/actionPackageAssembly';
import { Button } from './ui/button';

const PdfViewer = lazy(() => import('./pdf/PdfViewer'));
type Output = Awaited<ReturnType<typeof preparePackagePdfOutput>>;

export function PackagePreparedPdf({ output, draft, hasSignedOriginal, onSendOriginals }: { output: Output & { url: string }; draft: boolean; hasSignedOriginal: boolean; onSendOriginals(): void }) {
  const [request, setRequest] = useState<{ page: number }>();
  const title = draft ? 'Draft PDF' : 'Combined PDF';
  return <section aria-label="Prepared PDF contents" className="space-y-3">
    <h4 className="font-medium">{title} · {output.pages} {output.pages === 1 ? 'page' : 'pages'} · {output.entries.length} {output.entries.length === 1 ? 'document' : 'documents'}</h4>
    {hasSignedOriginal && <p className="text-sm">This combined PDF is unsigned. <Button size="sm" variant="link" className="h-auto p-0" onClick={onSendOriginals}>Send the signed originals unchanged</Button></p>}
    <ol className="divide-y">{output.entries.map(entry => <li key={entry.memberId}>
      <Button size="sm" variant="link" onClick={() => setRequest({ page: entry.startPage })}>{entry.label} · {entry.pageCount === 1 ? 'Page ' + entry.startPage : 'Pages ' + entry.startPage + '–' + (entry.startPage + entry.pageCount - 1)}</Button>
    </li>)}</ol>
    <div className="h-[55dvh] min-h-72">
      <Suspense fallback={<p role="status">Opening prepared PDF…</p>}><PdfViewer key={output.url} pdfUrl={output.url} pageRequest={request}
        allowOpenInTab={false} showFullscreen={false} toolbarLabel={title} /></Suspense>
    </div>
  </section>;
}
