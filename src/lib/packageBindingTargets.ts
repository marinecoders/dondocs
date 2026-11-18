import { z } from 'zod';
import type { SerializedSession } from '@/stores/documentStore';
import { compileFormDefinition, validateAnswers, type AnswerField, type FormDefinition } from '@/services/forms/model';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { documentTextFields } from './documentFields';
import type { PackageMember } from './actionPackages';
import { portableResourceDigest } from './portableResources';

const identity = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => !Object.hasOwn(Object.prototype, value) && value !== 'prototype', 'Reserved object property');
const correspondenceFields = ['subject', 'from', 'to', 'via', 'date', 'ssic', 'serial', 'unitLine1', 'unitLine2', 'unitAddress', 'memorandumFor'] as const;
const aaFields = ['actionNo', 'ssicFileNo', 'date', 'from', 'via', 'orgStation', 'to', 'natureOfAction'] as const;
const page11Fields = ['lastName', 'firstName', 'middleName', 'edipi', 'entryDate', 'box11'] as const;

/** Targets identify qualified scalar answers, never arbitrary object paths or signing data. */
export const packageBindingTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('correspondence'), docType: identity, field: z.enum(correspondenceFields) }).strict(),
  z.object({ kind: z.literal('aa-form'), field: z.enum(aaFields) }).strict(),
  z.object({ kind: z.literal('page11'), field: z.enum(page11Fields) }).strict(),
  z.object({
    kind: z.literal('configured-form'), formId: identity,
    definitionRevision: z.string().min(1).max(200), templateRevision: z.string().min(1).max(200),
    definitionSha256: z.string().regex(/^[a-f0-9]{64}$/), fieldId: identity,
    row: z.object({ groupId: identity, rowId: identity }).strict().optional(),
  }).strict(),
]);
export type PackageBindingTarget = z.infer<typeof packageBindingTargetSchema>;
/** null records an absent answer, separately from empty text, zero and false. */
export const packageBindingValueSchema = z.union([z.string().max(10000), z.boolean(), z.null()]);
export type PackageBindingValue = z.infer<typeof packageBindingValueSchema>;
export type PackageBindingFieldKind = 'text' | 'identifier' | 'date' | 'decimal' | 'boolean' | 'singleChoice';
export interface PackageBindingField {
  target: PackageBindingTarget;
  label: string;
  kind: PackageBindingFieldKind;
  value: PackageBindingValue;
  options?: readonly { id: string; label: string }[];
}
export type PackageBindingTargetResolution =
  | { state: 'current'; field: PackageBindingField }
  | { state: 'missing' | 'unsupported'; message: string };

