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

export function missingAnswerGroups(groups: FormCompletion['answerGroups'], answered: ReadonlySet<string>) {
  return groups?.filter(group => !group.alternatives.some(row => row.every(field => answered.has(field)))) ?? [];
}

export function missingPackageSignatures(member: PackageMember, rule?: FormCompletion) {
  return rule?.signatureFields?.filter(field => member.kind !== 'original' || !member.signedOriginal ||
    !hasInspectedSignature(member.original.sha256, field)) ?? [];
}

export function officialFormCompletionIssues(member: PackageMember, rule?: FormCompletion, onIssue?: (message: string, correction?: import('./packageDestinations').PackageCorrection) => void): string[] {
  if (rule?.deliveryBlockReason) return [rule.deliveryBlockReason];
  const issues: string[] = [];
  const add = (message: string, correction?: import('./packageDestinations').PackageCorrection) => { issues.push(message); onIssue?.(message, correction); };
  if (member.kind === 'native' && member.session.genericForm) {
    const { definition, answers, rows } = member.session.genericForm;
    const fieldTarget = (key: string) => {
      const section = definition.sections.find(section => section.fields.includes(key));
      return section ? { kind: 'edit' as const, sectionId: 'field/' + section.id, fieldKey: key, label: 'Fill ' + definition.fields[key].label } : undefined;
    };
    if (definition.nativePdfEdition && !Object.values(answers).some(hasValue) &&
        !Object.values(rows).flat().some(row => Object.values(row.answers).some(hasValue)))
      add('The official form is still blank.', { kind: 'edit', label: 'Fill form' });
    for (const selection of rule?.pdfSelections ?? []) {
      const field = Object.entries(definition.fields).find(([, item]) => item.sourceIds?.includes(selection.field));
      const value = field && (answers[field[0]] ?? field[1].initialValue);
      const kind = field?.[1].kind;
      let valid: boolean;
      if (selection.expected === null) valid = (kind === 'text' || kind === 'date') && (value == null || typeof value === 'string' && !value.trim());
      else if (typeof selection.expected === 'boolean') valid = kind === 'boolean' && (value ?? false) === selection.expected;
      else valid = kind === 'singleChoice' && typeof value === 'string' && selection.expected.includes(value);
      if (!valid) add(selection.label, field ? fieldTarget(field[0]) : undefined);
    }
    for (const name of rule?.requiredPdfFields ?? []) {
      const match = Object.entries(definition.fields).find(([, field]) => field.sourceIds?.includes(name));
      if (!match || match[1].requiredAt !== 'export' && !hasValue(answers[match[0]]))
        add('Complete the required field: ' + (match?.[1].label ?? name) + '.', match ? fieldTarget(match[0]) : undefined);
    }
    if (rule?.answerGroups?.length) {
      const answered = new Set(Object.entries(definition.fields).flatMap(([key, field]) =>
        hasValue(answers[key]) && answers[key] !== false ? field.sourceIds ?? [] : []));
      for (const group of missingAnswerGroups(rule.answerGroups, answered)) {
        const key = Object.keys(definition.fields).find(key => definition.fields[key].sourceIds?.includes(group.alternatives[0][0]));
        add(group.label, key ? fieldTarget(key) : undefined);
      }
    }
    for (const issue of validateAnswers(definition, answers, rows)) if (issue.severity === 'error') add(issue.message, fieldTarget(issue.path));
  } else if (member.kind === 'native' && member.session.formType === 'navmc_10274' && member.session.forms?.officialPdfEdition) {
    const { signatureBlocks, ...fields } = member.session.forms.navmc10274 ?? {};
    if (!Object.values(fields).some(value => typeof value === 'string' && value.trim()) && !signatureBlocks?.some(block => block.name?.trim() || block.statement?.trim())) {
      add('The official form is still blank.', { kind: 'edit', label: 'Fill form' });
    }
  } else if (member.kind !== 'native' && (rule?.blankSha256 === member.original.sha256 ||
      editions.some(edition => edition.sha256 === member.original.sha256))) {
    add('The saved PDF is the unchanged official blank.', member.kind === 'original' && !member.signedOriginal ? { kind: 'replace', label: 'Replace PDF' } : undefined);
  }
  if (rule?.handwrittenSignature && (member.kind !== 'original' || !member.handwrittenSourceSha256))
    add('Add a handwritten signature to this document.');
  if (rule?.reviewedScan && (member.kind !== 'original' || member.signatureReviewSha256 !== member.original.sha256))
    add('Review the visible signature on the received PDF in Documents.');
  if (rule?.writtenContent && member.kind === 'native' && !member.session.paragraphs?.some(p => p.text?.trim()))
    add('Write the body of this case record before delivery.', { kind: 'edit', sectionId: 'body', label: 'Write body' });
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
  return profile.format === 'xfa' || profile.fieldIds ? member.session.forms?.officialPdfEdition === expected.edition :
    !!definition && definition.nativePdfEdition === expected.edition &&
    await portableResourceDigest(new TextEncoder().encode(canonicalJson(definition)).buffer) === profile.definitionSha256;
}
