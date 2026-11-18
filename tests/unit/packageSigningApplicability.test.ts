import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { createActionPackage, getPackageRevision, reviseActionPackage, listActionPackages, type PackageRevision } from '@/lib/actionPackages';
import { captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { preparePackageSigningSource, openPackageSigningSource, preparePackageSigningHandoff, capturePackageSigningHandoff, inspectPackageSigning,
  preparePackageSigningReturn, applyPackageSigningReturn, downloadPackageSigningHandoff, reviewPackageSigningCapture, reviewPackageSigning, type PackageSigningTarget } from '@/lib/packageSigning';
import { updateSigningFields, createSigningHandoff, prepareSigningReturn, associateSigningReturn } from '@/lib/signingWorkspace';
import { updatePackageInformation } from '@/lib/packageInformation';
import { updatePackageWork } from '@/lib/packageWork';
import { preparePackageAssembly, assemblePackage } from '@/lib/actionPackageAssembly';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { inspectPackageChangeImpact, comparePackageChangeImpact } from '@/lib/packageChangeImpact';
import { derivePackageNextActions } from '@/lib/packageNextActions';
import { idbGetAttachment, idbPutAttachment } from '@/lib/documentsDb';
import { base64ToUint8Array } from '@/lib/encoding';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { portableResourceDigest } from '@/lib/portableResources';
import { extractPdfText } from '@/lib/pdfText';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction([...db.objectStoreNames], 'readwrite'); for (const store of db.objectStoreNames) tx.objectStore(store).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
}
beforeEach(async () => {
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  vi.mocked(extractPdfText).mockResolvedValue('');
  await createActionPackage('Initialize'); await clearDb(); useUIStore.setState({ storageHealth: 'ok' });
});
afterEach(() => vi.restoreAllMocks());
async function original(width = 400) {
  const pdf = await PDFDocument.create(); pdf.addPage([width, 600]);
  return captureOriginalPackageMember({ name: 'Synthetic signing source.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'basic-letter', false);
}
async function fixture(scope: 'member' | 'output' = 'member') {
  const member = await original(); let source = await reviseActionPackage(await createActionPackage('Synthetic applicability action'), [member]);
  let target: PackageSigningTarget = { kind: 'member', id: member.id, revisionId: member.revisionId };
  if (scope === 'output') {
    source = await assemblePackage(await preparePackageAssembly(source, source.currentRevisionId, policy), { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true });
    target = { kind: 'output', id: getPackageRevision(source).outputs[0].id };
  }
  let signing = await openPackageSigningSource(await preparePackageSigningSource(source, source.currentRevisionId, target, policy), policy, true);
  signing = await createSigningHandoff(await updateSigningFields(signing, [{ id: crypto.randomUUID(), signer: 'Alex Example', page: 0, x: 0.2, y: 0.7, width: 0.4, height: 0.08 }]));
  const record = await capturePackageSigningHandoff(await preparePackageSigningHandoff(source, source.currentRevisionId, target, signing, signing.handoffs![0].id, policy), policy, true);
  return { source, record, signing, entry: getPackageRevision(record).signing!.handoffs[0] };
}
async function facts(record: Awaited<ReturnType<typeof createActionPackage>>) {
  return updatePackageInformation(record, { version: 1, participants: [], facts: [{ id: 'action-date', label: 'Current action date', kind: 'date', value: '2026-11-19', source: { kind: 'entered' } }] });
}
it.each(['member', 'output'] as const)('validates exact retained %s handoffs without relabeling them as approval or a current revision', async scope => {
  const { record, entry } = await fixture(scope), snapshot = JSON.stringify(record), result = await inspectPackageSigning(record);
  expect(result.findings).toHaveLength(1); expect(result.findings[0]).toMatchObject({ id: entry.id, state: 'inputs-match', association: 'historical', packageContextChanged: false });
  expect(result.findings[0].message).toContain('do not authenticate'); expect(JSON.stringify(record)).toBe(snapshot); expect((await listActionPackages())[0]).toEqual(record);
});
it('separates unchanged original-member bytes from unrelated changed package context', async () => {
  const { record, entry } = await fixture(), changed = await facts(record), result = await inspectPackageSigning(changed);
  expect(result.findings[0]).toMatchObject({ id: entry.id, state: 'inputs-match', packageContextChanged: true, association: 'historical' });
  expect(result.findings[0].message).toContain('Other package context changed');
  const impact = await inspectPackageChangeImpact(changed, record.currentRevisionId);
  expect(impact.sections.find(section => section.kind === 'signing')!.items[0]).toMatchObject({ state: 'metadata-only', availability: 'not-checked', destinations: [{ signingId: entry.id, revisionId: changed.currentRevisionId }] });
});
it('marks a whole-package handoff historical after changed package inputs or context', async () => {
  const { record, entry } = await fixture('output'), changed = await facts(record);
  expect((await inspectPackageSigning(changed)).findings[0]).toMatchObject({ id: entry.id, state: 'changed', packageContextChanged: true, association: 'historical' });
  const report = await inspectPackageChangeImpact(changed, record.currentRevisionId);
  expect(report.sections.find(section => section.kind === 'signing')!.items[0].state).toBe('changed');
  expect(getPackageRevision(record).signing!.handoffs[0]).toEqual(getPackageRevision(changed).signing!.handoffs[0]);
});
it.each(['member', 'output'] as const)('reports further %s changes even when the handoff was already historical', async scope => {
  const { record } = await fixture(scope), first = await facts(record);
  const second = await updatePackageInformation(first, { version: 1, participants: [], facts: [{ id: 'action-date', label: 'Current action date', kind: 'date', value: '2026-11-20', source: { kind: 'entered' } }] });
  const report = await inspectPackageChangeImpact(second, first.currentRevisionId);
  expect(report.sections.find(section => section.kind === 'signing')!.items[0].state).toBe(scope === 'member' ? 'metadata-only' : 'changed');
  const replacement = await original(500); replacement.id = getPackageRevision(second).members[0].id;
  const third = await reviseActionPackage(second, [replacement]), another = await original(510); another.id = replacement.id;
  const fourth = await reviseActionPackage(third, [another]);
  expect((await inspectPackageChangeImpact(fourth, third.currentRevisionId)).sections.find(section => section.kind === 'signing')!.items[0].state).toBe('changed');
});
it('does not invalidate recorded applicability because a local task was completed', async () => {
  const { record } = await fixture(), changed = await updatePackageWork(record, { version: 1, tasks: [{ id: 'manual', title: 'Complete coordination', status: 'complete' }] }, policy);
  expect((await inspectPackageSigning(changed)).findings[0]).toMatchObject({ state: 'inputs-match', packageContextChanged: false });
  const report = await inspectPackageChangeImpact(changed, record.currentRevisionId);
  expect(report.sections.find(section => section.kind === 'signing')!.items[0].state).toBe('unchanged');
  expect((await derivePackageNextActions(changed, changed.currentRevisionId, { policy })).actions.some(action => action.id.startsWith('signing-'))).toBe(false);
});
it('recognizes changed and removed original targets while preserving their captured source bytes', async () => {
  const { record, entry } = await fixture(), replacement = await original(480);
  replacement.id = getPackageRevision(record).members[0].id;
  const changed = await reviseActionPackage(record, [replacement]);
  expect((await inspectPackageSigning(changed)).findings[0]).toMatchObject({ state: 'changed', packageContextChanged: true });
  const removed = await reviseActionPackage(changed, []);
  expect((await inspectPackageSigning(removed)).findings[0]).toMatchObject({ state: 'changed', association: 'historical' });
  expect(getPackageRevision(removed).signing!.handoffs[0].pdfs).toEqual(entry.pdfs);
  expect((await inspectPackageSigning(removed, record.currentRevisionId)).findings[0]).toMatchObject({ state: 'inputs-match', packageContextChanged: false });
});
it('reports pruned source history as unknown even when preserved file bytes and recorded inputs match', async () => {
  const { record } = await fixture(), parsed = await parsePortableActionPackage(await buildPortableActionPackage(record));
  expect((await inspectPackageSigning(parsed.record)).findings[0]).toMatchObject({ state: 'unknown', association: 'unknown' });
  expect((await inspectPackageSigning(parsed.record)).findings[0].message).toContain('outside the retained history');
});
it('reports a corrupt retained signing asset as unknown without promoting or deleting it', async () => {
  const { record, entry } = await fixture(), retained = (await idbGetAttachment(entry.pdfs.handoff.id))!;
  const data = retained.data.slice(0); new Uint8Array(data)[0] ^= 1; expect(await idbPutAttachment({ ...retained, data })).toBe(true);
  const result = await inspectPackageSigning(record); expect(result.findings[0]).toMatchObject({ state: 'unknown', association: 'unknown' });
  expect(result.findings[0].message).toContain('Missing or corrupt'); expect((await listActionPackages())[0]).toEqual(record);
});
it('treats an inconsistent recorded context digest as unknown rather than a changed current signature', async () => {
  const { record } = await fixture(), altered = structuredClone(record);
  altered.revisions.find(item => item.id === altered.currentRevisionId)!.signing!.handoffs[0].contextSha256 = '0'.repeat(64);
  expect((await inspectPackageSigning(altered)).findings[0]).toMatchObject({ state: 'unknown', association: 'unknown' });
});
it('tracks exact return-member removal without turning associated returns into signing completion', async () => {
  const { record, entry, signing } = await fixture();
  const associated = await associateSigningReturn(signing, await prepareSigningReturn(signing, entry.handoffId, base64ToUint8Array(signing.handoffs![0].pdf.data), 'Synthetic return.pdf'), { reviewed: true, acceptedMismatch: true });
  const adopted = await applyPackageSigningReturn(await preparePackageSigningReturn(record, entry.id, associated, associated.returns![0].id, policy), policy, { reviewed: true, acceptedMismatch: true });
  const receipt = getPackageRevision(adopted).signing!.handoffs[0].returns![0];
  expect((await inspectPackageSigning(adopted)).findings[0].returns[0]).toMatchObject({ id: receipt.id, state: 'present' });
  const removed = await reviseActionPackage(adopted, getPackageRevision(adopted).members.filter(member => member.id !== receipt.memberId));
  expect((await inspectPackageSigning(removed)).findings[0].returns[0]).toMatchObject({ id: receipt.id, state: 'missing' });
  expect((await inspectPackageSigning(removed)).findings[0].returns[0].message).toContain('captured return bytes remain');
  expect((await derivePackageNextActions(removed, removed.currentRevisionId, { policy })).actions.find(action => action.id === `signing-${entry.id}`)?.message).toContain('applied return member changed or is no longer included');
});
it('offers precise nonblocking next actions that manual task completion cannot clear', async () => {
  const { record, entry } = await fixture('output'), changed = await facts(record);
  const completed = await updatePackageWork(changed, { version: 1, tasks: [{ id: 'manual-signing', title: 'Signing complete', status: 'complete' }] }, policy);
  const result = await derivePackageNextActions(completed, completed.currentRevisionId, { policy });
  expect(result.readyForOperation).toBe(true);
  expect(result.actions.find(action => action.id === `signing-${entry.id}`)).toMatchObject({ blocking: false, label: 'Review signing applicability',
    destination: { section: 'delivery', panel: 'signing', signingId: entry.id, revisionId: completed.currentRevisionId } });
});
it('bounds cancellation and detects signing source identity changes in record-only impact comparisons', async () => {
  const { record } = await fixture(), controller = new AbortController(); controller.abort();
  await expect(inspectPackageSigning(record, record.currentRevisionId, controller.signal)).rejects.toThrow();
  const before = getPackageRevision(record), after: PackageRevision = { ...structuredClone(before), id: 'proposed', parentId: before.id, createdAt: before.createdAt + 1 };
  after.signing!.handoffs[0].contextSha256 = '0'.repeat(64);
  const impact = await comparePackageChangeImpact(before, after), item = impact.sections.find(section => section.kind === 'signing')!.items[0];
  expect(item).toMatchObject({ state: 'unknown', association: 'unknown', availability: 'not-checked' }); expect(impact.summary.unknownEvidence).toBeGreaterThan(0);
});

it('exports exact package and revision provenance alongside unchanged handoff PDF bytes', async () => {
  const { entry, signing } = await fixture(), archive = await JSZip.loadAsync(await downloadPackageSigningHandoff(entry));
  const manifest = JSON.parse(await archive.file('manifest.json')!.async('string'));
  expect(manifest.package).toMatchObject({ id: entry.packageId, revisionId: entry.sourceRevisionId, sourceSha256: entry.sourceSha256, signerAuthenticity: 'unverified' });
  expect(await archive.file('ready-to-sign.pdf')!.async('uint8array')).toEqual(base64ToUint8Array(signing.handoffs![0].pdf.data));
  expect(await archive.file('README.txt')!.async('string')).toContain(entry.sourceRevisionId);
});

it('reviews the selected handoff independently of a higher-marked return excluded from that delivery', async () => {
  const { record, entry, signing } = await fixture(), pdf = await PDFDocument.create(); pdf.addPage([510, 710]);
  const associated = await associateSigningReturn(signing, await prepareSigningReturn(signing, entry.handoffId, new Uint8Array(await pdf.save()), 'Synthetic different return.pdf'), { reviewed: true, acceptedMismatch: true });
  const saved = await applyPackageSigningReturn(await preparePackageSigningReturn(record, entry.id, associated, associated.returns![0].id, policy), policy, { reviewed: true, acceptedMismatch: true });
  const captured = getPackageRevision(saved).signing!.handoffs[0], receipt = captured.returns![0];
  vi.mocked(extractPdfText).mockImplementation(async bytes => {
    const data = new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    return await portableResourceDigest(data.buffer) === receipt.returnedAsset.sha256 ? '(S) Synthetic return marking' : '';
  });
  await expect(reviewPackageSigningCapture(captured, policy)).resolves.toHaveLength(3);
  await expect(reviewPackageSigningCapture(captured, policy, receipt.id)).rejects.toThrow('configured levels');
  await expect(reviewPackageSigning({ version: 1, handoffs: [captured] }, policy)).rejects.toThrow('configured levels');
});
