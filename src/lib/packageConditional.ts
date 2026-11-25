import { packageEndorsementRoutes } from './packageEndorsements';
import { resolvePackageRevisionSource, type MemberRevisionSource } from './packageRevisionSources';
import { captureTemplateSource } from './packageTemplateResources';
import { templateMemberPages } from '@/lib/packageTemplateSchema';
import { reviewPackageSigningMetadata } from './actionPackageDisclosure';
import { reviewPackageScans } from './actionPackageDisclosure';
import { materializePackageRequirements } from './packageRequirementsModel';
import { actionPackageSchema, commitActionPackage, getPackageRevision, listActionPackages, newPackageId, packageMemberLabel, packageAssets,
  type ActionPackage, type NativePackageMember, type PackageAsset, type PackageMember, type PackageRevision } from './actionPackages';
import { packageTemplateV2Schema, type PackageTemplateV2 } from './packageTemplateSchema';
import { validatePackageTemplate, MAX_TEMPLATE_ACTION_BYTES, type TemplateAttachment } from './packageTemplateLibrary';
import { evaluatePackageTemplateCondition, evaluatePackageTemplateProgram, packageTemplateAnswersSchema,
  type PackageTemplateAnswers, type PackageTemplateAnswer, type PackageTemplateQuestion, type PackageTemplateScope } from './packageTemplateProgram';
import { packageConditionalStateSchema, packageTemplateFactKey, packageTemplateInstanceKey, conditionalStateText, type PackageConditionalState } from './packageConditionalState';
import { readConditionalPackageTemplate, reviewConditionalTemplate, reviewConditionalPackage } from './packageConditionalSources';
import { packageInformationSchema, type PackageFact, type PackageInformation } from './packageInformation';
import { formatPackageFactForField, resolvePackageFieldBinding, type PackageFieldBinding } from './packageFieldBindings';
import { listPackageBindingFields, packageBindingTargetKey, patchPackageBindingDraftFields, type PackageBindingTarget } from './packageBindingTargets';
import { captureLinkedPackageChanges } from './packageLinkedUpdates';
import { reviewRestoredPackageSources } from './packageRestoredSources';
import type { PackageUpdateChoices, PackageUpdatePreview } from './packageUpdates';
import { readPackageAsset, readPackageMemberDraft, validatePackageOriginalPdf } from './actionPackageAssets';
import { validatePackageDraft } from './actionPackageDraft';
import { freshParagraphs } from './paragraphIdentity';
import { freshVolumeContent } from './publicationVolume';
import { sameReviewStoredValue, type StoredAttachment } from './documentsDb';
import { portableResourceDigest } from './portableResources';
import { base64ToUint8Array } from './encoding';
import { reviewPackageBindings, reviewPackageInformation, reviewPackageRequirements, reviewPackageNative, reviewPackageOriginal, reviewPackageText, reviewPackageConsistency, reviewPackageWork } from './actionPackageDisclosure';
import { withAttachmentStaging } from './attachments';
import { comparePackageChangeImpact, type PackageChangeImpact } from './packageChangeImpact';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';
import { reviewPackageAttachment } from './packageAttachmentCapabilities';
import type { SerializedSession } from '@/stores/documentStore';

