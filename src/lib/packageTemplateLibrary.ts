import { z } from 'zod';
import type { SerializedSession } from '@/stores/documentStore';
import { scheduleBackup } from '@/stores/backupStore';
import { actionPackageSchema, commitActionPackage, getPackageRevision, newPackageId, packageRoles, type ActionPackage, type NativePackageMember, type PackageMember } from './actionPackages';
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

export const MAX_PACKAGE_TEMPLATE_BYTES = 12 * 1024 * 1024;
export const MAX_PACKAGE_TEMPLATES = 20;
export const MAX_PACKAGE_TEMPLATE_LIBRARY_BYTES = 40 * 1024 * 1024;
const identity = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const common = { label: z.string().trim().min(1).max(120), role: z.enum(packageRoles), required: z.boolean() };
const pageSchema = z.object({ name: z.string().min(1).max(255), type: z.literal('application/pdf'), data: z.string().min(1) }).strict();
export const packageTemplateSchema = z.object({
  kind: z.literal('dondocs-package-template'), version: z.literal(1),
  id: identity, name: z.string().trim().min(1).max(120), createdAt: z.number().int().nonnegative(),
  members: z.array(z.discriminatedUnion('kind', [
    z.object({ ...common, kind: z.literal('native'), draft: z.record(z.string(), z.unknown()), pages: z.record(z.string().min(1).max(180), pageSchema) }).strict(),
    z.object({ ...common, kind: z.literal('attachment') }).strict(),
  ])).min(1).max(100),
}).strict();
export type PackageTemplate = z.infer<typeof packageTemplateSchema>;
export type PackageTemplateMember = PackageTemplate['members'][number];

