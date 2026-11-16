import type { SerializedSession } from '@/stores/documentStore';
import { captureDocumentScope, flushDocumentWrites, flushPendingReviewWrites, hasPendingReviewWrites, isCurrentDocumentScope, type DocumentScope } from '@/stores/documentsStore';
import { captureChangeReport, prepareChangeReport, escapeReportHtml, downloadReportHtml, type ChangeReport } from './changeReport';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { loadReviewSuggestionWorkspace, type ReviewSuggestionWorkspace } from './reviewSuggestionActions';
import { parseReviewRound, reviewPayloadDigest, reviewRoundStatus, type ReviewRound } from './reviewRounds';
import { emptyReviewSuggestionState, inspectReviewSuggestion, latestReviewSuggestionDecision, reviewSuggestionResolutionText, validateReviewSuggestionState, type ReviewSuggestionDecision, type ReviewSuggestionState } from './reviewSuggestions';
import { feedbackCategoryLabel } from './reviewFeedback';
import { reviewCommentsSchema } from './reviewComments';
import { describeCommentAnchor } from './reviewCommentTargets';

const captureBrand = Symbol('decision-summary-capture');
const preparedBrand = Symbol('prepared-decision-summary');
export interface DecisionSummaryCapture { readonly [captureBrand]: true }
export interface PreparedDecisionSummary { readonly [preparedBrand]: true }
type SummaryStatus = 'accepted' | 'rejected' | 'open' | 'conflicting';
interface SummaryItem {
  label: string;
  author: string;
  category: string;
  status: SummaryStatus;
  acceptedCurrentChanged: boolean;
  origin: { kind: string; rule?: string; context?: string };
  changes: Array<{ label: string; baseline: string; current: string | null; proposed: string; accepted?: string }>;
  history: Array<{ action: string; at: string; resolutions: Array<{ before: string; accepted: string; context?: string }> }>;
}
interface SummaryDiscussion {
  version: string;
  target: string;
  category: string;
  status: string;
  context?: string;
  current?: string;
  messages: Array<{ author: string; text: string; createdAt: string; editedAt?: string }>;
}
interface CaptureData {
  scope: DocumentScope;
  round: ReviewRound;
  current: SerializedSession;
  state: ReviewSuggestionState;
  owner: boolean;
  capturedAt: string;
  currentDigest: string;
}
interface SummaryData {
  capture: CaptureData;
  items: SummaryItem[];
  discussions: SummaryDiscussion[];
  counts: Record<SummaryStatus, number>;
  review: ChangeReport;
  filename: string;
}
const captures = new WeakMap<DecisionSummaryCapture, CaptureData>();
const summaries = new WeakMap<PreparedDecisionSummary, SummaryData>();

/** Own the entire review view before hashing, loading policy or rendering. */
export async function captureReviewDecisionSummary(workspace: ReviewSuggestionWorkspace, capturedAt: string): Promise<DecisionSummaryCapture> {
  const round = parseReviewRound(structuredClone(workspace.round));
  const current = structuredClone(workspace.current);
  const state = validateReviewSuggestionState(round, workspace.state ?? emptyReviewSuggestionState(round));
  // Discussion validation must fail closed; never silently omit an unreadable thread.
  reviewCommentsSchema.parse(current.reviewComments ?? { version: 1, threads: [] });
  const owned = { scope: workspace.target.scope, round, current, state, owner: workspace.owner, capturedAt: new Date(capturedAt).toISOString() };
  const currentDigest = await reviewPayloadDigest(current);
  const capture: DecisionSummaryCapture = Object.freeze({ [captureBrand]: true as const });
  captures.set(capture, { ...owned, currentDigest });
  return capture;
}

export async function loadReviewDecisionSummary(roundId: string): Promise<DecisionSummaryCapture> {
  const scope = captureDocumentScope();
  if (!isCurrentDocumentScope(scope)) throw new Error('Open the source draft or linked reviewer copy first.');
  if (hasPendingReviewWrites(scope.documentId)) await flushPendingReviewWrites(scope.documentId);
  if (!isCurrentDocumentScope(scope)) throw new Error('The active draft changed. Prepare this summary again.');
  await flushDocumentWrites();
  if (!isCurrentDocumentScope(scope)) throw new Error('The active draft changed. Prepare this summary again.');
  const workspace = await loadReviewSuggestionWorkspace(roundId);
  if (!isCurrentDocumentScope(scope)) throw new Error('The active draft changed. Prepare this summary again.');
  const captured = await captureReviewDecisionSummary(workspace, new Date().toISOString());
  if (!ownsReviewDecisionSummary(captured)) throw new Error('The active draft changed. Prepare this summary again.');
  return captured;
}

