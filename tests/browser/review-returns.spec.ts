import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });
test.setTimeout(180_000);
async function actions(page: Page, name: string) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();await page.getByRole('menuitem', { name, exact: true }).click();
}
async function reviews(page: Page) {
  await actions(page, 'Review rounds…');return page.getByRole('dialog', { name: 'Review rounds', exact: true });
}
async function comments(page: Page) {
  await page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ }).click();return page.getByRole('dialog', { name: 'Document comments', exact: true });
}
async function workspace(page: Page, name: string) {
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (await drawer.isVisible()) {
    await drawer.getByRole('button', { name, exact: true }).click();return;
  }
  const launcher = page.getByRole('button', { name: 'Open workspace', exact: true });
  // Wait for navigation to become available after the review dialog closes.
  await launcher.or(page.getByRole('button', { name, exact: true })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name, exact: true }).click();
}
async function download(page: Page, button: () => Promise<unknown>) {
  const pending = page.waitForEvent('download', { timeout: 30_000 });await button();return readFile((await (await pending).path())!);
}
async function exported(page: Page) { return JSON.parse((await download(page, () => actions(page, 'Export draft (.json)'))).toString('utf8')); }
for (const theme of ['light', 'dark', 'classic']) {
  test(`returned discussions preserve newer native work and receipts in ${theme}`, async ({ page, browser, baseURL }, info) => {
    const appearance = { theme, editorLayout: 'scroll' };
    const init = (value: typeof appearance) => {
      localStorage.setItem('browser-test-visitor', 'returning');localStorage.setItem('dondocs_ui', JSON.stringify({ state: value, version: 1 }));
    };
    const reviewerFile = await test.step('Pin the author baseline and download its reviewer copy', async () => {
      await page.addInitScript(init, appearance);await page.goto('/');
      const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
        formData: { subject: 'FICTIONAL REVIEW SOURCE', from: 'Training Office', to: 'Training Officer', date: '13 Nov 26', sigLast: 'EXAMPLE' },
        paragraphs: [{ id: 'review-first', text: 'A paragraph that will be removed by the drafter.', level: 0 }, { id: 'review-second', text: 'Original second paragraph.', level: 0 }],
        references: [], enclosures: [], copyTos: [], distributions: [], reviewComments: { version: 2, threads: [{
          id: '00000000-0000-4000-8000-000000000001', anchor: { kind: 'paragraph', paragraphId: 'review-first', context: 'A paragraph that will be removed by the drafter.', docType: 'naval_letter' },
          resolved: false, messages: [{ id: '00000000-0000-4000-8000-000000000002', author: 'Chief', text: 'Original baseline note.', createdAt: '2026-11-13T00:00:00Z' }],
        }] } };
      await page.getByLabel('Import draft file').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
      await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
      const modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill('Fictional November review');
      await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
      await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
      await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
      await expect(modal.getByRole('heading', { name: 'Check this reviewer copy before downloading', exact: true })).toBeVisible();
      const reviewerFile = await download(page, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());await page.keyboard.press('Escape');
      return reviewerFile;
    });
    const reviewerContext = await browser.newContext({ viewport: page.viewportSize()!, serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
    try {
      const reviewer = await test.step('Open the reviewer copy in a separate browser context', async () => {
        await reviewerContext.addInitScript(init, appearance);const reviewer = await reviewerContext.newPage();await reviewer.goto(baseURL!);
        const reviewModal = await reviews(reviewer);
        await reviewModal.getByLabel('Import reviewer copy', { exact: true }).setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: reviewerFile });
        await reviewModal.getByRole('button', { name: 'Open as new review copy', exact: true }).click();
        await expect(reviewModal).toBeHidden();
        return reviewer;
      });
      const returned = await test.step('Edit, reply, resolve and download returned feedback', async () => {
        const panel = await comments(reviewer);
        await panel.getByRole('button', { name: 'Edit comment by Chief', exact: true }).click();await panel.getByLabel('Comment', { exact: true }).fill('Returned correction.');
        await panel.getByRole('button', { name: 'Save comment', exact: true }).click();
        await panel.getByRole('button', { name: 'Reply', exact: true }).click();await panel.getByLabel('Reviewer name', { exact: true }).fill('Chief');
        await panel.getByLabel('Reply', { exact: true }).fill('Independent returned reply.');await panel.getByRole('button', { name: 'Post reply', exact: true }).click();
        await panel.getByRole('button', { name: 'Resolve', exact: true }).click();await panel.getByRole('button', { name: 'Close comments', exact: true }).click();
        const returning = await reviews(reviewer);await returning.getByRole('button', { name: 'Prepare feedback return', exact: true }).click();
        await expect(returning.getByRole('heading', { name: 'Review feedback before downloading', exact: true })).toBeVisible();
        const returned = await download(reviewer, () => returning.getByRole('button', { name: 'Download feedback return', exact: true }).click());
        const payload = JSON.parse(returned.toString('utf8'));expect(payload.handling.marking).toContain('UNCLASSIFIED');expect(payload.formData).toBeUndefined();
        return returned;
      });
      await test.step('Make independent newer author text and discussion edits', async () => {
        await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('NEWER AUTHOR SUBJECT');
        await page.getByRole('textbox', { name: 'Paragraph 2', exact: true }).fill('Newer author body survives returned feedback.');
        await page.locator('[data-paragraph-id="review-first"]').getByRole('button', { name: 'Delete paragraph', exact: true }).click();
        const panel = await comments(page);await panel.getByRole('button', { name: 'Edit comment by Chief', exact: true }).click();
        await panel.getByLabel('Comment', { exact: true }).fill('Local correction.');await panel.getByRole('button', { name: 'Save comment', exact: true }).click();
        await panel.getByRole('button', { name: 'Close comments', exact: true }).click();
      });
      await test.step('Review conflicting discussions and import selected feedback', async () => {
        const modal = await reviews(page);await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'return.json', mimeType: 'application/json', buffer: returned });
        await expect(modal.getByRole('region', { name: 'Conflict 1 current', exact: true })).toBeVisible();
        await expect(modal.getByRole('button', { name: 'Import reviewed feedback', exact: true })).toBeDisabled();
        for (const choice of await modal.getByRole('radio', { name: 'Keep current', exact: true }).all()) await choice.check();
        await modal.getByRole('region', { name: 'Conflict 1 current', exact: true }).scrollIntoViewIfNeeded();
        expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();expect(accessibility.violations).toEqual([]);
        await page.screenshot({ path: info.outputPath(`return-conflicts-${theme}.png`), scale: 'css' });
        await modal.getByRole('button', { name: 'Import reviewed feedback', exact: true }).click();await expect(modal.getByText(/Feedback imported/)).toBeVisible();
      });
      await test.step('Reload and verify newer author work and detached feedback', async () => {
        await page.keyboard.press('Escape');await page.reload();
        const saved = await exported(page);expect(saved.formData.subject).toBe('NEWER AUTHOR SUBJECT');
        expect(saved.paragraphs).toHaveLength(1);expect(saved.paragraphs[0].text).toBe('Newer author body survives returned feedback.');
        expect(saved.reviewComments.threads[0].anchor.paragraphId).toBe('review-first');
        expect(saved.reviewComments.threads[0].messages.map((message: { text: string }) => message.text)).toEqual(['Local correction.', 'Independent returned reply.']);
      });
      await test.step('Recognize the same feedback return after reload', async () => {
        const modal = await reviews(page);await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'same-return.json', mimeType: 'application/json', buffer: returned });
        await expect(modal.getByText(/This return has already been imported/)).toBeVisible();await page.keyboard.press('Escape');
      });
      await test.step('Open workspace Settings and download the receipt-bearing backup', async () => {
        await workspace(page, 'Settings');
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
        const backup = await download(page, () => settings.getByRole('button', { name: 'Download workspace backup', exact: true }).click());
        const bundle = JSON.parse(backup.toString('utf8'));expect(bundle.version).toBe(8);expect(bundle.reviewReturns).toHaveLength(1);
      });
    } finally { await reviewerContext.close(); }
  });
}