export { packageTemplateInstanceKey, readConditionalPackageTemplate };
export type ConditionalMemberChoice = 'keep' | 'remove' | 'restore';
export interface ConditionalPackageChange {
  key: string; memberId?: string; label: string;
  state: 'add' | 'keep' | 'remove' | 'conflict' | 'missing' | 'unresolved';
  message: string; choices?: ConditionalMemberChoice[];
}
export interface ConditionalAnswerChange {
  key: string; label: string; before?: PackageTemplateAnswer; current?: PackageTemplateAnswer; requested?: PackageTemplateAnswer;
  state: 'update' | 'kept-current' | 'conflict';
}
export type ConditionalPdfChoice = TemplateAttachment | { name: string; reuse: MemberRevisionSource };
export interface ConditionalPackageInput {
  template: PackageTemplateV2; answers: PackageTemplateAnswers; record?: ActionPackage; name?: string;
  /** A durable roster reserves a fresh owning ID; the final before=null insert still rejects collisions. */
  newPackageId?: string;
  memberChoices?: Readonly<Record<string, ConditionalMemberChoice>>;
  fieldChoices?: PackageUpdateChoices;
  answerChoices?: Readonly<Record<string, 'keep-current' | 'use-intake'>>;
  attachments?: Readonly<Record<string, ConditionalPdfChoice>>;
}
export interface PreparedConditionalPackage {
  readonly packageName: string; readonly ready: boolean; readonly changed: boolean;
  readonly changes: readonly ConditionalPackageChange[];
  readonly answerChanges: readonly ConditionalAnswerChange[];
  readonly fieldChanges: readonly PackageUpdatePreview[];
  readonly issues: readonly string[]; readonly reviews: readonly ExportReview[];
  readonly impact?: PackageChangeImpact;
}
export interface ConditionalPackageUndo { readonly packageId: string; readonly appliedRevisionId: string }
interface Capture { before: ActionPackage | null; after?: ActionPackage; attachments: StoredAttachment[]; policy: string }
const plans = new WeakMap<PreparedConditionalPackage, Capture>();
const reversals = new WeakMap<ConditionalPackageUndo, { before: ActionPackage; after: ActionPackage }>();
const emptyAnswers = (): PackageTemplateAnswers => ({ version: 1, values: {}, groups: {} });
const own = <T>(value: T): T => structuredClone(value);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
function identity(policy: PolicyResolution): string {
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy); return JSON.stringify(policy.policy);
}
function editable(record: ActionPackage | null): void {
  if (record?.archived) throw new Error('Reopen this archived package before changing its intake.');
  if (record?.reviewRounds?.some(round => round.ownerPackageId === undefined)) throw new Error('A reviewer copy cannot change its captured intake.');
}
function capturedInput<T extends Pick<ConditionalPackageInput, 'template' | 'answers' | 'record' | 'name'>>(input: T): T {
  const files = Object.values((input as ConditionalPackageInput).attachments ?? {}).filter((file): file is TemplateAttachment => !('reuse' in file));
  if (files.some(file => !(file.data instanceof ArrayBuffer) || !file.data.byteLength || file.data.byteLength > 25 * 1024 * 1024)
    || files.reduce((sum, file) => sum + file.data.byteLength, 0) > MAX_TEMPLATE_ACTION_BYTES)
    throw new Error('Choose supported PDFs within the 25 MB file and 64 MB combined limits.');
  return own(input);
}
async function stage(attachments: StoredAttachment[], name: string, type: string, input: ArrayBuffer): Promise<PackageAsset> {
  if (!input.byteLength || input.byteLength > 25 * 1024 * 1024) throw new Error('An action file exceeds the supported 25 MB limit.');
  const data = input.slice(0), asset = { id: newPackageId('asset'), name, type, size: data.byteLength, sha256: await portableResourceDigest(data) };
  if (type === 'application/pdf') {
    const existing = attachments.find(item => item.name === name && item.type === type && 'sha256' in item && item.sha256 === asset.sha256);
    if (existing) return { ...asset, id: existing.id };
  }
  attachments.push({ ...asset, data });
  if (attachments.reduce((sum, asset) => sum + asset.size, 0) > MAX_TEMPLATE_ACTION_BYTES) throw new Error('Prepared action files exceed the combined 64 MB limit.');
  return asset;
}
function answerAt(answers: PackageTemplateAnswers, question: PackageTemplateQuestion, participantId?: string): PackageTemplateAnswer | undefined {
  return question.groupId ? answers.groups[question.groupId]?.find(person => person.id === participantId)?.answers[question.id] : answers.values[question.id];
}
function setAnswer(answers: PackageTemplateAnswers, question: PackageTemplateQuestion, participantId: string | undefined, value: PackageTemplateAnswer): void {
  if (question.groupId) {
    const person = answers.groups[question.groupId]?.find(person => person.id === participantId);
    if (person) person.answers[question.id] = value;
  } else answers.values[question.id] = value;
}
function participantContext(template: PackageTemplateV2, answers: PackageTemplateAnswers, participantId?: string, previous?: PackageTemplateAnswers): string {
  if (!participantId) return '';
  for (const [source, removed] of [[answers, false], [previous, true]] as const) {
    if (!source) continue;
    for (const [groupId, people] of Object.entries(source.groups)) {
      const index = people.findIndex(person => person.id === participantId);
      if (index >= 0) return `${template.program.participantGroups.find(group => group.id === groupId)?.label ?? groupId} ${index + 1} · ${people[index].label}${removed ? ' (removed)' : ''}`;
    }
  }
  return `Person ${participantId.slice(-8)}`;
}
function reconcile(template: PackageTemplateV2, record: ActionPackage | null, answers: PackageTemplateAnswers,
  choices: ConditionalPackageInput['answerChoices'] = {}): { answers: PackageTemplateAnswers; changes: ConditionalAnswerChange[]; issues: string[] } {
  const current = record && getPackageRevision(record), state = current?.templateState, next = own(answers);
  const changes: ConditionalAnswerChange[] = [], issues: string[] = [], known = new Set<string>();
  for (const mapping of state?.facts ?? []) {
    const question = template.program.questions.find(question => question.id === mapping.questionId);
    const fact = current?.information?.facts.find(fact => fact.id === mapping.factId);
    if (!question || !fact) continue;
    const key = packageTemplateFactKey(question.id, mapping.participantId); known.add(key);
    if (question.groupId && !next.groups[question.groupId]?.some(person => person.id === mapping.participantId)) continue;
    const before = mapping.appliedValue ?? answerAt(state!.appliedAnswers ?? state!.answers, question, mapping.participantId), requested = answerAt(next, question, mapping.participantId);
    const person = participantContext(template, next, mapping.participantId, state!.appliedAnswers), label = person ? `${person} · ${question.label}` : question.label;
    if (sameReviewStoredValue(fact.value, before) || sameReviewStoredValue(fact.value, requested)) continue;
    if (sameReviewStoredValue(requested, before) || choices[key] === 'keep-current') {
      setAnswer(next, question, mapping.participantId, fact.value);
      changes.push({ key, label, before, current: fact.value, requested, state: 'kept-current' });
    } else if (choices[key] === 'use-intake') changes.push({ key, label, before, current: fact.value, requested, state: 'update' });
    else {
      changes.push({ key, label, before, current: fact.value, requested, state: 'conflict' });
      issues.push(`${label}: choose the current package value or the changed intake answer.`);
    }
  }
  for (const people of Object.values(next.groups)) for (const person of people) {
    const prior = Object.values(state?.appliedAnswers?.groups ?? state?.answers.groups ?? {}).flat().find(prior => prior.id === person.id);
    const actual = current?.information?.participants.find(participant => participant.id === person.id);
    if (!prior || !actual) continue;
    const key = JSON.stringify(['participant-label', person.id]); known.add(key);
    if (actual.label === prior.label || actual.label === person.label) continue;
    const requested = person.label, label = `${participantContext(template, next, person.id)} · Person label`;
    if (requested === prior.label || choices[key] === 'keep-current') {
      person.label = actual.label; changes.push({ key, label, before: prior.label, current: actual.label, requested, state: 'kept-current' });
    } else if (choices[key] === 'use-intake') changes.push({ key, label, before: prior.label, current: actual.label, requested, state: 'update' });
    else { changes.push({ key, label, before: prior.label, current: actual.label, requested, state: 'conflict' }); issues.push(`${label}: choose the current package label or intake label.`); }
  }
  for (const [key, choice] of Object.entries(choices)) if (!known.has(key) || !['keep-current', 'use-intake'].includes(choice))
    throw new Error('An intake answer decision does not belong to this action.');
  return { answers: next, changes, issues };
}
/** Current information edits are merged into untouched intake answers without changing stored content. */
export function conditionalPackageAnswers(record: ActionPackage, revisionId = record.currentRevisionId): PackageTemplateAnswers {
  const revision = getPackageRevision(record, revisionId), state = revision.templateState;
  if (!state) throw new Error('This package has no saved action intake.');
  const answers = own(state.answers), baseline = state.appliedAnswers ?? state.answers;
  for (const mapping of state.facts) {
    const fact = revision.information?.facts.find(fact => fact.id === mapping.factId);
    if (!fact) continue;
    if (mapping.appliedValue !== undefined && sameReviewStoredValue(mapping.appliedValue, fact.value)) continue;
    if (!mapping.participantId) {
      if (sameReviewStoredValue(answers.values[mapping.questionId], baseline.values[mapping.questionId])) answers.values[mapping.questionId] = fact.value;
    } else {
      const nextPerson = Object.values(answers.groups).flat().find(person => person.id === mapping.participantId);
      const previousPerson = Object.values(baseline.groups).flat().find(person => person.id === mapping.participantId);
      if (nextPerson && sameReviewStoredValue(nextPerson.answers[mapping.questionId], previousPerson?.answers[mapping.questionId])) nextPerson.answers[mapping.questionId] = fact.value;
    }
  }
  for (const person of Object.values(answers.groups).flat()) {
    const saved = revision.information?.participants.find(participant => participant.id === person.id);
    const before = Object.values(baseline.groups).flat().find(participant => participant.id === person.id);
    if (saved && person.label === before?.label) person.label = saved.label;
  }
  return answers;
}
function stateFor(template: PackageTemplateV2, source: PackageConditionalState['source'], answers: PackageTemplateAnswers, prior?: PackageConditionalState): PackageConditionalState {
  return { version: 1, source, ...(template.primaryMemberKey && { primaryMemberKey: template.primaryMemberKey }), templateId: template.id, templateRevision: template.program.revision, pending: true, answers: own(answers),
    appliedAnswers: own(prior?.appliedAnswers ?? prior?.answers ?? emptyAnswers()), facts: own(prior?.facts ?? []), instances: own(prior?.instances ?? []), requirementIds: own(prior?.requirementIds ?? []),
    ...(prior?.upgrades ? { upgrades: own(prior.upgrades) } : {}) };
}
async function context(input: Pick<ConditionalPackageInput, 'template' | 'answers' | 'record' | 'name'>, attachments: StoredAttachment[]) {
  const template = packageTemplateV2Schema.parse(await validatePackageTemplate(input.template));
  const answers = packageTemplateAnswersSchema.parse(own(input.answers));
  evaluatePackageTemplateProgram(template.program, answers);
  const before = input.record ? actionPackageSchema.parse(own(input.record)) : null; editable(before);
  if (before && (input as ConditionalPackageInput).newPackageId) throw new Error('A reserved new package identity cannot replace an existing action.');
  const current = before ? getPackageRevision(before) : undefined;
  const bytes = new TextEncoder().encode(JSON.stringify(template)).buffer;
  const sha256 = await portableResourceDigest(bytes);
  if (before && (!current?.templateState || (current.templateState.source.resources?.templateSha256 ?? current.templateState.source.sha256) !== sha256))
    throw new Error('Use the exact captured template for this action. Newer templates require deliberate adoption.');
  const source = current?.templateState?.source ?? await captureTemplateSource(template, (name, type, data) => stage(attachments, name, type, data));
  return { template, answers, before, current, source: source as PackageConditionalState['source'], name: packageMemberLabel(input.name?.trim() || before?.name || `${template.name} action`) };
}
function buildRecord(before: ActionPackage | null, name: string, revision: PackageRevision, reservedId?: string): ActionPackage {
  return actionPackageSchema.parse(before ? { ...before, name, sequence: before.sequence + 1, currentRevisionId: revision.id, revisions: [...before.revisions, revision] }
    : { kind: 'dondocs-action-package-record', version: 1, id: reservedId ?? newPackageId('package'), name, archived: false, sequence: 0, currentRevisionId: revision.id, revisions: [revision] });
}
async function guardedCommit(before: ActionPackage | null, after: ActionPackage, attachments: StoredAttachment[], policy: PolicyResolution,
  signal?: AbortSignal, isCurrent: () => boolean = () => true, rosterPublish?: import('./packageRosterModel').PackageRosterPublish): Promise<ActionPackage> {
  const policyKey = identity(policy);
  if (identity(await getExportDeploymentPolicy()) !== policyKey) throw new Error('Deployment settings changed. Review the intake again.');
  let error: unknown;
  const current = () => {
    try { signal?.throwIfAborted(); if (!isCurrent()) throw new Error('This intake operation is no longer current.');
      if (identity(getExportDeploymentPolicySync()) !== policyKey) throw new Error('Deployment settings changed. Review the intake again.'); return true;
    } catch (cause) { error = cause; return false; }
  };
  if (!current()) throw error;
  const stored = (await listActionPackages()).find(record => record.id === after.id) ?? null;
  if (!sameReviewStoredValue(stored, before)) throw new Error('The saved package changed. Review its latest revision before applying intake.');
  try { return await withAttachmentStaging(() => commitActionPackage(before, after, signal, current, attachments, undefined, rosterPublish)); }
  catch (cause) { throw error ?? cause; }
}

