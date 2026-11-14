import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });
test.setTimeout(180_000);
async function action(page: Page, name: string) {
  await page.getByRole('button', { name: name === 'Undo' || name === 'Redo' ? 'Document tools' : 'Document actions', exact: true }).click();await page.getByRole('menuitem', { name: name === 'Undo' || name === 'Redo' ? new RegExp(`^${name}`) : name, exact: true }).click();
}
async function reviews(page: Page) {
  await action(page, 'Review rounds…');return page.getByRole('dialog', { name: 'Review rounds', exact: true });
}
async function download(page: Page, operation: () => Promise<unknown>) {
  const pending = page.waitForEvent('download');await operation();return readFile((await (await pending).path())!);
}
for (const theme of ['light', 'dark', 'classic']) test(`round-bound replacement proposals preserve newer work in ${theme}`, async ({ page, browser, baseURL }, info) => {
  const appearance = { theme, editorLayout: 'scroll' };
  const init = (value: typeof appearance) => {
    localStorage.setItem('browser-test-visitor', 'returning');localStorage.setItem('dondocs_ui', JSON.stringify({ state: value, version: 1 }));
  };
  await page.addInitScript(init, appearance);await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL SUGGESTION SOURCE', from: 'Training Office', to: 'Original recipient', unitAddress: 'Original training address', date: '13 Nov 26', sigLast: 'EXAMPLE' },
    paragraphs: [{ id: 'suggestion-first', text: 'Original first paragraph.', level: 0 }, { id: 'suggestion-second', text: 'Original second paragraph.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill('Replacement review');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  const copy = await download(page, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());await page.keyboard.press('Escape');
  const reviewerContext = await browser.newContext({ viewport: page.viewportSize()!, serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
  try {
    await reviewerContext.addInitScript(init, appearance);const reviewer = await reviewerContext.newPage();await reviewer.goto(baseURL!);
    let reviewModal = await reviews(reviewer);
    await reviewModal.getByLabel('Import reviewer copy', { exact: true }).setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: copy });
    await reviewModal.getByRole('button', { name: 'Open as new review copy', exact: true }).click();await expect(reviewModal).toBeHidden();
    reviewModal = await reviews(reviewer);await reviewModal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Replacement review' });
    await reviewModal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Example chief');
    await reviewModal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'To' });
    await reviewModal.getByLabel('Proposed replacement', { exact: true }).fill('Reviewed recipient');
    await reviewModal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
    await expect(reviewModal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true })).toBeVisible();
    await reviewModal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'Paragraph 1' });
    await reviewModal.getByLabel('Proposed replacement', { exact: true }).fill('Fictional SSN 123-45-6789 proposed paragraph.');
    await reviewModal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
    await expect(reviewModal.getByRole('article', { name: 'Suggestion 2: Replace paragraph 1', exact: true })).toBeVisible();
    await reviewModal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'Unit address' });
    await reviewModal.getByLabel('Proposed replacement', { exact: true }).fill('123 Example Rd\nQuantico VA 22134');
    await reviewModal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
    await expect(reviewModal.getByRole('article', { name: 'Suggestion 3: Replace unit address', exact: true })).toBeVisible();
    await reviewModal.getByRole('button', { name: 'Prepare feedback return', exact: true }).click();
    await expect(reviewModal.getByText(/Possible sensitive information:/)).toBeVisible();
    const returned = await download(reviewer, () => reviewModal.getByRole('button', { name: 'Download feedback return', exact: true }).click());
    const payload = JSON.parse(returned.toString('utf8'));expect(payload.version).toBe(2);expect(payload.proposals).toHaveLength(3);expect(payload.formData).toBeUndefined();
    await page.getByRole('textbox', { name: 'Paragraph 2', exact: true }).fill('Newer author paragraph survives acceptance.');
    modal = await reviews(page);await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'return.json', mimeType: 'application/json', buffer: returned });
    await modal.getByRole('button', { name: 'Import reviewed feedback', exact: true }).click();await expect(modal.getByText(/Feedback imported/)).toBeVisible();
    await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Replacement review' });
    const address = modal.getByRole('article', { name: 'Suggestion 3: Replace unit address', exact: true });
    await address.getByRole('button', { name: 'Accept suggestion', exact: true }).click();await expect(address.getByText(/· Accepted$/)).toBeVisible();
    const recipient = modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true });
    await recipient.getByRole('button', { name: 'Accept suggestion', exact: true }).click();await expect(recipient.getByText(/· Accepted$/)).toBeVisible();
    const paragraph = modal.getByRole('article', { name: 'Suggestion 2: Replace paragraph 1', exact: true });
    await paragraph.getByRole('button', { name: 'Reject suggestion', exact: true }).click();await expect(paragraph.getByText(/· Rejected$/)).toBeVisible();
    expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`suggestions-${theme}.png`), scale: 'css' });
    await page.keyboard.press('Escape');
    await action(page, 'Undo');
    const undone = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));expect(undone.formData.to).toBe('Original recipient');
    await action(page, 'Redo');
    const redone = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));expect(redone.formData.to).toBe('Reviewed recipient');
    await page.reload();
    const saved = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
    expect(saved.formData.to).toBe('Reviewed recipient');expect(saved.formData.unitAddress).toBe('123 Example Rd\nQuantico VA 22134');expect(saved.paragraphs[1].text).toBe('Newer author paragraph survives acceptance.');
    expect(saved.paragraphs[0].text).toBe('Original first paragraph.');expect(JSON.stringify(saved)).not.toContain('123-45-6789');expect(saved.proposals).toBeUndefined();
    modal = await reviews(page);await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Replacement review' });
    await expect(modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true }).getByText(/· Accepted$/)).toBeVisible();
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'again.json', mimeType: 'application/json', buffer: returned });
    await expect(modal.getByText(/This return has already been imported/)).toBeVisible();
  } finally { await reviewerContext.close(); }
});
