import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });

for (const theme of ['light', 'dark', 'classic']) {
  test(`downloads a complete printable change report in ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript(theme => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme, editorLayout: 'scroll' }, version: 1 }));
    }, theme);
    const complete = `${'Unicode 🪸 café <script>alert("review")</script> '.repeat(110)}FULL_REPORT_END`;
    const draft = { documentCategory: 'correspondence', documentMode: 'custom', docType: 'naval_letter',
      formData: { subject: 'CURRENT CLEAN DRAFT', classLevel: 'unclassified' }, paragraphs: [{ id: 'current-paragraph', text: 'Current body', level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [],
      reviewComments: { version: 2, threads: [{ id: '11111111-1111-4111-8111-111111111111', resolved: true,
        anchor: { kind: 'paragraph', paragraphId: 'deleted-paragraph', context: 'Retained context SSN 234-56-7890', docType: 'naval_letter' },
        messages: [{ id: '22222222-2222-4222-8222-222222222222', author: 'Reviewer <Example>', text: complete, createdAt: '2026-11-12T12:00:00.000Z' }] }] } };
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({ name: 'review-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(page.locator('#subject')).toHaveValue('CURRENT CLEAN DRAFT');
    // Seed a known historical pair independently of autosave timing.
    await page.evaluate(async draft => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs');request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
      try {
        const id = await new Promise<string>((resolve, reject) => { const request = db.transaction('app').objectStore('app').get('currentId');request.onsuccess = () => resolve(request.result.value);request.onerror = () => reject(request.error); });
        const saved = structuredClone(draft);saved.formData.subject = 'BEFORE SSN 123-45-6789';saved.paragraphs[0].text = 'Earlier full body';
        await new Promise<void>((resolve, reject) => { const tx = db.transaction('app', 'readwrite');tx.objectStore('app').put({ key: `snap:${id}`, value: [{ ts: Date.UTC(2026, 10, 12, 12), session: saved }] });tx.oncomplete = () => resolve();tx.onerror = () => reject(tx.error); });
      } finally { db.close(); }
    }, draft);
    await page.getByRole('button', { name: 'History', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'Version history', exact: true });
    const picker = history.getByRole('combobox', { name: 'Saved version' });
    if (page.viewportSize()!.width < 768) await picker.selectOption('0');
    else await history.getByRole('button', { name: /Compare version 1/ }).click();
    await history.getByRole('button', { name: 'Prepare change report' }).click();
    await expect(history.getByRole('status')).toContainText('Social Security Number');
    const downloadButton = history.getByRole('button', { name: 'Download reviewed report (.html)' });
    await downloadButton.scrollIntoViewIfNeeded();
    const box = await downloadButton.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: testInfo.outputPath(`report-review-${theme}.png`) });
    const downloading = page.waitForEvent('download');
    await downloadButton.focus();await page.keyboard.press('Enter');
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^change-report-.*\.html$/);
    const html = await readFile((await download.path())!, 'utf8');
    expect(html).toContain('BEFORE SSN 123-45-6789');expect(html).toContain('CURRENT CLEAN DRAFT');
    expect(html).toContain('Retained context SSN 234-56-7890');expect(html).toContain('FULL_REPORT_END');
    expect(html).toContain('Target unavailable / detached');expect(html).not.toContain('<script>');
    expect(html).not.toContain('11111111-1111-4111-8111-111111111111');
    const artifact = await page.context().newPage();await artifact.setContent(html);
    await expect(artifact.getByRole('heading', { name: 'Change report', exact: true })).toBeVisible();
    expect(await artifact.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
    await artifact.screenshot({ path: testInfo.outputPath(`downloaded-report-${theme}.png`), fullPage: true, scale: 'css' });
    await artifact.close();
    await history.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#subject')).toHaveValue('CURRENT CLEAN DRAFT');
  });
}
