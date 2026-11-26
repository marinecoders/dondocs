import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { readConditionalPackageTemplate } from '@/lib/packageConditionalSources';
import { getPackageRevision, type ActionPackage } from '@/lib/actionPackages';
import { conditionalPackageAnswers } from '@/lib/packageConditional';
import { intakeQuestionKey } from '@/lib/conditionalIntakeView';
import { nextMembershipQuestion } from '@/lib/packageTemplateProgram';
import { desktopPackageBlank, readPackageBlank } from '@/lib/packageBlankForms';
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';
import { Button } from './ui/button';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

const PdfViewer = lazy(() => import('./pdf/PdfViewer'));
type Blank = { name: string; data: string };

export function PackageRecipeDocuments({ record, revisionId, onCompleteDetails, onAttach, onOpen }: {
  record: ActionPackage; revisionId: string; onCompleteDetails?: (question: string) => void;
  onAttach?: (memberId: string, file: File, signed: boolean) => void;
  onOpen?: (memberId: string) => void;
}) {
  const revision = useMemo(() => getPackageRevision(record, revisionId), [record, revisionId]);
  const [signed, setSigned] = useState<Record<string, boolean>>({});
  const [returns, setReturns] = useState<{memberId: string; label: string; blank: Blank}[]>([]);
  const [question, setQuestion] = useState<string>();
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
      const rows = (revision.templateState?.instances ?? []).flatMap(slot => {
        const member = template.members.find(item => item.key === slot.memberKey);
        return slot.condition === true && member?.kind === 'attachment' && member.blankPdf &&
          desktopPackageBlank(member.completion?.blankSha256) ? [{ memberId: slot.memberId, label: slot.label, blank: member.blankPdf }] : [];
      });
      setReturns(rows);
      for (const member of template.members) {
        const blank = member.blankPdf;
        if (blank && !rows.some(row => row.blank.data === blank.data) && !unique.some(item => item.name === blank.name && item.data === blank.data)) unique.push(blank);
      }
      const next = nextMembershipQuestion(template.program, conditionalPackageAnswers(record, revisionId), template.members);
      setQuestion(next && intakeQuestionKey(next));
      setBlanks(unique);
    }).catch(() => { if (active) setError('The saved package forms could not be opened.'); });
    return () => { active = false; };
  }, [record, revisionId, revision]);

  async function download(blank: Blank) {
    const download = reserveSigningPdfDownload();
    try {
      setError('');
      const bytes = await readPackageBlank(blank);
      if (!await download.deliver(new Uint8Array(bytes), blank.name)) setError('The form download was interrupted.');
    } catch { setError('This saved form could not be downloaded.'); }
    finally { download.release(); }
  }

  return <>
    {question && onCompleteDetails && <Button size="sm" variant="outline" onClick={() => onCompleteDetails(question)}>Complete package details</Button>}
    {returns.map(row => {
      const saved = revision.members.find(member => member.id === row.memberId);
      return <section key={row.memberId} aria-label={row.label} className="space-y-2 border-b pb-3">
        <h3 className="font-medium">{row.label}</h3>
        <Button variant="link" onClick={() => void download(row.blank)}>Download blank</Button>
        {saved ? <Button variant="outline" onClick={() => onOpen?.(row.memberId)}>View returned PDF</Button>
          : onAttach && <><label className="block text-sm"><input type="checkbox" checked={!!signed[row.memberId]}
            onChange={event => setSigned({ ...signed, [row.memberId]: event.target.checked })} /> Original is signed</label>
          <label className="block text-sm">Attach completed original
            <input type="file" accept=".pdf,application/pdf" className="block" onChange={event => {
              const file = event.target.files?.[0]; event.target.value = '';
              if (file) onAttach(row.memberId, file, !!signed[row.memberId]);
            }} />
          </label></>}
      </section>;
    })}
    {(blanks.length > 0 || error) && <section aria-label="Blank forms and guides" className="space-y-2">
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
  </section>}
  </>;
}