/** Saving unfinished intake captures progress, while current documents and facts remain untouched. */
export async function saveConditionalPackageDraft(input: Pick<ConditionalPackageInput, 'template' | 'answers' | 'record' | 'name'>,
  policy: PolicyResolution, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  return persistIntakeDraft(input, policy, signal, isCurrent, false);
}

/** Capture unconditional starter documents before the user supplies case details. */
export function startConditionalPackage(template: PackageTemplateV2, policy: PolicyResolution, signal: AbortSignal | undefined, isCurrent: () => boolean) {
  return persistIntakeDraft({ template, name: template.name, answers: emptyAnswers() }, policy, signal, isCurrent, true);
}

async function persistIntakeDraft(input: Pick<ConditionalPackageInput, 'template' | 'answers' | 'record' | 'name'>,
  policy: PolicyResolution, signal: AbortSignal | undefined, isCurrent: () => boolean, start: boolean): Promise<ActionPackage> {
  input = capturedInput(input); signal?.throwIfAborted(); identity(policy);
  const attachments: StoredAttachment[] = [], { template, answers, before, current, source, name } = await context(input, attachments);
  if (current?.templateState?.pending && sameReviewStoredValue(current.templateState.answers, answers) && name === before?.name)
    throw new Error('This intake draft is already saved.');
  const state = stateFor(template, source, answers, current?.templateState);
  const members = current ? own(current.members) : [];
  if (start) {
    const information = materializeInformation(template, answers, state);
    for (const item of listConditionalPackageInstances(template, answers)) {
      signal?.throwIfAborted();
      const instance: PackageConditionalState['instances'][number] = { key: item.key, memberKey: item.memberKey,
        memberId: newPackageId('member'), label: item.label, condition: item.condition, required: item.required,
        ...(item.participantId ? { participantId: item.participantId } : {}) };
      state.instances.push(instance);
      const blueprint = template.members.find(member => member.key === item.memberKey)!;
      if (blueprint.kind === 'native' && item.condition === true) {
        const member = await nativeMember(blueprint, instance, template, answers, information, state, attachments, []);
        instance.generatedDigest = await memberDigest(member);
        members.push(member);
      }
    }
  }
  const requirements = materializePackageRequirements({ version: 1, items: conditionalRequirementSlots(template, answers, state).map(({ key: _key, ...item }) => item) }, current?.requirements);
  reviewPackageRequirements(requirements, policy);
  if (current?.consistency) reviewPackageConsistency(current.consistency, policy);
  if (current?.work) reviewPackageWork(current.work, policy);
  if (current?.signing) reviewPackageSigningMetadata(current.signing, policy);
  if (current?.scans) reviewPackageScans(current.scans, policy);
  if (current?.templateState?.upgrades?.length) await reviewConditionalPackage(current, policy);
  await reviewConditionalTemplate(template, policy); reviewPackageText(conditionalStateText(state), 'Saved intake draft', policy); reviewPackageText(name, 'Package name', policy);
  const revision: PackageRevision = { ...(current ? own(current) : {}), members, id: newPackageId('revision'),
    ...(current ? { parentId: current.id } : {}), createdAt: Date.now(), outputs: [], templateState: state, requirements };
  if (start && members.some(member => member.role === 'endorsement')) {
    validateRecipeEndorsements(template, revision);
    await (await import('./packageEndorsementDrafts')).stagePackageEndorsements(revision, attachments);
    for (const instance of state.instances) {
      const member = members.find(item => item.id === instance.memberId && item.endorsementLink);
      if (member) instance.generatedDigest = await memberDigest(member);
    }
  }
  return guardedCommit(before, buildRecord(before, name, revision), attachments, policy, signal, isCurrent);
}

async function memberDigest(member: PackageMember): Promise<string> {
  return portableResourceDigest(new TextEncoder().encode(JSON.stringify({ kind: member.kind, label: member.label, role: member.role, required: member.required,
    ...(member.kind !== 'native' ? { sha256: member.original.sha256, signed: member.signedOriginal }
      : { sha256: member.draft.sha256, templates: Object.entries(member.templates ?? {}).sort().map(([file, asset]) => [file, asset.sha256]) }) })).buffer);
}
function contexts(answers: PackageTemplateAnswers, groupId?: string): Array<{ scope?: PackageTemplateScope; label?: string }> {
  return groupId ? (answers.groups[groupId] ?? []).map(person => ({ scope: { groupId, participantId: person.id }, label: person.label })) : [{}];
}
/** An explicit recipe relationship must identify the same letter that the printed routing order uses. */
function validateRecipeEndorsements(template: PackageTemplateV2, revision: PackageRevision) {
  if (!template.members.some(member => member.kind === 'native' && member.endorses)) return;
  const state = revision.templateState!;
  const routes = packageEndorsementRoutes(revision);
  for (const instance of state.instances) {
    const member = template.members.find(candidate => candidate.key === instance.memberKey);
    if (member?.kind !== 'native' || !member.endorses || !revision.members.some(item => item.id === instance.memberId)) continue;
    const route = routes.get(instance.memberId);
    const source = state.instances.find(candidate => candidate.memberId === route?.basicMemberId);
    if (source?.memberKey !== member.endorses || source.participantId && source.participantId !== instance.participantId)
      throw new Error(instance.label + ': place this endorsement in the routing chain for its declared basic letter.');
  }
}

