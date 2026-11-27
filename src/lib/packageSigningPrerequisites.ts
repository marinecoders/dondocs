import { identifyOfficialEdition } from '@/services/forms/nativeCatalog';
import { loadOfficialFormDefinition } from '@/services/forms/officialFormDefinition';
import { PackageSigningRequirementError } from './packageDestinations';
import type { PackageRevision } from './actionPackages';
import { resolveConditionalPackageRequirements } from './packageConditionalRequirements';
import { packageBindingReadiness } from './packageFieldBindings';
import { missingAnswerGroups } from './packageFormCompletion';
import { missingPdfSelections, readPdfAnswerStates } from '@/services/forms/readRequiredPdfFields';

/** Evaluate the chosen signer against the exact bytes about to reach the card. */
export async function checkPackageSigningPrerequisites(revision: PackageRevision, memberId: string, field: string, bytes: ArrayBuffer) {
  const [unresolved] = await packageBindingReadiness(revision, memberId);
  if (unresolved) throw new PackageSigningRequirementError(unresolved.message, { bindingId: unresolved.bindingId, memberId });
  const requirements = revision.templateState ? await resolveConditionalPackageRequirements(revision) : revision.requirements;
  const member = revision.members.find(item => item.id === memberId);
  const groups = [], selections = [];
  for (const item of requirements?.items ?? []) {
    if (item.kind !== 'document' || item.memberId !== memberId || item.condition === 'inactive' || !item.operations.includes('pdf')) continue;
    const applicable = item.completion?.answerGroups?.filter(group => group.beforeSignatures?.includes(field)) ?? [];
    const requiredSelections = item.completion?.pdfSelections ?? [];
    if ((applicable.length || requiredSelections.length) && item.condition === 'unknown') throw new PackageSigningRequirementError('Complete the package details for ' + item.label + ' before signing.', { panel: 'intake', section: 'overview' });
    if ((applicable.length || requiredSelections.length) && item.memberRevisionId && item.memberRevisionId !== member?.revisionId) {
      throw new PackageSigningRequirementError('Review the assigned document revision for ' + item.label + ' before signing.', { memberId });
    }
    groups.push(...applicable);
    selections.push(...requiredSelections);
  }
  if (!groups.length && !selections.length) return;
  const fields = await readPdfAnswerStates(bytes);
  const invalid = missingPdfSelections(fields, selections);
  const { answered } = fields;
  const missing = missingAnswerGroups(groups, answered);
  if (!missing.length && !invalid.length) return;
  const signedOriginal = member?.kind === 'original' && member.signedOriginal === true;
  let definition = member?.kind === 'native' ? member.session.genericForm?.definition : undefined;
  if (signedOriginal) {
    const edition = await identifyOfficialEdition(bytes);
    if (edition?.definitionSha256 && edition.formId === member.officialFormId) {
      definition = await loadOfficialFormDefinition(edition).catch(() => undefined);
    }
  }
  const row = missing[0]?.alternatives.reduce((best, row) =>
    row.filter(name => !answered.has(name)).length < best.filter(name => !answered.has(name)).length ? row : best);
  const name = invalid[0]?.field ?? row?.find(value => !answered.has(value));
  const entry = name && Object.entries(definition?.fields ?? {}).find(([, value]) => value.sourceIds?.includes(name));
  const section = entry && definition?.sections.find(section => section.fields.includes(entry[0]));
  const message = (invalid.length ? invalid : missing).map(rule => rule.label).join(' ');
  throw new PackageSigningRequirementError(message, entry ? { memberId,
    correction: { kind: 'edit', fieldKey: entry[0], sectionId: section && 'field/' + section.id, label: 'Fill ' + entry[1].label } } : { memberId }, signedOriginal);
}
