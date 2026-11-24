import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { createWordReviewExport } from '@/services/exports/wordReview';
import type { CorrespondenceRendererPorts } from '@/services/exports/correspondence';
import type { ExportGate } from '@/lib/exportController';
import { copyExportReview } from '@/lib/preparedExport';
import { reviewRoundStatus, type ReviewRound } from '@/lib/reviewRounds';
import { useDocumentsStore } from '@/stores/documentsStore';
import { supportsWordProofread } from '@/lib/correspondenceProofreadChecks';
import { WINDOW_ENVELOPE_WORD_REVIEW_LIMIT, windowEnvelopeLayout } from '@/lib/windowEnvelope';

export interface WordReviewExportOptions { gate: ExportGate; renderer: CorrespondenceRendererPorts }
interface Props extends WordReviewExportOptions {
  rounds: readonly ReviewRound[];
  disabled: boolean;
  onSaved(round: ReviewRound): void;
  onBusyChange(busy: boolean): void;
}
export function WordReviewControls({ rounds, disabled, onSaved, onBusyChange, gate, renderer }: Props) {
  const documentId = useDocumentsStore(state => state.currentId);
  const available = rounds.filter(round => round.ownerDocumentId === documentId && reviewRoundStatus(round) === 'active');
  const [selectedId, setSelectedId] = useState(''), [error, setError] = useState('');
  const [proofreadRoundId, setProofreadRoundId] = useState<string>();
  const [owner] = useState(() => createWordReviewExport({ gate, renderer, onSaved }));
  const state = useSyncExternalStore(owner.controller.subscribe, owner.controller.getState, owner.controller.getState);
  const held = state.phase === 'preparing' || state.phase === 'executing' || state.phase === 'review';
  const selected = available.find(round => round.id === selectedId) ?? available[0];
  const baseline = selected?.baseline.session;
  const windowEnvelope = baseline && windowEnvelopeLayout(baseline.docType, baseline.formData);
  const canIncludeProofread = selected && supportsWordProofread(selected.baseline.session);
  const includeProofread = !!canIncludeProofread && proofreadRoundId === selected?.id;
  const review = state.phase === 'review' ? copyExportReview(state.job) : null;
  useEffect(() => { onBusyChange(held);return () => onBusyChange(false); }, [held, onBusyChange]);
  useEffect(() => { owner.activate();return () => owner.dispose(); }, [owner]);
  return <section aria-label="Word review handoff" aria-busy={held} className="space-y-3 rounded-md border p-3">
    <h3 className="text-sm font-medium">Review in Word</h3>
    <p className="text-sm text-muted-foreground">Send the exact saved revision as an editable Word file. Return it below to review body-text suggestions and comments without replacing newer draft work. Keep this browser’s baseline or a workspace backup. Edit the issued DOCX in place and keep that file for return; converting it or copying the contents into a fresh file can remove its review markers.</p>
    <p className="text-xs text-muted-foreground">Word layout changes are excluded. Paragraph moves, splits, joins, field, table, image and header/footer content changes require manual review. Reviewer names and dates are unverified.</p>
    <Label className="block space-y-1">Saved Word review baseline
      <select aria-label="Saved Word review baseline" className="block w-full min-w-0 rounded border bg-background p-2 text-sm" disabled={disabled || held || !available.length}
        value={selected?.id ?? ''} onChange={event => { setSelectedId(event.target.value); setProofreadRoundId(undefined); }}>
        {!available.length && <option value="">Create an owned active review baseline first</option>}
        {available.map(round => <option key={round.id} value={round.id}>{round.label} · {new Date(round.createdAt).toLocaleString()}</option>)}
      </select>
    </Label>
    {windowEnvelope && <p className="text-sm text-muted-foreground">{WINDOW_ENVELOPE_WORD_REVIEW_LIMIT}</p>}
    {canIncludeProofread && !windowEnvelope && (
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={includeProofread} disabled={disabled || held}
          onChange={event => setProofreadRoundId(event.target.checked ? selected?.id : undefined)} />
        Include Proofread comments on body paragraphs
      </label>
    )}
    <div className="flex flex-wrap gap-2"><Button variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal text-left" disabled={disabled || held || !selected || !!windowEnvelope} onClick={() => {
      setError('');try { if (!owner.request(selected!, includeProofread)) setError('Another export is running or awaiting review. Finish or cancel it, then retry.'); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'The Word review could not be prepared.'); }
    }}>Download Word review copy</Button>
    {held && <Button variant="ghost" className="h-auto min-h-9 max-w-full whitespace-normal text-left" onClick={() => owner.controller.cancel()}>Cancel Word review export</Button>}</div>
    {(error || state.phase === 'error') && <p role="alert" className="break-words text-sm text-destructive">{error || (state.phase === 'error' ? state.message : '')}</p>}
    {state.phase === 'success' && <p role="status" className="text-sm">Word review copy sent to browser downloads. Its exact native baseline and matching receipt are retained locally.</p>}
    {(state.phase === 'preparing' || state.phase === 'executing') && <p role="status" className="text-sm">Preparing the captured Word review copy…</p>}
    {state.phase === 'review' && review && <div className="space-y-2 text-sm" aria-label="Approve Word review export">
      <p className="font-medium">Review {state.stage === 'structure' ? 'paragraph structure' : state.stage === 'marking' ? 'handling markings' : 'possible sensitive information'}</p>
      {state.stage === 'structure' && review.structure.map((finding, index) => <p key={index}>{finding.message}</p>)}
      {state.stage === 'marking' && review.notices.map((notice, index) => <p key={index}>{notice}</p>)}
      {state.stage === 'privacy' && review.privacy.findings.map((finding, index) => <p key={index} className="break-words">{finding.field}: {finding.type} · {finding.value}</p>)}
      <p>The unencrypted Word file contains this saved revision. Confirm the findings and intended recipients before downloading.</p>
      <Button className="h-auto min-h-9 max-w-full whitespace-normal text-left" onClick={() => owner.controller.confirm(state.job, state.stage)}>Approve {state.stage} for Word review</Button>
    </div>}
  </section>;
}
