import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type { ActionPackage } from '@/lib/actionPackages';
import { MAX_PACKAGE_FILE_BYTES } from '@/lib/actionPackageTransfer';
import { preparePackageFormFeedbackImport, applyPreparedPackageFormFeedbackImport, type PreparedPackageFormFeedbackImport } from '@/lib/packageFormFeedbackImport';
import { getExportDeploymentPolicy } from '@/config/classification';
import { feedbackCategoryLabel } from '@/lib/reviewFeedback';
const button = 'h-auto min-h-9 max-w-full whitespace-normal';
export function PackageFormFeedbackImportPanel({ record, roundId, memberId, busy, run, signal, onApply }: {
  record: ActionPackage; roundId: string; memberId: string; busy: boolean;
  run(action: () => Promise<void>): Promise<void>; signal?(): AbortSignal | undefined; onApply(record: ActionPackage): void;
}) {
  const [json, setJson] = useState(''), [choices, setChoices] = useState<Record<string, 'current' | 'returned'>>({});
  const [prepared, setPrepared] = useState<PreparedPackageFormFeedbackImport | null>(null), [approved, setApproved] = useState(false), [error, setError] = useState('');
  const alive = useRef(false), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function perform(action: (current: () => boolean) => Promise<void>) {
    const epoch = generation.current;
    try { await run(async () => { if (alive.current && generation.current === epoch) await action(() => alive.current && generation.current === epoch); }); }
    catch (cause) { if (alive.current && generation.current === epoch) setError(cause instanceof Error ? cause.message : 'Returned feedback could not be prepared.'); }
  }
  async function review(text: string, current: () => boolean, selectedChoices = choices) {
    const value = await preparePackageFormFeedbackImport(record, roundId, memberId, text, await getExportDeploymentPolicy(), selectedChoices);
    if (current()) { setPrepared(value); setApproved(false); }
  }
  return <details className="min-w-0 space-y-2 rounded border p-2 text-sm">
    <summary className="cursor-pointer font-medium">Collect returned form feedback</summary>
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">Collect discussion and typed proposals for this exact form. Saving feedback preserves the latest answers; decide corrections below.</p>
    <label className="block">Package feedback return<input aria-label="Collect form feedback return" type="file" accept=".json" disabled={busy} className="mt-1 block w-full min-w-0" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      generation.current++; setJson(''); setPrepared(null); setApproved(false); setChoices({}); setError('');
      void perform(async current => {
        if (file.size > MAX_PACKAGE_FILE_BYTES) throw new Error('Package feedback files are limited to 100 MB.');
        const text = await file.text(); if (!current()) return; setJson(text); await review(text, current, {});
      });
    }} /></label>
    {json && <Button className={button} variant="outline" disabled={busy} onClick={() => void perform(current => review(json, current))}>Review returned form feedback</Button>}
    {prepared && <div className="min-w-0 space-y-2">
      <p>{prepared.comments} field comments · {prepared.proposals} typed proposals</p>
      {prepared.conflicts.map(conflict => <div key={conflict.id} className="min-w-0 space-y-1 rounded border p-2">
        <p className="font-medium break-words">Discussion overlap: {conflict.label}</p>
        <p className="break-words">Current: {feedbackCategoryLabel(conflict.current.category)} · {conflict.current.resolved ? 'Resolved' : 'Open'}</p>
        <p className="whitespace-pre-wrap break-words">Current: {conflict.current.messages.map(message => `${message.author}: ${message.text}`).join('\n')}</p>
        <p className="break-words">Returned: {feedbackCategoryLabel(conflict.returned.category)} · {conflict.returned.resolved ? 'Resolved' : 'Open'}</p>
        <p className="whitespace-pre-wrap break-words">Returned: {conflict.returned.messages.map(message => `${message.author}: ${message.text}`).join('\n')}</p>
        <label className="block">Discussion version<select aria-label={`Returned form discussion ${conflict.id}`} className="mt-1 block w-full min-w-0 rounded border bg-background p-2" disabled={busy} value={choices[conflict.id] ?? ''} onChange={event => {
          generation.current++; setApproved(false); const value = event.target.value; const next = { ...choices }; if (value) next[conflict.id] = value as 'current' | 'returned'; else delete next[conflict.id]; setChoices(next);
        }}><option value="">Choose and review again</option><option value="current">Keep current discussion</option><option value="returned">Use returned discussion deliberately</option></select></label>
      </div>)}
      {prepared.reviews.map((value, index) => <div key={index} className="space-y-1 text-xs">{value.notices.map((notice, ordinal) => <p key={ordinal} className="whitespace-pre-wrap break-words">{notice}</p>)}{value.privacy.findings.map((finding, ordinal) => <p key={ordinal} className="break-words">{finding.type}: {finding.value}</p>)}</div>)}
      <label className="flex items-start gap-2"><input type="checkbox" disabled={busy || !prepared.ready} checked={approved} onChange={event => setApproved(event.target.checked)} />I reviewed the returned field feedback, discussion choices and privacy findings.</label>
      <Button className={button} disabled={busy || !prepared.ready || !approved} onClick={() => void perform(async current => {
        const result = await applyPreparedPackageFormFeedbackImport(prepared, await getExportDeploymentPolicy(), approved, signal?.(), current);
        if (current()) onApply(result);
      })}>Save bound form feedback</Button>
    </div>}
  </details>;
}
