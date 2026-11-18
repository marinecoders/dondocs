import { z } from 'zod';
import type { SerializedSession } from '@/stores/documentStore';
import { scheduleBackup } from '@/stores/backupStore';
import { actionPackageSchema, commitActionPackage, newPackageId, type ActionPackage, type NativePackageMember, type PackageMember } from './actionPackages';
import { readPackageAsset, readPackageMemberDraft } from './actionPackageAssets';
import { validatePackageDraft } from './actionPackageDraft';
import { validatePackageMemberTemplates } from './actionPackageTemplates';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { idbComparePackageTemplate, idbReadPackageTemplates, type StoredAttachment } from './documentsDb';
import { portableResourceDigest } from './portableResources';
import { applyPlaceholdersToSession, detectSessionPlaceholders, replacePlaceholders } from './placeholders';
import { freshParagraphs } from './paragraphIdentity';
import { validateBackup } from './backupValidation';
import { detectPlaceholders } from './placeholders';
import { documentTextFields } from './documentFields';

export const MAX_PACKAGE_TEMPLATE_BYTES = 12 * 1024 * 1024;
export const MAX_PACKAGE_TEMPLATES = 20;
export const MAX_TEMPLATE_ACTION_BYTES = 64 * 1024 * 1024;
export const MAX_PACKAGE_TEMPLATE_LIBRARY_BYTES = 40 * 1024 * 1024;
import { packageTemplateSchema, packageTemplateV1Schema, packageTemplatePageSchema as pageSchema,
  type PackageTemplate, type PackageTemplateV1, type PackageTemplateV2, type PackageTemplateMember, type RequiredNativeFile } from './packageTemplateSchema';
import { listPackageBindingFields, packageBindingTargetKey } from './packageBindingTargets';
import { formatPackageFactForField } from './packageFieldBindings';
import type { PackageFact } from './packageInformation';
export { packageTemplateSchema } from './packageTemplateSchema';
export type { PackageTemplate, PackageTemplateV1, PackageTemplateV2, PackageTemplateMember } from './packageTemplateSchema';
function nativeFileKey(index: number, file: RequiredNativeFile): string {
  return `${index}:${file.kind}${file.kind === 'enclosure' ? `:${file.index}` : ''}`;
}
interface TemplateFileSlot { key: string; label: string; required: boolean; native: boolean }
export function packageTemplateFileSlots(template: PackageTemplate): TemplateFileSlot[] {
  return template.members.flatMap<TemplateFileSlot>((member, index) => member.kind === 'attachment'
    ? [{ key: String(index), label: member.label, required: member.required, native: false }]
    : (member.requiredFiles ?? []).map(file => ({ key: nativeFileKey(index, file), label: `${member.label}: ${file.label}`, required: true, native: true })));
}

