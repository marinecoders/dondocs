import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';
import { closeReviewRounds } from '../_helpers/closeReviewRounds';

test.use({ serviceWorkers: 'block' });
test.setTimeout(180_000);
async function action(page: Page, name: string) {
  await page.getByRole('button', { name: ['Undo', 'Redo'].includes(name) ? 'Document tools' : 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: ['Undo', 'Redo'].includes(name) ? new RegExp(`^${name}`) : name, exact: true }).click();
}
async function reviews(page: Page) {
  await action(page, 'Review rounds…');return page.getByRole('dialog', { name: 'Review rounds', exact: true });
}
async function download(page: Page, operation: () => Promise<unknown>) {
  const pending = page.waitForEvent('download');await operation();return readFile((await (await pending).path())!);
}
async function selectSecondWord(modal: ReturnType<Page['getByRole']>) {
  await modal.getByLabel('Suggestion target', { exact: true }).selectOption('paragraph:selected-body');
  const text = modal.getByRole('textbox', { name: 'Select text in reviewed paragraph', exact: true });
  await text.focus();
  // Use the native textarea selection API on desktop and touch projects alike.
  await text.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(11, 16);element.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await text.press('Shift');
  await modal.getByRole('button', { name: 'Use selected text', exact: true }).click();
  await expect(modal.getByRole('region', { name: 'Suggestion baseline value', exact: true })).toHaveText('Alpha');
}

for (const theme of ['light', 'dark', 'classic']) test(`selected replacement transfer, decisions and Undo preserve surrounding text in ${theme}`, async ({ page, browser, baseURL }, info) => {
  const init = (appearance: string) => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: appearance, editorLayout: 'scroll' } }));
  };
  await page.addInitScript(init, theme);await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'SYNTHETIC SELECTED REVIEW', to: 'Training Office', classLevel: 'unclassified' },
    paragraphs: [{ id: 'selected-body', text: 'Keep Alpha Alpha ending.', level: 0 }, { id: 'newer-body', text: 'Original other paragraph.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'selected.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('Precise baseline');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  const copy = await download(page, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());
  await closeReviewRounds(modal);
  const context = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent),
    serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
  try {
    await context.addInitScript(init, theme);const reviewer = await context.newPage();await reviewer.goto(baseURL!);
    let remote = await reviews(reviewer);
    await remote.getByLabel('Import reviewer copy', { exact: true }).setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: copy });
    await remote.getByRole('button', { name: 'Open as new review copy', exact: true }).click();await expect(remote).toBeHidden();
    remote = await reviews(reviewer);
    await remote.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Precise baseline' });
    await remote.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Synthetic reviewer');
    await selectSecondWord(remote);
    await remote.getByLabel('Proposed replacement', { exact: true }).fill('Cancelled');
    await remote.getByRole('button', { name: 'Cancel replacement', exact: true }).click();
    await expect(remote.getByRole('article', { name: /^Suggestion / })).toHaveCount(0);
    for (const value of ['Équipe 👩🏽‍✈️', 'Conflicting']) {
      await selectSecondWord(remote);await remote.getByLabel('Proposed replacement', { exact: true }).fill(value);
      await remote.getByRole('button', { name: 'Add suggestion', exact: true }).click();
      await expect(remote.getByRole('status', { name: 'Suggestion submission status', exact: true })).toContainText('Suggestion submitted');
    }
    await expect(remote.getByRole('button', { name: 'Accept suggestion', exact: true })).toHaveCount(0);
    await remote.getByRole('button', { name: 'Prepare feedback return', exact: true }).click();
    const returned = await download(reviewer, () => remote.getByRole('button', { name: 'Download feedback return', exact: true }).click());
    const payload = JSON.parse(returned.toString('utf8'));
    expect(payload.proposals[0].changes[0]).toMatchObject({ expected: 'Alpha', proposed: 'Équipe 👩🏽‍✈️', target: { kind: 'range', start: 11, end: 16 } });
    await info.attach('selected-feedback-return.json', { body: returned, contentType: 'application/json' });
    await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 2', exact: true }), 'Newer independent draft work.');
    modal = await reviews(page);
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'returned.json', mimeType: 'application/json', buffer: returned });
    await modal.getByRole('button', { name: 'Import reviewed feedback', exact: true }).click();await expect(modal.getByText(/Feedback imported/)).toBeVisible();
    await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Precise baseline' });
    const first = modal.getByRole('article', { name: 'Suggestion 1: Replace selected text', exact: true });
    await first.getByRole('button', { name: 'Accept suggestion', exact: true }).click();await expect(first.getByText(/· Accepted$/)).toBeVisible();
    const conflict = modal.getByRole('article', { name: 'Suggestion 2: Replace selected text', exact: true });
    await expect(conflict.getByRole('button', { name: 'Accept suggestion', exact: true })).toBeDisabled();
    await conflict.getByRole('button', { name: 'Reject suggestion', exact: true }).click();await expect(conflict.getByText(/· Rejected$/)).toBeVisible();
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`selected-text-${theme}.png`), scale: 'css' });
    await closeReviewRounds(modal);
    await action(page, 'Undo');
    const undone = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
    expect(undone.paragraphs[0].text).toBe('Keep Alpha Alpha ending.');expect(undone.paragraphs[1].text).toBe('Newer independent draft work.');
    await action(page, 'Redo');await page.reload();
    const reloaded = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
    expect(reloaded.paragraphs[0].text).toBe('Keep Alpha Équipe 👩🏽‍✈️ ending.');expect(reloaded.paragraphs[1].text).toBe('Newer independent draft work.');
    expect(reloaded.proposals).toBeUndefined();expect(JSON.stringify(reloaded)).not.toContain('Synthetic reviewer');
    modal = await reviews(page);await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Precise baseline' });
    await expect(modal.getByRole('article', { name: 'Suggestion 1: Replace selected text', exact: true }).getByText(/· Accepted$/)).toBeVisible();
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'repeated.json', mimeType: 'application/json', buffer: returned });
    await expect(modal.getByText(/This return has already been imported/)).toBeVisible();
  } finally { await context.close(); }
});
