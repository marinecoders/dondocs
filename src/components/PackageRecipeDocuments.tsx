import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { readConditionalPackageTemplate } from '@/lib/packageConditionalSources';
import { getPackageRevision, type ActionPackage } from '@/lib/actionPackages';
import { conditionalPackageAnswers, listConditionalPackageInstances } from '@/lib/packageConditional';
import { intakeQuestionKey } from '@/lib/conditionalIntakeView';
import { nextMembershipQuestion } from '@/lib/packageTemplateProgram';
import { desktopPackageBlank, readPackageBlank } from '@/lib/packageBlankForms';
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';
import { Button } from './ui/button';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

const PdfViewer = lazy(() => import('./pdf/PdfViewer'));
type Blank = { name: string; data: string };

export function PackageRecipeDocuments({ record, revisionId, onCompleteDetails, onAttach, onOpen, onIntakeSlot }: {
  record: ActionPackage; revisionId: string; onCompleteDetails?: (question: string) => void;
  onAttach?: (memberId: string, files: File[], signed: boolean) => void;
  onIntakeSlot?: (key: string) => void;
  onOpen?: (memberId: string) => void;
}) {
  const revision = useMemo(() => getPackageRevision(record, revisionId), [record, revisionId]);
  const [signed, setSigned] = useState<Record<string, boolean>>({});
  const [slots, setSlots] = useState<{key: string; memberId?: string; label: string; multiple: boolean; blank?: Blank}[]>([]);
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
      const answers = conditionalPackageAnswers(record, revisionId);
      const rows = listConditionalPackageInstances(template, answers).flatMap(slot => {
        const instance = revision.templateState?.instances.find(item => item.key === slot.key && item.condition === true);
        const memberId = instance?.memberId;
        const member = template.members.find(item => item.key === slot.memberKey);
        if (slot.condition !== true || member?.kind !== 'attachment') return [];
        const blank = desktopPackageBlank(member.completion?.blankSha256) ? member.blankPdf : undefined;
        const exists = revision.members.some(item => item.id === memberId);
        return exists && !member.multipleFiles && !blank ? [] : [{ key: slot.key, memberId, label: slot.label, multiple: !!member.multipleFiles, blank }];
      });
      setSlots(rows);
      for (const member of template.members) {
        const blank = member.blankPdf;
        if (blank && !rows.some(row => row.blank?.data === blank.data) && !unique.some(item => item.name === blank.name && item.data === blank.data)) unique.push(blank);
      }
      const next = nextMembershipQuestion(template.program, answers, template.members);
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
    {slots.length > 0 && <ul aria-label="Document requirements" className="divide-y">
      {slots.map(row => {
        const memberId = row.memberId;
        const files = !memberId ? [] : revision.members.filter(member => member.id === row.memberId || member.kind === 'original' && member.evidenceSlotId === row.memberId);
        const upload = row.multiple ? 'Add files' : row.blank ? 'Attach completed original' : 'Add PDF';
        return <li key={row.key} className="flex flex-wrap items-center justify-between gap-3 py-2">
          <div className="min-w-0"><span className="break-words text-sm font-medium">{row.label}</span>
            {row.multiple && files.length > 0 && <details className="text-sm"><summary>{files.length} {files.length === 1 ? 'file' : 'files'}</summary>
              {files.map(member => <Button key={member.id} variant="link" onClick={() => onOpen?.(member.id)}>{member.kind === 'original' ? member.original.name : member.label}</Button>)}</details>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {row.blank && <Button variant="link" size="sm" onClick={() => void download(row.blank!)}>Download blank</Button>}
            {!row.multiple && files.length > 0 ? <Button variant="outline" size="sm" onClick={() => memberId && onOpen?.(memberId)}>View returned PDF</Button>
              : !memberId ? onIntakeSlot && <Button size="sm" variant="outline" onClick={() => onIntakeSlot(row.key)}>{upload}</Button>
              : onAttach && <>
                {row.blank && <label className="text-xs"><input type="checkbox" checked={!!signed[row.key]}
                  onChange={event => setSigned({ ...signed, [row.key]: event.target.checked })} /> Original is signed</label>}
                <label className="relative cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium focus-within:ring-2">
                  {upload}<input type="file" aria-label={upload + ' for ' + row.label} multiple={row.multiple} accept=".pdf,application/pdf"
                    className="absolute inset-0 w-full cursor-pointer opacity-0" onChange={event => {
                      const files = Array.from(event.target.files ?? []); event.target.value = '';
                      if (files.length) onAttach(memberId, files, !!signed[row.key]);
                    }} />
                </label>
              </>}
          </div>
        </li>;
      })}
    </ul>}
    {(blanks.length > 0 || error) && <section aria-label="Blank forms and guides" className="space-y-2">
    <h3 className="font-medium">Blank forms and guides</h3>
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
