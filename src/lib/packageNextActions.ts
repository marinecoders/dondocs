import { actionPackageSchema, getPackageRevision, type ActionPackage } from './actionPackages';
import { inspectPackageRequirements } from './packageRequirements';
import { conditionalMembershipFindings } from './packageConditionalSources';
import { packageBindingReadiness } from './packageFieldBindings';
import { packageCitationReadiness } from './packageCitationRepair';
import { packageReviewRoundStatus } from './packageReviewRounds';
import { packageWorkToday, isPackageWorkDate, resolvePackageTaskTarget, type PackageWorkDestination } from './packageWorkModel';
import { getExportDeploymentPolicy } from '@/config/classification';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { PackageRequirementOperation } from './packageRequirementsModel';
import { preparePackageAssembly } from './actionPackageAssembly';
import { validateActionPackageResources } from './actionPackageTransfer';
import { readPackageAsset } from './actionPackageAssets';
import { reviewPackageWork } from './actionPackageDisclosure';
import { inspectPackageConsistency } from './packageConsistency';
import { inspectPackageChangeImpact } from './packageChangeImpact';

export interface PackageNextAction {
  id: string;
  kind: 'intake' | 'evidence' | 'consistency' | 'field' | 'citation' | 'review' | 'task' | 'delivery' | 'inspection' | 'impact';
  label: string;
  message: string;
  blocking: boolean;
  destination?: PackageWorkDestination;
  taskId?: string;
  overdue?: boolean;
}
export interface PackageNextActions {
  operation: PackageRequirementOperation;
  readyForOperation: boolean;
  actions: PackageNextAction[];
  computedBlockers: number;
  pendingTasks: number;
}
export interface PackageNextActionOptions {
  operation?: PackageRequirementOperation;
  policy?: PolicyResolution;
  signal?: AbortSignal;
  today?: string;
  /** This read-only projection preserves review bytes, not authority to start another owning review. */
  reviewBaseline?: boolean;
}

