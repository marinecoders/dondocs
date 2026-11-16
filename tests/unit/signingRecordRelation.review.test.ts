import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createSigningRecord, updateSigningFields, createSigningHandoff, captureSigningPdf, validateSigningRecord, importSigningRecord, prepareSigningReturn } from '@/lib/signingWorkspace';
import { base64ToUint8Array } from '@/lib/encoding';

it('rejects a repacked handoff whose retained body differs from its claimed source revision', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([400, 600]).drawText('ORIGINAL SOURCE BODY');
  let record = await createSigningRecord(await pdf.save(), 'source.pdf', () => true, { documentId: 'original-draft', epoch: 1, editSequence: 10, capturedAt: 100 });
  record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'CHIEF', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.1 }]);
  record = await createSigningHandoff(record);
  const forged = structuredClone(record);
  const changed = await PDFDocument.load(base64ToUint8Array(forged.handoffs![0].pdf.data));
  changed.getPage(0).drawText('DIFFERENT RETURNED BODY', { y: 400 });
  forged.handoffs![0].pdf = await captureSigningPdf(await changed.save(), 'different-body.pdf');
  expect(forged.handoffs![0].sourceSha256).toBe(forged.source.sha256);
  expect(forged.handoffs![0].pdf.pages).toEqual(forged.source.pages);
  await expect(validateSigningRecord(forged)).rejects.toThrow(/handoff|source/i);
  forged.id = crypto.randomUUID();
  await expect(importSigningRecord(forged)).rejects.toThrow(/handoff|source/i);
});

it('preserves unsupported-but-valid raw stream encodings in an exact handoff', async () => {
  const { PDFName } = await import('pdf-lib');
  const { deflate } = await import('pako');
  const { compareSigningPdfs } = await import('@/lib/signingPdfComparison');
  const pdf = await PDFDocument.create(), page = pdf.addPage([400, 600]);
  const hex = [...deflate('q Q\n')].map(value => value.toString(16).padStart(2, '0')).join('') + '>';
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(hex, { Filter: pdf.context.obj([PDFName.of('ASCIIHexDecode'), PDFName.of('FlateDecode')]) })));
  let record = await createSigningRecord(await pdf.save(), 'filtered-source.pdf');
  record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'CHIEF', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.1 }]);
  record = await createSigningHandoff(record);
  const handoff = record.handoffs![0];
  const comparison = await compareSigningPdfs(base64ToUint8Array(record.source.data), base64ToUint8Array(handoff.pdf.data), handoff.id);
  expect(comparison.checks.contentComparisonAvailable).toBe(false);
  await expect(validateSigningRecord(record)).resolves.toEqual(record);
});

it.each(['signer', 'placement'] as const)('rejects handoff %s metadata that disagrees with actual widgets', async mutation => {
  const pdf = await PDFDocument.create(); pdf.addPage([400, 600]);
  let record = await createSigningRecord(await pdf.save(), 'source.pdf');
  record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'CHIEF', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.1 }]);
  record = await createSigningHandoff(record);
  const forged = structuredClone(record);
  if (mutation === 'signer') forged.handoffs![0].fields[0].signer = 'DIFFERENT SIGNER';
  else forged.handoffs![0].fields[0].x = 0.3;
  await expect(validateSigningRecord(forged)).rejects.toThrow(/handoff|placement|assignments/i);
});

it('rejects an injected visible annotation even when source content streams agree', async () => {
  const { PDFName } = await import('pdf-lib');
  const pdf = await PDFDocument.create(); pdf.addPage([400, 600]).drawText('ORIGINAL BODY');
  let record = await createSigningRecord(await pdf.save(), 'source.pdf');
  record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'CHIEF', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.1 }]);
  record = await createSigningHandoff(record);
  const forged = structuredClone(record);
  const changed = await PDFDocument.load(base64ToUint8Array(forged.handoffs![0].pdf.data));
  const annotation = changed.context.register(changed.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [20, 400, 350, 550], C: [1, 0, 0], IC: [1, 0, 0] }));
  changed.getPage(0).node.Annots()!.push(annotation);
  forged.handoffs![0].pdf = await captureSigningPdf(await changed.save(), 'changed-annotations.pdf');
  expect(changed.getPage(0).node.Annots()!.size()).toBe(2);
  expect(changed.getPage(0).node.lookup(PDFName.of('Contents'))).toBeDefined();
  await expect(validateSigningRecord(forged)).rejects.toThrow(/handoff|source/i);
});

