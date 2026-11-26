import { nativeSigningFormId } from '@/services/forms/nativeCatalog';
import type { ActionPackage, PackageAsset, PackageRevision } from './actionPackages';
import { getPackageRevision } from './actionPackages';
import { readPackageAsset } from './actionPackageAssets';
import { restoreTemplateSource } from './packageTemplateResources';
import { packageTemplateProgramText, type PackageTemplateV2 } from './packageTemplateSchema';
import { evaluatePackageTemplateCondition, evaluatePackageTemplateProgram } from './packageTemplateProgram';
import { packageConditionalStateSchema, conditionalStateText, type PackageConditionalState } from './packageConditionalState';
import { reviewPackageNative, reviewPackageOriginal, reviewPackageText } from './actionPackageDisclosure';
import { validatePackageDraft } from './actionPackageDraft';
import { base64ToUint8Array } from './encoding';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';
import type { DocumentFieldSource } from './documentFields';
import { sameReviewStoredValue } from './documentsDb';

type Reader = (asset: PackageAsset) => Promise<ArrayBuffer>;
async function sourceTemplate(state: Pick<PackageConditionalState, 'source'>, read: Reader): Promise<PackageTemplateV2> {
  return restoreTemplateSource(state.source, read);
}
function stateMatches(template: PackageTemplateV2, value: PackageConditionalState, revision: PackageRevision): void {
  const state = packageConditionalStateSchema.parse(value);
  if (!!template.deliveryChoices !== !!state.hasDeliveryChoices || template.primaryMemberKey !== state.primaryMemberKey || template.id !== state.templateId || template.program.revision !== state.templateRevision)
    throw new Error('The captured action template does not match its saved revision.');
  const evaluation = evaluatePackageTemplateProgram(template.program, state.answers);
  if (!state.pending && !evaluation.ready) throw new Error('Applied action answers are incomplete or invalid.');
  const applied = state.appliedAnswers ?? state.answers;
  const appliedEvaluation = evaluatePackageTemplateProgram(template.program, applied);
  if (!state.pending && !sameReviewStoredValue(state.answers, applied)) throw new Error('Applied intake cannot contain a different pending answer set.');
  if (!state.pending) {
    for (const blueprint of template.members) {
      const ids = blueprint.repeatGroupId ? (applied.groups[blueprint.repeatGroupId] ?? []).map(person => person.id) : [undefined];
      for (const participantId of ids) if (!state.instances.some(instance => instance.memberKey === blueprint.key && instance.participantId === participantId))
        throw new Error('The captured action is missing a declared document mapping.');
    }
    for (const question of appliedEvaluation.questions) if (question.visibility === true && question.answered && question.valid
      && !state.facts.some(fact => fact.questionId === question.questionId && fact.participantId === question.scope?.participantId))
      throw new Error('The captured action is missing an applied question mapping.');
  }
  for (const fact of state.facts) {
    const question = template.program.questions.find(question => question.id === fact.questionId);
    if (!question || !!question.groupId !== !!fact.participantId)
      throw new Error('A saved action value does not belong to this template.');
  }
  for (const member of revision.members) {
    if (member.kind !== 'original' || !member.evidenceSlotId) continue;
    const slot = state.instances.find(item => item.memberId === member.evidenceSlotId);
    const declaration = template.members.find(item => item.key === slot?.memberKey);
    if (declaration?.kind !== 'attachment' || !declaration.multipleFiles || member.id === member.evidenceSlotId ||
        !revision.members.some(owner => owner.kind === 'original' && owner.id === member.evidenceSlotId))
      throw new Error('A supporting PDF does not belong to a declared evidence group.');
  }
  for (const instance of state.instances) {
    const blueprint = template.members.find(member => member.key === instance.memberKey);
    if (!blueprint || !!blueprint.repeatGroupId !== !!instance.participantId || blueprint.required !== instance.required)
      throw new Error('A saved action document does not belong to this template.');
    const captured = revision.members.find(member => member.id === instance.memberId);
    const signedForm = captured?.kind === 'original' && captured.signedOriginal && !!captured.officialFormId
      && blueprint.kind === 'native' && captured.officialFormId === nativeSigningFormId(blueprint.draft.documentCategory, blueprint.draft.formType);
    if (captured && !signedForm && (captured.kind === 'native') !== (blueprint.kind === 'native'))
      throw new Error('A captured action document does not match its declared kind.');
    if ((instance.generatedDigest || captured?.kind === 'native') && blueprint.kind === 'native') {
      const targets = instance.targets ?? [];
      if (targets.length !== (blueprint.links?.length ?? 0)) throw new Error('The captured action is missing native field declarations.');
      for (const declaration of blueprint.links ?? []) {
        const target = targets.find(target => target.questionId === declaration.questionId && target.format === declaration.format
          && sameReviewStoredValue(target.target.kind === 'configured-form' && target.target.row ? { ...target.target, row: { ...target.target.row, rowId: '' } } : target.target,
          declaration.target.kind === 'configured-form' && declaration.target.row ? { ...declaration.target, row: { ...declaration.target.row, rowId: '' } } : declaration.target));
        if (!target) throw new Error('A captured native field does not match its declared template target.');
      }
    }
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
    let template = templates.get(JSON.stringify(state.source));
    if (!template) { template = sourceTemplate(state, read); templates.set(JSON.stringify(state.source), template); }
    stateMatches(await template, state, revision);
    for (const upgrade of state.upgrades ?? []) {
      let retained = templates.get(JSON.stringify(upgrade.source));
      if (!retained) { retained = sourceTemplate(upgrade, read); templates.set(JSON.stringify(upgrade.source), retained); }
      const original = await retained;
      if (original.id !== upgrade.templateId || original.program.revision !== upgrade.templateRevision)
        throw new Error('A retained template upgrade source does not match its recorded revision.');
      evaluatePackageTemplateProgram(original.program, upgrade.answers);
      if (upgrade.appliedAnswers) evaluatePackageTemplateProgram(original.program, upgrade.appliedAnswers);
    }
  }
}
export async function readConditionalPackageTemplate(record: ActionPackage, revisionId = record.currentRevisionId): Promise<PackageTemplateV2> {
  const state = getPackageRevision(record, revisionId).templateState;
  if (!state) throw new Error('This package has no captured action template.');
  const template = await sourceTemplate(state, readPackageAsset); stateMatches(template, state, getPackageRevision(record, revisionId)); return template;
}

