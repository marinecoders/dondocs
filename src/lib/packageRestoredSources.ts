import type { PackageRevision } from './actionPackages';
import { readPackageAsset, readPackageMemberDraft } from './actionPackageAssets';
import { reviewPackageAttachment } from './packageAttachmentCapabilities';
import { reviewPackageNative, reviewPackageOriginal } from './actionPackageDisclosure';
import type { DocumentFieldSource } from './documentFields';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';

/** A whole-revision restore reviews each member's exact retained source, then
 * each distinct pinned form background. It never stages or rewrites files. */
export async function reviewRestoredPackageSources(revision: PackageRevision, policy: PolicyResolution, signal?: AbortSignal): Promise<ExportReview[]> {
  const reviews: ExportReview[] = [];
  for (const member of revision.members) {
    signal?.throwIfAborted();
    if (member.kind === 'native') {
      const { draft, reviewed } = await readPackageMemberDraft(member);
      reviews.push(reviewPackageNative(reviewed.session, member.label, policy, draft as DocumentFieldSource));
      for (const file of [...reviewed.files, reviewed.basicLetter,
        ...reviewed.figures.filter((_, index) => reviewed.session.paragraphs[index]?.figure?.type === 'application/pdf')])
        if (file) reviews.push(await reviewPackageOriginal(file.data, `${member.label}: ${file.name}`, policy));
    } else if (member.kind === 'attachment') reviews.push((await reviewPackageAttachment(member.original, await readPackageAsset(member.original), policy, signal)).review);
    else {
      reviews.push(await reviewPackageOriginal(await readPackageAsset(member.original), member.label, policy));
      if (member.printableCopy) {
        signal?.throwIfAborted();
        const copy = member.printableCopy.asset;
        reviews.push(await reviewPackageOriginal(await readPackageAsset(copy), copy.name, policy));
      }
    }
  }
  const backgrounds = new Map(revision.members.flatMap(member => member.kind === 'native'
    ? Object.values(member.templates ?? {}).map(asset => [asset.id, asset] as const) : []));
  for (const asset of backgrounds.values()) {
    signal?.throwIfAborted();
    reviews.push(await reviewPackageOriginal(await readPackageAsset(asset), asset.name, policy));
  }
  return reviews;
}