/** Starters retain deliberate text and figures, never prior signing or review authority. */
function cleanStarter(input: Record<string, unknown>): Record<string, unknown> {
  const draft = structuredClone(input);
  delete draft.reviewComments;
  draft.timestamp = 0;
  const form = draft.formData as Record<string, unknown>;
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
      for (const row of rows) for (const [column, field] of Object.entries(configured.definition.rowGroups[key].columns))
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
export async function validatePackageTemplate(value: unknown): Promise<PackageTemplate> {
  const template = boundedTemplate(value);
  validateBackup({ packageTemplates: [template] });
  for (const member of template.members) {
    if (member.kind !== 'native') continue;
    const { session } = await validatePackageDraft(member.draft);
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
  return [...new Set(template.members.flatMap(member => [...detectPlaceholders(member.label), ...(member.kind === 'native'
    ? detectSessionPlaceholders(member.draft as unknown as SerializedSession) : [])]))].sort();
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
async function saveTemplate(before: PackageTemplate | null, after: PackageTemplate | null, signal?: AbortSignal): Promise<void> {
  if (after) await validatePackageTemplate(after);
  signal?.throwIfAborted();
  if (!await idbComparePackageTemplate(before, after, () => !signal?.aborted))
    throw new Error('The template library changed or could not be saved. Reopen it and retry.');
  scheduleBackup();
}
export async function capturePackageTemplate(record: ActionPackage, revisionId: string, name: string, signal?: AbortSignal): Promise<PackageTemplate> {
  const revision = getPackageRevision(actionPackageSchema.parse(record), revisionId);
  const members: PackageTemplateMember[] = [];
  for (const member of revision.members) {
    signal?.throwIfAborted();
    const { label, role, required } = member;
    if (member.kind === 'original') { members.push({ kind: 'attachment', label, role, required }); continue; }
    const { draft } = await readPackageMemberDraft(member);
    const pages = Object.fromEntries(await Promise.all(Object.entries(member.templates ?? {}).map(async ([file, asset]) =>
      [file, { name: asset.name, type: 'application/pdf' as const, data: uint8ArrayToBase64(new Uint8Array(await readPackageAsset(asset))) }])));
    members.push({ kind: 'native', label, role, required, draft: cleanStarter(draft as Record<string, unknown>), pages });
  }
  const template = boundedTemplate({ kind: 'dondocs-package-template', version: 1, id: newPackageId('template'), name, createdAt: Date.now(), members });
  await saveTemplate(null, template, signal);
  return template;
}
export async function renamePackageTemplate(before: PackageTemplate, name: string, signal?: AbortSignal): Promise<PackageTemplate> {
  const after = boundedTemplate({ ...before, name });
  await saveTemplate(before, after, signal);
  return after;
}
export async function deletePackageTemplate(template: PackageTemplate, signal?: AbortSignal): Promise<void> { await saveTemplate(template, null, signal); }
export async function exportPackageTemplate(template: PackageTemplate): Promise<string> { return JSON.stringify(await validatePackageTemplate(template)); }
export async function importPackageTemplate(json: string, signal?: AbortSignal): Promise<PackageTemplate> {
  if (new TextEncoder().encode(json).byteLength > MAX_PACKAGE_TEMPLATE_BYTES) throw new Error('Package templates are limited to 12 MB.');
  const template = await validatePackageTemplate(JSON.parse(json));
  const imported = { ...template, id: newPackageId('template'), createdAt: Date.now() };
  await saveTemplate(null, imported, signal);
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
/** Required slots and substitutions resolve before the new package is published atomically. */
export async function instantiatePackageTemplate(input: PackageTemplate, name: string, values: Record<string, string>, attachments: Record<number, TemplateAttachment>, signal?: AbortSignal): Promise<ActionPackage> {
  const template = await validatePackageTemplate(input);
  values = z.record(z.string(), z.string().max(10000)).parse(structuredClone(values));
  attachments = structuredClone(attachments);
  const placeholders = packageTemplatePlaceholders(template);
  for (const key of placeholders) if (!Object.hasOwn(values, key) || !values[key].trim() || /\{\{[A-Za-z0-9_]+\}\}/.test(values[key]))
    throw new Error(`Supply a fresh value for ${key}.`);
  if (Object.keys(values).some(key => !placeholders.includes(key))) throw new Error('An unknown template input was supplied.');
  const members: PackageMember[] = [], staged: StoredAttachment[] = [];
  const stage = async (assetName: string, type: string, data: ArrayBuffer) => {
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
      const { validatePackageOriginalPdf } = await import('./actionPackageAssets');
      if (!/\.pdf$/i.test(file.name) || !file.data.byteLength || file.data.byteLength > 25 * 1024 * 1024) throw new Error('Choose a PDF no larger than 25 MB.');
      await validatePackageOriginalPdf(file.data);
      members.push({ ...common, kind: 'original', signedOriginal: file.signedOriginal, original: await stage(file.name, 'application/pdf', file.data) });
    } else {
      const draft = applyPlaceholdersToSession(starter.draft as unknown as SerializedSession, values) as unknown as Record<string, unknown>;
      draft.timestamp = Date.now();
      draft.paragraphs = freshParagraphs((draft as unknown as SerializedSession).paragraphs);
      const configured = draft.genericForm as SerializedSession['genericForm'];
      if (configured) for (const rows of Object.values(configured.rows)) for (const row of rows) row.id = newPackageId('row');
      const reviewed = await validatePackageDraft(draft);
      const pages: NonNullable<NativePackageMember['templates']> = {};
      for (const [file, page] of Object.entries(starter.pages)) pages[file] = await stage(page.name, page.type, (await pageAsset(page, 'page')).data);
      members.push({ ...common, kind: 'native', session: reviewed.session,
        draft: await stage(`${common.label}.dondocs.json`, 'application/json', new TextEncoder().encode(JSON.stringify(draft)).buffer),
        ...(Object.keys(pages).length ? { templates: pages } : {}),
      });
    }
  }
  for (const key of Object.keys(attachments)) if (!Number.isInteger(Number(key)) || template.members[Number(key)]?.kind !== 'attachment')
    throw new Error('An attachment does not belong to this template.');
  const revision = { id: newPackageId('revision'), createdAt: Date.now(), members, outputs: [] };
  const record = actionPackageSchema.parse({ kind: 'dondocs-action-package-record', version: 1, id: newPackageId('package'), name,
    archived: false, sequence: 0, currentRevisionId: revision.id, revisions: [revision] });
  return commitActionPackage(null, record, signal, () => !signal?.aborted, staged);
}
