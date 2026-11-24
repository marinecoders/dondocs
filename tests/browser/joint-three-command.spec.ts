import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { PDFDocument, PDFSignature } from 'pdf-lib';
import { jointLetterFixture } from '../_helpers/jointLetterFixture';
import { downloadBrowserPdf } from '../_helpers/downloadBrowserPdf';

// Exercises the editor and real browser Word engine, not a store-only harness.
test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
test('adds, reorders and saves three-command correspondence, then returns to two commands', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll', previewVisible: false }, version: 1 }));
  });
  await page.goto('/');
  const fixture = jointLetterFixture(false);
  await page.getByLabel('Import draft file').setInputFiles({ name: 'joint.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...fixture, documentMode: 'custom', documentCategory: 'correspondence' })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: 'Add third command', exact: true }).click();
  await page.getByLabel('Command name', { exact: true }).fill('MIDDLE COMMAND');
  await page.getByLabel('From line', { exact: true }).last().fill('Commanding Officer, Middle Command');
  await page.getByLabel('Signatory name', { exact: true }).fill('C. MIDDLE');
  await page.getByLabel('Signatory title', { exact: true }).fill('Deputy Commander');
  await expect(page.getByRole('button', { name: 'Digital Fields (PKI)', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Swap with junior command', exact: true }).click();
  await expect(page.getByLabel('Command name', { exact: true })).toHaveValue('JUNIOR COMMAND');
  await expect(page.getByLabel('Signatory name', { exact: true })).toHaveValue('B. JUNIOR');
  await page.getByRole('button', { name: 'Swap with junior command', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Signatory name', { exact: true })).toHaveValue('C. MIDDLE');
  await page.getByLabel('Command name', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('joint-three-command.png'), fullPage: false });
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  const saving = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const draft = JSON.parse(await readFile((await (await saving).path())!, 'utf8'));
  expect(draft.version).toBe(6);
  expect(draft.formData.jointAdditionalCommands[0]).toMatchObject({ signatureName: 'C. MIDDLE', name: 'MIDDLE COMMAND' });
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const downloading = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const word = await readFile((await download.path())!);
  await info.attach('three-command.docx', { body: word, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const zip = await JSZip.loadAsync(word), xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('C. MIDDLE'); expect(xml).toContain('Deputy Commander');
  expect(xml.indexOf('B. JUNIOR')).toBeLessThan(xml.indexOf('C. MIDDLE'));
  expect(xml.indexOf('C. MIDDLE')).toBeLessThan(xml.indexOf('A. SENIOR'));

  await page.getByRole('button', { name: 'Digital Fields (PKI)', exact: true }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const pdfBytes = await downloadBrowserPdf(page, info.project.name,
    () => page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click());
  await info.attach('three-command-signer-fields.pdf', { body: pdfBytes, contentType: 'application/pdf' });
  const pdf = await PDFDocument.load(pdfBytes);
  const signatures = pdf.getForm().getFields().filter(field => field instanceof PDFSignature);
  expect(signatures.map(field => field.getName())).toEqual(['JuniorSignature', 'MiddleSignature', 'SeniorSignature']);
  const widgets = signatures.map(field => field.acroField.getWidgets()[0]);
  expect(new Set(widgets.map(widget => widget.P()?.toString())).size).toBe(1);
  const [junior, middle, senior] = widgets.map(widget => widget.getRectangle());
  expect(junior.x + junior.width).toBeLessThan(middle.x);
  expect(middle.x + middle.width).toBeLessThan(senior.x);

  await page.getByRole('button', { name: 'Remove third command', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add third command', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Digital Fields (PKI)', exact: true })).toBeEnabled();
});