const labels: Record<string, string> = {
  subject: 'Subject', from: 'From', to: 'To', via: 'Via', date: 'Date', ssic: 'SSIC', serial: 'Serial',
  unitLine1: 'Unit name', unitLine2: 'Unit line 2', unitAddress: 'Unit address', memorandumFor: 'Memorandum for',
  actionNo: 'Action number', ssicFileNo: 'SSIC / file number', orgStation: 'Organization / station', natureOfAction: 'Nature of action',
  lastName: 'Last name', firstName: 'First name', middleName: 'Middle name', edipi: 'EDIPI', entryDate: 'Entry date', box11: 'SRB page number',
};
const unsupportedTypes = new Set(['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter']);
function scalar(value: unknown): value is string | boolean {
  return typeof value === 'boolean' || typeof value === 'string' && value.length <= 10000;
}
function dateField(field: string): boolean { return field === 'date' || field === 'entryDate'; }
function kindFor(field: string): PackageBindingFieldKind {
  return dateField(field) ? 'date' : ['edipi', 'ssic', 'ssicFileNo', 'serial', 'actionNo', 'box11'].includes(field) ? 'identifier' : 'text';
}
function field(target: PackageBindingTarget, key: string, value: unknown): PackageBindingField | null {
  return typeof value === 'string' && value.length <= 10000
    ? { target, label: labels[key] ?? key, kind: kindFor(key), value } : null;
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export function packageBindingTargetKey(target: PackageBindingTarget): string {
  const parsed = packageBindingTargetSchema.parse(target);
  return parsed.kind === 'configured-form'
    ? JSON.stringify([parsed.kind, parsed.formId, parsed.definitionRevision, parsed.templateRevision, parsed.definitionSha256, parsed.row?.groupId ?? null, parsed.row?.rowId ?? null, parsed.fieldId])
    : JSON.stringify([parsed.kind, parsed.kind === 'correspondence' ? parsed.docType : null, parsed.field]);
}

async function definitionIdentity(definition: FormDefinition): Promise<string> {
  return portableResourceDigest(new TextEncoder().encode(JSON.stringify(compileFormDefinition(definition))).buffer);
}
function configuredField(target: Extract<PackageBindingTarget, { kind: 'configured-form' }>, definition: AnswerField, value: unknown): PackageBindingField | null {
  if (definition.kind === 'signature' || definition.kind === 'multipleChoice' || value !== undefined && !scalar(value)) return null;
  return { target, label: definition.label.slice(0, 240), kind: definition.kind,
    value: value === undefined ? null : value as string | boolean,
    ...(definition.options ? { options: definition.options.map(({ id, label }) => ({ id, label })) } : {}) };
}

function rowFieldLabel(group: string, row: number, label: string): string {
  const clean = (value: string, fallback: string) => Array.from(value,
    character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('').trim() || fallback;
  // Keep the row ordinal inside the first 80 characters retained in source descriptions.
  return `${clean(group, 'Rows').slice(0, 60)} · row ${row + 1} · ${clean(label, 'Field')}`.slice(0, 240);
}

/** Lists the captured member's own answers without reading the active editor or library. */
export async function listPackageBindingFields(member: PackageMember): Promise<PackageBindingField[]> {
  if (member.kind !== 'native') return [];
  return listSessionFields(member.session);
}
async function listSessionFields(session: SerializedSession): Promise<PackageBindingField[]> {
  const result: PackageBindingField[] = [];
  const add = (value: PackageBindingField | null) => {
    if (value && packageBindingTargetSchema.safeParse(value.target).success) result.push(value);
    if (result.length > 500) throw new Error('This member has more than 500 linkable fields. Use a smaller supported member.');
  };
  if (session.documentCategory !== 'forms') {
    if (!Object.hasOwn(DOC_TYPE_CONFIG, session.docType) || unsupportedTypes.has(session.docType)) return [];
    const output = new Set(documentTextFields(session, 'output')
      .filter(value => value.path.length === 2 && value.path[0] === 'formData').map(value => value.path[1]));
    for (const key of correspondenceFields) if (output.has(key) && Object.hasOwn(session.formData, key))
      add(field({ kind: 'correspondence', docType: session.docType, field: key }, key, session.formData[key]));
  } else if (session.genericForm) {
    const definition = compileFormDefinition(session.genericForm.definition);
    if (session.formType !== definition.formId) return [];
    const base = { kind: 'configured-form' as const, formId: definition.formId,
      definitionRevision: definition.definitionRevision, templateRevision: definition.templateRevision,
      definitionSha256: await definitionIdentity(definition) };
    for (const [fieldId, answer] of Object.entries(definition.fields))
      add(configuredField({ ...base, fieldId }, answer, session.genericForm.answers[fieldId]));
    for (const [groupId, group] of Object.entries(definition.rowGroups)) {
      const rows = session.genericForm.rows[groupId] ?? [];
      for (const [rowIndex, row] of rows.entries()) {
        if (!identity.safeParse(row.id).success || rows.filter(value => value.id === row.id).length !== 1) continue;
        for (const [fieldId, answer] of Object.entries(group.columns)) {
          const value = configuredField({ ...base, fieldId, row: { groupId, rowId: row.id } }, answer, row.answers[fieldId]);
          if (value) value.label = rowFieldLabel(group.title, rowIndex, answer.label);
          add(value);
        }
      }
    }
  } else if (session.formType === 'navmc_10274' && session.forms?.navmc10274) {
    for (const key of aaFields) add(field({ kind: 'aa-form', field: key }, key, session.forms.navmc10274[key]));
  } else if (session.formType === 'navmc_118_11' && session.forms?.navmc11811) {
    for (const key of page11Fields) add(field({ kind: 'page11', field: key }, key, session.forms.navmc11811[key]));
  }
  return result;
}

export async function resolvePackageBindingTarget(session: SerializedSession, target: PackageBindingTarget): Promise<PackageBindingTargetResolution> {
  const parsed = packageBindingTargetSchema.safeParse(target);
  if (!parsed.success) return { state: 'unsupported', message: 'This field is not a supported package-link target.' };
  const owned = parsed.data;
  if (owned.kind === 'configured-form') {
    const instance = session.documentCategory === 'forms' ? session.genericForm : undefined;
    if (!instance || instance.definition.formId !== owned.formId || session.formType !== owned.formId)
      return { state: 'missing', message: 'The configured form is no longer this linked form.' };
    if (instance.definition.definitionRevision !== owned.definitionRevision || instance.definition.templateRevision !== owned.templateRevision
      || await definitionIdentity(instance.definition) !== owned.definitionSha256)
      return { state: 'missing', message: 'The form definition changed. Review and reconnect this field.' };
  }
  const found = (await listSessionFields(session)).find(value => packageBindingTargetKey(value.target) === packageBindingTargetKey(owned));
  return found ? { state: 'current', field: found }
    : { state: 'missing', message: 'The linked field or row is missing, inactive, or unsupported. Review its replacement before reconnecting.' };
}

/** Validate one replacement, without requiring unrelated unfinished answers to be complete. */
export function validatePackageBindingValue(field: PackageBindingField, value: unknown): asserts value is string | boolean {
  if (!scalar(value)) throw new Error('A package link requires supported text or a yes/no answer.');
  if ((field.kind === 'boolean') !== (typeof value === 'boolean')) throw new Error('The package value has the wrong type for this field.');
  if (typeof value !== 'string') return;
  if (field.kind === 'singleChoice' && !field.options?.some(option => option.id === value)) throw new Error('Choose a value defined by this form.');
  if (field.kind === 'decimal' && value !== '' && !/^-?\d+(\.\d+)?$/.test(value)) throw new Error('Enter a decimal number without changing its precision.');
  if (field.target.kind === 'configured-form' && field.kind === 'date' && value !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
      throw new Error('Enter a real date in YYYY-MM-DD format.');
  }
}

function writeTarget(session: SerializedSession, target: PackageBindingTarget, value: string | boolean): void {
  if (target.kind === 'correspondence') {
    (session.formData as unknown as Record<string, unknown>)[target.field] = value;
  } else if (target.kind === 'aa-form') session.forms!.navmc10274![target.field] = value as string;
  else if (target.kind === 'page11') session.forms!.navmc11811![target.field] = value as string;
  else {
    const form = session.genericForm!;
    if (target.row) form.rows[target.row.groupId].find(row => row.id === target.row!.rowId)!.answers[target.fieldId] = value;
    else form.answers[target.fieldId] = value;
  }
}

export interface PackageBindingPatch { target: PackageBindingTarget; expected: PackageBindingValue; value: string | boolean }
async function checkedPatches(session: SerializedSession, patches: readonly PackageBindingPatch[]): Promise<PackageBindingPatch[]> {
  if (!patches.length || patches.length > 500) throw new Error('Choose between 1 and 500 supported field updates.');
  const available = await listSessionFields(session);
  const fields = new Map(available.map(field => [packageBindingTargetKey(field.target), field]));
  const seen = new Set<string>();
  return patches.map(patch => {
    const target = packageBindingTargetSchema.parse(patch.target), key = packageBindingTargetKey(target);
    if (seen.has(key)) throw new Error('A package update cannot write the same field twice.');
    seen.add(key);
    const found = fields.get(key);
    if (!found) throw new Error('The linked field or definition changed. Review it before applying this update.');
    if (!same(found.value, packageBindingValueSchema.parse(patch.expected))) throw new Error('The linked field changed. Review the latest value before applying this update.');
    validatePackageBindingValue(found, patch.value);
    return { target, expected: patch.expected, value: patch.value };
  });
}
function applyPatches(session: SerializedSession, patches: readonly PackageBindingPatch[]): void {
  for (const patch of patches) writeTarget(session, patch.target, patch.value);
  if (patches.some(patch => patch.target.kind === 'configured-form')) {
    const form = session.genericForm!;
    if (!Number.isSafeInteger(form.answerRevision) || form.answerRevision >= Number.MAX_SAFE_INTEGER) throw new Error('This form answer revision cannot be advanced.');
    form.answerRevision++;
  }
}
function checkPatchedAnswers(session: SerializedSession, owned: SerializedSession): void {
  if (owned.genericForm) {
    const before = validateAnswers(session.genericForm!.definition, session.genericForm!.answers, session.genericForm!.rows, false);
    const after = validateAnswers(owned.genericForm.definition, owned.genericForm.answers, owned.genericForm.rows, false);
    const existing = new Set(before.map(issue => JSON.stringify(issue)));
    if (after.some(issue => !existing.has(JSON.stringify(issue)))) throw new Error('The replacement is invalid for the captured form.');
  }
}
export async function patchPackageBindingTarget(session: SerializedSession, target: PackageBindingTarget, expected: PackageBindingValue, value: string | boolean): Promise<SerializedSession> {
  const owned = structuredClone(session), patches = await checkedPatches(owned, [{ target, expected, value }]);
  applyPatches(owned, patches);
  checkPatchedAnswers(session, owned);
  return owned;
}

/** Keep raw draft resources byte-for-byte; normalized sessions are never used as a lossy draft serializer. */
export async function patchPackageBindingDraft(draft: unknown, target: PackageBindingTarget, expected: PackageBindingValue, value: string | boolean): Promise<{ draft: Record<string, unknown>; session: SerializedSession }> {
  return patchPackageBindingDraftFields(draft, [{ target, expected, value }]);
}

/** A multi-field member update reads/validates resources twice in total and advances answers once. */
export async function patchPackageBindingDraftFields(draft: unknown, updates: readonly PackageBindingPatch[]): Promise<{ draft: Record<string, unknown>; session: SerializedSession }> {
  const { validatePackageDraft } = await import('./actionPackageDraft');
  const source = structuredClone(draft) as Record<string, unknown>;
  const before = await validatePackageDraft(source);
  const patches = await checkedPatches(before.session, updates);
  const next = structuredClone(before.session);
  applyPatches(next, patches);
  checkPatchedAnswers(before.session, next);
  // Qualified targets have the same raw and normalized answer locations.
  applyPatches(source as unknown as SerializedSession, patches);
  const after = await validatePackageDraft(source);
  if (!same(after.session, next)) throw new Error('The edited draft does not match its qualified package field.');
  return { draft: source, session: after.session };
}