export async function loadConditionalPackageSource(revision: PackageRevision, read: Reader = readPackageAsset,
  templates: Map<string, Promise<PackageTemplateV2>> = new Map()): Promise<{ template: PackageTemplateV2; state: PackageConditionalState } | undefined> {
  if (!revision.templateState) return undefined;
  const state = packageConditionalStateSchema.parse(revision.templateState);
  let retained = templates.get(JSON.stringify(state.source));
  if (!retained) { retained = sourceTemplate(state, read); templates.set(JSON.stringify(state.source), retained); }
  const template = await retained; stateMatches(template, state, revision); return { template, state };
}
/** Include inactive branch text and PDF backgrounds carried by the pinned source in disclosure review. */
export async function reviewConditionalTemplate(template: PackageTemplateV2, policy: PolicyResolution): Promise<ExportReview[]> {
  const reviews = [reviewPackageText([template.name, packageTemplateProgramText(template),
    ...template.members.flatMap(member => [member.label, ...(member.kind === 'native' ? Object.values(member.pages).map(page => page.name) : [])])].join('\n'),
  'Captured action template and all branch declarations', policy)];
  const pages = new Set<string>();
  for (const member of template.members) {
    if (member.blankPdf) reviews.push(await reviewPackageOriginal(new Uint8Array(base64ToUint8Array(member.blankPdf.data)).buffer, member.blankPdf.name, policy));
    if (member.kind === 'attachment') continue;
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
  const template = await sourceTemplate(revision.templateState, read); stateMatches(template, revision.templateState, revision);
  const reviews = [reviewPackageText(conditionalStateText(revision.templateState), 'Captured intake including retained inactive answers', policy),
    ...await reviewConditionalTemplate(template, policy)];
  const seen = new Set([JSON.stringify(revision.templateState.source)]);
  for (const upgrade of revision.templateState.upgrades ?? []) if (!seen.has(JSON.stringify(upgrade.source))) {
    seen.add(JSON.stringify(upgrade.source)); reviews.push(...await reviewConditionalTemplate(await sourceTemplate(upgrade, read), policy));
  }
  return reviews;
}
export function conditionalMembershipFindings(revision: PackageRevision): Array<{ message: string; memberId?: string }> {
  const state = revision.templateState;
  if (!state) return [];
  const findings: Array<{ message: string; memberId?: string }> = [];
  if (state.pending) findings.push({ message: 'Apply the saved intake changes before reviewing or assembling this package.' });
  const applied = state.appliedAnswers ?? state.answers;
  for (const mapping of state.facts) {
    const value = mapping.appliedValue ?? (mapping.participantId ? Object.values(applied.groups).flat().find(person => person.id === mapping.participantId)?.answers[mapping.questionId]
      : applied.values[mapping.questionId]);
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