export function ownsReviewDecisionSummary(capture: DecisionSummaryCapture): boolean {
  const data = captures.get(capture);
  return !!data && isCurrentDocumentScope(data.scope);
}

function capturedData(capture: DecisionSummaryCapture): CaptureData {
  const data = captures.get(capture);
  if (!data) throw new Error('The decision summary capture was not issued by this workspace.');
  return data;
}

function discussions(session: SerializedSession, version: string): SummaryDiscussion[] {
  return reviewCommentsSchema.parse(session.reviewComments ?? { version: 1, threads: [] }).threads.map(thread => {
    const anchor = describeCommentAnchor(session, thread.anchor);
    return { version, target: anchor.label, category: feedbackCategoryLabel(thread.category),
      status: `${thread.resolved ? 'Resolved' : 'Open'} · ${anchor.status === 'current' ? 'Target current' : anchor.status === 'changed' ? 'Target changed' : 'Target unavailable / detached'}`,
      context: thread.anchorHistory?.length ? [anchor.context ?? '', ...thread.anchorHistory.map(previous => `Earlier selected text:\n${previous.anchor.context.slice(previous.anchor.start, previous.anchor.end)}\n\nEarlier paragraph context:\n${previous.anchor.context}`)].join('\n\n') : anchor.context, current: anchor.current,
      messages: thread.messages.map(({ author, text, createdAt, editedAt }) => ({ author, text, createdAt, editedAt })) };
  });
}

function historyEntry(decision: ReviewSuggestionDecision): SummaryItem['history'][number] {
  return { action: decision.action, at: new Date(decision.decidedAt).toISOString(),
    resolutions: (decision.resolutions ?? []).map(value => ({ before: value.expectedCurrent, accepted: value.value, ...(value.range ? { context: value.range.context } : {}) })) };
}

function buildSummary(capture: CaptureData, policy: PolicyResolution): SummaryData {
  const { round, current, state } = capture;
  const counts: Record<SummaryStatus, number> = { accepted: 0, rejected: 0, open: 0, conflicting: 0 };
  const items: SummaryItem[] = state.proposals.map(proposal => {
    const inspected = inspectReviewSuggestion(round, current, proposal);
    const decision = latestReviewSuggestionDecision(state, proposal.id);
    const status: SummaryStatus = decision?.action === 'accepted' || decision?.action === 'restored' ? 'accepted'
      : decision?.action === 'rejected' ? 'rejected' : inspected.some(change => change.stale) ? 'conflicting' : 'open';
    counts[status]++;
    const acceptance = decision?.action === 'accepted' ? decision
      : decision?.action === 'restored' ? state.decisions.find(value => value.id === decision.acceptanceId) : undefined;
    const acceptedInspected = acceptance ? inspectReviewSuggestion(round, current, proposal, acceptance.resolutions) : inspected;
    const changes = acceptedInspected.map(change => ({ label: change.label, baseline: change.baseline, current: change.current, proposed: change.proposed,
      ...(acceptance ? { accepted: acceptance.resolutions?.find(value => value.changeId === change.id)?.value ?? change.proposed } : {}) }));
    return { label: proposal.label, author: proposal.author, category: feedbackCategoryLabel(proposal.category), status,
      acceptedCurrentChanged: status === 'accepted' && acceptedInspected.some((change,index) => change.applied === undefined ? change.current !== changes[index].accepted : !change.applied), origin: { ...proposal.origin }, changes,
      history: state.decisions.filter(value => value.proposalId === proposal.id).map(historyEntry) };
  });
  const threads = [...discussions(round.baseline.session, 'Reviewed baseline'), ...discussions(current, 'Captured current draft')];
  const lifecycle = (round.lifecycle?.events ?? []).map(event => `${event.state} ${new Date(event.changedAt).toISOString()}`);
  const emitted = [...state.decisions.flatMap(decision => reviewSuggestionResolutionText(decision.resolutions ?? []).map(field => field.value)), round.label, reviewRoundStatus(round), ...lifecycle,
    ...items.flatMap(item => [item.label, item.author, item.category, item.status, item.origin.kind, item.origin.rule ?? '', item.origin.context ?? '',
      ...item.changes.flatMap(change => [change.label, change.baseline, change.current ?? 'Target unavailable', change.proposed, change.accepted ?? '']),
      ...item.history.flatMap(entry => [entry.action, entry.at, ...entry.resolutions.flatMap(value => [value.before, value.accepted, value.context ?? ''])])]),
    ...threads.flatMap(thread => [thread.version, thread.target, thread.category, thread.status, thread.context ?? '', thread.current ?? '',
      ...thread.messages.flatMap(message => [message.author, message.text, message.createdAt, message.editedAt ?? ''])])];
  // Existing report preparation is the single marking/privacy gate, including
  // rejected text and historic manual resolutions no longer in the draft.
  const review = prepareChangeReport(captureChangeReport(
    { label: 'Reviewed baseline', title: round.label, session: round.baseline.session },
    { label: 'Captured current draft', title: round.label, session: current }, capture.capturedAt,
    { text: emitted.map((value, index) => ({ field: `Retained review summary value ${index + 1}`, value })), markings: [] },
  ), policy);
  return { capture, items, discussions: threads, counts, review,
    filename: `review-decisions-${capture.capturedAt.replace(/[:.]/g, '-')}.html` };
}

