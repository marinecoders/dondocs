import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { wordImportFixture, wordParagraph, wordRun, WORD_NS } from '../_helpers/wordImportFixture';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
const start = (id: number) => `<w:commentRangeStart w:id="${id}"/>`;
const end = (id: number) => `<w:commentRangeEnd w:id="${id}"/>`;
const definition = (id: number, text: string) => `<w:comment w:id="${id}" w:author="Chief Example" w:date="2026-11-16T10:30:00Z">${wordParagraph(text)}</w:comment>`;

async function importWord(page: Page, buffer: Uint8Array) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import letter…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a letter', exact: true });
  await dialog.getByLabel('Choose a PDF or Word file', { exact: true }).setInputFiles({
    name: 'fictional-word-comments.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(buffer),
  });
  await expect(dialog.getByText('Word comments', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Word import notices')).toContainText('author names and dates are unverified');
  await dialog.getByRole('button', { name: 'Import into editor', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

for (const theme of ['light', 'dark', 'classic'] as const) {
  test(`Word comments preserve exact plain selections and explicit formatted paragraph discussions in ${theme}`, async ({ page }, info) => {
    await page.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'scroll' } }));
    }, theme);
    await page.goto('/');
    const body = `${wordParagraph('From: Training Office')}${wordParagraph('To: Fictional Marine')}${wordParagraph('Subj: WORD COMMENT REVIEW')}<w:p>${wordRun('Purpose', '<w:b/>')}${wordRun(' before ')}${start(1)}${wordRun('formatted selection')}${end(1)}${wordRun(' after.')}</w:p><w:p>${wordRun('Before ')}${start(2)}${wordRun('plain selected words')}${end(2)}${wordRun(' after.')}</w:p>`;
    const source = await wordImportFixture(body, {
      'word/comments.xml': `<w:comments xmlns:w="${WORD_NS}">${definition(1, 'REVIEW_NOTE_FORMATTED: check the formatted paragraph.')}${definition(2, 'REVIEW_NOTE_PLAIN: check these words.')}</w:comments>`,
    });
    await importWord(page, source);
    await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).locator('strong')).toHaveText('Purpose');
    await page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Document comments', exact: true });
    const formatted = dialog.getByRole('article', { name: 'Comment on Paragraph 1', exact: true });
    await expect(formatted).toContainText('not an exact native text anchor');
    await expect(formatted).toContainText('Word selection: “formatted selection”');
    await expect(formatted.getByRole('button', { name: 'Go to paragraph', exact: true })).toBeVisible();
    await expect(formatted.getByRole('button', { name: 'Go to selected text', exact: true })).toHaveCount(0);
    const precise = dialog.getByRole('article', { name: 'Comment on Selected text in paragraph 2', exact: true });
    await expect(precise.getByLabel('Commented text', { exact: true })).toHaveText('plain selected words');
    await expect(precise).toContainText('Chief Example (Word, unverified)');
    await precise.getByRole('button', { name: 'Reply', exact: true }).click();
    await dialog.getByLabel('Reviewer name', { exact: true }).fill('Drafter');
    await dialog.getByLabel('Reply', { exact: true }).fill('The imported Word discussion is actionable.');
    await dialog.getByRole('button', { name: 'Post reply', exact: true }).click();
    await precise.getByRole('button', { name: 'Go to selected text', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Paragraph 2', exact: true })).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('plain selected words');
    await page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ }).click();
    await precise.getByRole('button', { name: 'Resolve', exact: true }).click();
    await dialog.getByRole('button', { name: 'Close comments', exact: true }).click();
    const saving = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
    const draft = JSON.parse(await readFile((await (await saving).path())!, 'utf8'));
    expect(draft.reviewComments.threads).toHaveLength(2);
    expect(Buffer.from(draft.wordSourceFile.data, 'base64')).toEqual(Buffer.from(source));
    await page.reload();
    await page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ }).click();
    await expect(formatted).toContainText('Word selection: “formatted selection”');
    await dialog.getByRole('button', { name: 'Resolved (1)', exact: true }).click();
    await expect(precise).toContainText('The imported Word discussion is actionable.');
    await expect(precise.getByLabel('Commented text', { exact: true })).toHaveText('plain selected words');
    await page.screenshot({ path: info.outputPath('word-comments.png'), fullPage: true });
  });
}
