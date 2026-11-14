import { validatePackageDraft } from './actionPackageDraft';
import { validatePackageMemberTemplates } from './actionPackageTemplates';
import { PDFDocument } from 'pdf-lib';
import { portableResourceDigest } from './portableResources';
import { z } from 'zod';
import { actionPackageSchema, commitActionPackage, listActionPackages, packageAssets, getPackageRevision, type ActionPackage } from './actionPackages';
import { buildPortableResources, parsePortableResources } from './portableResources';
import { readPackageAsset, readPackageMemberDraft } from './actionPackageAssets';
import { idbGetAttachment, idbPutAttachment, sameReviewStoredValue } from './documentsDb';
import { withAttachmentStaging } from './attachments';

export const MAX_PACKAGE_FILE_BYTES = 100 * 1024 * 1024;
const envelopeSchema = z.object({ kind: z.literal('dondocs-action-package'), version: z.literal(1), package: actionPackageSchema, portableResources: z.unknown() }).strict();
export async function buildPortableActionPackage(record: ActionPackage, revisionId = record.currentRevisionId): Promise<string> {
  const selected = getPackageRevision(record, revisionId);
  const owned = actionPackageSchema.parse({ ...structuredClone(record), historyScope: 'selected-revision', currentRevisionId: selected.id, revisions: [selected] });
  for (const revision of owned.revisions) for (const member of revision.members) if (member.kind === 'native') await readPackageMemberDraft(member);
  for (const revision of owned.revisions) for (const member of revision.members) if (member.kind === 'native' && member.source) member.source.local = false;
  delete owned.workingCopies;
  const assets = [...new Map(packageAssets(owned).map(asset => [asset.id, asset])).values()];
  const portableResources = await buildPortableResources(await Promise.all(assets.map(async asset => ({ path: `assets/${asset.id}`, name: asset.name, mediaType: asset.type, data: await readPackageAsset(asset) }))));
  const json = JSON.stringify({ kind: 'dondocs-action-package', version: 1, package: owned, portableResources });
  if (new TextEncoder().encode(json).byteLength > MAX_PACKAGE_FILE_BYTES) throw new Error('This editable package exceeds the 100 MB transfer limit.');
  return json;
}
export async function parsePortableActionPackage(json: string) {
  if (new TextEncoder().encode(json).byteLength > MAX_PACKAGE_FILE_BYTES) throw new Error('This editable package exceeds the 100 MB transfer limit.');
  const envelope = envelopeSchema.parse(JSON.parse(json));
  if (envelope.package.workingCopies?.length || envelope.package.revisions.some(revision => revision.members.some(member => member.kind === 'native' && member.source?.local))) throw new Error('Portable packages cannot bind to local source or working-copy identities.');
  const resources = await parsePortableResources(envelope.portableResources);
  const assets = packageAssets(envelope.package), distinct = new Map<string, typeof assets[number]>();
  for (const asset of assets) {
    if (distinct.has(asset.id) && JSON.stringify(distinct.get(asset.id)) !== JSON.stringify(asset)) throw new Error('Conflicting saved asset identity.');
    distinct.set(asset.id, asset);
    const resource = resources.get(`assets/${asset.id}`);
    const entry = (envelope.portableResources as { entries: Array<{ path: string; sha256: string }> }).entries.find(entry => entry.path === `assets/${asset.id}`);
    if (!resource || !entry || entry.sha256 !== asset.sha256 || resource.name !== asset.name || resource.mediaType !== asset.type || resource.data.byteLength !== asset.size) throw new Error(`The package is missing required content: ${asset.name}.`);
  }
  if (resources.size !== distinct.size) throw new Error('The package contains unbound resources.');
  await validateActionPackageResources(envelope.package, async asset => resources.get(`assets/${asset.id}`)!.data);
  return { record: envelope.package, resources };
}
export async function importPortableActionPackage(json: string): Promise<ActionPackage> {
  const { record, resources } = await parsePortableActionPackage(json);
  return withAttachmentStaging(async () => {
    const existing = (await listActionPackages()).find(item => item.id === record.id);
    const comparable = (value: ActionPackage) => { const copy = structuredClone(value);delete copy.workingCopies;for (const revision of copy.revisions) for (const member of revision.members) if (member.kind === 'native' && member.source) member.source.local = false;return copy; };
    const retained = existing && { ...existing, historyScope: record.historyScope, currentRevisionId: record.currentRevisionId, sequence: record.sequence, revisions: existing.revisions.filter(revision => record.revisions.some(incoming => incoming.id === revision.id)) };
    if (existing && !sameReviewStoredValue(comparable(retained!), comparable(record))) throw new Error('This package identity already exists with different revisions. Duplicate the local package before importing a different history.');
    for (const asset of packageAssets(record)) {
      const previous = await idbGetAttachment(asset.id), data = resources.get(`assets/${asset.id}`)!.data;
      if (previous) {
        await readPackageAsset(asset);
      } else if (!await idbPutAttachment({ ...asset, data }, true)) throw new Error(`Could not retain ${asset.name}. The package was not installed.`);
    }
    for (const revision of record.revisions) for (const member of revision.members) if (member.kind === 'native') await readPackageMemberDraft(member);
    return existing ?? commitActionPackage(null, record);
  });
}

/** Shared package integrity boundary for local readiness, portable files and workspace recovery. */
export async function validateActionPackageResources(record: ActionPackage, read: (asset: import('./actionPackages').PackageAsset) => Promise<ArrayBuffer>) {
  const owned = actionPackageSchema.parse(record);
  const seen = new Map<string, string>();
  for (const asset of packageAssets(owned)) {
    const identity = JSON.stringify(asset);
    if (seen.has(asset.id)) { if (seen.get(asset.id) !== identity) throw new Error('Conflicting package asset identity.');continue; }
    seen.set(asset.id, identity);
    const data = await read(asset);
    if (data.byteLength !== asset.size || await portableResourceDigest(data) !== asset.sha256) throw new Error(`Missing or corrupt package content: ${asset.name}.`);
  }
  for (const revision of owned.revisions) {
    for (const member of revision.members) {
      if (member.kind === 'original') { await PDFDocument.load(await read(member.original));continue; }
      const draft: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read(member.draft)));
      if (draft && typeof draft === 'object' && ('portableResources' in draft || 'portableFormTemplates' in draft)) throw new Error('Package templates must have a single explicit resource binding.');
      const reviewed = await validatePackageDraft(draft);
      if (JSON.stringify(reviewed.session) !== JSON.stringify(member.session)) throw new Error(`The saved model for ${member.label} does not match its native draft.`);
      await validatePackageMemberTemplates(member, read);
    }
    for (const output of revision.outputs) {
      const pdf = await PDFDocument.load(await read(output.asset));
      if (pdf.getPageCount() !== output.boundaries.reduce((total, boundary) => total + boundary.pageCount, 0)) throw new Error('The retained PDF does not match its member page boundaries.');
    }
  }
}
