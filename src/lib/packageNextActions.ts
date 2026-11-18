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
interface ConsistencyFinding {
  ruleId: string; label: string; state: 'satisfied' | 'conflict' | 'unresolved' | 'excepted'; required: boolean; message: string;
  destinations: readonly { factId: string; memberId?: string; bindingId?: string }[];
}
export interface PackageNextActionOptions {
  operation?: PackageRequirementOperation;
  policy?: PolicyResolution;
  signal?: AbortSignal;
  today?: string;
  consistencyFindings?: readonly ConsistencyFinding[];
  /** Already computed package-impact findings can be composed without re-reading the same resources. */
  impact?: readonly Pick<PackageNextAction, 'id' | 'label' | 'message' | 'destination'>[];
}

/** Inspect existing operation prerequisites. Local task status never participates in computed readiness. */
export async function derivePackageNextActions(input: ActionPackage, revisionId = input.currentRevisionId,
  options: PackageNextActionOptions = {}): Promise<PackageNextActions> {
  const record = actionPackageSchema.parse(structuredClone(input)), revision = getPackageRevision(record, revisionId);
  options = { ...options,
    ...(options.consistencyFindings ? { consistencyFindings: structuredClone(options.consistencyFindings) } : {}),
    ...(options.impact ? { impact: structuredClone(options.impact) } : {}) };
  const operation = options.operation ?? 'pdf', today = options.today ?? packageWorkToday();
  if (!['pdf', 'review', 'portable'].includes(operation)) throw new Error('Choose a supported package operation.');
  if (!isPackageWorkDate(today)) throw new Error('Use a real local calendar date for task inspection.');
  if ((options.consistencyFindings?.length ?? 0) > 200 || (options.impact?.length ?? 0) > 200)
    throw new Error('Too many coordination findings to inspect.');
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
      if (policy.status !== 'ready') throw new Error(policy.message);
      if (revision.work) reviewPackageWork(revision.work, policy);
      if (!revision.members.length) add({ id: 'review-no-documents', kind: 'inspection', label: 'Add a saved document',
        message: 'Add a saved member before starting a package review.', blocking: true, destination: { section: 'documents' } });
      await validateActionPackageResources({ ...record, historyScope: 'selected-revision', currentRevisionId: revision.id, revisions: [revision], reviewRounds: undefined }, async asset => {
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
  for (const finding of options.consistencyFindings ?? []) if (['conflict', 'unresolved'].includes(finding.state)) add({
    id: `consistency-${finding.ruleId}`, kind: 'consistency', label: finding.label, message: finding.message,
    blocking: finding.required && operation !== 'portable', destination: { section: 'overview', panel: 'consistency', ...finding.destinations[0] },
  });
  for (const finding of options.impact ?? []) add({ ...structuredClone(finding), kind: 'impact', blocking: false });
  const activeReviews = (record.reviewRounds ?? []).filter(round => packageReviewRoundStatus(round) === 'active');
  for (const round of activeReviews) add({ id: `review-${round.id}`, kind: 'review', label: 'Inspect an active review',
    message: `${round.label} is tied to saved revision ${round.revisionId.slice(-8)}. Check its returned feedback and applicability.`,
    blocking: false, destination: { section: 'review' } });
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
