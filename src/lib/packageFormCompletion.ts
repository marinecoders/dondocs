import editions from '@/data/officialPdfEditions.json' with { type: 'json' };
import { hasInspectedSignature } from '@/services/forms/signingBridge';
import { validateAnswers, type Answer } from '@/services/forms/model';
import type { PackageMember } from './actionPackages';
import type { FormCompletion } from './packageRequirementsModel';

function hasValue(value: Answer) {
  return typeof value === 'string' ? !!value.trim() : Array.isArray(value) ? value.length > 0 : typeof value === 'boolean';
}

export function officialFormCompletionIssues(member: PackageMember, rule?: FormCompletion): string[] {
  const issues: string[] = [];
  if (member.kind === 'native' && member.session.genericForm) {
    const { definition, answers, rows } = member.session.genericForm;
    if (definition.nativePdfEdition && !Object.values(answers).some(hasValue) &&
        !Object.values(rows).flat().some(row => Object.values(row.answers).some(hasValue)))
      issues.push('The official form is still blank.');
    issues.push(...validateAnswers(definition, answers, rows).filter(issue => issue.severity === 'error').map(issue => issue.message));
  } else if (member.kind !== 'native' && (rule?.blankSha256 === member.original.sha256 ||
      editions.some(edition => edition.sha256 === member.original.sha256))) {
    issues.push('The saved PDF is the unchanged official blank.');
  }
  const missing = rule?.signatureFields?.filter(field => member.kind !== 'original' || !member.signedOriginal ||
    !hasInspectedSignature(member.original.sha256, field));
  if (missing?.length) issues.push('Sign or verify these fields in the official signing workspace: ' + missing.join(', ') + '.');
  return issues;
}
