import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { docxImageFixture } from '../_helpers/docxImageFixture';
import { buildBaseline } from '../_helpers/compileMatrix';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(120_000);
async function packages(page: Page, name?: string) {
  await page.getByRole('button', { name: 'Packages', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Action packages', exact: true });
  if (name) await dialog.getByLabel('Saved packages', { exact: true }).selectOption({ label: name });
  return dialog;
}
async function downloadWord(page: Page, dialog: Locator, path: string) {
  const word = dialog.getByRole('region', { name: 'Word package delivery', exact: true });
  await word.getByRole('button', { name: 'Review Word package', exact: true }).click();
  await expect(word.getByRole('checkbox')).toBeVisible();
  await word.getByRole('checkbox').check();
  expect(await word.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await word.getByRole('button', { name: 'Download reviewed Word package', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.replace(/\.zip$/, '-review.png'), scale: 'css' });
  const saving = page.waitForEvent('download');
  await word.getByRole('button', { name: 'Download reviewed Word package', exact: true }).click();
  const file = await saving;expect(await file.failure()).toBeNull();await file.saveAs(path);
  await expect(word.getByRole('status')).toContainText('Complete Word package downloaded');
  return JSZip.loadAsync(await readFile(path), { checkCRC32: true });
}
for (const theme of ['light', 'dark', 'classic']) {
  test(`Word package preserves captured originals and editable content after replacement, deletion, reload and transfer in ${theme}`, async ({ page, browser, isMobile }, info) => {
    const images = await docxImageFixture(), pdf = await PDFDocument.create();pdf.addPage().drawText('Unchanged captured original');
    const original = Buffer.from(await pdf.save()), originalHash = createHash('sha256').update(original).digest('hex');
    const replacement = await PDFDocument.create();replacement.addPage().drawText('NEW SOURCE REPLACEMENT');
    const sourceReplacement = Buffer.from(await replacement.save());
    const packageName = `Paquet résumé ${theme}`;
    await page.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: value, editorLayout: 'scroll' }, version: 1 }));
    }, theme);
    await page.goto('/');
    const draft = { ...buildBaseline('business_letter'), documentMode: 'custom', documentCategory: 'correspondence',
      formData: { ...buildBaseline('business_letter').formData, subject: 'WORD PACKAGE FIXTURE', pageNumbering: 'simple', signatureType: 'image',
        signatureImage: { name: 'signature.png', size: images.signature.length, data: images.signature.toString('base64') } },
      paragraphs: [{ text: 'Captured package paragraph cites Reference (a) and Enclosure (1).', level: 0 }, { text: 'Training diagram', level: 0, figure: { name: 'figure.png', type: 'image/png', data: images.figure.toString('base64') } }],
      references: [{ letter: 'a', title: 'Training guidance', url: 'https://example.test/guidance' }],
      enclosures: [{ title: 'Captured annex', hasFile: true, file: { name: 'Annexe résumé.pdf', size: original.length, data: original.toString('base64') } }],
      reviewComments: { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false, messages: [{ id: crypto.randomUUID(), author: 'Private reviewer', text: 'Hidden review-only content', createdAt: '2026-11-14T00:00:00Z' }] }] },
    };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'word-package.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    let dialog = await packages(page);
    await dialog.getByLabel('Package name', { exact: true }).fill(packageName);
    await dialog.getByRole('button', { name: 'Create package', exact: true }).click();
    await dialog.getByRole('button', { name: 'Capture current document', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: /WORD PACKAGE FIXTURE/ })).toBeVisible();
    await dialog.getByLabel('New member role', { exact: true }).selectOption('enclosure');
    await dialog.getByRole('checkbox', { name: /Uploaded original is signed/ }).check();
    await dialog.getByLabel('Add original PDF', { exact: true }).setInputFiles({ name: 'CON.pdf', mimeType: 'application/pdf', buffer: original });
    await expect(dialog.getByRole('heading', { name: '2. CON.pdf', exact: true })).toBeVisible();
    const revisionId = (await dialog.getByText(/^Revision ID:/).innerText()).split('Revision ID: ')[1].split('.')[0];
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    // Replace the live source attachment after capture. The saved member owns its original bytes.
    const enclosures = page.getByRole('button', { name: /^Enclosures(?:\s|$)/ }).first();
    if (!await page.getByRole('button', { name: 'Remove attached PDF from enclosure 1', exact: true }).isVisible()) await enclosures.click();
    await page.getByRole('button', { name: 'Remove attached PDF from enclosure 1', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Remove attached PDF?', exact: true }).getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByLabel('Upload enclosure PDFs', { exact: true }).first().setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: sourceReplacement });
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('NEWER LIVE SOURCE');
    if (isMobile) await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await page.getByRole('button', { name: /^Actions for .*NEWER LIVE SOURCE/ }).click();
    await page.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
    const documents = page.getByRole('dialog', { name: 'Documents', exact: true });
    if (await documents.isVisible()) await documents.getByRole('button', { name: 'Close', exact: true }).click();
    if (isMobile) await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    const trash = page.getByRole('dialog', { name: 'Trash', exact: true });
    await trash.getByRole('listitem').filter({ hasText: 'NEWER LIVE SOURCE' }).getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Permanently delete this document?', exact: true }).getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await trash.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();dialog = await packages(page, packageName);
    await expect(dialog).toContainText('unavailable; preserved copy retained');
    const zip = await downloadWord(page, dialog, info.outputPath(`word-package-${theme}.zip`));
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.revisionId).toBe(revisionId);expect(manifest.completeness).toBe('complete');expect(manifest.members).toHaveLength(2);
    expect(manifest.members[1].signedOriginal).toBe(true);
    for (const file of manifest.files) {
      const bytes = await zip.file(file.path)!.async('uint8array');expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      if (file.name.endsWith('.pdf')) { expect(file.sha256).toBe(originalHash);expect(Buffer.from(bytes)).toEqual(original); }
    }
    const docxBytes = await zip.file(manifest.mainDocument)!.async('uint8array');
    const docx = await JSZip.loadAsync(docxBytes), xml = await docx.file('word/document.xml')!.async('string');
    expect(xml).toContain('Captured package paragraph');expect(xml).toContain('WORD PACKAGE FIXTURE');expect(xml).not.toContain('NEWER LIVE SOURCE');
    const rels = await docx.file('word/_rels/document.xml.rels')!.async('string');expect(rels).toContain('https://example.test/guidance');
    const allXml = (await Promise.all(Object.values(docx.files).filter(file => file.name.endsWith('.xml')).map(file => file.async('string')))).join('');
    expect(allXml).not.toContain('Hidden review-only content');expect(allXml).not.toContain('Private reviewer');
    const media = await Promise.all(Object.values(docx.files).filter(file => file.name.startsWith('word/media/') && !file.dir).map(file => file.async('uint8array')));
    expect(media.some(bytes => Buffer.from(bytes).equals(images.figure))).toBe(true);expect(media.some(bytes => Buffer.from(bytes).equals(images.signature))).toBe(true);
    await info.attach(`editable-main-${theme}`, { body: Buffer.from(docxBytes), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    await dialog.getByRole('region', { name: 'Word package delivery', exact: true }).screenshot({ path: info.outputPath(`word-delivery-${theme}.png`) });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    // Gap15's separate portable transfer restores the exact selected revision in a fresh browser.
    await dialog.getByRole('button', { name: 'Export editable package', exact: true }).click();
    await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
    const saving = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download reviewed editable package', exact: true }).click();
    const portable = await saving, portablePath = info.outputPath(`native-${theme}.json`);await portable.saveAs(portablePath);
    const fresh = await browser.newContext({ viewport: page.viewportSize(), userAgent: await page.evaluate(() => navigator.userAgent), isMobile, hasTouch: !!info.project.use.hasTouch, serviceWorkers: 'block' });
    try {
      await fresh.addInitScript(value => { localStorage.setItem('browser-test-visitor', 'returning');localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: value, editorLayout: 'scroll' }, version: 1 })); }, theme);
      const recipient = await fresh.newPage();await recipient.goto('/');
      const received = await packages(recipient);
      await received.getByLabel('Import editable package', { exact: true }).setInputFiles(portablePath);
      await expect(received.getByRole('heading', { name: '2. CON.pdf', exact: true })).toBeVisible();
      const transferred = await downloadWord(recipient, received, info.outputPath(`transferred-${theme}.zip`));
      const transferredManifest = JSON.parse(await transferred.file('manifest.json')!.async('string'));
      expect(transferredManifest.revisionId).toBe(manifest.revisionId);expect(transferredManifest.members).toEqual(manifest.members);
      const receivedWord = await JSZip.loadAsync(await transferred.file(transferredManifest.mainDocument)!.async('uint8array'));
      const receivedXml = await receivedWord.file('word/document.xml')!.async('string');expect(receivedXml).toContain('Captured package paragraph');expect(receivedXml).toContain('WORD PACKAGE FIXTURE');
      expect(transferredManifest.files.filter((file: { kind: string }) => file.kind === 'original')).toEqual(manifest.files.filter((file: { kind: string }) => file.kind === 'original'));
    } finally { await fresh.close(); }
  });
}