export function listConditionalPackageInstances(template: PackageTemplateV2, answers: PackageTemplateAnswers) {
  const expanded: Array<{ blueprint: PackageTemplateV2['members'][number]; scope?: PackageTemplateScope; label?: string }> = [];
  for (let index = 0; index < template.members.length;) {
    const blueprint = template.members[index];
    if (!blueprint.repeatGroupId) { expanded.push({ blueprint }); index++; continue; }
    let end = index + 1;
    while (end < template.members.length && template.members[end].repeatGroupId === blueprint.repeatGroupId) end++;
    for (const context of contexts(answers, blueprint.repeatGroupId)) for (const item of template.members.slice(index, end)) expanded.push({ blueprint: item, ...context });
    index = end;
  }
  return expanded.map(({ blueprint, scope, label }) => ({
    key: packageTemplateInstanceKey(blueprint.key, scope?.participantId), memberKey: blueprint.key, ...(scope ? { participantId: scope.participantId } : {}),
    label: packageMemberLabel(label ? `${blueprint.label.slice(0, 60)} · ${label.slice(0, 40)}${scope && (answers.groups[scope.groupId] ?? []).filter(person => person.label === label).length > 1 ? ` [${scope.participantId.slice(-8)}]` : ''}` : blueprint.label), kind: blueprint.kind,
    required: blueprint.required, condition: blueprint.when ? evaluatePackageTemplateCondition(template.program, answers, blueprint.when, scope) : true,
  }));
}
function freshDraft(input: Record<string, unknown>) {
  const draft = own(input), rows = new Map<string, string>();
  draft.timestamp = Date.now();
  const session = draft as unknown as SerializedSession;
  if (session.formData.volume) {
    const content = freshVolumeContent(session.formData.volume, session.paragraphs, { retained: session.docType !== 'technical_volume' });
    session.formData.volume = content.volume;
    draft.paragraphs = content.paragraphs;
  } else draft.paragraphs = freshParagraphs((draft.paragraphs ?? []) as SerializedSession['paragraphs']);
  const form = draft.genericForm as SerializedSession['genericForm'];
  if (form) {
    form.answerRevision = 0;
    for (const [groupId, values] of Object.entries(form.rows)) for (const row of values) {
      const previous = row.id; row.id = newPackageId('row'); rows.set(JSON.stringify([groupId, previous]), row.id);
    }
  }
  return { draft, rows };
}
function remapTarget(target: PackageBindingTarget, rows: Map<string, string>): PackageBindingTarget {
  if (target.kind !== 'configured-form' || !target.row) return own(target);
  const rowId = rows.get(JSON.stringify([target.row.groupId, target.row.rowId]));
  if (!rowId) throw new Error('The template field refers to an unavailable repeating row.');
  return { ...target, row: { ...target.row, rowId } };
}
function materializeInformation(template: PackageTemplateV2, answers: PackageTemplateAnswers, state: PackageConditionalState, current?: PackageRevision): PackageInformation {
  const information: PackageInformation = own(current?.information ?? { version: 1, participants: [], facts: [] });
  for (const group of template.program.participantGroups) for (const person of answers.groups[group.id] ?? []) {
    const prior = information.participants.find(participant => participant.id === person.id);
    if (prior) { if (prior.role !== group.role) throw new Error('A participant identity cannot change its role.'); prior.label = person.label; }
    else information.participants.push({ id: person.id, label: person.label, role: group.role });
  }
  for (const result of evaluatePackageTemplateProgram(template.program, answers).questions) {
    if (result.visibility !== true || !result.answered || !result.valid || result.value === undefined) continue;
    const question = template.program.questions.find(question => question.id === result.questionId)!;
    let mapping = state.facts.find(fact => fact.questionId === question.id && fact.participantId === result.scope?.participantId);
    if (!mapping) { mapping = { questionId: question.id, ...(result.scope ? { participantId: result.scope.participantId } : {}), factId: newPackageId('fact') }; state.facts.push(mapping); }
    const prior = information.facts.find(fact => fact.id === mapping!.factId);
    const fact = { id: mapping.factId, label: question.label, ...(mapping.participantId ? { participantId: mapping.participantId } : {}),
      kind: question.kind === 'choice' ? 'text' : question.kind, value: result.value, source: { kind: 'entered' } } as PackageFact;
    if (prior) { if (sameReviewStoredValue(prior.value, fact.value)) fact.source = prior.source; information.facts[information.facts.indexOf(prior)] = fact; }
    else information.facts.push(fact);
  }
  return packageInformationSchema.parse(information);
}
async function nativeMember(blueprint: Extract<PackageTemplateV2['members'][number], { kind: 'native' }>, instance: PackageConditionalState['instances'][number],
  template: PackageTemplateV2, answers: PackageTemplateAnswers, information: PackageInformation, state: PackageConditionalState,
  attachments: StoredAttachment[], bindings: PackageFieldBinding[]): Promise<NativePackageMember> {
  if (blueprint.requiredFiles?.length) throw new Error('Versioned native starters must use declared package evidence slots for fresh files.');
  const { draft: raw, rows } = freshDraft(blueprint.draft);
  let reviewed = await validatePackageDraft(raw), draft = raw;
  const fields = await listPackageBindingFields({ id: instance.memberId, revisionId: 'preparing', label: instance.label, role: blueprint.role, required: blueprint.required,
    kind: 'native', session: reviewed.session, draft: { id: 'preparing', name: 'draft.json', type: 'application/json', size: 1, sha256: '0'.repeat(64) } });
  const updates = [], links: PackageFieldBinding[] = [];
  instance.targets = [];
  for (const declared of blueprint.links ?? []) {
    const target = remapTarget(declared.target, rows), targetState = { questionId: declared.questionId, target, format: declared.format,
      linkId: newPackageId('link'), initialized: false };
    instance.targets.push(targetState);
    const question = template.program.questions.find(question => question.id === declared.questionId)!;
    const scope = question.groupId && instance.participantId ? { groupId: question.groupId, participantId: instance.participantId } : undefined;
    const visible = !question.when || evaluatePackageTemplateCondition(template.program, answers, question.when, scope) === true;
    const mapping = state.facts.find(fact => fact.questionId === question.id && fact.participantId === scope?.participantId);
    const fact = mapping && information.facts.find(fact => fact.id === mapping.factId);
    if (!visible || !fact || answerAt(answers, question, scope?.participantId) === undefined) continue;
    const field = fields.find(field => packageBindingTargetKey(field.target) === packageBindingTargetKey(target));
    if (!field) throw new Error('The declared starter field no longer matches its pinned form.');
    const value = formatPackageFactForField(fact, field, declared.format);
    if (value !== field.value) updates.push({ target, expected: field.value, value });
    targetState.initialized = true;
    links.push({ id: targetState.linkId, factId: fact.id, memberId: instance.memberId, target, format: declared.format, mode: 'linked', expectedValue: value });
  }
  if (updates.length) { const patched = await patchPackageBindingDraftFields(raw, updates); draft = patched.draft; reviewed = await validatePackageDraft(draft); }
  const pages: NonNullable<NativePackageMember['templates']> = {};
  for (const [file, page] of Object.entries(templateMemberPages(template, blueprint))) {
    const bytes = new Uint8Array(base64ToUint8Array(page.data)).buffer;
    const digest = await portableResourceDigest(bytes);
    pages[file] = state.source.resources?.pdfs.find(asset => asset.sha256 === digest && asset.name === page.name)
      ?? await stage(attachments, page.name, page.type, bytes);
  }
  bindings.push(...links);
  return { id: instance.memberId, revisionId: newPackageId('member-revision'), label: instance.label, role: blueprint.role, required: blueprint.required,
    kind: 'native', session: reviewed.session, draft: await stage(attachments, `${instance.label}.dondocs.json`, 'application/json', new TextEncoder().encode(JSON.stringify(draft)).buffer),
    ...(Object.keys(pages).length ? { templates: pages } : {}) };
}

export interface ConditionalRequirementSlot {
  key: string; id: string; definitionId?: string; participantId?: string; label: string; kind: 'document' | 'confirmation';
  operations: Array<'review' | 'pdf' | 'portable'>; condition: 'active' | 'inactive' | 'unknown'; memberId?: string; completion?: import('./packageRequirementsModel').FormCompletion;
}
/** PR9 materializes these declared slots without inventing a file or a completion flag. */
export function conditionalRequirementSlots(template: PackageTemplateV2, answers: PackageTemplateAnswers, state: PackageConditionalState): ConditionalRequirementSlot[] {
  const slots: ConditionalRequirementSlot[] = [];
  const idFor = (key: string) => {
    let item = state.requirementIds.find(item => item.key === key);
    if (!item) { item = { key, id: newPackageId('requirement') }; state.requirementIds.push(item); } return item.id;
  };
  for (const instance of state.instances) if (instance.required) {
    const key = JSON.stringify(['member', instance.memberKey, instance.participantId ?? null]);
    const completion = template.members.find(member => member.key === instance.memberKey)?.completion;
    slots.push({ key, id: idFor(key), ...(completion && { completion }), ...(instance.participantId ? { participantId: instance.participantId } : {}), label: instance.label,
      kind: 'document', operations: ['review', 'pdf'], condition: instance.condition === 'unknown' ? 'unknown' : instance.condition ? 'active' : 'inactive', memberId: instance.memberId });
  }
  for (const requirement of template.program.requirements) for (const { scope, label } of contexts(answers, requirement.repeatGroupId)) {
    const condition = requirement.when ? evaluatePackageTemplateCondition(template.program, answers, requirement.when, scope) : true;
    const key = JSON.stringify(['requirement', requirement.id, scope?.participantId ?? null]);
    const instance = requirement.memberKey && state.instances.find(instance => instance.memberKey === requirement.memberKey && instance.participantId === scope?.participantId);
    slots.push({ key, id: idFor(key), definitionId: requirement.id, ...(requirement.completion && { completion: requirement.completion }), ...(scope ? { participantId: scope.participantId } : {}),
      label: label ? `${requirement.label} · ${label}`.slice(0, 160) : requirement.label, kind: requirement.kind, operations: [...requirement.operations],
      condition: condition === 'unknown' ? 'unknown' : condition ? 'active' : 'inactive', ...(instance ? { memberId: instance.memberId } : {}) });
  }
  return slots;
}

