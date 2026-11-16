import { expect, test, type Locator } from '@playwright/test';
import type { Editor } from '@tiptap/core';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';

test.use({ serviceWorkers: 'block' });
test.setTimeout(180_000);
async function selectWords(editor: Locator, start: number, end: number) {
  await editor.focus();
  await editor.evaluate((element, offsets) => {
    const text = element.querySelector('p')?.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Expected a plain native paragraph');
    const range = document.createRange();
    range.setStart(text, offsets.start);range.setEnd(text, offsets.end);
    const selection = window.getSelection();
    selection?.removeAllRanges();selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { start, end });
}
for (const theme of ['light', 'dark', 'classic'] as const) {
  test(`selected word comments, deliberate reattachment and reload in ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript(theme => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme, editorLayout: 'scroll' }, version: 1 }));
    }, theme);
    await page.goto('/');
    const text = 'Before selected words after.';
    await page.getByLabel('Import draft file').setInputFiles({ name: 'selected-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
      formData: { subject: 'SELECTED TEXT CHECK', from: 'Commanding Officer', to: 'Training Officer', date: '15 Nov 26', sigLast: 'DOE' },
      paragraphs: [{ id: 'selected-first', text, level: 0 }, { id: 'selected-second', text, level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [],
    })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Paragraph 2', exact: true });
    await selectWords(editor, 7, 21);
    const launch = page.getByRole('button', { name: 'Comment on selection in paragraph 2', exact: true });
    await expect(launch).toBeEnabled();
    await launch.click();
    const dialog = page.getByRole('dialog', { name: 'Document comments', exact: true });
    await expect(dialog.getByLabel('Selected text', { exact: true })).toHaveText('selected words');
    await dialog.getByLabel('Reviewer name', { exact: true }).fill('Chief');
    await dialog.getByLabel('Comment', { exact: true }).fill('Review only these two words.');
    await dialog.getByRole('button', { name: 'Post comment', exact: true }).click();
    await expect(dialog.getByLabel('Commented text', { exact: true })).toHaveText('selected words');
    await dialog.getByRole('button', { name: 'Reply', exact: true }).click();
    await dialog.getByLabel('Reviewer name', { exact: true }).fill('Drafter');
    await dialog.getByLabel('Reply', { exact: true }).fill('Checked this exact quote.');
    await dialog.getByRole('button', { name: 'Post reply', exact: true }).click();
    await dialog.getByRole('button', { name: 'Go to selected text', exact: true }).click();
    await expect(editor).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('selected words');
    await editor.click({ position: { x: 1, y: 8 } });
    await expect.poll(() => page.evaluate(() => ({ collapsed: window.getSelection()?.isCollapsed, offset: window.getSelection()?.anchorOffset }))).toEqual({ collapsed: true, offset: 0 });
    await expect.poll(() => editor.evaluate(element => {
      const { from, to } = (element as HTMLElement & { editor: Editor }).editor.state.selection;
      return { from, to };
    })).toEqual({ from: 1, to: 1 });
    await page.keyboard.type('New ');
    await expect(editor).toHaveText('New ' + text);
    await page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ }).click();
    await expect(dialog.getByRole('article')).toContainText('Checked this exact quote.');
    await expect(dialog.getByRole('button', { name: 'Go to selected text', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close comments', exact: true }).click();
    await replaceParagraphText(editor, 'Before replacement words after.');
    await selectWords(editor, 7, 24);
    await launch.click();
    const selector = dialog.getByLabel('Reattach an existing detached discussion', { exact: true });
    await selector.selectOption({ label: 'Review only these two words.' });
    await expect(dialog.getByLabel('Earlier selected text', { exact: true })).toHaveText('selected words');
    await dialog.getByRole('button', { name: 'Reattach selected discussion', exact: true }).click();
    await expect(dialog.getByRole('article')).toHaveCount(1);
    await expect(dialog.getByLabel('Commented text', { exact: true })).toHaveText('replacement words');
    await dialog.getByRole('button', { name: 'Resolve', exact: true }).click();
    await dialog.getByRole('button', { name: 'Resolved (1)', exact: true }).click();
    await expect(dialog.getByRole('article')).toContainText('Earlier selected targets (1)');
    await page.screenshot({ path: testInfo.outputPath(`selected-text-comments-${theme}.png`) });
    await dialog.getByRole('button', { name: 'Close comments', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /Unsaved changes|Saving/ })).toHaveCount(0);
    await expect(page.getByText(/^Saved(?: ·.*)?$/)).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ }).click();
    await dialog.getByRole('button', { name: 'Resolved (1)', exact: true }).click();
    await expect(dialog.getByLabel('Commented text', { exact: true })).toHaveText('replacement words');
    await expect(dialog.getByRole('article')).toContainText('Checked this exact quote.');
    await expect(dialog.getByRole('article')).toHaveCount(1);
  });
}
