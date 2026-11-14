import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { docxImageFixture } from '../_helpers/docxImageFixture';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);

async function actions(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: typeof name === 'string' }).click();
}
async function reviews(page: Page) {
  await actions(page, 'Review rounds…');
  return page.getByRole('dialog', { name: 'Review rounds', exact: true });
}
async function workspace(page: Page, name?: string) {
  const trigger = page.getByRole('button', { name: 'Open workspace', exact: true });
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (await drawer.isVisible()) {
    if (name) await drawer.getByRole('button', { name, exact: true }).click();
    return;
  }
  if (name) {
    // Use whichever navigation the app renders, including tablets and reloads.
    await trigger.or(page.getByRole('button', { name, exact: true })).first().click();
    if (await drawer.isVisible()) await drawer.getByRole('button', { name, exact: true }).click();
  } else if (await trigger.isVisible()) await trigger.click();
}
async function downloadCopy(page: Page) {
  const modal = page.getByRole('dialog', { name: 'Review rounds', exact: true });
  await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  await expect(modal.getByText('Check this reviewer copy before downloading', { exact: true })).toBeVisible();
  const pending = page.waitForEvent('download', { timeout: 15_000 });
  await modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click();
  return readFile((await (await pending).path())!);
}
async function exportedDraft(page: Page) {
  const pending = page.waitForEvent('download', { timeout: 15_000 });
  await actions(page, 'Export draft (.json)');
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
}

