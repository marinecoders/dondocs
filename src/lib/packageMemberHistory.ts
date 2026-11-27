import { getPackageRevision, newPackageId, reviseActionPackage, type ActionPackage, type PackageMember } from './actionPackages';
import { preparePackagePdfAsset } from './actionPackageAssets';

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

/** A replacement keeps the document identity and starts its own review and signing history. */
export async function preparePackagePdfReplacement(member: Extract<PackageMember, { kind: 'original' }>, name: string,
  data: ArrayBuffer, signedOriginal: boolean, blankSha256?: string) {
  const { original, officialFormId, attachment } = await preparePackagePdfAsset(name, data, signedOriginal, blankSha256);
  if (original.sha256 === member.original.sha256) throw new Error('This exact PDF is already saved in this slot.');
  const { handwrittenSourceSha256: _handwritten, signatureReviewSha256: _review, signatureReviewStatements: _statements, printableCopy: _copy, officialFormId: _edition, ...slot } = member;
  const replacement = { ...slot, revisionId: newPackageId('member-revision'), original, signedOriginal,
    ...(signedOriginal && officialFormId && { officialFormId }) };
  return { replacement, attachment };
}

export async function replacePackagePdf(record: ActionPackage, selected: PackageMember, file: File, signedOriginal: boolean, signal?: AbortSignal) {
  const revision = getPackageRevision(record);
  const member = revision.members.find(item => item.id === selected.id);
  if (record.archived || record.reviewRounds?.some(round => !round.ownerPackageId) ||
      member?.revisionId !== selected.revisionId || member.kind !== 'original') throw new Error('Reopen the current PDF before replacing it.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a PDF up to 25 MB.');
  const slotId = member.evidenceSlotId ?? member.id;
  const requirement = revision.requirements?.items.find(item => item.kind === 'document' && item.memberId === slotId && item.completion?.blankSha256);
  let blankSha256 = requirement?.kind === 'document' ? requirement.completion?.blankSha256 : undefined;
  const instance = revision.templateState?.instances.find(item => item.memberId === slotId);
  if (!blankSha256 && instance) {
    const { readConditionalPackageTemplate } = await import('./packageConditionalSources');
    const template = await readConditionalPackageTemplate(record, revision.id);
    blankSha256 = template.members.find(item => item.key === instance.memberKey)?.completion?.blankSha256;
  }
  const { replacement, attachment } = await preparePackagePdfReplacement(member, file.name, await file.arrayBuffer(), signedOriginal, blankSha256);
  signal?.throwIfAborted();
  return reviseActionPackage(record, revision.members.map(item => item.id === member.id ? replacement : item),
    signal, revision.citations, undefined, undefined, [attachment]);
}
