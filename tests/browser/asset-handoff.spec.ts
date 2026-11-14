import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { docxImageFixture } from '../_helpers/docxImageFixture';

test.use({ serviceWorkers: 'block' });
test.setTimeout(90_000);
async function share(page: Page) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('SYNTHETIC ASSET HANDOFF');
  const desktop = page.getByRole('button', { name: 'Share', exact: true });
  if (await desktop.isVisible()) await desktop.click();
  else { await page.getByRole('button', { name: 'Document actions', exact: true }).click();await page.getByRole('menuitem', { name: /^Create share link/ }).click(); }
  return page.getByRole('dialog', { name: 'Share document', exact: true });
}
async function exportDraft(page: Page) {
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const file = await saving;expect(await file.failure()).toBeNull();
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}
for (const theme of ['light', 'dark', 'classic']) {
  test(`encrypted native assets survive file handoff and reload in ${theme}`, async ({ page }, testInfo) => {
    const images = await docxImageFixture();
    const pdf = await PDFDocument.create();pdf.addPage([612, 792]);
    const originalPdf = Buffer.from(await pdf.save());
    let seed = 713;
    const random = Array.from({ length: 24_000 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;return String.fromCharCode(97 + seed % 26); }).join('');
    const support = Buffer.concat([originalPdf, Buffer.from(`\n%${random}\n`)]);
    await page.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: value, editorLayout: 'scroll' }, version: 1 }));
    }, theme);
    await page.goto('/');
    const draft = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'business_letter',
      formData: { subject: 'SYNTHETIC ASSET HANDOFF', to: 'Training Office', date: 'November 14, 2026', sigFirst: 'Alex', sigLast: 'Example', signatureType: 'image',
        signatureImage: { name: 'signature.png', size: images.signature.length, data: images.signature.toString('base64') },
        basicLetterFile: { name: 'basic.pdf', size: originalPdf.length, data: originalPdf.toString('base64') } },
      paragraphs: [{ text: 'Synthetic body with retained attachments.', level: 0 }, { text: 'Synthetic figure', level: 0, figure: { name: 'figure.png', type: 'image/png', width: 480, height: 240, data: images.figure.toString('base64') } }],
      references: [], enclosures: [{ title: 'Supporting PDF', hasFile: true, file: { name: 'support.pdf', size: support.length, data: support.toString('base64') } }], copyTos: [], distributions: [] };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'native-assets.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    const dialog = await share(page);
    await dialog.getByLabel('Password for this link', { exact: true }).fill('synthetic-password');
    await dialog.getByRole('button', { name: 'Generate link', exact: true }).click();
    const privacy = dialog.getByRole('button', { name: 'Share anyway', exact: true });
    if (await privacy.isVisible()) await privacy.click();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled({ timeout: 30_000 });
    await expect(dialog).toContainText('too large for a reliable link');
    await expect(dialog.locator('#generated-share-link')).toHaveCount(0);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download encrypted share file', exact: true }).click();
    const filePath = testInfo.outputPath(`asset-share-${theme}.json`);
    await (await downloading).saveAs(filePath);
    const encryptedText = await readFile(filePath, 'utf8');
    expect(JSON.parse(encryptedText)).toMatchObject({ kind: 'dondocs-encrypted-share', version: 1 });
    expect(encryptedText).not.toContain(draft.formData.subject);
    expect(encryptedText).not.toContain(images.signature.toString('base64'));
    await page.screenshot({ path: testInfo.outputPath(`encrypted-file-${theme}.png`) });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('NEWER LOCAL WORK');
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open from share link', exact: true }).click();
    const incoming = page.getByRole('dialog', { name: 'Open shared document', exact: true });
    await incoming.getByLabel('Encrypted share file', { exact: true }).setInputFiles(filePath);
    await expect(incoming).toContainText(`Selected: asset-share-${theme}.json`);
    await incoming.getByLabel('Password', { exact: true }).fill('wrong-password');
    await incoming.getByRole('button', { name: 'Decrypt and review', exact: true }).click();
    await expect(incoming.getByRole('alert')).toContainText('Wrong password');
    await expect(incoming.getByRole('button', { name: 'Open as new document', exact: true })).toHaveCount(0);
    await incoming.getByLabel('Password', { exact: true }).fill('synthetic-password');
    await incoming.getByRole('button', { name: 'Decrypt and review', exact: true }).click();
    await expect(incoming).toContainText('attachments passed their size, type and checksum checks');
    await incoming.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(incoming).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(draft.formData.subject);
    const transferred = await exportDraft(page);
    expect(Buffer.from(transferred.enclosures[0].file.data, 'base64').equals(support)).toBe(true);
    expect(Buffer.from(transferred.formData.basicLetterFile.data, 'base64').equals(originalPdf)).toBe(true);
    expect(Buffer.from(transferred.formData.signatureImage.data, 'base64').equals(images.signature)).toBe(true);
    expect(Buffer.from(transferred.paragraphs[1].figure.data, 'base64').equals(images.figure)).toBe(true);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(draft.formData.subject);
    const reopened = await exportDraft(page);
    expect(reopened.enclosures[0].file.data).toBe(transferred.enclosures[0].file.data);
    expect(reopened.paragraphs[1].figure.data).toBe(transferred.paragraphs[1].figure.data);
    expect(reopened.formData.signatureImage.data).toBe(transferred.formData.signatureImage.data);
    expect(reopened.formData.basicLetterFile.data).toBe(transferred.formData.basicLetterFile.data);
  });
}
