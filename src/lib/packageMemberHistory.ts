import { getPackageRevision, newPackageId, reviseActionPackage, type ActionPackage, type PackageMember } from './actionPackages';
import { validatePackageOriginalPdf } from './actionPackageAssets';
import { newAttachmentId } from './attachments';
import { portableResourceDigest } from './portableResources';

export function packageMemberHistory(record: ActionPackage, memberId: string, through: string) {
  const changes = [];
  let previous: string | undefined;
  for (const revision of record.revisions) {
    const member = revision.members.find(item => item.id === memberId);
    if (member && member.revisionId !== previous) {
      changes.push({ packageRevisionId: revision.id, createdAt: revision.createdAt, member });
    }
    previous = member?.revisionId;
    if (revision.id === through) break;
  }
  return changes;
}

/** Replace the content in the existing slot and commit its bytes with the revision. */
export async function reviseUnsignedPackagePdf(record: ActionPackage, selected: PackageMember, file: File, signal?: AbortSignal) {
  const revision = getPackageRevision(record);
  const member = revision.members.find(item => item.id === selected.id);
  if (record.archived || record.reviewRounds?.some(round => !round.ownerPackageId) ||
      member?.revisionId !== selected.revisionId || member.kind !== 'original' || member.signedOriginal)
    throw new Error('Reopen the current unsigned PDF before replacing it.');
  if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 25 * 1024 * 1024)
    throw new Error('Choose a PDF up to 25 MB.');
  const data = await file.arrayBuffer();
  await validatePackageOriginalPdf(data);
  const sha256 = await portableResourceDigest(data);
  if (sha256 === member.original.sha256) throw new Error('This exact PDF is already saved in this slot.');
  signal?.throwIfAborted();
  const original = { id: newAttachmentId(), type: 'application/pdf', name: file.name, size: data.byteLength, sha256 };
  const { signatureReviewSha256: _previousReview, ...previous } = member;
  const replacement = { ...previous, revisionId: newPackageId('member-revision'), original };
  return reviseActionPackage(record, revision.members.map(item => item.id === member.id ? replacement : item),
    signal, revision.citations, undefined, undefined, [{ ...original, data }]);
}
