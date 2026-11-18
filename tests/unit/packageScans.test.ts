import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { actionPackageSchema, createActionPackage, getPackageRevision, listActionPackages, packageAssets, renameActionPackage, reviseActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { preparePackageScan, preparePackageScanCorrection, savePreparedPackageScan, openPackageScan, copyPreparedPackageScanSource, preparePackageScanFact, packageScanIsCurrent, packageScansSchema } from '@/lib/packageScans';
import { recognizeScannedFile } from '@/lib/scannedImport';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { applyPreparedPackageUpdate } from '@/lib/packageUpdates';
import { searchCapturedPackage } from '@/lib/packageSearch';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { useUIStore } from '@/stores/uiStore';
import { idbDeleteAttachment } from '@/lib/documentsDb';
import { extractPdfText } from '@/lib/pdfText';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
vi.mock('@/lib/scannedImport', () => ({ recognizeScannedFile: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(() => {
  vi.restoreAllMocks(); vi.mocked(extractPdfText).mockResolvedValue(''); useUIStore.setState({ storageHealth: 'ok' });
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  vi.mocked(recognizeScannedFile).mockReset().mockResolvedValue([{ page: 1, text: 'Synthetic scanned training excerpt', confidence: 92, preview: new Blob(['synthetic preview']) }]);
});
async function fixture() {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
  return reviseActionPackage(await createActionPackage(`Scanned ${crypto.randomUUID()}`), [await captureOriginalPackageMember({ name: 'Synthetic scan.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'basic-letter', false)]);
}
async function savedFixture() {
  const before = await fixture(), prepared = await preparePackageScan(before, getPackageRevision(before).members[0].id, policy);
  return savePreparedPackageScan(await preparePackageScanCorrection(prepared, ['User corrected training excerpt'], policy), policy, true);
}
it('preserves the exact source, recognized words and corrections in a new portable revision', async () => {
  const before = await fixture(), member = getPackageRevision(before).members[0], prepared = await preparePackageScan(before, member.id, policy);
  expect(await copyPreparedPackageScanSource(prepared).arrayBuffer()).toEqual(await readPackageAsset(member.kind === 'native' ? member.draft : member.original));
  const correction = await preparePackageScanCorrection(prepared, ['User corrected training excerpt'], policy);
  const saved = await savePreparedPackageScan(correction, policy, true), revision = getPackageRevision(saved), scan = revision.scans!.items[0];
  expect(scan.pages[0]).toMatchObject({ recognizedText: 'Synthetic scanned training excerpt', text: 'User corrected training excerpt', confidence: 92 });
  expect(scan.status).toBe('corrected'); expect(revision.information).toEqual(getPackageRevision(before).information);
  expect(saved.revisions.slice(0, -1)).toEqual(before.revisions); expect(revision.parentId).toBe(before.currentRevisionId);
  expect(packageScanIsCurrent(scan, revision)).toBe(true); expect(packageAssets(saved)).toContainEqual(scan.source);
  const portable = await parsePortableActionPackage(await buildPortableActionPackage(saved));
  expect(getPackageRevision(portable.record).scans).toEqual(revision.scans);
});
it('keeps a removed source preserved and reopens its saved extraction while refusing current-value adoption', async () => {
  const saved = await savedFixture(), old = getPackageRevision(saved), scan = old.scans!.items[0];
  const another = await fixture(), replacement = getPackageRevision(another).members[0];
  const changed = await reviseActionPackage(saved, [replacement]);
  expect(packageAssets(changed)).toContainEqual(scan.source);
  // A normal package membership revision preserves its saved extraction metadata.
  expect(getPackageRevision(changed).scans).toEqual(old.scans);
  const opened = await openPackageScan(changed, scan.id, policy);
  expect(await copyPreparedPackageScanSource(opened).arrayBuffer()).toEqual(await readPackageAsset(scan.source));
  expect(packageScanIsCurrent(scan, getPackageRevision(changed))).toBe(false);
  await expect(preparePackageScanFact(changed, scan.id, 1, 'Control', 'training excerpt', policy)).rejects.toThrow('still current');
  const portable = await parsePortableActionPackage(await buildPortableActionPackage(changed)); expect(packageAssets(portable.record)).toContainEqual(scan.source);
});
it('adopts only an explicit exact excerpt through the reviewed shared-value update', async () => {
  const saved = await savedFixture(), scan = getPackageRevision(saved).scans!.items[0];
  expect(getPackageRevision(saved).information?.facts ?? []).toEqual([]);
  await expect(preparePackageScanFact(saved, scan.id, 1, 'Control', 'invented words', policy)).rejects.toThrow('exact characters');
  const proposal = await preparePackageScanFact(saved, scan.id, 1, 'Training note', 'corrected training', policy);
  await expect(applyPreparedPackageUpdate(proposal, policy, false)).rejects.toThrow('review');
  const { record } = await applyPreparedPackageUpdate(proposal, policy, true);
  expect(getPackageRevision(record).information!.facts[0]).toMatchObject({ label: 'Training note', value: 'corrected training', source: { kind: 'document', sha256: scan.source.sha256 } });
  expect(getPackageRevision(record).scans).toEqual(getPackageRevision(saved).scans);
});
it('requires exact reviewed private preparation and consumes it only once', async () => {
  const before = await fixture(), prepared = await preparePackageScan(before, getPackageRevision(before).members[0].id, policy);
  await expect(preparePackageScanCorrection({ ...prepared }, ['Corrected'], policy)).rejects.toThrow('again');
  const correction = await preparePackageScanCorrection(prepared, ['Corrected'], policy);
  await expect(savePreparedPackageScan({ ...correction }, policy, true)).rejects.toThrow('Review');
  await expect(savePreparedPackageScan(correction, policy, false)).rejects.toThrow('Review');
  await savePreparedPackageScan(correction, policy, true);
  await expect(savePreparedPackageScan(correction, policy, true)).rejects.toThrow('Review');
});
it('refuses no-op correction, missing pages, historical writes and imported reviewer copies', async () => {
  const saved = await savedFixture(), scan = getPackageRevision(saved).scans!.items[0], opened = await openPackageScan(saved, scan.id, policy);
  await expect(preparePackageScanCorrection(opened, [scan.pages[0].text], policy)).rejects.toThrow('already matches');
  await expect(preparePackageScanCorrection(opened, [], policy)).rejects.toThrow('every captured source page');
  const latest = await reviseActionPackage(saved, getPackageRevision(saved).members), historical = await openPackageScan(latest, scan.id, policy, undefined, saved.currentRevisionId);
  await expect(preparePackageScanCorrection(historical, ['new value'], policy)).rejects.toThrow('read-only');
  await expect(preparePackageScan({ ...saved, archived: true }, scan.memberId, policy)).rejects.toThrow('owning package');
});
it('does not save on cancellation, stale CAS or deployment changes', async () => {
  const before = await fixture(), prepared = await preparePackageScan(before, getPackageRevision(before).members[0].id, policy);
  const correction = await preparePackageScanCorrection(prepared, ['Corrected'], policy), controller = new AbortController(); controller.abort();
  await expect(savePreparedPackageScan(correction, policy, true, controller.signal)).rejects.toThrow();
  await expect(savePreparedPackageScan(correction, policy, true, undefined, () => false)).rejects.toThrow();
  const changed = await renameActionPackage(before, 'Another saved name');
  await expect(savePreparedPackageScan(correction, policy, true)).rejects.toThrow();
  expect((await listActionPackages()).find(record => record.id === before.id)).toEqual(changed);
});
it('rechecks policy at final commit and reviews corrected text before returning a save token', async () => {
  const before = await fixture(), prepared = await preparePackageScan(before, getPackageRevision(before).members[0].id, policy);
  await expect(preparePackageScanCorrection(prepared, ['SECRET'], policy)).rejects.toThrow();
  const correction = await preparePackageScanCorrection(prepared, ['Synthetic corrected'], policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue({ status: 'not-ready', message: 'Deployment changed' });
  await expect(savePreparedPackageScan(correction, policy, true)).rejects.toThrow();
  expect((await listActionPackages()).find(record => record.id === before.id)).toEqual(before);
});
it('bounds and validates page identities, correction status and source page count', async () => {
  const saved = await savedFixture(), revision = getPackageRevision(saved), scan = revision.scans!.items[0];
  expect(packageScansSchema.safeParse({ version: 1, items: [scan, scan] }).success).toBe(false);
  expect(packageScansSchema.safeParse({ version: 1, items: [{ ...scan, status: 'recognized' }] }).success).toBe(false);
  const forged = structuredClone(saved); forged.revisions.at(-1)!.scans!.items[0].pages.push({ ...scan.pages[0], page: 2 });
  expect(actionPackageSchema.safeParse(forged).success).toBe(true);
  await expect(buildPortableActionPackage(forged)).rejects.toThrow('pages');
});
it('searches saved corrected text only when its exact source is current and byte-verified', async () => {
  const saved = await savedFixture(), report = await searchCapturedPackage(saved, saved.currentRevisionId, 'corrected training');
  expect(report.matches).toContainEqual(expect.objectContaining({ context: 'Saved corrected source page 1' }));
  const missing = await searchCapturedPackage(saved, saved.currentRevisionId, 'corrected training', { readAsset: async () => { throw new Error('Unavailable'); } });
  expect(missing.matches).toEqual([]); expect(missing.notices.join(' ')).toContain('could not be verified');
});
it('refuses OCR value adoption after the exact saved source is missing', async () => {
  const saved = await savedFixture(), scan = getPackageRevision(saved).scans!.items[0];
  await idbDeleteAttachment(scan.source.id);
  await expect(preparePackageScanFact(saved, scan.id, 1, 'Training note', 'corrected training', policy)).rejects.toThrow(/Missing|corrupt|source/i);
  expect((await listActionPackages()).find(record => record.id === saved.id)).toEqual(saved);
});
it('rechecks source markings when adopting an excerpt after deployment settings change', async () => {
  const saved = await savedFixture(), scan = getPackageRevision(saved).scans!.items[0];
  // Recognition can miss a marking that remains in the preserved source text layer.
  vi.mocked(extractPdfText).mockResolvedValue('(S) Restricted synthetic source content.');
  await expect(preparePackageScanFact(saved, scan.id, 1, 'Training note', 'corrected training', policy)).rejects.toThrow(/markings|levels/);
  expect((await listActionPackages()).find(record => record.id === saved.id)).toEqual(saved);
});
