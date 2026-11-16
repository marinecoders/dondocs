import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { associateSigningReturn, createSigningHandoff, createSigningRecord, prepareSigningReturn, updateSigningFields } from '@/lib/signingWorkspace';
import { base64ToUint8Array } from '@/lib/encoding';

it('does not waive a return mismatch when only a displayed image resource changes', async () => {
  const source = await PDFDocument.create();
  const image = await source.embedPng(await readFile(resolve('tests/fixtures/review-redline/unicode-line.png')));
  source.addPage([612, 792]).drawImage(image, { x: 40, y: 400, width: 500, height: 200 });
  let record = await createSigningRecord(await source.save(), 'image-letter.pdf');
  record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'REVIEWER', page: 0, x: 0.5, y: 0.8, width: 0.3, height: 0.05 }]);
  record = await createSigningHandoff(record);
  const handoff = record.handoffs![0];
  const returned = await PDFDocument.load(base64ToUint8Array(handoff.pdf.data));
  const replacement = await returned.embedJpg(await readFile(resolve('tests/fixtures/images/business-figure-baseline.jpg')));
  const objects = returned.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  objects.set(objects.keys()[0], replacement.ref);
  const candidate = await prepareSigningReturn(record, handoff.id, await returned.save(), 'changed-image.pdf');
  expect(candidate.evidence.checks.samePageGeometry).toBe(true);
  expect(candidate.evidence.checks.sameContentStreams).toBe(true);
  expect(candidate.evidence.checks.matchingHandoffMarker).toBe(true);
  expect(candidate.evidence.assessment).not.toBe('checks-agree');
  await expect(associateSigningReturn(record, candidate, { reviewed: true, acceptedMismatch: false })).rejects.toThrow('Explicit acknowledgement');
});

it('requires manual acknowledgement when a cyclic resource graph cannot be compared', async () => {
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
  const resources = pdf.context.obj({});
  const reference = pdf.context.register(resources);
  resources.set(PDFName.of('Cycle'), reference); page.node.set(PDFName.of('Resources'), resources);
  const handoffId = crypto.randomUUID(); pdf.setKeywords([`DonDocs handoff ${handoffId}`]);
  const original = await pdf.save();
  const returned = await PDFDocument.load(original); returned.setSubject('Rewritten return');
  const { compareSigningPdfs } = await import('@/lib/signingPdfComparison');
  const result = await compareSigningPdfs(original, await returned.save(), handoffId);
  expect(result.checks.sameContentStreams).toBe(true);
  expect(result.checks.resourceComparisonAvailable).toBe(false);
  expect(result.assessment).toBe('inconclusive');
});
