import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { closeReviewRounds } from '../_helpers/closeReviewRounds';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
const changed = (id: number, before: string, proposed: string, properties = '') => `<w:del w:id="${id}" w:author="Training Chief">${wordRun(before, properties).replaceAll('w:t', 'w:delText')}</w:del><w:ins w:id="${id + 1}" w:author="Training Chief">${wordRun(proposed, properties)}</w:ins>`;
async function action(page: Page, name: string) {
  await page.getByRole('button', { name: name === 'Undo' || name === 'Redo' ? 'Document tools' : 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: name === 'Undo' || name === 'Redo' ? new RegExp(`^${name}`) : name, exact: true }).click();
}
async function download(page: Page, operate: () => Promise<unknown>) {
  const pending = page.waitForEvent('download'); await operate();
  const result = await pending; expect(await result.failure()).toBeNull();
  return readFile((await result.path())!);
}
async function reviews(page: Page) {
  await page.getByRole('button', { name: 'Review imported Word edits', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Review rounds', exact: true });
  await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Word tracked text: fictional-tracked.docx' });
  return modal;
}
for (const theme of ['light', 'dark', 'classic'] as const) test(`Word tracked text uses native decisions and deliberate newer-draft reconciliation in ${theme}`, async ({ page, browserName }, info) => {
  const errors: string[] = [];
  let resizeDeferrals = 0;
  page.on('pageerror', error => {
    // WebKit can report a resize notification deferred to a later rendering update.
    if (browserName === 'webkit' && error.message === 'ResizeObserver loop completed with undelivered notifications.') {
      resizeDeferrals++;
    } else {
      errors.push(error.message);
    }
  });
  await page.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'scroll', previewVisible: false } }));
  }, theme);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('PRIOR TRACKED DRAFT');
  const source = await wordImportFixture(`${wordParagraph('From: Training Office')}${wordParagraph('To: Fictional Marine')}${wordParagraph('Subj: WORD TRACKED REVIEW')}`
    + `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${wordRun('Purpose')}</w:p>`
    + `<w:p>${wordRun('1. Before ')}${changed(1, 'old', 'new', '<w:b/>')}${wordRun(' after.')}</w:p>`
    + `<w:p>${wordRun('2. ')}${changed(3, 'Alpha', 'Bravo')}${wordRun(' team reports on Friday.')}</w:p>`
    + `<w:p>${wordRun('3. Approve ')}${changed(5, 'original', 'reviewer')}${wordRun(' wording.')}</w:p>`
    + `<w:p>${wordRun('4. Keep ')}${changed(7, 'obsolete ', '')}${wordRun('text.')}</w:p>`);
  await action(page, 'Import letter…');
  const importing = page.getByRole('dialog', { name: 'Import a letter', exact: true });
  await importing.getByLabel('Choose a PDF or Word file', { exact: true }).setInputFiles({ name: 'fictional-tracked.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(source) });
  await expect(importing.getByText('Readable tracked paragraphs', { exact: true })).toBeVisible();
  await expect(importing.getByLabel('Word import notices')).toContainText('Author names, dates and Word revision IDs are unverified');
  await importing.getByRole('button', { name: 'Import into editor', exact: true }).click();
  await expect(importing).toBeHidden({ timeout: 30_000 });
  const formatted = page.getByRole('textbox', { name: 'Paragraph 2', exact: true });
  await expect(formatted.locator('strong')).toHaveText('old');
  let modal = await reviews(page);
  const first = modal.getByRole('article', { name: 'Suggestion 1: Word tracked paragraph text', exact: true });
  await expect(first).toContainText('Training Chief (Word, unverified)');
  await first.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
  await expect(first.getByText(/· Accepted$/)).toBeVisible();
  await closeReviewRounds(modal, 'close-button');
  await expect(formatted.locator('strong')).toHaveText('new');
  await action(page, 'Undo'); await expect(formatted.locator('strong')).toHaveText('old');
  await action(page, 'Redo'); await expect(formatted.locator('strong')).toHaveText('new');

  await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 3', exact: true }), 'Alpha team reports on Monday.');
  await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 4', exact: true }), 'Approve author wording.');
  modal = await reviews(page);
  const independent = modal.getByRole('article', { name: 'Suggestion 2: Word tracked paragraph text', exact: true });
  await expect(independent.getByRole('button', { name: 'Accept suggestion', exact: true })).toBeDisabled();
  await independent.getByRole('button', { name: 'Reconcile suggestion', exact: true }).click();
  await expect(independent.getByText('Independent edits can be combined. Review the complete result before applying it.', { exact: true })).toBeVisible();
  await expect(independent.getByLabel('Resolved replacement', { exact: true })).toHaveValue('Bravo team reports on Monday.');
  await independent.getByRole('button', { name: 'Apply resolution', exact: true }).click();
  await expect(independent.getByText(/· Accepted$/)).toBeVisible();
  const overlap = modal.getByRole('article', { name: 'Suggestion 3: Word tracked paragraph text', exact: true });
  await expect(overlap.getByRole('button', { name: 'Accept suggestion', exact: true })).toBeDisabled();
  await overlap.getByRole('button', { name: 'Reconcile suggestion', exact: true }).click();
  await expect(overlap.getByText(/These edits overlap/)).toBeVisible();
  await overlap.getByRole('button', { name: 'Keep current text', exact: true }).click();
  await overlap.getByRole('button', { name: 'Apply resolution', exact: true }).click();
  await expect(overlap.getByText(/· Accepted$/)).toBeVisible();
  const rejected = modal.getByRole('article', { name: 'Suggestion 4: Word tracked paragraph text', exact: true });
  await rejected.getByRole('button', { name: 'Reject suggestion', exact: true }).click();
  await expect(rejected.getByText(/· Rejected$/)).toBeVisible();
  await expect(modal.getByLabel('Review name', { exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('word-tracked-review.png'), fullPage: true });
  await closeReviewRounds(modal, 'close-button');
  const draft = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString());
  expect(draft.paragraphs[0].header).toBe('Purpose');
  expect(draft.paragraphs.slice(1).map((paragraph: { text: string }) => paragraph.text)).toEqual(['Before **new** after.', 'Bravo team reports on Monday.', 'Approve author wording.', 'Keep obsolete text.']);
  expect(Buffer.from(draft.wordSourceFile.data, 'base64')).toEqual(Buffer.from(source));
  await writeFile(info.outputPath('word-tracked-result.json'), JSON.stringify(draft, null, 2));
  await page.reload();
  await expect(formatted.locator('strong')).toHaveText('new');
  modal = await reviews(page);
  await expect(modal.getByRole('article', { name: 'Suggestion 4: Word tracked paragraph text', exact: true })).toContainText('Rejected');
  await closeReviewRounds(modal, 'close-button');
  expect(await download(page, () => page.getByRole('button', { name: 'Download original Word file', exact: true }).click())).toEqual(Buffer.from(source));
  expect(errors).toEqual([]);
  expect(resizeDeferrals, 'repeated WebKit ResizeObserver delivery errors').toBeLessThanOrEqual(1);
});
