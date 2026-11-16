import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';
import { closeReviewRounds } from '../_helpers/closeReviewRounds';

test.use({ serviceWorkers: 'block' });test.setTimeout(180_000);
async function action(page: Page, name: string) {
  const history = ['Undo', 'Redo'].includes(name);
  await page.getByRole('button', { name: history ? 'Document tools' : 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: history ? new RegExp(`^${name}`) : name, exact: true }).click();
}
async function reviews(page: Page) { await action(page, 'Review rounds…');return page.getByRole('dialog', { name: 'Review rounds', exact: true }); }
async function exportDraft(page: Page) {
  const pending = page.waitForEvent('download');await action(page, 'Export draft (.json)');
  return JSON.parse((await readFile((await (await pending).path())!)).toString('utf8'));
}
async function selectText(textarea: ReturnType<Page['getByRole']>, start: number, end: number) {
  await textarea.focus();await textarea.evaluate((element: HTMLTextAreaElement, offsets) => {
    element.setSelectionRange(offsets.start, offsets.end);element.dispatchEvent(new Event('select', { bubbles: true }));
  }, { start, end });await textarea.press('Shift');
}

for (const theme of ['light', 'dark', 'classic']) test(`range reconciliation preserves independent edits and resolves repeated text deliberately in ${theme}`, async ({ page }, info) => {
  await page.addInitScript(appearance => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: appearance, editorLayout: 'scroll' } }));
  }, theme);
  await page.goto('/');
  const text = 'Start red middle blue Alpha Alpha ending.';
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'SYNTHETIC RANGE RECONCILIATION', to: 'Training Office', classLevel: 'unclassified' },
    paragraphs: [{ id: 'range-body', text, level: 0 }, { id: 'other-body', text: 'Other saved author work.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('Range reconciliation baseline');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Range reconciliation baseline' });
  await modal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Synthetic reviewer');
  for (const [word, replacement] of [['red', 'scarlet'], ['blue', 'azure'], ['Alpha', 'Bravo']]) {
    await modal.getByLabel('Suggestion target', { exact: true }).selectOption('paragraph:range-body');
    const start = text.indexOf(word);
    await selectText(modal.getByRole('textbox', { name: 'Select text in reviewed paragraph', exact: true }), start, start + word.length);
    await modal.getByRole('button', { name: 'Use selected text', exact: true }).click();
    await modal.getByLabel('Proposed replacement', { exact: true }).fill(replacement);
    await modal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
    await expect(modal.getByRole('status', { name: 'Suggestion submission status', exact: true })).toContainText('Suggestion submitted');
  }
  await expect(modal.getByRole('article', { name: /^Suggestion / })).toHaveCount(3);
  await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();
  await closeReviewRounds(modal);
  await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 1', exact: true }), 'Newest red middle blue Alpha completed.');
  modal = await reviews(page);await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Range reconciliation baseline' });
  for (const index of [1, 2]) {
    const proposal = modal.getByRole('article', { name: `Suggestion ${index}: Replace selected text`, exact: true });
    await proposal.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
    await expect(proposal.getByText(/· Accepted$/)).toBeVisible();
  }
  const ambiguous = modal.getByRole('article', { name: 'Suggestion 3: Replace selected text', exact: true });
  await expect(ambiguous.getByRole('button', { name: 'Accept suggestion', exact: true })).toBeDisabled();
  await ambiguous.getByRole('button', { name: 'Reconcile suggestion', exact: true }).click();
  await expect(ambiguous.getByText(/current boundaries cannot be mapped safely/)).toBeVisible();
  await expect(ambiguous.getByRole('button', { name: 'Apply resolution', exact: true })).toBeDisabled();
  await ambiguous.getByRole('button', { name: 'Cancel reconciliation', exact: true }).click();
  await ambiguous.getByRole('button', { name: 'Reconcile suggestion', exact: true }).click();
  const scope = ambiguous.getByRole('textbox', { name: 'Select current text to resolve', exact: true });
  const current = await scope.inputValue(), start = current.indexOf('Alpha');
  await selectText(scope, start, start + 5);
  await ambiguous.getByRole('button', { name: 'Use current selection', exact: true }).click();
  await ambiguous.getByRole('button', { name: 'Use proposed text', exact: true }).click();
  await expect(ambiguous.getByRole('textbox', { name: 'Resolved replacement', exact: true })).toHaveValue('Bravo');
  await ambiguous.getByRole('textbox', { name: 'Resolved replacement', exact: true }).fill('Équipe 👩🏽‍✈️');
  await ambiguous.getByRole('button', { name: 'Apply resolution', exact: true }).click();
  await expect(ambiguous.getByText(/· Accepted$/)).toBeVisible();
  await expect(ambiguous.getByText('Équipe 👩🏽‍✈️', { exact: true })).toHaveCount(2);
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`range-resolution-${theme}.png`), scale: 'css' });
  await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();
  await closeReviewRounds(modal);await action(page, 'Undo');
  const undone = await exportDraft(page);expect(undone.paragraphs[0].text).toBe('Newest scarlet middle azure Alpha completed.');
  expect(undone.paragraphs[1].text).toBe('Other saved author work.');
  await action(page, 'Redo');await page.reload();
  const reloaded = await exportDraft(page);expect(reloaded.paragraphs[0].text).toBe('Newest scarlet middle azure Équipe 👩🏽‍✈️ completed.');
  expect(JSON.stringify(reloaded)).not.toContain('Synthetic reviewer');expect(reloaded.reviewSuggestions).toBeUndefined();
  modal = await reviews(page);await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Range reconciliation baseline' });
  await expect(modal.getByRole('article', { name: 'Suggestion 3: Replace selected text', exact: true }).getByText(/· Accepted$/)).toBeVisible();
});
