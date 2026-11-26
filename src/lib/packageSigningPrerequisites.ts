import type { PackageRevision } from './actionPackages';
import { resolveConditionalPackageRequirements } from './packageConditionalRequirements';
import { missingAnswerGroups } from './packageFormCompletion';
import { readAnsweredPdfFields } from '@/services/forms/readRequiredPdfFields';

/** Evaluate the chosen signer against the exact bytes about to reach the card. */
export async function checkPackageSigningPrerequisites(revision: PackageRevision, memberId: string, field: string, bytes: ArrayBuffer) {
  const requirements = revision.templateState ? await resolveConditionalPackageRequirements(revision) : revision.requirements;
  const groups = [];
  for (const item of requirements?.items ?? []) {
    if (item.kind !== 'document' || item.memberId !== memberId || item.condition === 'inactive') continue;
    const applicable = item.completion?.answerGroups?.filter(group => group.beforeSignatures?.includes(field)) ?? [];
    if (applicable.length && item.condition === 'unknown') throw new Error('Complete the package details for ' + item.label + ' before signing.');
    groups.push(...applicable);
  }
  if (!groups.length) return;
  const missing = missingAnswerGroups(groups, await readAnsweredPdfFields(bytes));
  if (missing.length) throw new Error(missing.map(group => group.label).join(' '));
}