for (const theme of ['light', 'dark', 'classic']) {
  test(`review baseline survives history cleanup, source deletion and fresh-browser recovery in ${theme}`, async ({ page, browser, baseURL }, info) => {
    await page.addInitScript(appearance => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: appearance, editorLayout: 'focused' } }));
    }, theme);
    await page.goto('/');
    const images = await docxImageFixture(), pdf = await PDFDocument.create();
    pdf.addPage([300, 400]);
    const attached = Buffer.from(await pdf.save());
    const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
      formData: { subject: `REVIEW SOURCE ${theme}`, unitLine1: 'FICTIONAL TRAINING UNIT', unitAddress: '', from: 'Training Office', to: 'Training Officer',
        date: '13 Nov 26', classLevel: 'unclassified', signatureType: 'image', sigFirst: 'Alex', sigLast: 'Example',
        signatureImage: { name: 'signature.png', size: images.signature.length, data: images.signature.toString('base64') } },
      paragraphs: [{ id: 'review-body', text: 'Original fictional paragraph.', level: 0, portionMarking: 'U' },
        { id: 'review-figure', text: 'Fictional diagram', level: 0, figure: { name: 'diagram.png', type: 'image/png', data: images.figure.toString('base64') } }],
      enclosures: [{ title: 'Supporting PDF', file: { name: 'support.pdf', size: attached.length, data: attached.toString('base64') } }], references: [], copyTos: [], distributions: [] };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'review-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(page.getByRole('button', { name: `REVIEW SOURCE ${theme}`, exact: true })).toBeVisible();
    // A user can paste an entire address into City while the other parts are empty.
    // Normal saved-document readers canonicalize it; a linked review copy must not.
    await page.getByLabel('Document section', { exact: true }).selectOption('letterhead');
    await page.getByRole('textbox', { name: 'City', exact: true }).fill('CAMP PENDLETON CA 92055');
    const modal = await reviews(page);
    await modal.getByLabel('Review name', { exact: true }).fill(`Retained review ${theme}`);
    await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
    await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
    const first = await downloadCopy(page), packet = JSON.parse(first.toString('utf8'));
    expect(packet.draft.formData.unitAddress).toBe('CAMP PENDLETON CA 92055');
    expect(packet.draft.paragraphs[0].portionMarking).toBe('U');
    expect(packet.draft.formData.signatureImage.data).toBe(images.signature.toString('base64'));
    expect(packet.draft.paragraphs[1].figure.data).toBe(images.figure.toString('base64'));
    expect(packet.draft.enclosures[0].file.data).toBe(attached.toString('base64'));
    await page.keyboard.press('Escape');

    await page.getByLabel('Document section', { exact: true }).selectOption('addressing');
    for (let index = 0; index < 11; index++) {
      await page.getByRole('textbox', { name: 'Subject', exact: true }).fill(`LATER AUTHOR WORK ${theme} ${index}`);
      await actions(page, /^Save checkpoint/);
    }
    await expect.poll(async () => page.evaluate(async id => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs');request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
      try {
        return await new Promise<boolean>(resolve => { const request = db.transaction('app').objectStore('app').get(`snap:${id}`);request.onsuccess = () => resolve(request.result?.value?.length === 10); });
      } finally { db.close(); }
    }, packet.round.sourceDocumentId)).toBe(true);
    await workspace(page);
    await page.getByRole('button', { name: `Actions for LATER AUTHOR WORK ${theme} 10`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
    await workspace(page, 'Trash');
    const trash = page.getByRole('dialog', { name: 'Trash', exact: true });
    await trash.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Permanently delete this document?', exact: true }).getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(trash.getByText('Trash is empty.', { exact: true })).toBeVisible();
    await trash.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    const retained = await reviews(page);
    await expect(retained.getByText('Source unavailable; the saved baseline is retained.', { exact: false })).toBeVisible();
    expect(JSON.parse((await downloadCopy(page)).toString('utf8'))).toEqual(packet);
    await retained.getByRole('article').first().scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const accessibility = await new AxeBuilder({ page }).analyze();
    await info.attach('review-rounds-axe', { body: JSON.stringify(accessibility, null, 2), contentType: 'application/json' });
    expect(accessibility.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
    await page.screenshot({ path: info.outputPath(`retained-review-${theme}.png`), scale: 'css' });
    await retained.getByRole('button', { name: 'Open baseline as new review copy', exact: true }).click();
    await expect(retained).toBeHidden();
    await page.reload();
    await expect(page.getByRole('button', { name: `Review: Retained review ${theme}`, exact: true })).toBeVisible();
    const live = await exportedDraft(page);
    expect(live.formData.unitAddress).toBe('CAMP PENDLETON CA 92055');
    expect(live.paragraphs[0].portionMarking).toBe('U');
    expect(live.formData.subject).toBe(`REVIEW SOURCE ${theme}`);

    await workspace(page, 'Settings');
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    const backupDownload = page.waitForEvent('download', { timeout: 15_000 });
    await settings.getByRole('button', { name: 'Download workspace backup', exact: true }).click();
    const backup = await readFile((await (await backupDownload).path())!);
    expect(JSON.parse(backup.toString('utf8')).version).toBe(7);
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    const second = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent),
      isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch, serviceWorkers: 'block' });
    try {
      await second.addInitScript(appearance => {
        localStorage.setItem('browser-test-visitor', 'returning');
        localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: appearance, editorLayout: 'focused' } }));
      }, theme);
      const restored = await second.newPage();await restored.goto(baseURL!);
      await workspace(restored, 'Settings');
      await restored.getByLabel('Backup file', { exact: true }).setInputFiles({ name: 'workspace-review.json', mimeType: 'application/json', buffer: backup });
      await expect(restored.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('status')).toContainText('review baseline');
      await restored.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
      const recovered = await reviews(restored);
      expect(JSON.parse((await downloadCopy(restored)).toString('utf8'))).toEqual(packet);
      await recovered.getByRole('button', { name: 'Open baseline as new review copy', exact: true }).click();
      await expect(recovered).toBeHidden();
      await restored.reload();
      await expect(restored.getByRole('button', { name: `Review: Retained review ${theme}`, exact: true })).toBeVisible();
      const recoveredDraft = await exportedDraft(restored);
      expect(recoveredDraft.formData.unitAddress).toBe('CAMP PENDLETON CA 92055');
      expect(recoveredDraft.enclosures[0].file.data).toBe(attached.toString('base64'));
      expect(recoveredDraft.paragraphs[1].figure.data).toBe(images.figure.toString('base64'));
      const cleanup = await reviews(restored);
      await cleanup.getByRole('button', { name: 'Delete review baseline', exact: true }).click();
      await restored.getByRole('alertdialog', { name: 'Delete this review baseline?', exact: true }).getByRole('button', { name: 'Delete review baseline', exact: true }).click();
      await expect(cleanup.getByText('No review baselines saved yet.', { exact: true })).toBeVisible();
      await restored.keyboard.press('Escape');await restored.reload();
      await expect(restored.getByRole('button', { name: `Review: Retained review ${theme}`, exact: true })).toBeVisible();
      expect((await exportedDraft(restored)).formData.unitAddress).toBe('CAMP PENDLETON CA 92055');
    } finally { await second.close(); }
  });
}
