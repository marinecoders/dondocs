import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getExportDeploymentPolicy } from '@/config/classification';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore, captureDocumentTarget } from '@/stores/documentsStore';
import { supportsReviewComments } from '@/lib/reviewCommentTargets';
import { listReviewRounds, MAX_REVIEW_COPY_BYTES, type ReviewRound } from '@/lib/reviewRounds';
import { buildReviewCopy, downloadReviewCopy, initialReviewLabel, openReviewCopy, parseReviewCopy,
  prepareReviewCopyExport, startReviewRound, type PreparedReviewCopy, type ReviewedReviewCopy } from '@/lib/reviewRoundActions';
import { getPIITypeLabel } from '@/services/pii/detector';
import { showAppConfirm } from '@/stores/alertStore';
import { idbDeleteReviewRound } from '@/lib/documentsDb';
import { sweepOrphanedAttachments } from '@/lib/attachmentGc';
import { scheduleBackup } from '@/stores/backupStore';

export function ReviewRoundsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return open ? <ReviewRoundsContent onClose={() => onOpenChange(false)} /> : null;
}

function ReviewRoundsContent({ onClose }: { onClose: () => void }) {
  const native = useDocumentStore(state => supportsReviewComments(state));
  const docs = useDocumentsStore(state => state.docs);
  const [rounds, setRounds] = useState<ReviewRound[]>([]);
  const [label, setLabel] = useState(initialReviewLabel);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [prepared, setPrepared] = useState<PreparedReviewCopy | null>(null);
  const [incoming, setIncoming] = useState<ReviewedReviewCopy | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void listReviewRounds().then(records => {
      if (!active) return;
      setRounds(records.sort((a, b) => b.createdAt - a.createdAt));setLoaded(true);
    }).catch(() => { if (active) setError('Saved reviews could not be read completely. Retry before creating or sending a reviewer copy.'); });
    return () => { active = false; };
  }, [attempt]);

  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);setError('');setNotice('');
    try { await operation(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'The review operation could not finish. Your source draft has not been replaced.'); }
    finally { if (alive.current) setBusy(false); }
  }

  async function start() {
    const round = await startReviewRound(label, captureDocumentTarget());
    if (alive.current) { setRounds(previous => [round, ...previous]);setPrepared(null);setIncoming(null);setNotice('Review baseline saved. Later source edits will not change this copy.'); }
  }

  async function prepare(round: ReviewRound) {
    const envelope = await buildReviewCopy(round);
    const policy = await getExportDeploymentPolicy(undefined, true);
    const review = prepareReviewCopyExport(envelope, policy);
    if (alive.current) { setPrepared(review);setIncoming(null); }
  }

  async function inspect(round: ReviewRound) {
    const target = captureDocumentTarget();
    const copy = await parseReviewCopy(await buildReviewCopy(round));
    const result = await openReviewCopy(copy, target);
    if (alive.current) {
      if (result === 'applied') onClose();
      else setNotice('The reviewer copy was saved in the library, but the active document changed. Open the saved copy from the sidebar.');
    }
  }

  async function remove(round: ReviewRound) {
    if (!await showAppConfirm({ title: 'Delete this review baseline?',
      message: 'This removes the saved baseline and its local reviewer links. Existing editable copies and downloaded files remain. Keep a reviewer file or workspace backup if you may need this baseline again.',
      confirmLabel: 'Delete review baseline', destructive: true }) || !alive.current) return;
    await run(async () => {
      if (!await idbDeleteReviewRound(round.id, round.baselineDigest)) throw new Error('The saved review could not be removed. Retry after checking browser storage.');
      scheduleBackup();
      await sweepOrphanedAttachments();
      if (alive.current) { setRounds(previous => previous.filter(pin => pin.id !== round.id));setPrepared(null);setIncoming(null);setNotice('Review baseline removed. Editable copies and downloaded files remain.'); }
    });
  }

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];event.target.value = '';
    if (!file) return;
    setIncoming(null);setPrepared(null);
    void run(async () => {
      if (file.size > MAX_REVIEW_COPY_BYTES) throw new Error('Review copies are limited to 100 MB.');
      let value: unknown;
      try { value = JSON.parse(await file.text()); }
      catch { throw new Error('This file is not readable JSON. Choose a reviewer copy exported by DonDocs.'); }
      const parsed = await parseReviewCopy(value);
      if (alive.current) { setIncoming(parsed);setPrepared(null); }
    });
  }

  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-3xl max-h-[85dvh] flex flex-col overflow-hidden">
      <DialogHeader className="shrink-0 pr-8 text-left">
        <DialogTitle>Review rounds</DialogTitle>
        <DialogDescription>Keep the exact native letter and attachments sent for review. Each reviewer copy opens as a separate draft; the source stays in your library.</DialogDescription>
      </DialogHeader>
      <div role="region" aria-label="Review round workspace" tabIndex={0} className="min-h-0 space-y-4 overflow-y-auto p-1 focus-visible:outline-2 focus-visible:outline-ring">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {!loaded ? <div className="space-y-2"><p className="text-sm">Loading saved reviews…</p><Button variant="outline" disabled={busy} onClick={() => { setError('');setAttempt(value => value + 1); }}>Retry saved reviews</Button></div> : <>
          <section className="space-y-2 rounded-md border p-3" aria-label="Start a review">
            <Label htmlFor="review-round-name">Review name</Label>
            <Input id="review-round-name" value={label} maxLength={120} disabled={busy} onChange={event => setLabel(event.target.value)} />
            {!native && <p className="text-sm">Start a review from supported native correspondence. Saved reviews remain available below.</p>}
            <Button disabled={busy || !native || !label.trim()} onClick={() => void run(start)}>Start review from current draft</Button>
          </section>
          <section className="space-y-2" aria-label="Saved review baselines">
            <h3 className="text-sm font-medium">Saved review baselines</h3>
            {!rounds.length && <p className="text-sm text-muted-foreground">No review baselines saved yet.</p>}
            {rounds.map(round => <article key={round.id} className="space-y-2 rounded-md border p-3" aria-label={`Review ${round.label}`}>
              <h4 className="break-words text-sm font-medium">{round.label}</h4>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{new Date(round.createdAt).toLocaleString()} · {round.ownerDocumentId
                ? docs[round.ownerDocumentId] ? `Source: ${docs[round.ownerDocumentId].meta.title}` : 'Source unavailable; the saved baseline is retained.'
                : 'Received reviewer baseline; no local source ownership is assigned.'}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal text-left" disabled={busy} onClick={() => void run(() => inspect(round))}>Open baseline as new review copy</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => prepare(round))}>Prepare reviewer copy</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(round)}>Delete review baseline</Button>
              </div>
            </article>)}
          </section>
        </>}
        {prepared && <section aria-label="Review copy contents" className="space-y-2 rounded-md border p-3 text-sm">
          <h3 className="font-medium">Check this reviewer copy before downloading</h3>
          <p>{prepared.review.marking}</p>
          <p>The file is unencrypted and includes the entire baseline letter, existing discussions, signature images, figures and attached PDFs. Check who may receive it.</p>
          <p>Automatic checks cover text and filenames. Inspect attached PDFs and images yourself.</p>
          {prepared.review.customMarkings.map(marking => <p key={marking} className="whitespace-pre-wrap break-words">{marking}</p>)}
          {prepared.review.notices.map(message => <p key={message}>{message}</p>)}
          <p>{prepared.review.privacy.found ? `Possible sensitive information: ${[...new Set(prepared.review.privacy.findings.map(finding => getPIITypeLabel(finding.type)))].join(', ')}.`
            : 'The privacy scan found no recognized patterns. Review the contents and attachment files yourself before sending.'}</p>
          <Button disabled={busy} onClick={() => {
            try { downloadReviewCopy(prepared);setPrepared(null);setNotice('Reviewer copy sent to browser downloads.'); }
            catch (cause) { setError(cause instanceof Error ? cause.message : 'The download could not start.'); }
          }}>Download reviewer copy</Button>
          <Button variant="ghost" disabled={busy} onClick={() => setPrepared(null)}>Cancel download</Button>
        </section>}
        <section aria-label="Open a reviewer copy" className="space-y-2 rounded-md border p-3">
          <Label htmlFor="review-copy-file">Import reviewer copy</Label>
          <Input id="review-copy-file" type="file" accept=".json,application/json" disabled={busy} onChange={importFile} />
          {incoming && <div className="space-y-2 text-sm">
            <p className="break-words">{incoming.envelope.round.label} · {incoming.reviewed.session.paragraphs.length} paragraphs · {incoming.reviewed.files.filter(Boolean).length} attached PDFs</p>
            <p>The included baseline checksum matches. Sender identity and approval authority are not verified.</p>
            <Button disabled={busy} onClick={() => void run(async () => {
              const result = await openReviewCopy(incoming, captureDocumentTarget());
              if (alive.current && result === 'applied') onClose();
              else if (alive.current) setNotice('The active document changed. The retained reviewer copy is available in the library.');
            })}>Open as new review copy</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setIncoming(null)}>Cancel imported copy</Button>
          </div>}
        </section>
        {busy && <p role="status" className="text-sm">Saving or checking review contents…</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
