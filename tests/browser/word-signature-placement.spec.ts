import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { docxImageFixture } from '../_helpers/docxImageFixture';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

for (const [docType, theme, signer] of [
  ['joint_letter', 'light', 'junior'],
  ['joint_memorandum', 'dark', 'senior'],
  ['information_memorandum', 'classic', undefined],
] as const) {
  test(`Word signature placement survives reload in ${docType} (${theme})`, async ({ page }, info) => {
    const { signature } = await docxImageFixture();
    await page.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: value, editorLayout: 'scroll' }, version: 1 }));
    }, theme);
    await page.goto('/');
    const draft = { documentCategory: 'correspondence', documentMode: 'custom', docType,
      formData: { subject: 'SYNTHETIC WORD SIGNATURE', from: 'Training Sender', memorandumFor: 'Training Recipient',
        to: 'Training Recipient', sigLast: 'EXAMPLE', jointJuniorSigName: 'JUNIOR EXAMPLE',
        jointSeniorSigName: 'SENIOR EXAMPLE', jointMemoJuniorSigName: 'JUNIOR EXAMPLE', jointMemoSeniorSigName: 'SENIOR EXAMPLE',
        signatureType: 'none' },
      paragraphs: [{ text: 'Synthetic correspondence for Word signature placement.', level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [] };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'word-signature.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    const section = page.getByRole('region', { name: 'Word signature image', exact: true });
    await expect(section.getByText(/placed in Word output only/)).toBeVisible();
    if (signer) {
      const select = section.getByLabel('Signature image signer', { exact: true });
      await expect(select).toHaveValue('');
      await select.selectOption(signer);
      await expect(select).toHaveValue(signer);
    }
    await section.getByLabel('Upload Word signature image', { exact: true }).setInputFiles({ name: 'signature.png', mimeType: 'image/png', buffer: signature });
    await expect(section.getByText('signature.png · Included in Word', { exact: true })).toBeVisible();
    const savingDraft = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
    const saved = JSON.parse(await readFile((await (await savingDraft).path())!, 'utf8'));
    expect(saved.formData.signatureImageSigner).toBe(signer);
    expect(saved.formData.signatureImage.data).toBe(signature.toString('base64'));
    await page.reload();
    if (signer) await expect(section.getByLabel('Signature image signer', { exact: true })).toHaveValue(signer);
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const savingWord = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
    const result = await savingWord;
    expect(await result.failure()).toBeNull();
    await result.saveAs(info.outputPath(`${docType}.docx`));
    const zip = await JSZip.loadAsync(await readFile(info.outputPath(`${docType}.docx`)));
    const xml = await zip.file('word/document.xml')!.async('string');
    const count = (xml.match(/descr="Handwritten signature image"/g) ?? []).length;
    expect(count).toBe(1);
    const media = await Promise.all(Object.values(zip.files).filter(file => file.name.startsWith('word/media/') && !file.dir).map(file => file.async('nodebuffer')));
    expect(media.some(bytes => bytes.equals(signature))).toBe(true);
    await page.screenshot({ path: info.outputPath('signature-editor.png') });
  });
}

test('refuses a malformed signer backup before replacing a usable saved document', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const draft = {
    documentCategory: 'correspondence', documentMode: 'custom', docType: 'joint_letter',
    formData: { subject: 'SYNTHETIC SIGNER RESTORE', signatureType: 'none', signatureImageSigner: 'junior' },
    paragraphs: [{ text: 'Synthetic saved work must survive rejected restore.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'restore-source.json',
    mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByLabel('Signature image signer', { exact: true })).toHaveValue('junior');
  // Imported fields update before the closing dialog restores header access.
  // Wait for that handoff before choosing the desktop or tablet workspace path.
  await expect(page.getByRole('button', { name: 'Document actions', exact: true })).toBeVisible();
  const workspace = page.getByRole('button', { name: 'Open workspace', exact: true });
  if (await workspace.isVisible()) await workspace.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  const downloading = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Download workspace backup', exact: true }).click();
  const backup = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  const saved = backup.documents.find((entry: { session: { formData: { subject?: string } } }) =>
    entry.session.formData.subject === draft.formData.subject);
  expect(saved).toBeDefined();
  expect(saved.session.formData.signatureImageSigner).toBe('junior');
  saved.meta.updatedAt += 60_000;
  saved.session.formData.signatureImageSigner = 'both';
  backup.documents = [saved];
  await settings.getByLabel('Backup file', { exact: true }).setInputFiles({ name: 'invalid-signer-backup.json',
    mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(settings.getByRole('alert')).toContainText('Invalid signature image signer');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await page.reload();
  await expect(page.getByLabel('Signature image signer', { exact: true })).toHaveValue('junior');
  await expect(page.getByPlaceholder('Enter the printed subject', { exact: true })).toHaveValue(draft.formData.subject);
});
