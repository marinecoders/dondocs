import 'fake-indexeddb/auto';
import { PDFDocument, degrees } from 'pdf-lib';
import { beforeEach, expect, it, vi } from 'vitest';
import { createActionPackage, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { startPackageReview, transitionPackageReview } from '@/lib/packageReviewRounds';
import { preparePackageReviewMember, savePackageMemberReview } from '@/lib/packageMemberReviews';
import { addPackagePdfRegionComment, capturePackagePdfRegion, inspectPackagePdfRegion, replyPackagePdfRegion, readPackagePdfReviewSource } from '@/lib/packagePdfReview';
import { buildPackageReviewerCopy, packageReviewTransferFile, parsePackageReviewTransfer, preparePackageReviewerImport, importPackageReviewerCopy, buildPackageReviewReturn } from '@/lib/packageReviewTransfer';
import { idbDeleteAttachment, idbCompareActionPackage } from '@/lib/documentsDb';
import { preparePackagePdfFeedbackImport, applyPreparedPackageFormFeedbackImport } from '@/lib/packageFormFeedbackImport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => 'Synthetic original PDF text') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy); });
async function fixture() {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]).drawText('Synthetic original page one.');
  const second = pdf.addPage([500, 800]); second.setCropBox(20, 30, 300, 600); second.setRotation(degrees(90)); second.drawText('Synthetic rotated page.');
  const bytes = new Uint8Array(await pdf.save()).buffer, member = await captureOriginalPackageMember({ name: 'Synthetic signed original.pdf', data: bytes }, 'enclosure', true);
  if (member.kind !== 'original') throw new Error('Expected an original PDF fixture.');
  const record = await startPackageReview(await reviseActionPackage(await createActionPackage(`PDF review ${crypto.randomUUID()}`), [member]));
  const round = record.reviewRounds![0], prepared = await preparePackageReviewMember(record, round.id, member.id);
  const anchor = await capturePackagePdfRegion(member, 2, { left: 0.1, top: 0.2, width: 0.3, height: 0.25 });
  return { record: prepared.record, round: prepared.record.reviewRounds![0], child: prepared.child, member, bytes, anchor };
}
async function removePackage(id: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction('app', 'readwrite'); transaction.objectStore('app').delete(`action-package:${id}`); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
}
it('anchors exact original bytes, physical page, crop and rotation while leaving signed bytes unchanged', async () => {
  const { record, round, child, member, bytes, anchor } = await fixture();
  expect(anchor.geometry).toEqual({ x: 20, y: 30, width: 300, height: 600, rotation: 90 });
  const pdfReview = addPackagePdfRegionComment(undefined, anchor, 'Alex Example', 'Check this exact original region.');
  const saved = await savePackageMemberReview(record, round.id, { ...child, pdfReview });
  expect(await readPackageAsset(member.original)).toEqual(bytes); expect(saved.revisions).toEqual(record.revisions);
  expect((await listActionPackages()).find(item => item.id === saved.id)).toEqual(saved);
  expect(await inspectPackagePdfRegion(member, anchor)).toBe('current');
});
it('keeps PDF replacements and internal page reorder unavailable instead of moving a region to another page', async () => {
  const { member, anchor, bytes } = await fixture(), source = await PDFDocument.load(bytes), reordered = await PDFDocument.create();
  const pages = await reordered.copyPages(source, [1, 0]); for (const page of pages) reordered.addPage(page);
  const changed = await captureOriginalPackageMember({ name: member.original.name, data: new Uint8Array(await reordered.save()).buffer }, 'enclosure', true);
  expect(await inspectPackagePdfRegion(changed, anchor)).toBe('unavailable');
  expect(await inspectPackagePdfRegion(undefined, anchor)).toBe('unavailable');
});
it('rejects forged source hashes, page numbers, geometry and out-of-page or empty rectangles', async () => {
  const { record, round, child, member, anchor } = await fixture();
  for (const altered of [{ ...anchor, assetSha256: '0'.repeat(64) }, { ...anchor, page: 3 }, { ...anchor, geometry: { ...anchor.geometry, width: 301 } }]) {
    const pdfReview = addPackagePdfRegionComment(undefined, altered, 'Alex Example', 'Synthetic invalid target.');
    await expect(savePackageMemberReview(record, round.id, { ...child, pdfReview })).rejects.toThrow(/exact captured/);
  }
  for (const region of [{ left: 0.9, top: 0, width: 0.2, height: 0.2 }, { left: 0, top: 0, width: 0, height: 0.2 }])
    await expect(capturePackagePdfRegion(member, 1, region)).rejects.toThrow();
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});
it('validates region feedback against portable bytes before a fresh receiving inventory has the file', async () => {
  const { record, round, child, member, bytes, anchor } = await fixture();
  const saved = await savePackageMemberReview(record, round.id, { ...child, pdfReview: addPackagePdfRegionComment(undefined, anchor, 'Alex Example', 'Portable original region.') });
  const json = await packageReviewTransferFile(await buildPackageReviewerCopy(saved, round.id, policy), policy);
  await removePackage(saved.id); await idbDeleteAttachment(member.original.id);
  await expect(readPackageAsset(member.original)).rejects.toThrow(/Missing|corrupt/);
  const parsed = await parsePackageReviewTransfer(json); expect(parsed.memberReviews[0].pdfReview!.comments[0].anchor).toEqual(anchor);
  const received = await importPackageReviewerCopy(await preparePackageReviewerImport(json, policy), policy);
  expect(await readPackageAsset(member.original)).toEqual(bytes);
  expect(received.reviewRounds![0].memberReviews![0].pdfReview).toEqual(saved.reviewRounds![0].memberReviews![0].pdfReview);
});
it('collects exact returned PDF region discussion and preserves original package content', async () => {
  const { record, round, child, member, bytes, anchor } = await fixture();
  const saved = await savePackageMemberReview(record, round.id, { ...child, pdfReview: addPackagePdfRegionComment(undefined, anchor, 'Alex Example', 'Returned PDF region.') });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(saved, round.id, policy), policy);
  // Restore the isolated owner fixture inventory, equivalent to opening the return in its original browser.
  await removePackage(record.id); expect(await idbCompareActionPackage(null, record)).toBe(true);
  const prepared = await preparePackagePdfFeedbackImport(record, round.id, member.id, json, policy);
  expect(prepared.ready).toBe(true); expect(prepared.comments).toBe(1);
  const collected = await applyPreparedPackageFormFeedbackImport(prepared, policy, true);
  expect(collected.revisions).toEqual(record.revisions); expect(await readPackageAsset(member.original)).toEqual(bytes);
  expect(collected.reviewRounds![0].memberReviews![0].pdfReview!.comments[0].anchor).toEqual(anchor);
});
it('saves replies and resolution without altering anchors and refuses closed, cancelled or retargeted writes', async () => {
  const { record, round, child, member, bytes, anchor } = await fixture();
  const review = addPackagePdfRegionComment(undefined, anchor, 'Alex Example', 'First region comment.');
  const saved = await savePackageMemberReview(record, round.id, { ...child, pdfReview: review });
  const replied = replyPackagePdfRegion(review, review.comments[0].id, 'Blair Sample', 'Reply to the same region.');
  const next = await savePackageMemberReview(saved, round.id, { ...child, pdfReview: { ...replied, comments: replied.comments.map(comment => ({ ...comment, resolved: true })) } });
  expect(next.reviewRounds![0].memberReviews![0].pdfReview!.comments[0].messages).toHaveLength(2);
  const retargeted = { ...replied, comments: replied.comments.map(comment => ({ ...comment, anchor: { ...anchor, region: { ...anchor.region, left: 0.2 } } })) };
  await expect(savePackageMemberReview(next, round.id, { ...child, pdfReview: retargeted })).rejects.toThrow(/changed/);
  await expect(savePackageMemberReview(next, round.id, { ...child, pdfReview: replied }, AbortSignal.abort())).rejects.toThrow();
  const closed = await transitionPackageReview(next, round.id, 'close');
  await expect(savePackageMemberReview(closed, round.id, { ...child, pdfReview: replied })).rejects.toThrow(/closed/);
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(closed);
  expect(await readPackageAsset(member.original)).toEqual(bytes);
});
it('checks raw multiline PDF region discussion at the transfer policy boundary', async () => {
  const { record, round, child, anchor } = await fixture();
  const saved = await savePackageMemberReview(record, round.id, { ...child, pdfReview: addPackagePdfRegionComment(undefined, anchor, 'Alex Example', 'Synthetic note.\n(S) Restricted synthetic note.') });
  await expect(buildPackageReviewReturn(saved, round.id, policy)).rejects.toThrow(/markings|levels/);
});
it.each([[-50, 0, 400, 300], [500, 500, 100, 100]])('anchors the displayed media intersection or fallback for crop box %j', async (x, y, width, height) => {
  const document = await PDFDocument.create(), page = document.addPage([200, 300]);
  page.setCropBox(x, y, width, height);
  const member = await captureOriginalPackageMember({ name: 'Oversized crop.pdf', data: new Uint8Array(await document.save()).buffer }, 'enclosure', false);
  const source = await readPackagePdfReviewSource(member);
  expect(source.pages[0]).toEqual({ x: 0, y: 0, width: 200, height: 300, rotation: 0 });
  expect((await capturePackagePdfRegion(member, 1, { left: 0.25, top: 0.25, width: 0.25, height: 0.25 })).geometry).toEqual(source.pages[0]);
});
