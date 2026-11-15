import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getExportDeploymentPolicy } from '@/config/classification';
import { captureDocumentTarget, isCurrentDocumentTarget, useDocumentsStore, type DocumentTarget } from '@/stores/documentsStore';
import { readReviewCopyLink, type ReviewRound } from '@/lib/reviewRounds';
import { loadReviewSuggestionWorkspace } from '@/lib/reviewSuggestionActions';
import { compareReviewCheckpoint, parseReviewCheckpoint, type CheckpointComparison } from '@/lib/reviewCheckpoints';
import { MAX_REVIEW_CHECKPOINT_BYTES, type ReviewCheckpoint } from '@/lib/reviewCheckpointModel';
import { downloadReviewCheckpoint, importReviewCheckpoint, prepareCheckpointExport, saveReviewCheckpoint,
  type PreparedCheckpointExport } from '@/lib/reviewCheckpointActions';
import { getPIITypeLabel } from '@/services/pii/detector';

interface Props {
  rounds: ReviewRound[];
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onRoundChange: (round: ReviewRound) => void;
}

export function ReviewCheckpoints({ rounds, disabled, onBusyChange, onRoundChange }: Props) {
  const documentId = useDocumentsStore(state => state.currentId);
  const [linked, setLinked] = useState<string | null>(null);
  const [roundId, setRoundId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [reviewerLabel, setReviewerLabel] = useState('');
  const [comparison, setComparison] = useState<CheckpointComparison | null>(null);
  const [comparedAt, setComparedAt] = useState<number | null>(null);
  const [outgoing, setOutgoing] = useState<PreparedCheckpointExport | null>(null);
  const [incoming, setIncoming] = useState<{ checkpoint: ReviewCheckpoint; target: DocumentTarget | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; onBusyChange(false); };
  }, [onBusyChange]);
  useEffect(() => {
    let current = true;
    if (documentId) void readReviewCopyLink(documentId).then(link => {
      if (current) setLinked(link?.roundId ?? null);
    }).catch(() => { if (current) setError('The reviewer association could not be read. Reopen Reviews to retry.'); });
    return () => { current = false; };
  }, [documentId]);
  const available = rounds.filter(round => round.ownerDocumentId === documentId || round.id === linked);
  const round = available.find(item => item.id === roundId);
  const checkpoint = round?.checkpoints?.find(item => item.reviewerId === reviewerId);
  const working = disabled || busy;

  function clearComparison() {
    setComparison(null);
    setComparedAt(null);
    setOutgoing(null);
    setError('');
    setNotice('');
  }

  async function run(operation: () => Promise<void>) {
    if (disabled || running.current) return;
    running.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setNotice('');
    try { await operation(); }
    catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : 'The checkpoint operation could not finish.');
    } finally {
      running.current = false;
      if (active.current) { setBusy(false); onBusyChange(false); }
    }
  }

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIncoming(null);
    const target = captureDocumentTarget();
    void run(async () => {
      if (file.size > MAX_REVIEW_CHECKPOINT_BYTES) throw new Error('Reviewer checkpoints are limited to 2 MB.');
      let value: unknown;
      try { value = JSON.parse(await file.text()); }
      catch { throw new Error('Choose a readable reviewer checkpoint JSON file.'); }
      const parsed = await parseReviewCheckpoint(value);
      if (!isCurrentDocumentTarget(target)) throw new Error('The draft changed while reading the checkpoint. Choose the file again.');
      if (active.current) { clearComparison(); setIncoming({ checkpoint: parsed, target }); }
    });
  }

  return <section className="space-y-3 rounded-md border p-3" aria-label="Since you last reviewed">
    <h3 className="text-sm font-medium">Since you last reviewed</h3>
    <p className="text-sm text-muted-foreground">Choose your saved reviewer marker explicitly. Names and markers are self-entered observations, not authenticated identity or approval. A checkpoint retains earlier text and feedback for comparison; it contains no attachment bytes and cannot restore a draft.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <Label htmlFor="checkpoint-round">Review for comparison checkpoint</Label>
    <select id="checkpoint-round" value={round?.id ?? ''} disabled={working}
      className="w-full rounded-md border bg-background p-2 text-sm" onChange={event => {
        setRoundId(event.target.value);
        setReviewerId('');
        setReviewerLabel('');
        clearComparison();
      }}>
      <option value="">Choose a review for this draft</option>
      {available.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
    {round && <>
      <Label htmlFor="checkpoint-reviewer">Reviewer checkpoint</Label>
      <select id="checkpoint-reviewer" value={checkpoint?.reviewerId ?? ''} disabled={working}
        className="w-full rounded-md border bg-background p-2 text-sm" onChange={event => {
          const selected = round.checkpoints?.find(item => item.reviewerId === event.target.value);
          setReviewerId(selected?.reviewerId ?? '');
          setReviewerLabel(selected?.reviewerLabel ?? '');
          clearComparison();
        }}>
        <option value="">New reviewer marker</option>
        {(round.checkpoints ?? []).map(item => <option key={item.reviewerId} value={item.reviewerId}>
          {item.reviewerLabel} · {new Date(item.capturedAt).toLocaleString()}
        </option>)}
      </select>
      {!checkpoint && <p className="text-sm">No checkpoint is selected. DonDocs cannot infer what you previously reviewed. Mark the current view reviewed to start a comparison history.</p>}
      <Label htmlFor="checkpoint-reviewer-label">Reviewer label for checkpoint</Label>
      <Input id="checkpoint-reviewer-label" value={reviewerLabel} maxLength={100} disabled={working}
        onChange={event => setReviewerLabel(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={working || !reviewerLabel.trim()} onClick={() => void run(async () => {
          const id = checkpoint?.reviewerId ?? crypto.randomUUID();
          const saved = await saveReviewCheckpoint(round.id, { id, label: reviewerLabel });
          if (active.current) {
            onRoundChange(saved);
            setReviewerId(id);
            setComparison(null);
            setOutgoing(null);
            setNotice('Current captured document and feedback marked reviewed. Earlier text stays in this checkpoint until it is replaced.');
          }
        })}>Mark current view reviewed</Button>
        <Button variant="outline" disabled={working || !checkpoint} onClick={() => void run(async () => {
          const context = await loadReviewSuggestionWorkspace(round.id);
          const saved = context.round.checkpoints?.find(item => item.reviewerId === checkpoint!.reviewerId);
          if (!saved) throw new Error('The checkpoint changed or is no longer available. Refresh Reviews.');
          const verified = await parseReviewCheckpoint(saved);
          if (!isCurrentDocumentTarget(context.target)) throw new Error('The draft changed. Refresh the comparison.');
          if (active.current) {
            setComparison(compareReviewCheckpoint(verified, context.round, context.current, context.state));
            setComparedAt(verified.capturedAt);
          }
        })}>Show changes since checkpoint</Button>
        <Button variant="outline" disabled={working || !checkpoint} onClick={() => void run(async () => {
          const context = await loadReviewSuggestionWorkspace(round.id);
          const saved = context.round.checkpoints?.find(item => item.reviewerId === checkpoint!.reviewerId);
          if (!saved) throw new Error('The checkpoint changed or is no longer available. Refresh Reviews.');
          const verified = await parseReviewCheckpoint(saved);
          const policy = await getExportDeploymentPolicy(undefined, true);
          if (!isCurrentDocumentTarget(context.target)) throw new Error('The draft changed. Prepare the checkpoint again.');
          const prepared = await prepareCheckpointExport(verified, context.round, policy);
          if (!isCurrentDocumentTarget(context.target)) throw new Error('The draft changed. Prepare the checkpoint again.');
          if (active.current) setOutgoing(prepared);
        })}>Prepare checkpoint file</Button>
      </div>
    </>}
    {comparison && <div className="space-y-2 text-sm" aria-label="Captured changes since checkpoint">
      <p>Compared with the marker from {new Date(comparedAt!).toLocaleString()}. This comparison is captured; use Show changes again after further edits.</p>
      <p>{comparison.document.length} document changes · {comparison.feedback.length} feedback changes</p>
      <p className="text-xs text-muted-foreground">Compares retained text and file metadata. Attachment contents are not compared. A marker alone does not transfer later suggestions or decisions. Missing feedback is reported as unavailable rather than inferred resolved. Stable native paragraph targets distinguish position changes from text changes; legacy targets may use positions.</p>
      {(['document', 'feedback'] as const).map(kind => <details key={kind} open>
        <summary>{kind === 'document' ? 'Document changes' : 'Feedback changes'} ({comparison[kind].length})</summary>
        <div role="region" aria-label={`${kind} changes since checkpoint`} tabIndex={0}
          className="max-h-80 space-y-3 overflow-auto rounded-md border p-2 focus-visible:outline-2 focus-visible:outline-ring">
          {comparison[kind].length === 0 && <p>No changes in this captured comparison.</p>}
          {comparison[kind].map((change, index) => <article key={index} className="space-y-1 border-b pb-2">
            <h4 className="font-medium">{change.label}</h4>
            <dl><dt>When reviewed</dt><dd className="whitespace-pre-wrap break-words">{change.before || '(Empty)'}</dd>
              <dt>Current captured view</dt><dd className="whitespace-pre-wrap break-words">{change.after || '(Empty)'}</dd></dl>
          </article>)}
        </div>
      </details>)}
    </div>}
    {outgoing && <div className="space-y-2 rounded-md border p-3 text-sm" aria-label="Review checkpoint file contents">
      <p>{outgoing.reviewerLabel} · {outgoing.review.marking}</p>
      <p>This unencrypted file contains retained document text and feedback, including text since removed. It excludes attachment bytes. Inspect it before transferring.</p>
      {outgoing.review.customMarkings.map(marking => <p key={marking} className="whitespace-pre-wrap break-words">{marking}</p>)}
      {outgoing.review.notices.map(notice => <p key={notice}>{notice}</p>)}
      <p>{outgoing.review.privacy.found
        ? `Possible sensitive information: ${[...new Set(outgoing.review.privacy.findings.map(finding => getPIITypeLabel(finding.type)))].join(', ')}.`
        : 'The privacy scan found no recognized patterns. Review the retained text yourself.'}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={working} onClick={() => void run(async () => {
          const target = captureDocumentTarget();
          const policy = await getExportDeploymentPolicy(undefined, true);
          if (!active.current || !isCurrentDocumentTarget(target)) throw new Error('The draft changed. Prepare the checkpoint again.');
          downloadReviewCheckpoint(outgoing, policy);
          setOutgoing(null);
        })}>Download checkpoint file</Button>
        <Button variant="ghost" disabled={working} onClick={() => setOutgoing(null)}>Cancel checkpoint download</Button>
      </div>
    </div>}
    <Label htmlFor="checkpoint-file">Import reviewer checkpoint</Label>
    <Input id="checkpoint-file" type="file" accept=".json,application/json" disabled={working} onChange={importFile} />
    {incoming && <div className="space-y-2 rounded-md border p-3 text-sm">
      <p>{incoming.checkpoint.reviewerLabel} · {new Date(incoming.checkpoint.capturedAt).toLocaleString()}</p>
      <p>The checksum matches the captured text; it does not verify reviewer identity. Import replaces this reviewer's marker for the same baseline. Keep the file if you need the previous comparison point.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={working} onClick={() => void run(async () => {
          const saved = await importReviewCheckpoint(incoming.checkpoint, incoming.target);
          if (active.current) {
            onRoundChange(saved);
            setRoundId(saved.id);
            setReviewerId(incoming.checkpoint.reviewerId);
            setReviewerLabel(incoming.checkpoint.reviewerLabel);
            setIncoming(null);
            clearComparison();
            setNotice('Reviewer checkpoint imported. Document text and review decisions were kept.');
          }
        })}>Import this checkpoint</Button>
        <Button variant="ghost" disabled={working} onClick={() => setIncoming(null)}>Cancel checkpoint import</Button>
      </div>
    </div>}
  </section>;
}
