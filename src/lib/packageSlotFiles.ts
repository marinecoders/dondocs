import { MAX_TEMPLATE_ACTION_BYTES } from './packageTemplateLibrary';
import { packageMemberLabel, getPackageRevision, newPackageId, reviseActionPackage, type ActionPackage, type PackageMember } from './actionPackages';
import { readConditionalPackageTemplate } from './packageConditionalSources';
import { preparePackagePdfAsset } from './actionPackageAssets';

function checkPackageUploadSizes(files: readonly File[]) {
  if (!files.length || files.some(file => !/\.pdf$/i.test(file.name) || !file.size || file.size > 25 * 1024 * 1024)
      || files.reduce((size, file) => size + file.size, 0) > MAX_TEMPLATE_ACTION_BYTES)
    throw new Error('Choose PDFs up to 25 MB each and 64 MB in total.');
}

export async function preparePackageUploads(files: readonly File[], role: PackageMember['role'], signedOriginal: boolean, signal?: AbortSignal) {
  checkPackageUploadSizes(files);
  const members: PackageMember[] = [], attachments = [];
  for (const file of files) {
    signal?.throwIfAborted();
    const { original, attachment, officialFormId } = await preparePackagePdfAsset(file.name, await file.arrayBuffer(), signedOriginal);
    members.push({ id: newPackageId('member'), revisionId: newPackageId('member-revision'), kind: 'original', label: packageMemberLabel(file.name),
      required: true, role: role === 'basic-letter' && members.length ? 'supporting-document' : role, signedOriginal, original, ...(officialFormId && { officialFormId }) });
    attachments.push(attachment);
  }
  return { members, attachments };
}

/** Capture an original into a declared slot without changing the user's other intake answers. */
export async function attachPackageSlotFiles(record: ActionPackage, revisionId: string, memberId: string, files: readonly File[], signedOriginal: boolean, signal?: AbortSignal) {
  if (record.currentRevisionId !== revisionId || record.archived || record.reviewRounds?.some(round => !round.ownerPackageId))
    throw new Error('Open the current editable package to attach a file.');
  const revision = getPackageRevision(record);
  const instances = revision.templateState?.instances ?? [];
  const slot = instances.find(item => item.memberId === memberId);
  const template = await readConditionalPackageTemplate(record, revisionId);
  const blueprint = template.members.find(item => item.key === slot?.memberKey);
  const saved = revision.members.find(member => member.id === memberId);
  if (slot?.condition !== true || blueprint?.kind !== 'attachment' || (saved || files.length > 1) && !blueprint.multipleFiles)
    throw new Error('This document slot is no longer available.');
  checkPackageUploadSizes(files);
  const staged = [], additions: PackageMember[] = [];
  for (const [index, file] of files.entries()) {
    signal?.throwIfAborted();
    const data = await file.arrayBuffer();
    const { original, attachment, officialFormId } = await preparePackagePdfAsset(file.name, data, signedOriginal, blueprint.completion?.blankSha256);
    const extra = !!saved || index > 0;
    additions.push({ id: extra ? newPackageId('member') : slot.memberId, revisionId: newPackageId('member-revision'), kind: 'original',
      label: extra ? packageMemberLabel(file.name) : slot.label, role: blueprint.role, required: !extra && blueprint.required, signedOriginal, original,
      ...(officialFormId && { officialFormId }), ...(extra && { evidenceSlotId: slot.memberId }) });
    staged.push(attachment);
  }
  const later = new Set(instances.slice(instances.indexOf(slot) + 1).map(item => item.memberId));
  const next = revision.members.findIndex(item => later.has(item.id));
  const members = [...revision.members];
  const last = members.reduce((found, item, index) => item.id === memberId || item.kind === 'original' && item.evidenceSlotId === memberId ? index : found, -1);
  members.splice(last >= 0 ? last + 1 : next === -1 ? members.length : next, 0, ...additions);
  return reviseActionPackage(record, members, signal, revision.citations, undefined, undefined, staged);
}
