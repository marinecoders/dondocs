import { canonicalJson } from './canonicalJson';
import { portableResourceDigest } from './portableResources';
import { officialEdition } from '@/services/forms/nativeCatalog';
import editions from '@/data/officialPdfEditions.json' with { type: 'json' };
import { hasInspectedSignature } from '@/services/forms/signingBridge';
import { validateAnswers, type Answer } from '@/services/forms/model';
import type { PackageMember } from './actionPackages';
import type { FormCompletion } from './packageRequirementsModel';

function hasValue(value: Answer) {
  return typeof value === 'string' ? !!value.trim() : Array.isArray(value) ? value.length > 0 : typeof value === 'boolean';
}

export function missingPackageSignatures(member: PackageMember, rule?: FormCompletion) {
  return rule?.signatureFields?.filter(field => member.kind !== 'original' || !member.signedOriginal ||
    !hasInspectedSignature(member.original.sha256, field)) ?? [];
}

export function officialFormCompletionIssues(member: PackageMember, rule?: FormCompletion): string[] {
  const issues: string[] = [];
  if (member.kind === 'native' && member.session.genericForm) {
    const { definition, answers, rows } = member.session.genericForm;
    if (definition.nativePdfEdition && !Object.values(answers).some(hasValue) &&
        !Object.values(rows).flat().some(row => Object.values(row.answers).some(hasValue)))
      issues.push('The official form is still blank.');
    for (const name of rule?.requiredPdfFields ?? []) {
      const match = Object.entries(definition.fields).find(([, field]) => field.sourceIds?.includes(name));
      if (!match || match[1].requiredAt !== 'export' && !hasValue(answers[match[0]]))
        issues.push('Complete the required field: ' + (match?.[1].label ?? name) + '.');
    }
    issues.push(...validateAnswers(definition, answers, rows).filter(issue => issue.severity === 'error').map(issue => issue.message));
  } else if (member.kind !== 'native' && (rule?.blankSha256 === member.original.sha256 ||
      editions.some(edition => edition.sha256 === member.original.sha256))) {
    issues.push('The saved PDF is the unchanged official blank.');
  }
  if (rule?.reviewedScan && (member.kind !== 'original' || member.signatureReviewSha256 !== member.original.sha256))
    issues.push('Review the visible signature on the received PDF in Documents.');
  if (rule?.writtenContent && member.kind === 'native' && !member.session.paragraphs?.some(p => p.text?.trim()))
    issues.push('Write the body of this case record before delivery.');
  return issues;
}

export async function matchesExpectedForm(member: PackageMember, expected: NonNullable<FormCompletion['expectedForm']>, bytes?: ArrayBuffer) {
  const profile = officialEdition(expected.id, expected.edition);
  if (!profile) return false;
  if (member.kind === 'original') return !!bytes && bytes.byteLength >= profile.length &&
    await portableResourceDigest(bytes.slice(0, profile.length)) === profile.sha256;
  if (member.kind !== 'native') return false;
  if (expected.id === 'package_correspondence') return member.session.documentCategory === 'correspondence';
  if (member.session.formType !== expected.id) return false;
  const definition = member.session.genericForm?.definition;
  return profile.format === 'xfa' ? member.session.forms?.officialPdfEdition === expected.edition :
    !!definition && definition.nativePdfEdition === expected.edition &&
    await portableResourceDigest(new TextEncoder().encode(canonicalJson(definition)).buffer) === profile.definitionSha256;
}
