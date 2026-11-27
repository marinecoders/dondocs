import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { PDFDict, PDFDocument, PDFName, degrees } from 'pdf-lib';
import { prepareHandwrittenRevision, saveHandwrittenRevision } from '@/lib/handwrittenSigning';
import { createSigningRecord, exportSigningRecord, importSigningRecord, removeSigningRecord } from '@/lib/signingWorkspace';
import { missingPackageSignatures, officialFormCompletionIssues } from '@/lib/packageFormCompletion';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { attachPackageHandwriting, openPackageSigningSource, preparePackageSigningSource } from '@/lib/packageSigning';
import { signingRecordDisclosure } from '@/lib/signingDisclosure';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import { base64ToUint8Array } from '@/lib/encoding';
import { addSignatureFieldToPage } from '@/services/pdf/signatureFieldCore';

vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => 'Synthetic training file') }));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

const ink = 'iVBORw0KGgoAAAANSUhEUgAAABIAAAAICAYAAAD0g6+qAAAAV0lEQVR4nGP8//8/AzUAE6UG8GpGg13CgksCBD5fX8pIyAAYYMEnSciAz0gWsRBjCC+aHDaXMoICG90WbIbi8ybYRYTChJABcAByEY9G1H8QDcPofGIwALzFWalgAlxBAAAAAElFTkSuQmCC';
const transparent = 'iVBORw0KGgoAAAANSUhEUgAAABIAAAAICAYAAAD0g6+qAAAAG0lEQVR4nGP8//8/AzUAE1VMYRg1iBgw+AIbAOAQAw1eE2TXAAAAAElFTkSuQmCC';
const field = () => ({ id: crypto.randomUUID(), signer: 'Training signer', page: 0, x: 0.1, y: 0.3, width: 0.3, height: 0.1 });
async function trainingPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 400]); page.setRotation(degrees(90));
  return pdf;
}

it('retains and verifies the exact handwritten history and original across portable transfer', async () => {
  const source = await createSigningRecord(await (await trainingPdf()).save(), 'Training.pdf');
  const firstField = { ...field(), signer: ' Training signer ' };
  const first = await prepareHandwrittenRevision(source, firstField, ink);
  await expect(saveHandwrittenRevision(source, [firstField], first, () => false)).rejects.toThrow('could not be saved');
  const one = await saveHandwrittenRevision(source, [firstField], first, () => true);
  expect(one.fields[0].signer).toBe('Training signer');
  const secondField = { ...field(), y: 0.6 };
  const second = await prepareHandwrittenRevision(one, secondField, ink);
  const two = await saveHandwrittenRevision(one, [firstField, secondField], second, () => true);
  const final = await PDFDocument.load(base64ToUint8Array(second.pdf.data));
  expect(final.getForm().getFields()).toHaveLength(0);
  const imageResources = final.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  expect(imageResources.keys()).toHaveLength(2);
  expect(two.source).toEqual(source.source);
  expect(signingRecordDisclosure(two, true).pdfs).toHaveLength(3);
  expect(JSON.stringify(signingRecordDisclosure(two, true).metadata)).not.toContain(ink);
  const portable = JSON.parse(new TextDecoder().decode(await exportSigningRecord(two)));
  await removeSigningRecord(two);
  await expect(importSigningRecord(portable)).resolves.toEqual(two);
  portable.handwritten[1].field.y = 0.75;
  await expect(importSigningRecord(portable)).rejects.toThrow('does not match');
  await expect(prepareHandwrittenRevision(two, firstField, ink)).rejects.toThrow('already has');
});

it('rejects an oversized portable history before replacing the saved record', async () => {
  const record = await createSigningRecord(await (await trainingPdf()).save(), 'Training.pdf');
  const placement = field();
  const revision = await prepareHandwrittenRevision(record, placement, ink);
  // Four individually valid PDF payload lengths are together at the file size
  // limit before the original, graphic and UTF-8 metadata are counted.
  const pdf = { ...revision.pdf, data: 'A'.repeat(24 * 1024 * 1024) };
  const handoffs = Array.from({ length: 4 }, () => ({
    id: crypto.randomUUID(), createdAt: Date.now(), sourceSha256: record.source.sha256, fields: [], pdf,
  }));
  await expect(saveHandwrittenRevision({ ...record, handoffs }, [placement], revision, () => true))
    .rejects.toThrow('96 MB');
  await expect(saveHandwrittenRevision(record, [placement], revision, () => true)).resolves.toMatchObject({ id: record.id });
});

it('refuses blank ink, restricted PDFs and certificate fields', async () => {
  const pdf = await trainingPdf();
  const ordinary = await createSigningRecord(await pdf.save(), 'Ordinary.pdf');
  await expect(prepareHandwrittenRevision(ordinary, field(), transparent)).rejects.toThrow('no visible ink');
  pdf.catalog.set(PDFName.of('Perms'), pdf.context.obj({}));
  const restricted = await createSigningRecord(await pdf.save(), 'Restricted.pdf');
  await expect(prepareHandwrittenRevision(restricted, field(), ink)).rejects.toThrow('signing restrictions');
  pdf.catalog.delete(PDFName.of('Perms')); addSignatureFieldToPage(pdf, pdf.getPage(0), [0,0,50,20], 'Certificate');
  const reserved = await createSigningRecord(await pdf.save(), 'Reserved.pdf');
  await expect(prepareHandwrittenRevision(reserved, field(), ink)).rejects.toThrow('certificate fields');
});

it('applies only to the chosen package member, retaining prior bytes and leaving CAC requirements outstanding', async () => {
  const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  const bytes = new Uint8Array(await (await trainingPdf()).save());
  const file = { name: 'Training.pdf', data: bytes.buffer };
  const first = await captureOriginalPackageMember(file, 'basic-letter', false);
  const second = await captureOriginalPackageMember(file, 'enclosure', false);
  const record = await reviseActionPackage(await createActionPackage('Training signatures'), [first, second]);
  const plan = await preparePackageSigningSource(record, record.currentRevisionId, { kind: 'member', id: second.id, revisionId: second.revisionId }, policy);
  const signing = await openPackageSigningSource(plan, policy, true);
  const placement = field(), revision = await prepareHandwrittenRevision(signing, placement, ink);
  await saveHandwrittenRevision(signing, [placement], revision, () => true);
  const otherPlan = await preparePackageSigningSource(record, record.currentRevisionId, { kind: 'member', id: first.id, revisionId: first.revisionId }, policy);
  await openPackageSigningSource(otherPlan, policy, true);
  await expect(attachPackageHandwriting(otherPlan, signing.id, revision.id, policy)).rejects.toThrow('Reopen the signing record');
  const updated = await attachPackageHandwriting(plan, signing.id, revision.id, policy);
  const result = getPackageRevision(updated);
  expect(result.members[0]).toEqual(first);
  const member = result.members[1]; if (member.kind !== 'original') throw new Error('Expected original PDF');
  expect(member.id).toBe(second.id);
  expect(new Uint8Array(await readPackageAsset(member.original))).toEqual(base64ToUint8Array(revision.pdf.data));
  expect(member.signedOriginal).toBe(false);
  expect(officialFormCompletionIssues(member, {handwrittenSignature: true})).toEqual([]);
  expect(missingPackageSignatures(member, {signatureFields: ['Officer']})).toEqual(['Officer']);
  expect(getPackageRevision(updated, record.currentRevisionId).members[1]).toEqual(second);
  await expect(attachPackageHandwriting(plan, signing.id, revision.id, policy)).rejects.toThrow('package changed');
});
