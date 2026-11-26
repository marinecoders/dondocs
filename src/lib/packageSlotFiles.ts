import { getPackageRevision, newPackageId, reviseActionPackage, type ActionPackage, type PackageMember } from './actionPackages';
import { readConditionalPackageTemplate } from './packageConditionalSources';
import { newAttachmentId } from './attachments';
import { validatePackageOriginalPdf } from './packageOriginalPdf';
import { portableResourceDigest } from './portableResources';

/** Capture an original into a declared slot without changing the user's other intake answers. */
export async function attachPackageSlotFile(record: ActionPackage, revisionId: string, memberId: string, file: File, signedOriginal: boolean, signal?: AbortSignal) {
  if (record.currentRevisionId !== revisionId || record.archived || record.reviewRounds?.some(round => !round.ownerPackageId))
    throw new Error('Open the current editable package to attach a file.');
  const revision = getPackageRevision(record);
  const instances = revision.templateState?.instances ?? [];
  const slot = instances.find(item => item.memberId === memberId);
  const template = await readConditionalPackageTemplate(record, revisionId);
  const blueprint = template.members.find(item => item.key === slot?.memberKey);
  if (slot?.condition !== true || blueprint?.kind !== 'attachment' || revision.members.some(member => member.id === memberId))
    throw new Error('This document slot is no longer available.');
  if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 25 * 1024 * 1024)
    throw new Error('Choose a PDF up to 25 MB.');
  const data = await file.arrayBuffer();
  await validatePackageOriginalPdf(data);
  const sha256 = await portableResourceDigest(data);
  if (sha256 === blueprint.completion?.blankSha256) throw new Error('This is the blank form. Attach the completed original.');
  const original = { id: newAttachmentId(), name: file.name, size: data.byteLength, type: 'application/pdf' as const, sha256 };
  const member: PackageMember = { id: slot.memberId, revisionId: newPackageId('member-revision'), kind: 'original',
    label: slot.label, role: blueprint.role, required: blueprint.required, signedOriginal, original };
  const later = new Set(instances.slice(instances.indexOf(slot) + 1).map(item => item.memberId));
  const next = revision.members.findIndex(item => later.has(item.id));
  const members = [...revision.members];
  members.splice(next === -1 ? members.length : next, 0, member);
  return reviseActionPackage(record, members, signal, revision.citations, undefined, undefined, [{ ...original, data }]);
}