it('retains existing hierarchical fields and annotations while adding a handoff widget', async () => {
  const { PDFName } = await import('pdf-lib');
  const pdf = await PDFDocument.create(), page = pdf.addPage([400, 600]);
  const existing = pdf.getForm().createTextField('group.existing'); existing.setText('EXISTING VALUE'); existing.addToPage(page, { x: 20, y: 300, width: 120, height: 20 });
  const square = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [20, 400, 100, 450], P: page.ref }));
  page.node.Annots()!.push(square);
  let record = await createSigningRecord(await pdf.save(), 'existing-fields.pdf');
  record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'CHIEF', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.1 }]);
  record = await createSigningHandoff(record);
  await expect(validateSigningRecord(record)).resolves.toEqual(record);
  const handoff = await PDFDocument.load(base64ToUint8Array(record.handoffs![0].pdf.data));
  expect(handoff.getForm().getTextField('group.existing').getText()).toBe('EXISTING VALUE');
  expect(handoff.getPage(0).node.lookup(PDFName.of('Annots'))).toBeDefined();
});


it('keeps the displayed prepared return immutable down to PDF geometry and checks', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([400, 600]);
  let record = await createSigningRecord(await pdf.save(), 'candidate.pdf');
  record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'CHIEF', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.1 }]);
  record = await createSigningHandoff(record);
  const handoff = record.handoffs![0];
  const candidate = await prepareSigningReturn(record, handoff.id, base64ToUint8Array(handoff.pdf.data), 'returned.pdf');
  expect(Object.isFrozen(candidate.pdf)).toBe(true);
  expect(Object.isFrozen(candidate.pdf.pages)).toBe(true);
  expect(Object.isFrozen(candidate.pdf.pages[0])).toBe(true);
  expect(Object.isFrozen(candidate.evidence.checks)).toBe(true);
  expect(Reflect.set(candidate.pdf, 'data', 'different displayed PDF')).toBe(false);
  expect(Reflect.set(candidate.evidence.checks, 'sameContentStreams', false)).toBe(false);
});

it('rejects a repacked manual widget with a forged visible appearance', async () => {
  const { PDFDict, PDFName } = await import('pdf-lib');
  const pdf = await PDFDocument.create(); pdf.addPage([400, 600]);
  let record = await createSigningRecord(await pdf.save(), 'widget.pdf');
  record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'CHIEF', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.1 }]);
  record = await createSigningHandoff(record);
  const forged = structuredClone(record), changed = await PDFDocument.load(base64ToUint8Array(forged.handoffs![0].pdf.data));
  const field = changed.getForm().getFields()[0];
  const appearance = field.acroField.dict.lookup(PDFName.of('AP'), PDFDict);
  appearance.set(PDFName.of('N'), changed.context.register(changed.context.stream('0 0 0 rg 0 0 120 60 re f', { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 120, 60] })));
  forged.handoffs![0].pdf = await captureSigningPdf(await changed.save(), 'forged-appearance.pdf');
  await expect(validateSigningRecord(forged)).rejects.toThrow(/handoff.*appearance/i);
});

it('rejects changed existing form values even when a field has no page widget', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([400, 600]);
  pdf.getForm().createTextField('retained-value').setText('ORIGINAL RETAINED VALUE');
  let record = await createSigningRecord(await pdf.save(), 'form-values.pdf');
  record = await updateSigningFields(record, [{ id: crypto.randomUUID(), signer: 'CHIEF', page: 0, x: 0.2, y: 0.6, width: 0.3, height: 0.1 }]);
  record = await createSigningHandoff(record);
  const forged = structuredClone(record), changed = await PDFDocument.load(base64ToUint8Array(forged.handoffs![0].pdf.data));
  changed.getForm().getTextField('retained-value').setText('DIFFERENT RETAINED VALUE');
  forged.handoffs![0].pdf = await captureSigningPdf(await changed.save(), 'changed-field-value.pdf');
  await expect(validateSigningRecord(forged)).rejects.toThrow(/handoff|source/i);
});
