import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
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
async function workspace(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: 'Open workspace', exact: true });
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (await drawer.isVisible()) {
    await drawer.getByRole('button', { name, exact: true }).click();
    return;
  }
  // Auto-wait for navigation after menu dismissal and responsive hydration.
  await trigger.or(page.getByRole('button', { name, exact: true })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name, exact: true }).click();
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
    // Section navigation focuses its heading on the next animation frame.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    const city = page.getByRole('textbox', { name: 'City', exact: true });
    await city.fill('CAMP PENDLETON CA 92055');
    await expect(city).toHaveValue('CAMP PENDLETON CA 92055');
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
    await workspace(page, `Actions for LATER AUTHOR WORK ${theme} 10`);
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
      await expect(restored.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('status')).toContainText('review baseline', { timeout: 15_000 });
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

test('reviewer imports reject stale previews and preserve native bytes without claiming local ownership', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'light', editorLayout: 'focused' } }));
  });
  await page.goto('/');
  const image = await docxImageFixture(), pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  const bytes = Buffer.from(await pdf.save()).toString('base64');
  const draft = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FRESH REVIEW BOUNDARIES', unitLine1: 'FICTIONAL TRAINING UNIT', unitAddress: '', from: 'Example sender', to: 'Example recipient',
      date: '13 Nov 26', classLevel: 'unclassified', sigFirst: 'Alex', sigLast: 'Example', signatureType: 'image',
      signatureImage: { name: 'signature.png', size: image.signature.length, data: image.signature.toString('base64') },
      basicLetterFile: { name: 'basic-letter.pdf', size: Buffer.from(bytes, 'base64').length, data: bytes } },
    paragraphs: [{ id: 'fresh-body', text: 'Retain this exact native paragraph.', level: 0, portionMarking: 'U' },
      { id: 'fresh-figure', text: 'Synthetic diagram', level: 0, figure: { name: 'figure.png', type: 'image/png', data: image.figure.toString('base64') } }],
    enclosures: [{ title: 'Synthetic supporting PDF', file: { name: 'support.pdf', size: Buffer.from(bytes, 'base64').length, data: bytes } }], references: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'fresh-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('button', { name: draft.formData.subject, exact: true })).toBeVisible();
  await page.getByLabel('Document section', { exact: true }).selectOption('letterhead');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  const city = page.getByRole('textbox', { name: 'City', exact: true });
  await city.fill('CAMP PENDLETON CA 92055');
  await expect(city).toHaveValue('CAMP PENDLETON CA 92055');
  const modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('Fresh exact baseline');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByRole('status')).toContainText('Review baseline saved.');
  const original = JSON.parse((await downloadCopy(page)).toString('utf8'));
  await info.attach('captured-reviewer-file', { body: JSON.stringify(original, null, 2), contentType: 'application/json' });
  expect(original.draft.formData.unitAddress).toBe('CAMP PENDLETON CA 92055');
  expect(original.draft.formData.basicLetterFile.data).toBe(bytes);
  expect(original.draft.enclosures[0].file.data).toBe(bytes);
  expect(original.draft.formData.signatureImage.data).toBe(image.signature.toString('base64'));
  expect(original.draft.paragraphs[1].figure.data).toBe(image.figure.toString('base64'));
  expect(original.round.ownerDocumentId).toBeUndefined();

  const foreign = structuredClone(original);
  foreign.round.id = `review_${crypto.randomUUID()}`;
  const importCopy = (value: unknown) => modal.getByLabel('Import reviewer copy', { exact: true }).setInputFiles({
    name: 'incoming-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await importCopy(foreign);
  await expect(modal.getByRole('button', { name: 'Open as new review copy', exact: true })).toBeVisible();
  const tampered = structuredClone(foreign);
  tampered.draft.paragraphs[0].text = 'Tampered after checksum';
  await importCopy(tampered);
  await expect(modal.getByRole('alert')).toContainText('does not match its recorded baseline');
  await page.screenshot({ path: info.outputPath('rejected-reviewer-replacement.png'), scale: 'css' });
  await expect(modal.getByRole('button', { name: 'Open as new review copy', exact: true })).toHaveCount(0);
  await importCopy({ ...foreign, round: { ...foreign.round, ownerDocumentId: original.round.sourceDocumentId } });
  await expect(modal.getByRole('alert')).toContainText('not a supported reviewer copy');
  await expect(modal.getByRole('button', { name: 'Open as new review copy', exact: true })).toHaveCount(0);
  await importCopy(foreign);
  await modal.getByRole('button', { name: 'Open as new review copy', exact: true }).click();
  await expect(modal).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Review: Fresh exact baseline', exact: true })).toBeVisible();
  const reopened = await exportedDraft(page);
  expect(reopened.formData.unitAddress).toBe(original.draft.formData.unitAddress);
  expect(reopened.formData.basicLetterFile.data).toBe(bytes);
  expect(reopened.enclosures[0].file.data).toBe(bytes);
  expect(reopened.paragraphs[1].figure.data).toBe(image.figure.toString('base64'));
  const inventory = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs');request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
    try { return await new Promise<{ app: Array<{ key: string; value: unknown }>; documents: Array<{ id: string; meta: { nativeReviewText?: boolean } }> }>((resolve, reject) => {
      const tx = db.transaction(['app', 'documents']), app = tx.objectStore('app').getAll(), documents = tx.objectStore('documents').getAll();
      tx.oncomplete = () => resolve({ app: app.result, documents: documents.result });tx.onerror = () => reject(tx.error);
    }); } finally { db.close(); }
  });
  const localPin = inventory.app.find(record => record.key === `review:${original.round.id}`)!.value as { ownerDocumentId?: string };
  const receivedPin = inventory.app.find(record => record.key === `review:${foreign.round.id}`)!.value as { ownerDocumentId?: string };
  expect(localPin.ownerDocumentId).toBe(original.round.sourceDocumentId);
  expect(receivedPin.ownerDocumentId).toBeUndefined();
  expect(inventory.documents.some(document => document.id !== original.round.sourceDocumentId && document.meta.nativeReviewText)).toBe(true);
  const historical = await page.evaluate(async payload => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs');request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
    try {
      const id = await new Promise<string>(resolve => { const request = db.transaction('app').objectStore('app').get('currentId');request.onsuccess = () => resolve(request.result.value); });
      const record = await new Promise<{ session: typeof payload.session }>(resolve => { const request = db.transaction('documents').objectStore('documents').get(id);request.onsuccess = () => resolve(request.result); });
      const ref = { id: 'att_fresh_history_signature', name: 'legacy-signature.png', size: payload.signature.length, type: 'image/png' };
      const session = { ...record.session, formData: { ...record.session.formData, signatureImage: { name: ref.name, size: ref.size, data: '', fileRef: ref } } };
      await new Promise<void>((resolve, reject) => { const tx = db.transaction(['app', 'attachments'], 'readwrite');
        tx.objectStore('attachments').put({ ...ref, data: new Uint8Array(payload.signature).buffer });
        tx.objectStore('app').put({ key: `snap:${id}`, value: [{ ts: Date.now() - 1000, session }] });
        tx.oncomplete = () => resolve();tx.onerror = () => reject(tx.error);
      });
      return id;
    } finally { db.close(); }
  }, { signature: [...image.signature], session: reopened });
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Version history', exact: true });
  const version = history.getByRole('button', { name: /^Compare version 1 from/ });
  const versionSelect = history.getByRole('combobox', { name: 'Saved version', exact: true });
  await expect(version.or(versionSelect)).toBeVisible();
  if (await version.isVisible()) await version.click();
  else await versionSelect.selectOption('0');
  await history.getByRole('button', { name: 'Restore selected version', exact: true }).click();
  await expect(history).toBeHidden();
  const recoveredHistory = await exportedDraft(page);
  expect(recoveredHistory.formData.unitAddress).toBe(original.draft.formData.unitAddress);
  expect(recoveredHistory.formData.signatureImage.data).toBe(image.signature.toString('base64'));
  const wordDownload = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const word = await readFile((await (await wordDownload).path())!);
  await info.attach('clean-native-word', { body: word, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const zip = await JSZip.loadAsync(word), xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('Retain this exact native paragraph.');
  for (const hidden of [original.round.id, foreign.round.id, foreign.round.baselineDigest, historical, 'nativeReviewText']) expect(xml).not.toContain(hidden);
  const retained = await reviews(page);
  await expect(retained.getByText('Received reviewer baseline; no local source ownership is assigned.', { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath('separate-owner-and-received-baselines.png'), scale: 'css' });
  await page.evaluate(async roundId => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('dondocs');request.onsuccess = () => resolve(request.result); });
    try {
      const pin = await new Promise<{ baseline: { session: { enclosures: Array<{ fileRef: { id: string } }> } } }>(resolve => { const request = db.transaction('app').objectStore('app').get(`review:${roundId}`);request.onsuccess = () => resolve(request.result.value); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('attachments', 'readwrite');tx.objectStore('attachments').delete(pin.baseline.session.enclosures[0].fileRef.id);tx.oncomplete = () => resolve();tx.onerror = () => reject(tx.error); });
    } finally { db.close(); }
  }, foreign.round.id);
  await retained.getByRole('article').filter({ hasText: 'Received reviewer baseline;' }).getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  await expect(retained.getByRole('alert')).toContainText('Could not read');
  await expect(retained.getByRole('button', { name: 'Download reviewer copy', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('missing-required-review-asset.png'), scale: 'css' });
});
