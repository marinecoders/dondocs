import { z } from 'zod';
import { portableResourceDigest } from './portableResources';
import type { PackageMember, PackageRevision } from './actionPackages';
import { packageFactSchema, packageFactSourceSchema, type PackageFact, type PackageFactSource } from './packageInformation';
import {
  listPackageBindingFields, packageBindingTargetKey, packageBindingTargetSchema, packageBindingValueSchema,
  resolvePackageBindingTarget, validatePackageBindingValue,
  type PackageBindingField, type PackageBindingTarget, type PackageBindingValue,
} from './packageBindingTargets';

const identity = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => !Object.hasOwn(Object.prototype, value) && value !== 'prototype', 'Reserved object property');
export const packageFieldBindingSchema = z.object({
  id: identity, factId: identity, memberId: identity, target: packageBindingTargetSchema,
  mode: z.enum(['linked', 'override']), expectedValue: packageBindingValueSchema,
  format: z.enum(['field', 'uppercase']).default('field'),
}).strict();
export type PackageFieldBinding = z.infer<typeof packageFieldBindingSchema>;
export const packageFieldBindingsSchema = z.object({
  version: z.literal(1), items: z.array(packageFieldBindingSchema).max(500),
}).strict().superRefine((bindings, context) => {
  if (new TextEncoder().encode(JSON.stringify(bindings)).byteLength > 256 * 1024)
    context.addIssue({ code: 'custom', message: 'Package field links exceed the 256 KB limit.' });
  const ids = new Set<string>(), fields = new Set<string>();
  for (const binding of bindings.items) {
    const key = JSON.stringify([binding.memberId, packageBindingTargetKey(binding.target)]);
    if (ids.has(binding.id) || fields.has(key)) context.addIssue({ code: 'custom', message: 'A package field has duplicate link identities or competing bindings.' });
    ids.add(binding.id); fields.add(key);
  }
});
export type PackageFieldBindings = z.infer<typeof packageFieldBindingsSchema>;
export const MAX_PACKAGE_BINDING_HISTORY_BYTES = 8 * 1024 * 1024;
/** Review even orphaned links and deliberate overrides before any disclosure. */
export function packageBindingsText(value: PackageFieldBindings): string {
  const strings: string[] = [];
  function collect(item: unknown): void {
    if (typeof item === 'string') strings.push(item);
    else if (Array.isArray(item)) item.forEach(collect);
    else if (item && typeof item === 'object') Object.values(item).forEach(collect);
  }
  collect(packageFieldBindingsSchema.parse(value));
  return strings.join('\n');
}

function realDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
/** Formatting is explicit and bounded; it never interprets names or rewrites narrative text. */
export function formatPackageFactForField(fact: PackageFact, field: PackageBindingField, format: PackageFieldBinding['format'] = 'field'): string | boolean {
  fact = packageFactSchema.parse(fact);
  format = packageFieldBindingSchema.shape.format.parse(format);
  if (fact.kind === 'boolean') {
    if (field.kind !== 'boolean' || format !== 'field') throw new Error('This yes/no value requires a yes/no field.');
  } else {
    if (field.kind === 'boolean') throw new Error('This field requires a yes/no package value.');
    if (field.kind === 'date' && fact.kind !== 'date' || field.kind === 'decimal' && fact.kind !== 'decimal')
      throw new Error('The package value has the wrong kind for this field.');
  }
  let value = fact.value;
  if (fact.kind === 'date') {
    if (!realDate(fact.value)) throw new Error('The package date is invalid.');
    if (field.kind === 'date' && field.target.kind !== 'configured-form') {
      const [year, month, day] = fact.value.split('-');
      if (Number(year) < 2000 || Number(year) > 2099) throw new Error('This date falls outside the supported 2000–2099 abbreviated-year range.');
      value = `${Number(day)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]} ${year.slice(2)}`;
    }
  }
  if (format === 'uppercase') {
    if (typeof value !== 'string' || field.kind === 'date' || field.kind === 'decimal') throw new Error('Only text can use uppercase formatting.');
    value = value.toUpperCase();
  }
  validatePackageBindingValue(field, value);
  return value;
}