export function prepareReviewDecisionSummary(capture: DecisionSummaryCapture, policy: PolicyResolution): PreparedDecisionSummary {
  const summary = buildSummary(capturedData(capture), policy);
  const prepared: PreparedDecisionSummary = Object.freeze({ [preparedBrand]: true as const });
  summaries.set(prepared, summary);
  return prepared;
}

function preparedData(prepared: PreparedDecisionSummary): SummaryData {
  const summary = summaries.get(prepared);
  if (!summary) throw new Error('The decision summary was not prepared by this workspace.');
  return summary;
}

export function reviewDecisionSummaryDetails(prepared: PreparedDecisionSummary) {
  const data = preparedData(prepared);
  return structuredClone({ counts: data.counts, capturedAt: data.capture.capturedAt, roundLabel: data.capture.round.label,
    marking: data.review.marking, privacy: data.review.privacy, notices: data.review.notices, customMarkings: data.review.customMarkings });
}

function htmlText(value: string): string {
  return `<pre>${escapeReportHtml(value || '(Empty)')}</pre>`;
}

function renderSummaryChange(change: SummaryItem['changes'][number]): string {
  return `<section>
    <h4>${escapeReportHtml(change.label)}</h4>
    <h5>Reviewed baseline</h5>${htmlText(change.baseline)}
    <h5>Captured current value</h5>${htmlText(change.current ?? '(Target unavailable)')}
    <h5>Reviewer proposal</h5>${htmlText(change.proposed)}
    ${change.accepted === undefined ? '' : `<h5>Accepted result at decision</h5>${htmlText(change.accepted)}`}
  </section>`;
}

function renderSummaryHistory(history: SummaryItem['history']): string {
  if (!history.length) return '<p>No decision recorded.</p>';
  return history.map(entry => `<section>
    <p>${escapeReportHtml(entry.action)} · ${escapeReportHtml(entry.at)}</p>
    ${entry.resolutions.map(value => `${value.context !== undefined ? `<h5>Captured current paragraph context</h5>${htmlText(value.context)}` : ''}<h5>Current value before manual resolution</h5>${htmlText(value.before)}
      <h5>Accepted manual resolution</h5>${htmlText(value.accepted)}`).join('')}
  </section>`).join('');
}

function renderSummaryItem(item: SummaryItem, index: number): string {
  const status = item.acceptedCurrentChanged ? 'Accepted earlier; current draft text has changed'
    : item.status === 'conflicting' ? 'Conflicting / needs reconciliation' : item.status;
  return `<article>
    <h3>Item ${index + 1}: ${escapeReportHtml(item.label)}</h3>
    <p>Status: ${escapeReportHtml(status)} · Feedback category: ${escapeReportHtml(item.category)} · Reviewer label: ${escapeReportHtml(item.author)}</p>
    <p>Suggestion source: ${escapeReportHtml(item.origin.kind)}${item.origin.rule ? ` · Rule: ${escapeReportHtml(item.origin.rule)}` : ''}</p>
    ${item.origin.context ? `<h4>Suggestion context</h4>${htmlText(item.origin.context)}` : ''}
    ${item.changes.map(renderSummaryChange).join('')}
    <h4>Retained decision history</h4>${renderSummaryHistory(item.history)}
  </article>`;
}

function renderSummaryDiscussion(thread: SummaryDiscussion): string {
  return `<article>
    <h3>${escapeReportHtml(thread.version)}: ${escapeReportHtml(thread.target)}</h3>
    <p>${escapeReportHtml(thread.status)} · Feedback category: ${escapeReportHtml(thread.category)}</p>
    ${thread.context === undefined ? '' : `<h4>Retained comment context</h4>${htmlText(thread.context)}`}
    ${thread.current === undefined ? '' : `<h4>Target in captured version</h4>${htmlText(thread.current)}`}
    ${thread.messages.map(message => `<section>
      <h4>${escapeReportHtml(message.author)}</h4>
      <p>${escapeReportHtml(message.createdAt)}${message.editedAt ? ` · Edited ${escapeReportHtml(message.editedAt)}` : ''}</p>
      ${htmlText(message.text)}
    </section>`).join('')}
  </article>`;
}

