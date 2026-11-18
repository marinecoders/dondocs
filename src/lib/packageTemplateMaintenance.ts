import { packageTemplateV2Schema, type PackageTemplateV2 } from './packageTemplateSchema';
import { validatePackageTemplate, importPackageTemplate, type TemplateAttachment } from './packageTemplateLibrary';
import { prepareConditionalPackage, listConditionalPackageInstances } from './packageConditional';
import { evaluatePackageTemplateProgram, evaluatePackageTemplateCondition, packageTemplateAnswersSchema, type PackageTemplateAnswers } from './packageTemplateProgram';
import { reviewConditionalTemplate } from './packageConditionalSources';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';

export interface PackageTemplateScenario { name: string; answers: PackageTemplateAnswers; attachments?: Record<string, TemplateAttachment>; expectedMembers: string[] }
export interface PreparedPackageTemplateMaintenance {
  readonly name: string; readonly revision: string; readonly ready: boolean; readonly issues: readonly string[];
  readonly scenarios: readonly { name: string; ready: boolean; members: readonly string[]; issues: readonly string[] }[];
  readonly reviews: readonly ExportReview[];
}
const plans = new WeakMap<PreparedPackageTemplateMaintenance, { template: PackageTemplateV2; policy: string }>();
export function packageTemplateMaintenancePolicy(policy: PolicyResolution): string {
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy); return JSON.stringify(policy.policy);
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

/** Exercise the same materialization used by end users. A scenario never publishes an action or sample file. */
export async function preparePackageTemplateMaintenance(input: PackageTemplateV2, scenariosInput: readonly PackageTemplateScenario[], policy: PolicyResolution,
  signal?: AbortSignal): Promise<PreparedPackageTemplateMaintenance> {
  signal?.throwIfAborted(); const key = packageTemplateMaintenancePolicy(policy);
  if (scenariosInput.length > 12) throw new Error('Validate at most twelve template scenarios at once.');
  if (scenariosInput.some(scenario => scenario.expectedMembers.length > 100 || scenario.expectedMembers.some(key => key.length > 220)))
    throw new Error('A scenario supports at most 100 expected document instances.');
  const bytes = scenariosInput.reduce((sum, scenario) => sum + Object.values(scenario.attachments ?? {}).reduce((total, file) => total + file.data.byteLength, 0), 0);
  if (bytes > 64 * 1024 * 1024) throw new Error('Scenario sample files exceed the combined 64 MB limit.');
  const captured = structuredClone({ template: input, scenarios: scenariosInput });
  const template = packageTemplateV2Schema.parse(await validatePackageTemplate(captured.template));
  const issues: string[] = [], results: Array<{ name: string; ready: boolean; members: string[]; issues: string[] }> = [];
  const coverage = new Map<string, Set<boolean>>(), seenQuestions = new Set<string>();
  if (!captured.scenarios.length) issues.push('Add at least one complete scenario before saving a maintained template.');
  if (new Set(captured.scenarios.map(scenario => scenario.name.trim())).size !== captured.scenarios.length) issues.push('Use a distinct name for each scenario.');
  for (const scenario of captured.scenarios) {
    signal?.throwIfAborted();
    if (!scenario.name.trim() || scenario.name.length > 120) throw new Error('Use a scenario name of one to 120 characters.');
    const answers = packageTemplateAnswersSchema.parse(scenario.answers), evaluation = evaluatePackageTemplateProgram(template.program, answers);
    const instances = listConditionalPackageInstances(template, answers), members = instances.filter(item => item.condition === true).map(item => item.key);
    const prepared = await prepareConditionalPackage({ template, answers, name: `Scenario: ${scenario.name}`.slice(0, 120), attachments: scenario.attachments }, policy, signal);
    const problems = [...prepared.issues];
    if (new Set(scenario.expectedMembers).size !== scenario.expectedMembers.length
      || JSON.stringify([...members].sort()) !== JSON.stringify([...scenario.expectedMembers].sort())) problems.push('Actual active document instances differ from the expected scenario membership.');
    if (prepared.ready && !problems.length) {
      const add = (id: string, value: boolean | 'unknown') => { if (value !== 'unknown') { const values = coverage.get(id) ?? new Set<boolean>(); values.add(value); coverage.set(id, values); } };
      for (const question of evaluation.questions) {
        if (question.visibility === true) seenQuestions.add(question.questionId);
        if (template.program.questions.find(item => item.id === question.questionId)?.when) add(`question:${question.questionId}`, question.visibility);
      }
      for (const instance of instances) if (template.members.find(item => item.key === instance.memberKey)?.when) add(`member:${instance.memberKey}`, instance.condition);
      for (const requirement of template.program.requirements) if (requirement.when) {
        const people = requirement.repeatGroupId ? answers.groups[requirement.repeatGroupId] ?? [] : [undefined];
        for (const person of people) add(`requirement:${requirement.id}`, evaluatePackageTemplateCondition(template.program, answers, requirement.when,
          person && requirement.repeatGroupId ? { groupId: requirement.repeatGroupId, participantId: person.id } : undefined));
      }
    }
    results.push({ name: scenario.name, ready: prepared.ready && !problems.length, members, issues: problems });
  }
  for (const question of template.program.questions) if (!seenQuestions.has(question.id)) issues.push(`Exercise question "${question.label}" in a complete scenario.`);
  for (const [kind, items] of [['question', template.program.questions], ['member', template.members], ['requirement', template.program.requirements]] as const)
    for (const item of items) if (item.when && coverage.get(`${kind}:${'id' in item ? item.id : item.key}`)?.size !== 2)
      issues.push(`Exercise both outcomes of ${kind} "${item.label}" in complete scenarios.`);
  signal?.throwIfAborted();
  const result = freeze({ name: template.name, revision: template.program.revision, ready: !!results.length && results.every(item => item.ready) && !issues.length,
    issues, scenarios: results, reviews: await reviewConditionalTemplate(template, policy) });
  plans.set(result, { template, policy: key }); return result;
}
/** Save a separate immutable library entry; existing packages keep their captured source. */
export async function savePreparedPackageTemplateMaintenance(prepared: PreparedPackageTemplateMaintenance, policy: PolicyResolution, reviewed: boolean,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<PackageTemplateV2> {
  const captured = plans.get(prepared), key = packageTemplateMaintenancePolicy(policy);
  if (!captured || !prepared.ready || reviewed !== true || captured.policy !== key) throw new Error('Validate complete scenarios and review the exact template before saving it.');
  if (packageTemplateMaintenancePolicy(await getExportDeploymentPolicy()) !== key) throw new Error('Deployment settings changed. Validate and review this template again.');
  signal?.throwIfAborted();
  const current = () => { signal?.throwIfAborted(); return isCurrent() && packageTemplateMaintenancePolicy(getExportDeploymentPolicySync()) === key; };
  if (!current()) throw new Error('This template operation is no longer current.');
  const saved = packageTemplateV2Schema.parse(await importPackageTemplate(JSON.stringify(captured.template), signal, current));
  plans.delete(prepared); return saved;
}