/** Preview known membership and field changes against one exact saved package. No storage writes. */
export async function prepareConditionalPackage(input: ConditionalPackageInput, policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedConditionalPackage> {
  return prepareConditionalPackageContext(input, policy, signal);
}
interface AdoptedTemplateContext { before: ActionPackage; current: PackageRevision; source: PackageConditionalState['source']; attachments: StoredAttachment[] }
async function prepareConditionalPackageContext(input: ConditionalPackageInput, policy: PolicyResolution, signal?: AbortSignal, adopted?: AdoptedTemplateContext): Promise<PreparedConditionalPackage> {
  input = capturedInput(input); signal?.throwIfAborted(); const policyKey = identity(policy), attachments: StoredAttachment[] = [];
  if (input.record && input.newPackageId) throw new Error('A reserved new package identity cannot replace an existing action.');
  const { template, answers: supplied, before, current, source, name } = adopted
    ? { ...adopted, template: input.template, answers: input.answers, name: adopted.before.name } : await context(input, attachments);
  if (adopted) attachments.push(...adopted.attachments);
  const reconciliationRecord = adopted ? { ...adopted.before, revisions: adopted.before.revisions.map(item => item.id === adopted.current.id ? adopted.current : item) } : before;
  const reconciled = reconcile(template, reconciliationRecord, supplied, input.answerChoices), answers = reconciled.answers;
  const evaluation = evaluatePackageTemplateProgram(template.program, answers), issues = [...reconciled.issues,
    ...evaluation.issues.filter(issue => issue.severity === 'error' || issue.code === 'visibility-unknown').map(issue => issue.message)];
  const state = stateFor(template, source, answers, current?.templateState), changes: ConditionalPackageChange[] = [], earlyFields: PackageUpdatePreview[] = [];
  const reviews = [reviewPackageText(name, 'Package name', policy), reviewPackageText(conditionalStateText(state), 'Action intake and retained answers', policy),
    ...await reviewConditionalTemplate(template, policy), ...(current?.consistency ? [reviewPackageConsistency(current.consistency, policy)] : []),
    ...(current?.work ? [reviewPackageWork(current.work, policy)] : []),
    ...(current?.signing ? [reviewPackageSigningMetadata(current.signing, policy)] : []),
    ...(current?.scans ? [reviewPackageScans(current.scans, policy)] : [])];
  if (!adopted && current?.templateState?.upgrades?.length) reviews.push(...await reviewConditionalPackage(current, policy));
  const desired = listConditionalPackageInstances(template, answers);
  const selectedChoices = own(input.memberChoices ?? {}), knownKeys = new Set([...state.instances.map(item => item.key), ...desired.map(item => item.key)]);
  for (const [key, choice] of Object.entries(selectedChoices)) if (!knownKeys.has(key) || !['keep', 'remove', 'restore'].includes(choice)) throw new Error('A document decision does not belong to this action.');
  for (const key of Object.keys(input.attachments ?? {})) if (!desired.some(item => item.key === key && item.kind === 'attachment' && item.condition === true)) throw new Error('This PDF does not belong to an active action slot.');
  const early = () => {
    const qualifiedChanges = changes.map(change => {
      const person = participantContext(template, answers, state.instances.find(instance => instance.key === change.key)?.participantId, state.appliedAnswers);
      return person ? { ...change, label: `${person} · ${change.label}` } : change;
    });
    const qualifiedFields = earlyFields.map(change => {
      const instance = state.instances.find(item => item.memberId === change.memberId);
      const person = participantContext(template, answers, instance?.participantId, state.appliedAnswers);
      const memberLabel = current?.members.find(item => item.id === change.memberId)?.label ?? instance?.label;
      return { ...change, memberLabel, label: person ? `${person} · ${change.label}` : change.label };
    });
    const prepared = freeze({ packageName: name, ready: false, changed: true, changes: own(qualifiedChanges), answerChanges: own(reconciled.changes), fieldChanges: own(qualifiedFields), issues: [...issues], reviews: own(reviews) });
    plans.set(prepared, { before, attachments: [], policy: policyKey }); return prepared;
  };
  if (!evaluation.ready || reconciled.issues.length) {
    for (const item of desired) changes.push({ key: item.key, label: item.label, state: item.condition === 'unknown' ? 'unresolved' : 'keep', message: 'Complete the relevant intake answers before applying document changes.' });
    return early();
  }
  const retiredFacts = new Set<string>();
  for (const result of evaluation.questions) if (result.visibility === true && !result.answered) {
    const mapping = state.facts.find(fact => fact.questionId === result.questionId && fact.participantId === result.scope?.participantId);
    if (!mapping) continue;
    const bound = (current?.bindings?.items ?? []).filter(binding => binding.factId === mapping.factId);
    const question = template.program.questions.find(question => question.id === result.questionId)!;
    for (const binding of bound) if (binding.mode !== 'override' && !['keep-local', 'detach'].includes(input.fieldChoices?.[binding.id] ?? '')) {
      issues.push(`${question.label}: preserve the document value locally or detach its link before clearing this answer.`);
      earlyFields.push({ bindingId: binding.id, memberId: binding.memberId, label: question.label, state: 'conflict', before: binding.expectedValue,
        choices: ['keep-local', 'detach'],
        message: 'Clearing this intake answer requires an explicit decision about the existing document value.' });
    }
    state.facts = state.facts.filter(fact => fact !== mapping);
    if (!bound.length || bound.every(binding => input.fieldChoices?.[binding.id] === 'detach')) retiredFacts.add(mapping.factId);
    reconciled.changes.push({ key: packageTemplateFactKey(result.questionId, result.scope?.participantId), label: question.label,
      before: current?.information?.facts.find(fact => fact.id === mapping.factId)?.value, requested: result.value, state: 'update' });
  }
  if (issues.length) return early();
  const information = materializeInformation(template, answers, state, current);
  information.facts = information.facts.filter(fact => !retiredFacts.has(fact.id));
  const members = own(current?.members ?? []), bindings = own(current?.bindings?.items ?? []), selectedMembers: PackageMember[] = [];
  const clean = new Map<string, boolean>(), desiredKeys = new Set(desired.map(item => item.key));
  for (const prior of state.instances) if (!desiredKeys.has(prior.key)) prior.condition = false;
  for (const item of desired) {
    let instance = state.instances.find(instance => instance.key === item.key);
    if (!instance) { instance = { key: item.key, memberKey: item.memberKey, ...(item.participantId ? { participantId: item.participantId } : {}),
      memberId: newPackageId('member'), label: item.label, required: item.required, condition: item.condition }; state.instances.push(instance); }
    else instance.condition = item.condition;
  }
  const requirementSlots = conditionalRequirementSlots(template, answers, state);
  for (const instance of state.instances) {
    signal?.throwIfAborted();
    const blueprint = template.members.find(member => member.key === instance.memberKey)!;
    const existing = members.find(member => member.id === instance.memberId), choice = selectedChoices[instance.key];
    clean.set(instance.memberId, !!existing && instance.generatedDigest === await memberDigest(existing));
    if (instance.condition === 'unknown') { issues.push(`Resolve the branch for ${instance.label}.`); changes.push({ key: instance.key, label: instance.label, memberId: instance.memberId, state: 'unresolved', message: 'This branch needs an explicit answer.' }); continue; }
    if (!instance.condition) {
      if (!existing) continue;
      const keptPreviously = current?.templateState?.instances.some(prior => prior.key === instance.key && prior.condition === false);
      if (keptPreviously && choice !== 'remove') {
        selectedMembers.push(existing); changes.push({ key: instance.key, label: existing.label, memberId: existing.id, state: 'keep', message: 'Preserve the previously retained local document.' });
      } else if ((!clean.get(existing.id) || existing.kind === 'original') && choice !== 'keep' && choice !== 'remove') {
        issues.push(`Decide whether to keep or remove ${existing.label}.`);
        changes.push({ key: instance.key, label: existing.label, memberId: existing.id, state: 'conflict', choices: ['keep', 'remove'], message: 'This document was edited or supplied independently and no longer belongs to the selected branch.' });
      } else if (choice === 'keep') { instance.suppressed = false; selectedMembers.push(existing); changes.push({ key: instance.key, label: existing.label, memberId: existing.id, state: 'keep', message: 'Preserve this document outside the current template branch.' }); }
      else { instance.suppressed = choice === 'remove'; changes.push({ key: instance.key, label: existing.label, memberId: existing.id, state: 'remove', message: 'Remove from the current package; saved history keeps its exact bytes.' }); }
      continue;
    }
    if (existing) {
      if (input.attachments?.[instance.key]) throw new Error('Review removal of the existing original before replacing it with a new upload.');
      selectedMembers.push(existing); changes.push({ key: instance.key, label: existing.label, memberId: existing.id, state: 'keep', message: 'Keep captured content and local edits.' }); continue;
    }
    const existed = !!current?.templateState?.instances.some(prior => prior.key === instance.key && prior.generatedDigest && (prior.condition === true || prior.suppressed === true));
    if (existed && choice !== 'restore' && choice !== 'remove') {
      issues.push(`Decide whether to restore ${instance.label}.`);
      changes.push({ key: instance.key, label: instance.label, memberId: instance.memberId, state: 'conflict', choices: ['restore', 'remove'], message: 'This document was removed after creation. Restore it explicitly or keep the slot unfinished.' }); continue;
    }
    if (choice === 'remove') { instance.suppressed = true; changes.push({ key: instance.key, label: instance.label, memberId: instance.memberId, state: 'missing', choices: ['restore', 'remove'], message: 'The removed document stays absent; required evidence remains unresolved.' }); continue; }
    const previousInstance = current?.templateState?.instances.find(prior => prior.key === instance.key);
    const priorRevision = previousInstance?.generatedDigest && !input.attachments?.[instance.key]
      ? [...(before?.revisions ?? [])].reverse().find(revision => revision.members.some(member => member.id === instance.memberId)) : undefined;
    const historical = priorRevision?.members.find(member => member.id === instance.memberId);
    if (historical) {
      if (historical.kind === 'native') {
        const { draft } = await readPackageMemberDraft(historical);
        reviews.push(reviewPackageNative(historical.session, historical.label, policy, draft as SerializedSession));
        if (previousInstance?.condition === false) {
          const fields = await listPackageBindingFields(historical);
          for (const priorLink of priorRevision?.bindings?.items.filter(binding => binding.memberId === historical.id) ?? []) {
            if (bindings.some(binding => binding.id === priorLink.id)) continue;
            const restoredLink = own(priorLink);
            const targetState = instance.targets?.find(target => target.linkId === priorLink.id);
            const question = targetState && template.program.questions.find(question => question.id === targetState.questionId);
            const mapping = question && state.facts.find(fact => fact.questionId === question.id
              && fact.participantId === (question.groupId ? instance.participantId : undefined));
            const fact = information.facts.find(fact => fact.id === (targetState ? mapping?.factId : priorLink.factId));
            // A cleared answer must not resurrect its retired fact when an older document returns.
            // Reserve this formerly linked field for a later answer and an explicit local-value
            // decision. Genuinely absent historical links stay detached because this loop skips them.
            if (!fact) {
              if (targetState) { targetState.linkId = newPackageId('link'); targetState.initialized = false; }
              continue;
            }
            if (fact.id !== restoredLink.factId) {
              restoredLink.id = newPackageId('link'); restoredLink.factId = fact.id;
              if (targetState) { targetState.linkId = restoredLink.id; targetState.initialized = true; }
            }
            const field = fields.find(field => packageBindingTargetKey(field.target) === packageBindingTargetKey(restoredLink.target));
            if (field && field.value !== restoredLink.expectedValue) { restoredLink.mode = 'override'; restoredLink.expectedValue = field.value; }
            bindings.push(restoredLink);
          }
        }
      } else if (historical.kind === 'attachment') reviews.push((await reviewPackageAttachment(historical.original, await readPackageAsset(historical.original), policy, signal)).review);
      else reviews.push(await reviewPackageOriginal(await readPackageAsset(historical.original), historical.label, policy));
      selectedMembers.push(own(historical)); instance.suppressed = false;
      clean.set(historical.id, instance.generatedDigest === await memberDigest(historical));
      changes.push({ key: instance.key, label: instance.label, memberId: instance.memberId, state: 'add', message: 'Restore the last captured document, including its local changes and original bytes.' });
      continue;
    }
    // A transferred current-only package may lack removed content; explicit restore can regenerate a native starter.
    for (let index = bindings.length - 1; index >= 0; index--) if (bindings[index].memberId === instance.memberId) bindings.splice(index, 1);
    let member: PackageMember;
    if (blueprint.kind === 'attachment') {
      const file = input.attachments?.[instance.key];
      if (!file) { changes.push({ key: instance.key, label: instance.label, memberId: instance.memberId, state: 'missing', message: 'No file has been supplied. This remains an evidence slot.' }); continue; }
      const identity = { id: instance.memberId, revisionId: newPackageId('member-revision'), label: instance.label, role: blueprint.role, required: blueprint.required };
      if ('reuse' in file) {
        if (!before) throw new Error('Save the package before choosing an existing document version.');
        const source = resolvePackageRevisionSource(before, file.reuse);
        if (source.kind !== 'original') throw new Error('Choose a saved original PDF for this attachment slot.');
        const bytes = await readPackageAsset(source.original);
        const rules = requirementSlots.flatMap(item =>
          item.memberId === instance.memberId && item.condition === 'active' && item.completion ? [item.completion] : []);
        if (!instance.required && blueprint.completion) rules.push(blueprint.completion);
        const { verifyRevisionForEvidence } = await import('./packageRequirements');
        await verifyRevisionForEvidence(source, rules, { signal, readAsset: async () => bytes });
        reviews.push(await reviewPackageOriginal(bytes, source.original.name, policy));
        if (source.printableCopy) reviews.push(await reviewPackageOriginal(await readPackageAsset(source.printableCopy.asset), source.printableCopy.asset.name, policy));
        member = { ...source, ...identity };
        delete member.endorsementLink;
      } else {
        if (!/\.pdf$/i.test(file.name)) throw new Error('Action evidence slots currently accept PDF originals.');
        signal?.throwIfAborted(); await validatePackageOriginalPdf(file.data);
        reviews.push(await reviewPackageOriginal(file.data, file.name, policy));
        member = { ...identity, kind: 'original', signedOriginal: file.signedOriginal, original: await stage(attachments, file.name, 'application/pdf', file.data) };
      }
    } else member = await nativeMember(blueprint, instance, template, answers, information, state, attachments, bindings);
    instance.generatedDigest = await memberDigest(member); instance.suppressed = false; clean.set(member.id, true); selectedMembers.push(member);
    changes.push({ key: instance.key, label: instance.label, memberId: instance.memberId, state: 'add', message: 'reuse' in (input.attachments?.[instance.key] ?? {}) ? 'Use the selected saved PDF version, preserving its exact bytes.' : 'Add a fresh captured document from this exact template.' });
  }
  if (issues.length) return early();
  const managedIds = new Set(state.instances.map(instance => instance.memberId));
  const activeIds = new Set(state.instances.filter(instance => instance.condition === true).map(instance => instance.memberId));
  const byId = new Map(selectedMembers.map(member => [member.id, member]));
  const queue = desired.flatMap(item => { if (item.condition !== true) return []; const instance = state.instances.find(instance => instance.key === item.key)!; const member = byId.get(instance.memberId); return member ? [member] : []; });
  const ordered: PackageMember[] = [];
  for (const old of members) {
    if (activeIds.has(old.id)) { const next = queue.shift(); if (next) ordered.push(next); }
    else if (!managedIds.has(old.id) || byId.has(old.id)) ordered.push(byId.get(old.id) ?? old);
  }
  ordered.push(...queue);
  const retainedIds = new Set(ordered.map(member => member.id));
  for (const instance of state.instances) {
    if (instance.condition !== true) continue;
    const member = ordered.find(member => member.id === instance.memberId);
    if (!member || member.kind !== 'native' || !instance.targets?.some(target => !target.initialized)) continue;
    const fields = await listPackageBindingFields(member);
    for (const targetState of instance.targets ?? []) {
      if (targetState.initialized) continue;
      const question = template.program.questions.find(question => question.id === targetState.questionId)!;
      const result = evaluation.questions.find(result => result.questionId === question.id && result.scope?.participantId === (question.groupId ? instance.participantId : undefined));
      if (!result?.answered || result.visibility !== true || !result.valid) continue;
      const mapping = state.facts.find(fact => fact.questionId === question.id && fact.participantId === result.scope?.participantId);
      const fact = mapping && information.facts.find(fact => fact.id === mapping.factId);
      if (!fact) continue;
      if (bindings.some(binding => binding.memberId === member.id && packageBindingTargetKey(binding.target) === packageBindingTargetKey(targetState.target))) {
        targetState.initialized = true; continue; // A deliberate existing link owns the field.
      }
      const field = fields.find(field => packageBindingTargetKey(field.target) === packageBindingTargetKey(targetState.target));
      if (!field) { issues.push(`The saved optional field for ${question.label} is missing. Review its native document.`); continue; }
      const desiredValue = formatPackageFactForField(fact, field, targetState.format);
      if (field.value !== null && field.value !== '' && field.value !== desiredValue && !input.fieldChoices?.[targetState.linkId]) {
        issues.push(`${question.label}: decide whether to preserve the independently entered document value or apply intake.`);
        earlyFields.push({ bindingId: targetState.linkId, memberId: member.id, label: question.label, state: 'conflict', before: field.value, after: desiredValue,
          message: 'This optional field was filled independently before its intake answer was supplied.' }); continue;
      }
      targetState.initialized = true;
      bindings.push({ id: targetState.linkId, memberId: member.id, factId: fact.id, target: own(targetState.target), format: targetState.format,
        mode: 'linked', expectedValue: field.value });
    }
  }
  if (issues.length) return early();
  const keptBindings = bindings.filter(binding => retainedIds.has(binding.memberId));
  const inactiveFields: PackageUpdatePreview[] = [];
  for (const binding of keptBindings) {
    const mapping = state.facts.find(fact => fact.factId === binding.factId), instance = state.instances.find(instance => instance.memberId === binding.memberId);
    if (!mapping || !instance || !current?.bindings?.items.some(item => item.id === binding.id)) continue;
    const result = evaluation.questions.find(question => question.questionId === mapping.questionId && question.scope?.participantId === mapping.participantId);
    if (result?.visibility === true || binding.mode === 'override') continue;
    if (!['keep-local', 'detach'].includes(input.fieldChoices?.[binding.id] ?? '')) {
      const field = await resolvePackageFieldBinding(current, binding);
      issues.push(`${field.label}: decide whether to preserve or detach the field whose question is now inactive.`);
      inactiveFields.push({ bindingId: binding.id, memberId: binding.memberId, label: field.label, state: 'conflict',
        ...(field.field ? { before: field.field.value } : {}), choices: ['keep-local', 'detach'],
        message: 'The controlling question became inactive; existing document content is preserved until an explicit decision.' });
    }
  }
  state.pending = false; state.appliedAnswers = own(answers);
  for (const mapping of state.facts) {
    const fact = information.facts.find(fact => fact.id === mapping.factId);
    if (fact) mapping.appliedValue = fact.value;
  }
  const requirements = materializePackageRequirements({ version: 1, items: requirementSlots.map(({ key: _key, ...item }) => item) }, current?.requirements);
  reviews.push(reviewPackageRequirements(requirements, policy));
  const revision: PackageRevision = { ...(current ? own(current) : { members: [], outputs: [] }), id: newPackageId('revision'),
    ...(current ? { parentId: current.id } : {}), createdAt: Date.now(), members: ordered, information, bindings: { version: 1, items: keptBindings },
    templateState: packageConditionalStateSchema.parse(state), requirements, outputs: [] };
  validateRecipeEndorsements(template, revision);
  const staged = new Map(attachments.map(asset => [asset.id, asset]));
  const planned = await captureLinkedPackageChanges(current ?? { id: 'initial', createdAt: 0, members: [], outputs: [] }, revision,
    input.fieldChoices ?? {}, policy, signal, async member => {
      const asset = staged.get(member.draft.id); return asset ? { draft: JSON.parse(new TextDecoder().decode(asset.data)) } : readPackageMemberDraft(member);
    });
  issues.push(...planned.issues);
  for (const instance of planned.revision.templateState!.instances) {
    const member = planned.revision.members.find(member => member.id === instance.memberId);
    if (member && clean.get(member.id)) instance.generatedDigest = await memberDigest(member);
  }
  const after = buildRecord(before, name, planned.revision, input.newPackageId);
  for (const change of changes) {
    const instance = state.instances.find(instance => instance.key === change.key);
    const person = participantContext(template, answers, instance?.participantId, current?.templateState?.appliedAnswers);
    if (person) change.label = `${person} · ${change.label}`;
    const oldIndex = current?.members.findIndex(member => member.id === change.memberId) ?? -1;
    const newIndex = planned.revision.members.findIndex(member => member.id === change.memberId);
    if (change.state === 'keep' && oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex)
      change.message = `Move from document ${oldIndex + 1} to ${newIndex + 1}; preserve captured content and local edits.`;
  }
  const fieldChanges = [...new Map([...planned.changes, ...inactiveFields].map(change => [change.bindingId, change])).values()];
  const memberLabels = new Map([...(current?.members ?? []), ...planned.revision.members].map(member => [member.id, member.label]));
  for (const change of fieldChanges) {
    change.memberLabel = memberLabels.get(change.memberId);
    const instance = state.instances.find(instance => instance.memberId === change.memberId);
    const person = participantContext(template, answers, instance?.participantId, current?.templateState?.appliedAnswers);
    if (person) change.label = `${person} · ${change.label}`;
  }
  const changed = !current || !sameReviewStoredValue({ ...current, id: undefined, parentId: undefined, createdAt: undefined, outputs: [] },
    { ...planned.revision, id: undefined, parentId: undefined, createdAt: undefined, outputs: [] }) || name !== before?.name;
  const prepared = freeze({ packageName: name, ready: !issues.length, changed, changes: own(changes), answerChanges: own(reconciled.changes),
    fieldChanges: own(fieldChanges), issues: [...issues], reviews: [...own(reviews), ...own(planned.reviews)],
    ...(current && !issues.length ? { impact: await comparePackageChangeImpact(current, planned.revision, { reviewRounds: before?.reviewRounds, retainedRevisions: before?.revisions.filter(item => item.outputs.length), packageId: before?.id, signal }) } : {}) });
  const retained = new Set(packageAssets(after).map(asset => asset.id));
  plans.set(prepared, { before, after, attachments: [...attachments, ...planned.attachments].filter(asset => retained.has(asset.id)), policy: policyKey });
  return prepared;
}

export async function applyPreparedConditionalPackage(prepared: PreparedConditionalPackage, policy: PolicyResolution, reviewed: boolean,
  signal?: AbortSignal, isCurrent: () => boolean = () => true, rosterPublish?: import('./packageRosterModel').PackageRosterPublish): Promise<{ record: ActionPackage; undo?: ConditionalPackageUndo }> {
  const captured = plans.get(prepared);
  if (!captured?.after || captured.policy !== identity(policy)) throw new Error('Prepare and review these action changes again.');
  if (!prepared.ready || !prepared.changed || !reviewed) throw new Error('Resolve and review the action changes before applying them.');
  if (rosterPublish && captured.before) throw new Error('A roster can create a fresh action, never replace an owning package.');
  const publication = rosterPublish && own(rosterPublish);
  const record = await guardedCommit(captured.before, captured.after, captured.attachments, policy, signal, isCurrent, publication);
  plans.delete(prepared);
  if (!captured.before) return { record };
  const undo = freeze({ packageId: record.id, appliedRevisionId: record.currentRevisionId });
  reversals.set(undo, { before: captured.before, after: own(record) }); return { record, undo };
}
/** An owned metadata copy supports durable row receipts; file bytes and mutation authority remain private. */
export function copyPreparedConditionalPackageRecord(prepared: PreparedConditionalPackage): { record: ActionPackage; stagedBytes: number } {
  const captured = plans.get(prepared);
  if (!captured?.after || !prepared.ready) throw new Error('Resolve this exact action preparation first.');
  return { record: own(captured.after), stagedBytes: captured.attachments.reduce((sum, item) => sum + item.size, 0) };
}

export interface ConditionalTemplateUpgradeInput extends ConditionalPackageInput {
  record: ActionPackage; questionMappings: Readonly<Record<string, string | null>>;
  memberMappings: Readonly<Record<string, string | null>>; preserveUnmapped: boolean;
}
export interface PreparedConditionalTemplateUpgrade extends PreparedConditionalPackage {
  readonly upgrade: { readonly from: string; readonly to: string; readonly preservedAnswers: number; readonly preservedMembers: number };
}
export function mappedConditionalTemplateAnswers(template: PackageTemplateV2, next: PackageTemplateV2, answers: PackageTemplateAnswers, mappings: Readonly<Record<string, string | null>>): PackageTemplateAnswers {
  const result: PackageTemplateAnswers = { version: 1, values: {}, groups: {} };
  for (const group of next.program.participantGroups) if (answers.groups[group.id]) result.groups[group.id] = answers.groups[group.id].map(person => ({ ...own(person), answers: {} }));
  for (const question of template.program.questions) {
    const id = mappings[question.id]; if (!id) continue;
    const target = next.program.questions.find(item => item.id === id)!;
    if (!question.groupId) { const value = answers.values[question.id]; if (value !== undefined) result.values[target.id] = value; }
    else for (const person of answers.groups[question.groupId] ?? []) {
      const value = person.answers[question.id], selected = result.groups[target.groupId!]?.find(item => item.id === person.id);
      if (value !== undefined && selected) selected.answers[target.id] = value;
    }
  }
  return result;
}
/** Deliberate membership adoption reuses intake reconciliation. It never replaces existing document bodies. */
export async function prepareConditionalTemplateUpgrade(input: ConditionalTemplateUpgradeInput, policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedConditionalTemplateUpgrade> {
  input = capturedInput(input); signal?.throwIfAborted(); identity(policy);
  if (input.preserveUnmapped !== true) throw new Error('Explicitly preserve unmapped answers, independent documents, local links and history before adopting a template.');
  const before = actionPackageSchema.parse(own(input.record)); editable(before);
  const original = getPackageRevision(before), previous = await readConditionalPackageTemplate(before), template = packageTemplateV2Schema.parse(await validatePackageTemplate(input.template));
  if (original.templateState!.pending) throw new Error('Apply or resolve the saved intake draft before adopting another template.');
  if (await portableResourceDigest(new TextEncoder().encode(JSON.stringify(template)).buffer) === (original.templateState!.source.resources?.templateSha256 ?? original.templateState!.source.sha256))
    throw new Error('This exact template is already captured by the action.');
  const questionMappings = own(input.questionMappings), memberMappings = own(input.memberMappings);
  const requireMappings = (known: string[], mappings: Readonly<Record<string, string | null>>, targets: string[]) => {
    if (Object.keys(mappings).length !== known.length || known.some(id => !Object.hasOwn(mappings, id))
      || Object.entries(mappings).some(([id, target]) => !known.includes(id) || target !== null && !targets.includes(target)))
      throw new Error('Choose an explicit mapping or independent preservation for every source declaration.');
    const selected = Object.values(mappings).filter((value): value is string => value !== null);
    if (new Set(selected).size !== selected.length) throw new Error('Each source declaration needs a distinct destination.');
  };
  requireMappings(previous.program.questions.map(item => item.id), questionMappings, template.program.questions.map(item => item.id));
  requireMappings(previous.members.map(item => item.key), memberMappings, template.members.map(item => item.key));
  if (memberMappings[previous.members[0].key] !== template.members[0].key) throw new Error('Map the existing main document to the new main slot; its current text will be preserved.');
  for (const question of previous.program.questions) if (questionMappings[question.id]) {
    const target = template.program.questions.find(item => item.id === questionMappings[question.id])!;
    if (question.kind !== target.kind || question.groupId !== target.groupId) throw new Error('Mapped questions must keep their answer type and participant group. Preserve incompatible answers independently.');
  }
  for (const group of previous.program.participantGroups) {
    const target = template.program.participantGroups.find(item => item.id === group.id);
    if (target && target.role !== group.role) throw new Error('Existing participants cannot inherit a different role during an upgrade.');
  }
  const attachments: StoredAttachment[] = [], source = await captureTemplateSource(template, (name, type, data) => stage(attachments, name, type, data));
  const current = own(original), prior = current.templateState!;
  prior.upgrades = [...prior.upgrades ?? [], { id: newPackageId('template-upgrade'), source: own(prior.source), templateId: prior.templateId,
    templateRevision: prior.templateRevision, answers: own(prior.answers), ...(prior.appliedAnswers ? { appliedAnswers: own(prior.appliedAnswers) } : {}),
    questionMappings, memberMappings, ...(original.requirements ? { requirements: own(original.requirements) } : {}), createdAt: Date.now() }];
  if (template.primaryMemberKey) prior.primaryMemberKey = template.primaryMemberKey;
  else delete prior.primaryMemberKey;
  prior.source = source as PackageConditionalState['source']; prior.templateId = template.id; prior.templateRevision = template.program.revision;
  prior.answers = mappedConditionalTemplateAnswers(previous, template, prior.answers, questionMappings);
  prior.appliedAnswers = mappedConditionalTemplateAnswers(previous, template, prior.appliedAnswers ?? original.templateState!.answers, questionMappings);
  prior.facts = prior.facts.flatMap(fact => questionMappings[fact.questionId] ? [{ ...fact, questionId: questionMappings[fact.questionId]! }] : []);
  const instances: PackageConditionalState['instances'] = [];
  for (const instance of prior.instances) {
    const key = memberMappings[instance.memberKey]; if (!key) continue;
    const blueprint = template.members.find(item => item.key === key)!, old = previous.members.find(item => item.key === instance.memberKey)!;
    if (blueprint.kind !== old.kind || blueprint.repeatGroupId !== old.repeatGroupId) throw new Error('Mapped document slots must keep their kind and participant group. Preserve incompatible documents independently.');
    const mapped = { ...instance, memberKey: key, key: packageTemplateInstanceKey(key, instance.participantId), required: blueprint.required };
    const member = current.members.find(item => item.id === mapped.memberId);
    if (blueprint.kind === 'attachment' && member?.kind === 'attachment') throw new Error('A non-PDF file cannot fill a PDF template slot. Preserve it independently and supply a reviewed PDF.');
    if (blueprint.kind === 'native' && member?.kind === 'native') {
      const fields = await listPackageBindingFields(member);
      mapped.targets = (blueprint.links ?? []).map(link => {
        const field = fields.find(item => packageBindingTargetKey(item.target) === packageBindingTargetKey(link.target));
        if (!field) throw new Error('Upgrade this form definition separately before adopting its changed field declaration.');
        const binding = current.bindings?.items.find(item => item.memberId === member.id && packageBindingTargetKey(item.target) === packageBindingTargetKey(link.target));
        const fact = prior.facts.find(item => item.questionId === link.questionId && item.participantId === (template.program.questions.find(question => question.id === link.questionId)?.groupId ? mapped.participantId : undefined));
        if (binding && (binding.factId !== fact?.factId || binding.format !== link.format)) throw new Error('An existing field link controls this value differently. Detach it deliberately before adopting the changed mapping.');
        return { questionId: link.questionId, target: own(field.target), format: link.format, linkId: binding?.id ?? newPackageId('link'), initialized: false };
      });
    } else if (mapped.targets) mapped.targets = mapped.targets.flatMap(target => questionMappings[target.questionId] ? [{ ...target, questionId: questionMappings[target.questionId]! }] : []);
    instances.push(mapped);
  }
  prior.instances = instances;
  // Existing requirement identities are not reused for a different controlling template.
  prior.requirementIds = [];
  const retainedReviews = await reviewConditionalPackage(original, policy);
  const prepared = await prepareConditionalPackageContext({ ...input, template }, policy, signal, { before, current, source: prior.source, attachments });
  const captured = plans.get(prepared)!, preservedMembers = original.templateState!.instances.filter(item => !memberMappings[item.memberKey] && original.members.some(member => member.id === item.memberId)).length;
  const result = freeze({ ...prepared, upgrade: { from: `${previous.name} · ${previous.program.revision}`, to: `${template.name} · ${template.program.revision}`,
    preservedAnswers: previous.program.questions.filter(item => questionMappings[item.id] === null).length, preservedMembers },
    reviews: [...retainedReviews, ...prepared.reviews], ...(captured.after && prepared.ready ? { impact: await comparePackageChangeImpact(original, getPackageRevision(captured.after), { reviewRounds: before.reviewRounds, packageId: before.id, signal }) } : {}) });
  plans.delete(prepared); plans.set(result, captured); return result;
}
export async function undoConditionalPackage(receipt: ConditionalPackageUndo, policy: PolicyResolution,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const captured = reversals.get(receipt);
  if (!captured) throw new Error('This action change can no longer be undone here. Saved history remains available.');
  const original = getPackageRevision(captured.before);
  await reviewConditionalPackage(original, policy); reviewPackageText(captured.before.name, 'Package name', policy);
  if (original.information) reviewPackageInformation(original.information, policy);
  if (original.bindings) reviewPackageBindings(original.bindings, policy);
  if (original.requirements) reviewPackageRequirements(original.requirements, policy);
  if (original.consistency) reviewPackageConsistency(original.consistency, policy);
  if (original.work) reviewPackageWork(original.work, policy);
  if (original.signing) reviewPackageSigningMetadata(original.signing, policy);
  if (original.scans) {
    reviewPackageScans(original.scans, policy);
    const { reviewPackageScanSources } = await import('./packageScans');
    await reviewPackageScanSources(original.scans, policy, { signal });
  }
  await reviewRestoredPackageSources(original, policy, signal);
  const revision = { ...own(original), id: newPackageId('revision'), parentId: captured.after.currentRevisionId, createdAt: Date.now(), outputs: [] };
  const record = await guardedCommit(captured.after, buildRecord(captured.after, captured.before.name, revision), [], policy, signal, isCurrent);
  reversals.delete(receipt); return record;
}
