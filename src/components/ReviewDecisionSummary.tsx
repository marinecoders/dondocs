import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getExportDeploymentPolicy } from '@/config/classification';
import { useDocumentsStore } from '@/stores/documentsStore';
import { getPIITypeLabel } from '@/services/pii/detector';
import {
  downloadReviewDecisionSummary, loadReviewDecisionSummary, ownsReviewDecisionSummary,
  prepareReviewDecisionSummary, reviewDecisionSummaryDetails,
  type DecisionSummaryCapture, type PreparedDecisionSummary,
} from '@/lib/reviewDecisionSummary';

const ignoreBusy = (_busy: boolean): void => {};
interface DecisionSummaryProps {
  roundId: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean, roundId: string) => void;
}

export function ReviewDecisionSummary(props: DecisionSummaryProps) {
  const documentId = useDocumentsStore(state => state.currentId);
  const epoch = useDocumentsStore(state => state.activationEpoch);
  return <DecisionSummaryContent key={`${props.roundId}:${documentId}:${epoch}`} {...props} />;
}

function DecisionSummaryContent({ roundId, disabled = false, onBusyChange = ignoreBusy }: DecisionSummaryProps) {
  const [prepared, setPrepared] = useState<{ capture: DecisionSummaryCapture; report: PreparedDecisionSummary } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(true);
  const request = useRef(0);
  const running = useRef(false);
  useEffect(() => {
    active.current = true;
    const requestState = request;
    return () => { active.current = false;requestState.current++;onBusyChange(false, roundId); };
  }, [onBusyChange, roundId]);

  function cancel(): void {
    request.current++;
    running.current = false;
    setPrepared(null);setBusy(false);setError('');onBusyChange(false, roundId);
  }

  async function prepare(): Promise<void> {
    if (disabled || running.current) return;
    running.current = true;
    const generation = ++request.current;
    setBusy(true);setError('');setNotice('');onBusyChange(true, roundId);
    try {
      const capture = await loadReviewDecisionSummary(roundId);
      const policy = await getExportDeploymentPolicy(undefined, true);
      if (!active.current || request.current !== generation) return;
      if (!ownsReviewDecisionSummary(capture)) throw new Error('The active draft changed. Prepare this summary again.');
      setPrepared({ capture, report: prepareReviewDecisionSummary(capture, policy) });
    } catch (cause) {
      if (active.current && request.current === generation) setError(cause instanceof Error ? cause.message : 'The decision summary could not be prepared.');
    } finally {
      if (active.current && request.current === generation) {
        running.current = false;setBusy(false);onBusyChange(false, roundId);
      }
    }
  }

  async function download(): Promise<void> {
    if (!prepared || disabled || running.current) return;
    running.current = true;
    const generation = ++request.current;
    setBusy(true);setError('');onBusyChange(true, roundId);
    try {
      const policy = await getExportDeploymentPolicy(undefined, true);
      if (!active.current || request.current !== generation) return;
      if (!ownsReviewDecisionSummary(prepared.capture)) throw new Error('The active draft changed. Prepare this summary again.');
      downloadReviewDecisionSummary(prepared.report, policy);
      setPrepared(null);setNotice('Decision summary sent to browser downloads.');
    } catch (cause) {
      if (active.current && request.current === generation) setError(cause instanceof Error ? cause.message : 'The decision summary could not be downloaded.');
    } finally {
      if (active.current && request.current === generation) {
        running.current = false;setBusy(false);onBusyChange(false, roundId);
      }
    }
  }

  const details = prepared ? reviewDecisionSummaryDetails(prepared.report) : null;
  return <div role="group" aria-label="Review decision summary" className="space-y-3 rounded-md border p-3 text-sm">
    <h3 className="font-medium">Decision summary</h3>
    <p>Printable HTML with retained suggestions, decisions and discussions for this draft and review round. Preparation saves pending work and captures the current revision. Later edits are excluded.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {details && <div className="space-y-2">
      <h4 className="font-medium">Review summary contents before downloading</h4>
      <p>{details.roundLabel} · Captured {details.capturedAt}</p>
      <p>Accepted: {details.counts.accepted} · Rejected: {details.counts.rejected} · Open: {details.counts.open} · Conflicting: {details.counts.conflicting}</p>
      <p>{details.marking} · Includes rejected text, earlier accepted resolutions, reviewer labels and retained comment context. Reviewer labels are not verified identities; this is not approval evidence.</p>
      <p>Each suggested-edit group counts once. Conflicting includes changed or unavailable targets needing reconciliation, including independent edits. Discussions are separate. Inspect the entire report before sharing; attached PDF and image contents are excluded.</p>
      {details.privacy.found ? <p role="status" className="text-warning">Possible sensitive information: {[...new Set(details.privacy.findings.map(finding => getPIITypeLabel(finding.type)))].join(', ')}.</p>
        : <p>The automatic scan found no recognized sensitive patterns. Review the retained text yourself.</p>}
      {details.customMarkings.map(marking => <p key={marking} className="whitespace-pre-wrap break-words">{marking}</p>)}
      {details.notices.map(message => <p key={message}>{message}</p>)}
      <Button type="button" disabled={disabled || busy} onClick={() => void download()}>Download reviewed decision summary (.html)</Button>
    </div>}
    {busy || prepared ? <Button type="button" variant="outline" onClick={cancel}>Cancel decision summary</Button>
      : <Button type="button" variant="outline" disabled={disabled} onClick={() => void prepare()}>Prepare decision summary</Button>}
    {busy && <p role="status">Checking captured summary contents…</p>}
  </div>;
}