/** Starters retain deliberate text and figures, never prior signing or review authority. */
function cleanStarter(input: Record<string, unknown>): Record<string, unknown> {
  const draft = structuredClone(input);
  delete draft.reviewComments;
  draft.timestamp = 0;
  const form = draft.formData as Record<string, unknown>;
  // A prior Word source can contain deleted text, review notes and signatures.
  // Starters retain deliberate native content, not that historical original.
  delete form.wordSource;
  delete draft.wordSourceFile;
  delete form.basicLetterFile;
  delete form.basicLetterFileRef;
  const cleanSignatures = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(cleanSignatures); return; }
    const record = value as Record<string, unknown>;
    delete record.signatureImage;
    delete record.signatureImageSigner;
    delete record.imageRef;
    if ('signatureType' in record) record.signatureType = 'none';
    if ('signatureBlocks' in record) record.signatureBlocks = [];
    for (const child of Object.values(record)) cleanSignatures(child);
  };
  cleanSignatures(form);
  cleanSignatures(draft.forms);
  const configured = draft.genericForm as SerializedSession['genericForm'];
  if (configured) {
    for (const [key, field] of Object.entries(configured.definition.fields)) if (field.kind === 'signature') delete configured.answers[key];
    for (const [key, rows] of Object.entries(configured.rows))
      for (const row of rows) for (const [column, field] of Object.entries(configured.definition.rowGroups[key]?.columns ?? {}))
        if (field.kind === 'signature') delete row.answers[column];
    configured.answerRevision = 0;
  }
  for (const enclosure of draft.enclosures as Array<Record<string, unknown>>) {
    delete enclosure.file;
    delete enclosure.fileRef;
    enclosure.hasFile = false;
  }
  return draft;
}
function jsonSize(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function boundedTemplate(value: unknown): PackageTemplate {
  if (jsonSize(value) > MAX_PACKAGE_TEMPLATE_BYTES) throw new Error('Package templates are limited to 12 MB.');
  return packageTemplateSchema.parse(structuredClone(value));
}
async function pageAsset(page: z.infer<typeof pageSchema>, id: string): Promise<{ asset: import('./actionPackages').PackageAsset; data: ArrayBuffer }> {
  const bytes = base64ToUint8Array(page.data);
  if (!bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024 || uint8ArrayToBase64(bytes) !== page.data)
    throw new Error('A template page has invalid encoded bytes.');
  const data = bytes.buffer as ArrayBuffer;
  return { asset: { id, name: page.name, type: page.type, size: data.byteLength, sha256: await portableResourceDigest(data) }, data };
}
function assertNoTemplatePlaceholders(value: unknown): void {
  if (typeof value === 'string' && /\{\{[^{}]*\}\}/.test(value)) throw new Error('Version 2 templates use declared questions and field links, not placeholder substitution.');
  if (Array.isArray(value)) value.forEach(assertNoTemplatePlaceholders);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertNoTemplatePlaceholders);
}
async function qualifyConditionalMember(template: Extract<PackageTemplate, { version: 2 }>, member: Extract<PackageTemplateMember, { kind: 'native' }>, session: SerializedSession): Promise<void> {
  for (const key of ['sigFirst', 'sigMiddle', 'sigLast'] as const) if (session.formData[key]?.trim())
    throw new Error('Version 2 starters leave printed signature names for the native document editor.');
  if (!('links' in member)) return;
  const fields = new Map((await listPackageBindingFields({ kind: 'native', id: 'template', revisionId: 'template', label: member.label,
    role: member.role, required: member.required, session, draft: { id: 'draft', name: 'starter.json', type: 'application/json', size: 1, sha256: '0'.repeat(64) } }))
    .map(field => [packageBindingTargetKey(field.target), field]));
  for (const link of member.links ?? []) {
    const field = fields.get(packageBindingTargetKey(link.target));
    if (!field) throw new Error(`Member ${member.key} links an unavailable, changed or unsupported native field.`);
    if (field.value !== null && field.value !== '') throw new Error(`Member ${member.key}: linked fields must be empty in a fresh template.`);
    const question = template.program.questions.find(question => question.id === link.questionId)!;
    if (field.kind === 'singleChoice' && question.kind !== 'choice') throw new Error('A choice field requires a declared choice question.');
    const values = question.kind === 'choice' ? question.options!.map(option => option.id)
      : [question.kind === 'boolean' ? false : question.kind === 'date' ? '2028-02-29' : question.kind === 'decimal' ? '0' : question.kind === 'identifier' ? '0001' : 'Template value'];
    for (const value of values) formatPackageFactForField({ id: question.id, label: question.label, kind: question.kind === 'choice' ? 'text' : question.kind, value, source: { kind: 'entered' } } as PackageFact, field, link.format);
  }
}
export function validatePackageTemplate(value: PackageTemplateV1): Promise<PackageTemplateV1>;
export function validatePackageTemplate(value: PackageTemplateV2): Promise<PackageTemplateV2>;
export function validatePackageTemplate(value: unknown): Promise<PackageTemplate>;
export async function validatePackageTemplate(value: unknown): Promise<PackageTemplate> {
  const template = boundedTemplate(value);
  validateBackup({ packageTemplates: [template] });
  if (template.version === 2) assertNoTemplatePlaceholders(template);
  for (const member of template.members) {
    if (member.kind !== 'native') continue;
    const { session } = await validatePackageDraft(member.draft);
    if (template.version === 2) await qualifyConditionalMember(template, member, session);
    const fileKeys = new Set<string>();
    for (const file of member.requiredFiles ?? []) {
      const key = nativeFileKey(0, file);
      if (session.documentCategory === 'forms' || fileKeys.has(key)
        || (file.kind === 'basic-letter' ? session.docType !== 'new_page_endorsement' : !session.enclosures[file.index]))
        throw new Error('A native template file requirement has an invalid or duplicate target.');
      fileKeys.add(key);
    }
    if (JSON.stringify(cleanStarter(member.draft)) !== JSON.stringify(member.draft))
      throw new Error('Package templates cannot contain prior signatures, attached files or review comments.');
    const pages = new Map(await Promise.all(Object.entries(member.pages).map(async ([file, page], index) => {
      const item = await pageAsset(page, `page_${index}`);
      return [file, item] as const;
    })));
    await validatePackageMemberTemplates({ kind: 'native', id: 'template', revisionId: 'template', label: member.label,
      role: member.role, required: member.required, session,
      draft: { id: 'draft', name: 'starter.json', type: 'application/json', size: 1, sha256: '0'.repeat(64) },
      ...(pages.size ? { templates: Object.fromEntries([...pages].map(([file, item]) => [file, item.asset])) } : {}),
    }, async asset => {
      const page = [...pages.values()].find(page => page.asset.id === asset.id);
      if (!page) throw new Error('The template page is unavailable.');
      return page.data;
    });
  }
  return template;
}
export function packageTemplatePlaceholders(template: PackageTemplate): string[] {
  if (template.version === 2) return [];
  return [...new Set(template.members.flatMap(member => [...detectPlaceholders(member.label), ...(member.kind === 'native'
    ? [...detectSessionPlaceholders(member.draft as unknown as SerializedSession), ...(member.requiredFiles ?? []).flatMap(file => detectPlaceholders(file.label))] : [])]))].sort();
}
export async function validatePackageTemplateLibrary(records: unknown): Promise<PackageTemplate[]> {
  if (!Array.isArray(records)) throw new Error('Invalid package template library.');
  if (records.length > MAX_PACKAGE_TEMPLATES || jsonSize(records) > MAX_PACKAGE_TEMPLATE_LIBRARY_BYTES)
    throw new Error('The package template library exceeds its storage limits.');
  const templates = await Promise.all(records.map(validatePackageTemplate));
  if (new Set(templates.map(value => value.id)).size !== templates.length) throw new Error('Duplicate package template recovery identity.');
  return templates;
}
export async function listPackageTemplates(): Promise<PackageTemplate[]> { return validatePackageTemplateLibrary(await idbReadPackageTemplates()); }
async function saveTemplate(before: PackageTemplate | null, after: PackageTemplate | null, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<void> {
  if (after) await validatePackageTemplate(after);
  signal?.throwIfAborted();
  if (!await idbComparePackageTemplate(before, after, () => !signal?.aborted && isCurrent()))
    throw new Error('The template library changed or could not be saved. Reopen it and retry.');
  scheduleBackup();
}
export async function capturePackageTemplate(record: ActionPackage, revisionId: string, name: string, signal?: AbortSignal): Promise<PackageTemplateV1> {
  signal?.throwIfAborted();
  const revision = actionPackageSchema.parse(record).revisions.find(revision => revision.id === revisionId);
  if (!revision) throw new Error('This package revision is unavailable.');
  if (revision.bindings?.items.length)
    throw new Error('Create a clean starter or detach and review linked package values before saving this package as a template.');
  const template: PackageTemplateV1 = { kind: 'dondocs-package-template', version: 1, id: newPackageId('template'),
    name: packageTemplateV1Schema.shape.name.parse(name), createdAt: Date.now(), members: [] };
  let bytes = jsonSize(template);
  const includeBytes = (size: number): void => {
    bytes += size;
    if (bytes > MAX_PACKAGE_TEMPLATE_BYTES) throw new Error('Package templates are limited to 12 MB.');
  };
  // Each binding is embedded separately, even when several members share one stored PDF.
  // Reserve guaranteed retained bytes before reading drafts or allocating encoded pages.
  for (const member of revision.members) if (member.kind === 'native')
    for (const asset of Object.values(member.templates ?? {})) includeBytes(Math.ceil(asset.size / 3) * 4);
  const appendMember = (member: PackageTemplateV1['members'][number]): void => {
    includeBytes(jsonSize(member) + (template.members.length ? 1 : 0));
    template.members.push(member);
  };
  for (const member of revision.members) {
    signal?.throwIfAborted();
    const { label, role, required } = member;
    if (member.kind === 'original') { appendMember({ kind: 'attachment', label, role, required }); continue; }
    const { draft, reviewed } = await readPackageMemberDraft(member);
    signal?.throwIfAborted();
    const requiredFiles: RequiredNativeFile[] = [];
    if (reviewed.session.documentCategory !== 'forms') {
      const form = (draft as Record<string, unknown>).formData as Record<string, unknown>;
      if (reviewed.session.docType === 'new_page_endorsement' && (form.basicLetterFile || form.basicLetterFileRef))
        requiredFiles.push({ kind: 'basic-letter', label: 'Basic-letter PDF' });
      ((draft as Record<string, unknown>).enclosures as Array<Record<string, unknown>>).forEach((enclosure, index) => {
        if (enclosure.file || enclosure.fileRef || enclosure.hasFile) requiredFiles.push({ kind: 'enclosure', index, label: `Enclosure ${index + 1}: ${String(enclosure.title)}`.slice(0, 120) });
      });
    }
    const pages = Object.fromEntries(Object.entries(member.templates ?? {}).map(([file, asset]) =>
      [file, { name: asset.name, type: 'application/pdf' as const, data: '' }]));
    // Empty page data accounts for all JSON keys/escaping; encoded lengths are reserved above.
    appendMember({ kind: 'native', label, role, required, draft: cleanStarter(draft as Record<string, unknown>), pages, ...(requiredFiles.length ? { requiredFiles } : {}) });
    for (const [file, asset] of Object.entries(member.templates ?? {})) {
      signal?.throwIfAborted();
      const data = await readPackageAsset(asset);
      signal?.throwIfAborted();
      pages[file].data = uint8ArrayToBase64(new Uint8Array(data));
    }
  }
  const bounded = boundedTemplate(template);
  await saveTemplate(null, bounded, signal);
  return bounded as PackageTemplateV1;
}
export async function renamePackageTemplate(before: PackageTemplate, name: string, signal?: AbortSignal): Promise<PackageTemplate> {
  const after = boundedTemplate({ ...before, name });
  await saveTemplate(before, after, signal);
  return after;
}
export async function deletePackageTemplate(template: PackageTemplate, signal?: AbortSignal): Promise<void> { await saveTemplate(template, null, signal); }
export async function exportPackageTemplate(template: PackageTemplate): Promise<string> { return JSON.stringify(await validatePackageTemplate(template)); }
export async function importPackageTemplate(json: string, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<PackageTemplate> {
  if (new TextEncoder().encode(json).byteLength > MAX_PACKAGE_TEMPLATE_BYTES) throw new Error('Package templates are limited to 12 MB.');
  const template = await validatePackageTemplate(JSON.parse(json));
  const imported = { ...template, id: newPackageId('template'), createdAt: Date.now() };
  await saveTemplate(null, imported, signal, isCurrent);
  return imported;
}
export async function restorePackageTemplates(records: PackageTemplate[]): Promise<number> {
  const incoming = await validatePackageTemplateLibrary(records);
  if (new Set(incoming.map(value => value.id)).size !== incoming.length) throw new Error('Duplicate package template recovery identity.');
  const existing = await listPackageTemplates();
  for (const value of incoming) {
    const local = existing.find(local => local.id === value.id);
    if (local && JSON.stringify(local) !== JSON.stringify(value)) throw new Error(`Template ${value.name} differs locally. Keep the backup file.`);
  }
  let restored = 0;
  for (const value of incoming) if (!existing.some(local => local.id === value.id)) { await saveTemplate(null, value); restored++; }
  return restored;
}
export interface TemplateAttachment { name: string; data: ArrayBuffer; signedOriginal: boolean }
function freshTemplateDraft(input: Record<string, unknown>): Record<string, unknown> {
  const draft = { ...input, formData: { ...input.formData as Record<string, unknown> },
    enclosures: (input.enclosures as Array<Record<string, unknown>>).map(enclosure => ({ ...enclosure })),
    timestamp: Date.now(), paragraphs: freshParagraphs((input as unknown as SerializedSession).paragraphs) };
  const configured = input.genericForm as SerializedSession['genericForm'];
  if (configured) Object.assign(draft, { genericForm: { ...configured, rows: Object.fromEntries(Object.entries(configured.rows)
    .map(([key, rows]) => [key, rows.map(row => ({ ...row, id: newPackageId('row') }))])) } });
  return draft;
}
/** Measure JSON escaping and substitution growth without allocating expanded text. */
function assertTemplateActionBytes(template: PackageTemplate, drafts: Map<number, Record<string, unknown>>, values: Record<string, string>, fileBytes: number, nativeBytes: Map<number, number>): void {
  const costs = new Map<string, number>();
  const encoder = new TextEncoder();
  let bytes = fileBytes;
  for (const [index, starter] of template.members.entries()) {
    if (starter.kind !== 'native') continue;
    const draft = drafts.get(index)!;
    let draftBytes = jsonSize(draft) + (nativeBytes.get(index) ?? 0);
    for (const field of documentTextFields(draft as unknown as SerializedSession, 'substitution')) {
      for (const match of field.text.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)) {
        const key = match[1].toUpperCase();
        if (!Object.hasOwn(values, key)) continue;
        if (!costs.has(key)) costs.set(key, encoder.encode(JSON.stringify(values[key])).byteLength - 2);
        draftBytes += costs.get(key)! - match[0].length;
      }
    }
    bytes += draftBytes;
    for (const page of Object.values(starter.pages)) bytes += page.data.length / 4 * 3 - (page.data.endsWith('==') ? 2 : page.data.endsWith('=') ? 1 : 0);
    if (bytes > MAX_TEMPLATE_ACTION_BYTES) throw new Error('Package starter content and fresh files exceed the combined 64 MB limit.');
    if (draftBytes > 25 * 1024 * 1024) throw new Error('A generated starter exceeds the 25 MB per-file limit. Shorten its text or values.');
  }
}
function bindNativeFile(draft: Record<string, unknown>, requirement: RequiredNativeFile, file: TemplateAttachment, data: string): void {
  const payload = { name: file.name, size: file.data.byteLength, data };
  if (requirement.kind === 'basic-letter') (draft.formData as Record<string, unknown>).basicLetterFile = payload;
  else Object.assign((draft.enclosures as Array<Record<string, unknown>>)[requirement.index], { file: payload, hasFile: true });
}
/** Required slots and substitutions resolve before the new package is published atomically. */
export async function instantiatePackageTemplate(input: PackageTemplate, name: string, values: Record<string, string>, attachments: Record<string, TemplateAttachment>, signal?: AbortSignal): Promise<ActionPackage> {
  const template = await validatePackageTemplate(input);
  if (template.version !== 1) throw new Error('This versioned template requires the conditional intake workflow.');
  name = z.string().trim().min(1).max(120).parse(name);
  const slots = packageTemplateFileSlots(template);
  for (const key of Object.keys(attachments)) if (!slots.some(slot => slot.key === key))
    throw new Error('An attachment does not belong to this template.');
  const fileBytes = Object.values(attachments).reduce((sum, file) => sum + file.data.byteLength, 0);
  if (fileBytes > MAX_TEMPLATE_ACTION_BYTES)
    throw new Error('Fresh package files exceed the combined 64 MB limit.');
  values = z.record(z.string(), z.string().max(10000)).parse(structuredClone(values));
  const placeholders = packageTemplatePlaceholders(template);
  for (const key of placeholders) if (!Object.hasOwn(values, key) || !values[key].trim() || /\{\{[A-Za-z0-9_]+\}\}/.test(values[key]))
    throw new Error(`Supply a fresh value for ${key}.`);
  if (Object.keys(values).some(key => !placeholders.includes(key))) throw new Error('An unknown template input was supplied.');
  for (const slot of slots) if (slot.required && !attachments[slot.key]) throw new Error(`Attach a fresh PDF for ${slot.label}.`);
  const drafts = new Map(template.members.flatMap((member, index) => member.kind === 'native' ? [[index, freshTemplateDraft(member.draft)] as const] : []));
  const nativeBytes = new Map<number, number>();
  let originalBytes = fileBytes;
  for (const [index, member] of template.members.entries()) if (member.kind === 'native') for (const requirement of member.requiredFiles ?? []) {
    const file = attachments[nativeFileKey(index, requirement)];
    bindNativeFile(drafts.get(index)!, requirement, file, '');
    originalBytes -= file.data.byteLength;
    nativeBytes.set(index, (nativeBytes.get(index) ?? 0) + Math.ceil(file.data.byteLength / 3) * 4);
  }
  assertTemplateActionBytes(template, drafts, values, originalBytes, nativeBytes);
  attachments = structuredClone(attachments);
  const { validatePackageOriginalPdf } = await import('./actionPackageAssets');
  for (const file of Object.values(attachments)) {
    signal?.throwIfAborted();
    if (!/\.pdf$/i.test(file.name) || !file.data.byteLength || file.data.byteLength > 25 * 1024 * 1024) throw new Error('Choose a PDF no larger than 25 MB.');
    await validatePackageOriginalPdf(file.data);
  }
  const members: PackageMember[] = [], staged: StoredAttachment[] = [];
  let stagedBytes = 0;
  const stage = async (assetName: string, type: string, data: ArrayBuffer) => {
    stagedBytes += data.byteLength;
    if (stagedBytes > MAX_TEMPLATE_ACTION_BYTES) throw new Error('Package starter content and fresh files exceed the combined 64 MB limit.');
    const asset = { id: newPackageId('asset'), name: assetName, type, size: data.byteLength, sha256: await portableResourceDigest(data) };
    staged.push({ id: asset.id, name: asset.name, type, size: data.byteLength, data: data.slice(0) });
    return asset;
  };
  for (const [index, starter] of template.members.entries()) {
    signal?.throwIfAborted();
    const common = { id: newPackageId('member'), revisionId: newPackageId('member-revision'), label: replacePlaceholders(starter.label, values), role: starter.role, required: starter.required };
    if (starter.kind === 'attachment') {
      const file = attachments[index];
      if (!file) { if (starter.required) throw new Error(`Attach a fresh PDF for ${starter.label}.`); continue; }
      members.push({ ...common, kind: 'original', signedOriginal: file.signedOriginal, original: await stage(file.name, 'application/pdf', file.data) });
    } else {
      const draft = applyPlaceholdersToSession(drafts.get(index) as unknown as SerializedSession, values) as unknown as Record<string, unknown>;
      for (const requirement of starter.requiredFiles ?? []) {
        const file = attachments[nativeFileKey(index, requirement)];
        bindNativeFile(draft, requirement, file, uint8ArrayToBase64(new Uint8Array(file.data)));
      }
      const reviewed = await validatePackageDraft(draft);
      const pages: NonNullable<NativePackageMember['templates']> = {};
      for (const [file, page] of Object.entries(starter.pages)) pages[file] = await stage(page.name, page.type, (await pageAsset(page, 'page')).data);
      members.push({ ...common, kind: 'native', session: reviewed.session,
        draft: await stage(`${common.label}.dondocs.json`, 'application/json', new TextEncoder().encode(JSON.stringify(draft)).buffer),
        ...(Object.keys(pages).length ? { templates: pages } : {}),
      });
    }
  }
  const revision = { id: newPackageId('revision'), createdAt: Date.now(), members, outputs: [] };
  const record = actionPackageSchema.parse({ kind: 'dondocs-action-package-record', version: 1, id: newPackageId('package'), name,
    archived: false, sequence: 0, currentRevisionId: revision.id, revisions: [revision] });
  return commitActionPackage(null, record, signal, () => !signal?.aborted, staged);
}
