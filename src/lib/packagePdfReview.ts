import { PDFDocument } from 'pdf-lib';
import type { PackageAsset, PackageMember, PackageMemberReview, PackageReviewRound } from './actionPackages';
import { readPackageAsset } from './actionPackageAssets';
import { portableResourceDigest } from './portableResources';
import { uint8ArrayToBase64 } from './encoding';
import { sameReviewStoredValue } from './documentsDb';
import { packagePdfAnchorSchema, packagePdfGeometrySchema, packagePdfRegionSchema, packagePdfReviewSchema,
  type PackagePdfAnchor, type PackagePdfGeometry, type PackagePdfRegion, type PackagePdfReview } from './packagePdfReviewModel';
import type { FeedbackCategory } from './reviewFeedback';
export * from './packagePdfReviewModel';
export type PackagePdfValidationCache = Map<string, Promise<PackagePdfGeometry[]>>;
type ReadAsset = (asset: PackageAsset) => Promise<ArrayBuffer>;
async function source(member: PackageMember, read: ReadAsset) {
  if (member.kind !== 'original') throw new Error('Region comments require an exact original PDF.');
  const bytes = await read(member.original);
  if (bytes.byteLength > 25 * 1024 * 1024 || await portableResourceDigest(bytes) !== member.original.sha256) throw new Error('The captured PDF bytes do not match this review.');
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  if (document.getPageCount() < 1) throw new Error('The captured PDF has no original pages.');
  if (document.getPageCount() > 500) throw new Error('PDF region review supports at most 500 original pages.');
  const pages: PackagePdfGeometry[] = document.getPages().map(page => {
    const media = page.getMediaBox(), crop = page.getCropBox();
    const x = Math.max(media.x, crop.x), y = Math.max(media.y, crop.y);
    const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
    const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
    // PDF.js displays the nonempty crop/media intersection, or the media box
    // when they do not intersect. The overlay must use that same visible area.
    const visible = width > 0 && height > 0 ? { x, y, width, height } : media;
    return packagePdfGeometrySchema.parse({ ...visible, rotation: ((page.getRotation().angle % 360) + 360) % 360 });
  });
  return { bytes, pages };
}
/** Rendering reads preserved bytes; it never annotates or rewrites the signed original. */
export async function readPackagePdfReviewSource(member: PackageMember) {
  const value = await source(member, readPackageAsset);
  return { data: uint8ArrayToBase64(new Uint8Array(value.bytes)), pages: value.pages };
}
export async function capturePackagePdfRegion(member: PackageMember, page: number, region: PackagePdfRegion): Promise<PackagePdfAnchor> {
  const value = await source(member, readPackageAsset);
  if (member.kind !== 'original' || !Number.isInteger(page) || !value.pages[page - 1]) throw new Error('Choose a page in this exact captured PDF.');
  return packagePdfAnchorSchema.parse({ assetSha256: member.original.sha256, page, geometry: value.pages[page - 1], region: packagePdfRegionSchema.parse(region) });
}
export async function inspectPackagePdfRegion(member: PackageMember | undefined, input: PackagePdfAnchor): Promise<'current' | 'unavailable'> {
  const anchor = packagePdfAnchorSchema.parse(input);
  if (member?.kind !== 'original' || member.original.sha256 !== anchor.assetSha256) return 'unavailable';
  const value = await source(member, readPackageAsset);
  return sameReviewStoredValue(value.pages[anchor.page - 1], anchor.geometry) ? 'current' : 'unavailable';
}
export function addPackagePdfRegionComment(input: PackagePdfReview | undefined, anchor: PackagePdfAnchor, author: string, text: string,
  category: FeedbackCategory = 'question'): PackagePdfReview {
  const review = packagePdfReviewSchema.parse(structuredClone(input ?? { version: 1, comments: [] }));
  review.comments.push({ id: crypto.randomUUID(), anchor: packagePdfAnchorSchema.parse(anchor), category, resolved: false,
    messages: [{ id: crypto.randomUUID(), author, text, createdAt: new Date().toISOString() }] });
  return packagePdfReviewSchema.parse(review);
}
export function replyPackagePdfRegion(input: PackagePdfReview, commentId: string, author: string, text: string): PackagePdfReview {
  const review = packagePdfReviewSchema.parse(structuredClone(input)), comment = review.comments.find(comment => comment.id === commentId);
  if (!comment) throw new Error('This exact PDF region discussion is unavailable.');
  comment.messages.push({ id: crypto.randomUUID(), author, text, createdAt: new Date().toISOString() }); return packagePdfReviewSchema.parse(review);
}
export async function validatePackagePdfFeedback(round: PackageReviewRound, child: PackageMemberReview, read: ReadAsset = readPackageAsset, cache?: PackagePdfValidationCache): Promise<void> {
  if (!child.pdfReview) return;
  const member = round.baseline.members.find(member => member.id === child.binding.memberId);
  if (!member || member.kind !== 'original') throw new Error('PDF region feedback requires its exact original member.');
  if (!child.pdfReview.comments.length) return;
  const identity = JSON.stringify(member.original);
  let pending = cache?.get(identity);
  if (!pending) { pending = source(member, read).then(value => value.pages); cache?.set(identity, pending); }
  const pages = await pending;
  for (const comment of child.pdfReview.comments) if (comment.anchor.assetSha256 !== member.original.sha256
    || !sameReviewStoredValue(comment.anchor.geometry, pages[comment.anchor.page - 1]))
    throw new Error('The PDF region does not match its exact captured bytes, page and geometry.');
}