function discussionCounts(threads: SummaryDiscussion[]): string {
  const open = threads.filter(thread => thread.status.startsWith('Open')).length;
  const resolved = threads.filter(thread => thread.status.startsWith('Resolved')).length;
  return `${open} open, ${resolved} resolved`;
}

function renderSummaryHeader(capture: CaptureData, marking: string): string {
  const metadata = [
    `Captured: ${capture.capturedAt}`,
    `Round status at capture: ${reviewRoundStatus(capture.round)}`,
    `Baseline captured: ${new Date(capture.round.createdAt).toISOString()}`,
    `Baseline SHA-256: ${capture.round.baselineDigest}`,
    `Captured draft record SHA-256: ${capture.currentDigest}`,
  ];
  return `<header>
    <strong>${escapeReportHtml(marking)} — REVIEW DERIVATIVE</strong>
    <h1>Review decision summary</h1>
    <h2>${escapeReportHtml(capture.round.label)}</h2>
    <p>${metadata.map(escapeReportHtml).join('<br>')}</p>
    <p>For review only. This summary contains the local ${capture.owner ? 'source draft' : 'linked reviewer copy'} and retained feedback for this round. Reviewer labels are self-entered, not verified identities. This is not an approval record or audit proof. Other copies and returns not imported here are excluded. Later edits are excluded. Attached PDF/image contents are not reproduced.</p>
  </header>`;
}

function renderSummaryTotals(counts: Record<SummaryStatus, number>): string {
  return `<section>
    <h2>Suggested-edit totals</h2>
    <p>Accepted: ${counts.accepted} · Rejected: ${counts.rejected} · Open: ${counts.open} · Conflicting: ${counts.conflicting}</p>
    <p>Each suggested-edit group counts once, even when it changes several targets. Discussion threads are listed separately. Accepted includes restored acceptances; reversed acceptances return to open or conflicting. Accepted results remain historical even if the current draft changed afterward. Conflicting means a target differs from the baseline or is unavailable; this includes independent edits needing reconciliation, not only overlapping edits. A matching proposed value without a recorded decision remains undecided.</p>
  </section>`;
}

export function renderReviewDecisionSummary(prepared: PreparedDecisionSummary): string {
  const data = preparedData(prepared);
  const { capture, counts, review } = data;
  const baselineThreads = data.discussions.filter(thread => thread.version === 'Reviewed baseline');
  const currentThreads = data.discussions.filter(thread => thread.version === 'Captured current draft');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>Review decision summary</title>
  <style>
    body{font:16px/1.5 system-ui,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem;color:#17202a;background:white;overflow-wrap:anywhere}
    pre,p{white-space:pre-wrap;overflow-wrap:anywhere}pre{font:inherit}
    article{border:1px solid #999;padding:1rem;margin:1rem 0}h3,h4,h5{break-after:avoid}
    @media print{body{font-size:10pt;margin:0}}
  </style>
</head>
<body>
  ${renderSummaryHeader(capture, review.marking)}
  ${renderSummaryTotals(counts)}
  ${review.customMarkings.map(value => `<h2>Retained custom source marking</h2>${htmlText(value)}`).join('')}
  ${review.notices.map(value => `<p>${escapeReportHtml(value)}</p>`).join('')}
  <section>
    <h2>Suggested edits and decisions</h2>
    ${data.items.map(renderSummaryItem).join('') || '<p>No suggested edits retained for this round.</p>'}
  </section>
  <section>
    <h2>Discussions from both captured versions</h2>
    <p>Baseline discussions: ${discussionCounts(baselineThreads)}. Current discussions: ${discussionCounts(currentThreads)}. The same thread can appear in both versions to preserve its captured context.</p>
    ${data.discussions.map(renderSummaryDiscussion).join('') || '<p>No discussions retained.</p>'}
  </section>
  <footer>${escapeReportHtml(review.marking)} — REVIEW DERIVATIVE</footer>
</body>
</html>`;
}

/** Recheck current deployment policy against the same owned capture, never live text. */
export function downloadReviewDecisionSummary(prepared: PreparedDecisionSummary, policy: PolicyResolution): void {
  const data = preparedData(prepared);
  if (!isCurrentDocumentScope(data.capture.scope)) throw new Error('The active draft changed. Prepare this summary again.');
  buildSummary(data.capture, policy);
  downloadReportHtml(renderReviewDecisionSummary(prepared), data.filename);
}
