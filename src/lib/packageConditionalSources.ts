import type { ActionPackage, PackageAsset, PackageRevision } from './actionPackages';
import { getPackageRevision } from './actionPackages';
import { readPackageAsset } from './actionPackageAssets';
import { portableResourceDigest } from './portableResources';
import { validatePackageTemplate } from './packageTemplateLibrary';
import { packageTemplateProgramText, type PackageTemplateV2 } from './packageTemplateSchema';
import { evaluatePackageTemplateCondition, evaluatePackageTemplateProgram } from './packageTemplateProgram';
import { packageConditionalStateSchema, conditionalStateText, type PackageConditionalState } from './packageConditionalState';
import { reviewPackageNative, reviewPackageOriginal, reviewPackageText } from './actionPackageDisclosure';
import { validatePackageDraft } from './actionPackageDraft';
import { base64ToUint8Array } from './encoding';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';
import type { DocumentFieldSource } from './documentFields';

type Reader = (asset: PackageAsset) => Promise<ArrayBuffer>;
async function sourceTemplate(state: PackageConditionalState, read: Reader): Promise<PackageTemplateV2> {
  const bytes = await read(state.source);
  if (bytes.byteLength !== state.source.size || await portableResourceDigest(bytes) !== state.source.sha256)
    throw new Error('The captured action template is missing or corrupt.');
  const template = await validatePackageTemplate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (template.version !== 2) throw new Error('This action requires its exact versioned template.');
  return template;
}
function stateMatches(template: PackageTemplateV2, value: PackageConditionalState): void {
  const state = packageConditionalStateSchema.parse(value);
  if (template.id !== state.templateId || template.program.revision !== state.templateRevision)
    throw new Error('The captured action template does not match its saved revision.');
  const evaluation = evaluatePackageTemplateProgram(template.program, state.answers);
  if (!state.pending && !evaluation.ready) throw new Error('Applied action answers are incomplete or invalid.');
  const applied = state.appliedAnswers ?? state.answers;
  evaluatePackageTemplateProgram(template.program, applied);
  for (const fact of state.facts) {
    const question = template.program.questions.find(question => question.id === fact.questionId);
    if (!question || !!question.groupId !== !!fact.participantId)
      throw new Error('A saved action value does not belong to this template.');
  }
  for (const instance of state.instances) {
    const blueprint = template.members.find(member => member.key === instance.memberKey);
    if (!blueprint || !!blueprint.repeatGroupId !== !!instance.participantId || blueprint.required !== instance.required)
      throw new Error('A saved action document does not belong to this template.');
    const scope = blueprint.repeatGroupId && instance.participantId ? { groupId: blueprint.repeatGroupId, participantId: instance.participantId } : undefined;
    const personExists = !scope || applied.groups[scope.groupId]?.some(person => person.id === scope.participantId);
    const expected = !personExists ? false : blueprint.when
      ? evaluatePackageTemplateCondition(template.program, applied, blueprint.when, scope) : true;
    if (instance.condition !== expected) throw new Error('Saved action membership does not match its applied answers.');
  }
}

/** Shared transfer/recovery boundary; one template read per captured asset, even through long history. */
export async function validateConditionalPackageStates(record: ActionPackage, read: Reader): Promise<void> {
  const templates = new Map<string, Promise<PackageTemplateV2>>();
  for (const revision of [...record.revisions, ...(record.reviewRounds ?? []).map(round => round.baseline)]) {
    const state = revision.templateState;
    if (!state) continue;
    let template = templates.get(state.source.sha256);
    if (!template) { template = sourceTemplate(state, read); templates.set(state.source.sha256, template); }
    stateMatches(await template, state);
  }
}
export async function readConditionalPackageTemplate(record: ActionPackage, revisionId = record.currentRevisionId): Promise<PackageTemplateV2> {
  const state = getPackageRevision(record, revisionId).templateState;
  if (!state) throw new Error('This package has no captured action template.');
  const template = await sourceTemplate(state, readPackageAsset); stateMatches(template, state); return template;
}

export async function loadConditionalPackageSource(revision: PackageRevision, read: Reader = readPackageAsset,
  templates: Map<string, Promise<PackageTemplateV2>> = new Map()): Promise<{ template: PackageTemplateV2; state: PackageConditionalState } | undefined> {
  if (!revision.templateState) return undefined;
  const state = packageConditionalStateSchema.parse(revision.templateState);
  let retained = templates.get(state.source.sha256);
  if (!retained) { retained = sourceTemplate(state, read); templates.set(state.source.sha256, retained); }
  const template = await retained; stateMatches(template, state); return { template, state };
}
/** Include inactive branch text and PDF backgrounds carried by the pinned source in disclosure review. */
export async function reviewConditionalTemplate(template: PackageTemplateV2, policy: PolicyResolution): Promise<ExportReview[]> {
  const reviews = [reviewPackageText([template.name, packageTemplateProgramText(template),
    ...template.members.flatMap(member => [member.label, ...(member.kind === 'native' ? Object.values(member.pages).map(page => page.name) : [])])].join('\n'),
  'Captured action template and all branch declarations', policy)];
  const pages = new Set<string>();
  for (const member of template.members) if (member.kind === 'native') {
    const { session } = await validatePackageDraft(member.draft);
    reviews.push(reviewPackageNative(session, `Starter: ${member.label}`, policy, member.draft as unknown as DocumentFieldSource));
    for (const page of Object.values(member.pages)) {
      const key = page.data;
      if (pages.has(key)) continue;
      pages.add(key);
      const bytes = base64ToUint8Array(page.data);
      reviews.push(await reviewPackageOriginal(new Uint8Array(bytes).buffer, `Starter background: ${page.name}`, policy));
    }
  }
  return reviews;
}
export async function reviewConditionalPackage(revision: PackageRevision, policy: PolicyResolution, read: Reader = readPackageAsset): Promise<ExportReview[]> {
  if (!revision.templateState) return [];
  const template = await sourceTemplate(revision.templateState, read); stateMatches(template, revision.templateState);
  return [reviewPackageText(conditionalStateText(revision.templateState), 'Captured intake including retained inactive answers', policy),
    ...await reviewConditionalTemplate(template, policy)];
}
export function conditionalMembershipFindings(revision: PackageRevision): Array<{ message: string; memberId?: string }> {
  const state = revision.templateState;
  if (!state) return [];
  const findings: Array<{ message: string; memberId?: string }> = [];
  if (state.pending) findings.push({ message: 'Apply the saved intake changes before reviewing or assembling this package.' });
  const applied = state.appliedAnswers ?? state.answers;
  for (const mapping of state.facts) {
    const value = mapping.participantId ? Object.values(applied.groups).flat().find(person => person.id === mapping.participantId)?.answers[mapping.questionId]
      : applied.values[mapping.questionId];
    const fact = revision.information?.facts.find(fact => fact.id === mapping.factId);
    if (value !== undefined && value !== fact?.value)
      findings.push({ message: `Review the action intake after changing ${fact?.label ?? mapping.questionId} in package information.` });
  }
  for (const instance of state.instances) {
    if (instance.condition === 'unknown') findings.push({ message: `Resolve the intake questions for ${instance.label}.`, memberId: instance.memberId });
    else if (instance.condition && instance.required && !revision.members.some(member => member.id === instance.memberId))
      findings.push({ message: `Required document is missing: ${instance.label}.`, memberId: instance.memberId });
  }
  return findings;
}