export type PackageBindingResolution = {
  state: 'current' | 'changed' | 'missing' | 'unsupported' | 'override';
  binding: PackageFieldBinding;
  label: string;
  message: string;
  field?: PackageBindingField;
  desiredValue?: string | boolean;
};
/** Last-applied equality alone cannot make a link current when its shared value has changed. */
export async function resolvePackageFieldBinding(revision: PackageRevision, input: PackageFieldBinding): Promise<PackageBindingResolution> {
  const binding = packageFieldBindingSchema.parse(input);
  const base = { binding, label: binding.id };
  const member = revision.members.find(member => member.id === binding.memberId);
  if (!member) return { ...base, state: 'missing', message: 'The linked package member is missing. Detach or reconnect this field.' };
  if (member.kind !== 'native') return { ...base, label: member.label, state: 'unsupported', message: 'Original PDFs do not support linked field edits.' };
  const target = await resolvePackageBindingTarget(member.session, binding.target);
  if (target.state !== 'current') return { ...base, label: member.label, ...target };
  const label = `${member.label}: ${target.field.label}`;
  const fact = revision.information?.facts.find(fact => fact.id === binding.factId);
  if (!fact) return { ...base, label, field: target.field, state: 'missing', message: 'The shared package value is missing. Detach or reconnect this field.' };
  let desiredValue: string | boolean;
  try { desiredValue = formatPackageFactForField(fact, target.field, binding.format); }
  catch (error) { return { ...base, label, field: target.field, state: 'unsupported', message: error instanceof Error ? error.message : 'The package value is incompatible with this field.' }; }
  const result = { ...base, label, field: target.field, desiredValue };
  if (binding.mode === 'override') return { ...result, state: 'override', message: 'A deliberate local value is preserved. Reconnect explicitly to use the package value.' };
  if (target.field.value !== binding.expectedValue) return { ...result, state: 'changed', message: 'This linked field was edited locally. Review it before applying shared changes.' };
  if (target.field.value !== desiredValue) return { ...result, state: 'changed', message: 'This field differs from its shared package value. Review and apply the linked update.' };
  return { ...result, state: 'current', message: 'This field matches the shared package value.' };
}

export async function packageBindingReadiness(revision: PackageRevision): Promise<Array<{ memberId: string; bindingId: string; severity: 'error'; message: string }>> {
  const findings: Array<{ memberId: string; bindingId: string; severity: 'error'; message: string }> = [];
  for (const binding of revision.bindings?.items ?? []) {
    const result = await resolvePackageFieldBinding(revision, binding);
    if (result.state !== 'current' && result.state !== 'override') findings.push({ memberId: binding.memberId,
      bindingId: binding.id, severity: 'error', message: `${result.label}: ${result.message}` });
  }
  return findings;
}

export interface PackageFieldSuggestion {
  memberId: string;
  memberRevisionId: string;
  target: PackageBindingTarget;
  label: string;
  kind: PackageFact['kind'];
  value: string | boolean;
  source: PackageFactSource;
}
function sourceLabel(value: string, fallback: string): string {
  return Array.from(value, character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('').trim() || fallback;
}
/** Suggestions retain independent candidates and source identities; no candidate is adopted here. */
export async function suggestPackageFieldValues(members: readonly PackageMember[]): Promise<PackageFieldSuggestion[]> {
  const suggestions: PackageFieldSuggestion[] = [];
  for (const member of members) {
    if (member.kind !== 'native') continue;
    for (const field of await listPackageBindingFields(member)) {
      if (field.value === null || typeof field.value === 'string' && !field.value.trim()) continue;
      if (field.kind === 'date' && (typeof field.value !== 'string' || !realDate(field.value))) continue;
      const kind = field.kind === 'singleChoice' ? 'text' : field.kind;
      // An unfinished native answer may be readable without qualifying as a typed fact.
      if (!packageFactSchema.safeParse({ id: 'candidate', label: 'Candidate', kind, value: field.value, source: { kind: 'entered' } }).success) continue;
      const locator = await portableResourceDigest(new TextEncoder().encode(packageBindingTargetKey(field.target)).buffer);
      const label = sourceLabel(field.label, 'Field');
      suggestions.push({ memberId: member.id, memberRevisionId: member.revisionId, target: field.target,
        label: `${member.label}: ${field.label}`, kind, value: field.value,
        source: packageFactSourceSchema.parse({ kind: 'document', label: sourceLabel(member.label, 'Package member'),
          field: `${label.slice(0, 80)} [${locator}]`, capturedAt: member.session.timestamp, sha256: member.draft.sha256 }) });
      if (suggestions.length > 2000) throw new Error('The package has too many field suggestions. Select a smaller set of members.');
    }
  }
  return suggestions;
}

/** Metadata-only proposals belong in the same reviewed transaction as changed native draft bytes. */
export function proposePackageFieldBinding(input: PackageFieldBinding): PackageFieldBinding {
  return packageFieldBindingSchema.parse(structuredClone(input));
}

export function preservePackageFieldOverride(input: PackageFieldBinding, value: PackageBindingValue): PackageFieldBinding {
  return packageFieldBindingSchema.parse({ ...structuredClone(input), mode: 'override', expectedValue: packageBindingValueSchema.parse(value) });
}

/** Reconnection still needs a reviewed field update when the fact and field differ. */
export function reconnectPackageFieldBinding(input: PackageFieldBinding, value: PackageBindingValue): PackageFieldBinding {
  return packageFieldBindingSchema.parse({ ...structuredClone(input), mode: 'linked', expectedValue: packageBindingValueSchema.parse(value) });
}
