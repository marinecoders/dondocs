import { lazy, Suspense, useEffect, useState } from 'react';
import { readConditionalPackageTemplate } from '@/lib/packageConditionalSources';
import type { ActionPackage } from '@/lib/actionPackages';
import { readPackageBlank } from '@/lib/packageBlankForms';
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';
import { Button } from './ui/button';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

const PdfViewer = lazy(() => import('./pdf/PdfViewer'));
type Blank = { name: string; data: string };

export function PackageBlankPdfs({ record, revisionId }: { record: ActionPackage; revisionId: string }) {
  const [blanks, setBlanks] = useState<Blank[]>([]);
  const [selected, setSelected] = useState<Blank>();
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!selected) return;
    let closed = false;
    let objectUrl: string | undefined;
    void readPackageBlank(selected).then(bytes => {
      if (closed) return;
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      setUrl(objectUrl);
    }).catch(() => { if (!closed) { setSelected(undefined); setError('This reference could not be opened.'); } });
    return () => { closed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selected]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    readConditionalPackageTemplate(record, revisionId).then(template => {
      if (!active) return;
      const unique: Blank[] = [];
      for (const member of template.members) {
        const blank = member.blankPdf;
        if (blank && !unique.some(item => item.name === blank.name && item.data === blank.data)) unique.push(blank);
      }
      setBlanks(unique);
    }).catch(() => { if (active) setError('The saved package forms could not be opened.'); });
    return () => { active = false; };
  }, [record, revisionId]);

  async function download(blank: Blank) {
    const download = reserveSigningPdfDownload();
    try {
      setError('');
      const bytes = await readPackageBlank(blank);
      if (!await download.deliver(new Uint8Array(bytes), blank.name)) setError('The form download was interrupted.');
    } catch { setError('This saved form could not be downloaded.'); }
    finally { download.release(); }
  }

  if (!blanks.length && !error) return null;
  return <section aria-label="Blank forms and guides" className="space-y-2">
    <h3 className="font-medium">Blank forms and guides</h3>
    <p className="text-sm text-muted-foreground">Read the captured references here. Open working documents from the document list.</p>
    <ul>{blanks.map((blank, index) => <li key={index}><Button variant="link" className="h-auto whitespace-normal px-0 text-left" onClick={() => { setError(''); setUrl(''); setSelected(blank); }}>
      {blank.name}</Button></li>)}</ul>
    {selected && <Dialog open onOpenChange={open => { if (!open) setSelected(undefined); }}>
      <DialogContent fullscreen className="flex flex-col gap-2 p-3">
        <DialogTitle className="pr-10">{selected.name}</DialogTitle>
        <DialogDescription className="sr-only">Original reference saved with this package revision.</DialogDescription>
        <Button variant="outline" className="self-start" onClick={() => void download(selected)}>Download original</Button>
        {!url && <p role="status">Opening PDF…</p>}
        {url && <Suspense fallback={<p>Opening PDF…</p>}><PdfViewer pdfUrl={url} className="min-h-0 flex-1" showFullscreen={false} /></Suspense>}
      </DialogContent>
    </Dialog>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
