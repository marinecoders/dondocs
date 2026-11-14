import { PDFDocument } from 'pdf-lib';
import { validatePackagePage } from '@/services/forms/packages';
import { retainPortableFormTemplates } from '@/services/forms/portableTemplates';
import type { NativePackageMember, PackageAsset } from './actionPackages';

/** Built-in templates are pinned to the existing shipped renderer geometry. */
const builtinTemplateHashes: Record<string, Record<string, string>> = {
  navmc_10274: { page1: '5f5e661d628378ae56d575740cc78fc2d6369d2ab49edc01a1f0722f7905c5d1', page2: '8ef605884fd1f221b03390a7ba8bb0a55c2eb4e64d1e1164cadd1a718d6d5e91', page3: 'd07faffc16a0c6cbefe824da530573989987622e0db85f3b60fd4e01238443d1' },
  navmc_118_11: { page1: 'eaea7e582dc90ab4bffc88b5ff28b5795b0432206dda005ee2e912ff6a0401fb' },
};
export async function validatePackageMemberTemplates(member: NativePackageMember, read: (asset: PackageAsset) => Promise<ArrayBuffer>): Promise<void> {
  if (member.session.documentCategory !== 'forms') {
    if (member.templates && Object.keys(member.templates).length) throw new Error('A correspondence member cannot carry form templates.');
    return;
  }
  const definition = member.session.genericForm?.definition;
  const templates = member.templates ?? {};
  const required = definition ? Object.fromEntries(definition.pages.map(page => [page.file, page.sha256])) : builtinTemplateHashes[member.session.formType!];
  if (!required || Object.keys(required).length !== Object.keys(templates).length) throw new Error(`The exact form templates for ${member.label} are missing or unsupported.`);
  for (const [file, hash] of Object.entries(required)) {
    const asset = templates[file];
    if (!hash || !asset || asset.sha256 !== hash || asset.type !== 'application/pdf') throw new Error(`The pinned template does not match ${member.label}: ${file}.`);
    const bytes = new Uint8Array(await read(asset));
    if (definition) await validatePackagePage(definition, file, bytes);
    else if ((await PDFDocument.load(bytes)).getPageCount() !== 1) throw new Error('A built-in form template must contain its exact single page.');
  }
}

export async function retainPackageMemberTemplates(member: NativePackageMember, read: (asset: PackageAsset) => Promise<ArrayBuffer>): Promise<void> {
  const definition = member.session.genericForm?.definition;
  if (!definition) return;
  const pages: Record<string, Uint8Array> = {};
  for (const [file, asset] of Object.entries(member.templates ?? {})) pages[file] = new Uint8Array(await read(asset));
  if (!await retainPortableFormTemplates([{ definition, pages }])) throw new Error(`The exact templates for ${member.label} could not be retained.`);
}