/** Inspect existing operation prerequisites. Local task status never participates in computed readiness. */
export async function derivePackageNextActions(input: ActionPackage, revisionId = input.currentRevisionId,
  options: PackageNextActionOptions = {}): Promise<PackageNextActions> {
  const record = actionPackageSchema.parse(structuredClone(input)), revision = getPackageRevision(record, revisionId);
  options = { ...options };
  const operation = options.operation ?? 'pdf', today = options.today ?? packageWorkToday();
  if (!['pdf', 'review', 'portable'].includes(operation)) throw new Error('Choose a supported package operation.');
  if (!isPackageWorkDate(today)) throw new Error('Use a real local calendar date for task inspection.');
  options.signal?.throwIfAborted();
  const policy = options.policy ?? await getExportDeploymentPolicy(), actions: PackageNextAction[] = [];
  const add = (action: PackageNextAction) => {
    if (actions.some(prior => prior.id === action.id)) return;
    const duplicate = actions.findIndex(prior => !['task', 'review', 'impact', 'delivery'].includes(prior.kind)
      && !['task', 'review', 'impact', 'delivery'].includes(action.kind)
      && prior.message === action.message && prior.destination?.memberId === action.destination?.memberId);
    if (duplicate < 0) actions.push(action);
    else if (actions[duplicate].kind === 'inspection' && action.kind !== 'inspection') actions[duplicate] = action;
  };
  for (const [index, finding] of conditionalMembershipFindings(revision).entries()) add({
    id: `intake-${index}`, kind: 'intake', label: 'Resolve saved intake', message: finding.message,
    blocking: operation !== 'portable', destination: { section: 'overview', panel: 'intake', ...(finding.memberId ? { memberId: finding.memberId } : {}) },
  });
  let readinessInspected = true;
  try {
    for (const finding of (await inspectPackageConsistency(revision, options.signal)).findings) if (['conflict', 'unresolved'].includes(finding.state)) add({
      id: `consistency-${finding.ruleId}`, kind: 'consistency', label: finding.label, message: `${finding.label}: ${finding.message}`,
      blocking: finding.required && operation !== 'portable',
      destination: { section: 'overview', panel: 'consistency', ...(finding.destinations.find(target => target.memberId) ?? finding.destinations[0]) },
    });
    const requirements = await inspectPackageRequirements(revision, operation, { signal: options.signal });
    for (const finding of requirements.items) if (['missing', 'unknown', 'invalid'].includes(finding.state)) add({
      id: `requirement-${finding.id}`, kind: 'evidence', label: finding.label, message: `${finding.label}: ${finding.message}`, blocking: true,
      destination: { section: 'overview', panel: 'requirements',
        ...(revision.requirements?.items.some(item => item.id === finding.id) ? { requirementId: finding.id } : {}),
        ...(finding.memberId ? { memberId: finding.memberId } : {}) },
    });
    for (const finding of await packageBindingReadiness(revision)) add({ id: `binding-${finding.bindingId}`, kind: 'field', label: 'Review a linked field',
      message: finding.message, blocking: operation === 'pdf', destination: { section: 'overview', panel: 'information', memberId: finding.memberId, bindingId: finding.bindingId } });
    for (const [index, finding] of (await packageCitationReadiness(revision)).entries()) if (finding.severity === 'error') add({
      id: `citation-${index}`, kind: 'citation', label: 'Repair a linked citation', message: finding.message, blocking: operation === 'pdf',
      destination: { section: 'documents', ...(finding.memberId ? { memberId: finding.memberId } : {}) },
    });
    if (operation === 'review') {
      if (options.reviewBaseline) add({ id: 'review-baseline', kind: 'review', label: 'Return to the owning package workspace',
        message: 'This view contains an exact saved review baseline. Use Return to package workspace before starting a new owning review.', blocking: true });
      if (record.archived) add({ id: 'review-archived', kind: 'inspection', label: 'Reopen the owning package',
        message: 'This archived package can be inspected, but must be reopened before starting a review.', blocking: true, destination: { section: 'overview' } });
      if (record.reviewRounds?.some(round => round.ownerPackageId === undefined)) add({ id: 'review-copy', kind: 'review', label: 'Return feedback to the owning package',
        message: 'This reviewer copy can inspect its captured content. Start a new review from the owning package.', blocking: true, destination: { section: 'review' } });
      if (revision.id !== record.currentRevisionId) add({ id: 'review-historical', kind: 'inspection', label: 'Open the current saved revision',
        message: 'These checks describe historical content. Open the current revision before preparing a new owning review.', blocking: true, destination: { section: 'review', revisionId: record.currentRevisionId } });
      if (policy.status !== 'ready') throw new Error(policy.message);
      if (revision.work) reviewPackageWork(revision.work, policy);
      if (!revision.members.length) add({ id: 'review-no-documents', kind: 'inspection', label: 'Add a saved document',
        message: 'Add a saved member before starting a package review.', blocking: true, destination: { section: 'documents' } });
      await validateActionPackageResources({ ...record, historyScope: 'selected-revision', currentRevisionId: revision.id, revisions: [revision], reviewRounds: undefined, reviewApplications: undefined, workingCopies: undefined }, async asset => {
        options.signal?.throwIfAborted(); const bytes = await readPackageAsset(asset); options.signal?.throwIfAborted(); return bytes;
      });
    } else {
      const assembly = await preparePackageAssembly(record, revision.id, policy, { signal: options.signal, includeRetainedDraftText: operation === 'portable' });
      for (const [index, finding] of assembly.readiness.findings.entries()) if (finding.severity === 'error') add({
        id: `readiness-${index}`, kind: 'inspection', label: 'Resolve a package check', message: finding.message, blocking: true,
        destination: { section: finding.memberId ? 'documents' : 'delivery', ...(finding.memberId ? { memberId: finding.memberId } : {}) },
      });
    }
  } catch (cause) {
    options.signal?.throwIfAborted(); readinessInspected = false;
    add({ id: 'inspection-error', kind: 'inspection', label: 'Inspect unavailable package content',
      message: cause instanceof Error ? cause.message : 'The package could not be inspected.', blocking: true, destination: { section: 'delivery' } });
  }
  try {
    // Compare exact saved inputs, including every retained review baseline. Workflow-only edits do not invalidate document reviews.
    const beforeId = record.revisions.some(candidate => candidate.id === revision.parentId) ? revision.parentId! : revision.id;
    const impact = await inspectPackageChangeImpact(record, beforeId, revision.id, options.signal);
    for (const section of impact.sections) if (section.kind === 'output' || section.kind === 'review') {
      for (const item of section.items) if (['changed', 'metadata-only', 'unknown', 'unavailable'].includes(item.state)) add({
        id: `impact-${section.kind}-${item.id}`, kind: 'impact', label: `${section.kind === 'review' ? 'Inspect recorded review' : 'Inspect retained PDF'}: ${item.label}`,
        message: item.message, blocking: false,
        destination: { section: section.kind === 'review' ? 'review' : 'delivery', ...item.destinations[0] },
      });
    }
    if (impact.limited) add({ id: 'impact-limited', kind: 'impact', label: 'Inspect saved change history',
      message: impact.notices.join(' '), blocking: false, destination: { section: 'overview' } });
  } catch (cause) {
    options.signal?.throwIfAborted();
    add({ id: 'impact-unavailable', kind: 'impact', label: 'Inspect saved change history',
      message: cause instanceof Error ? cause.message : 'Saved change impact could not be compared.', blocking: false, destination: { section: 'overview' } });
  }
  const activeReviews = (record.reviewRounds ?? []).filter(round => packageReviewRoundStatus(round) === 'active');
  for (const round of activeReviews) add({ id: `review-${round.id}`, kind: 'review', label: 'Inspect an active review',
    message: `${round.label} is tied to saved revision ${round.revisionId.slice(-8)}. Check its returned feedback and applicability.`,
    blocking: false, destination: { section: 'review', reviewRoundId: round.id, revisionId: round.revisionId } });
  const pendingTasks = revision.work?.tasks.filter(task => task.status === 'pending') ?? [];
  for (const task of pendingTasks) {
    const target = task.target ? resolvePackageTaskTarget(revision, task.target) : undefined;
    add({ id: `task-${task.id}`, kind: 'task', label: task.title, message: target?.state === 'missing' ? target.label : task.owner ? `Responsible person: ${task.owner}.` : 'No responsible person entered.',
      taskId: task.id, overdue: !!task.dueDate && task.dueDate < today, blocking: false,
      destination: target?.destination ?? { section: 'overview', panel: 'work' } });
  }
  const blockers = actions.filter(action => action.blocking).length;
  if (readinessInspected && blockers === 0) add({ id: `prepare-${operation}`, kind: 'delivery',
    label: operation === 'review' ? 'Prepare a package review' : operation === 'portable' ? 'Prepare an editable handoff' : 'Prepare PDF assembly',
    message: 'The inspected operation checks have no unresolved blockers. Review the captured content before continuing.',
    blocking: false, destination: { section: operation === 'review' ? 'review' : 'delivery' } });
  const priority = (action: PackageNextAction) => action.blocking ? 0 : action.kind === 'task' && action.overdue ? 1 : action.kind === 'review' || action.kind === 'impact' ? 2 : action.kind === 'task' ? 3 : 4;
  actions.sort((left, right) => priority(left) - priority(right));
  options.signal?.throwIfAborted();
  return { operation, readyForOperation: readinessInspected && blockers === 0, actions, computedBlockers: blockers, pendingTasks: pendingTasks.length };
}