test('Word delivery blocks disallowed original PDF text and displays original PDF privacy findings', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('browser-test-visitor', 'returning'); });
  await page.goto('/');
  const baseline = buildBaseline('business_letter');
  const draft = { ...baseline, documentMode: 'custom', documentCategory: 'correspondence', formData: { ...baseline.formData, subject: 'WORD ORIGINAL REVIEW' }, paragraphs: [{ text: 'Synthetic captured correspondence.', level: 0 }], references: [], enclosures: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'review-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const dialog = await packages(page);
  await dialog.getByLabel('Package name', { exact: true }).fill('Original content review');await dialog.getByRole('button', { name: 'Create package', exact: true }).click();
  await dialog.getByRole('button', { name: 'Capture current document', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '1. WORD ORIGINAL REVIEW', exact: true })).toBeVisible();
  await dialog.getByLabel('New member role', { exact: true }).selectOption('supporting-document');
  async function addOriginal(text: string) {
    const pdf = await PDFDocument.create();pdf.addPage().drawText(text);
    await dialog.getByLabel('Add original PDF', { exact: true }).setInputFiles({ name: 'support.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
    await expect(dialog.getByRole('heading', { name: '2. support.pdf', exact: true })).toBeVisible();
  }
  await addOriginal('SECRET');
  const word = dialog.getByRole('region', { name: 'Word package delivery', exact: true });
  await word.getByRole('button', { name: 'Review Word package', exact: true }).click();
  await expect(word.getByRole('alert')).toContainText('outside this deployment');expect(await word.getByRole('checkbox').count()).toBe(0);
  await dialog.getByRole('listitem').filter({ hasText: '2. support.pdf' }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '2. support.pdf', exact: true })).toHaveCount(0);
  await addOriginal('SSN 123-45-6789');
  await word.getByRole('button', { name: 'Review Word package', exact: true }).click();
  await expect(word).toContainText('123-45-6789');await expect(word.getByRole('checkbox')).toBeVisible();
  await expect(word).toContainText('Text-layer inspection cannot read text inside scanned images');
});
