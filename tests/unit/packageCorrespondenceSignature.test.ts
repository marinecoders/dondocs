import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { expect, it } from 'vitest';
import { prepareCorrespondenceSignature } from '@/services/pdf/packageCorrespondenceSignature';
import { identifyOfficialOriginal } from '@/services/forms/nativeCatalog';

it('puts both letter pages before the maintained signature field and preserves the original sheet', async () => {
  const letter = await PDFDocument.create();
  letter.addPage([500, 710]).drawText('First synthetic page');
  letter.addPage([620, 720]).drawText('Second synthetic page');
  const source = new Uint8Array(await letter.save()).buffer;
  const sheet = new Uint8Array(await readFile('public/templates/DonDocs correspondence signature/original.pdf')).buffer;
  const bytes = await prepareCorrespondenceSignature(source, sheet);
  expect(bytes.slice(0, sheet.byteLength)).toEqual(new Uint8Array(sheet));
  expect(await identifyOfficialOriginal(bytes.buffer)).toBe('package_correspondence');
  const result = await PDFDocument.load(bytes);
  expect(result.getPages().map(page => page.getWidth())).toEqual([500, 620, 612]);
  const widget = result.getForm().getSignature('Signing_authority').acroField.getWidgets()[0];
  expect(widget.P()).toEqual(result.getPage(2).ref);
  await expect(prepareCorrespondenceSignature(source, source)).rejects.toThrow('changed');
});

it('rejects a letter over the signing limit before loading the signature sheet', async () => {
  const { MAX_SIGNING_PDF_BYTES } = await import('@/lib/manualSignatureFields');
  await expect(prepareCorrespondenceSignature(new ArrayBuffer(MAX_SIGNING_PDF_BYTES + 1))).rejects.toThrow('20 MB');
});
