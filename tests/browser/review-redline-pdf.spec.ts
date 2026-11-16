import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';

test.use({ serviceWorkers: 'block' });test.setTimeout(150_000);
async function reviews(page: Page) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Review rounds…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Review rounds', exact: true });
}
const unicode = 'Café 中文 العربية שלום 👩🏽‍🚀 e\u0301';
const rtlFirst = 'العربية שלום Café 中文 👩🏽‍🚀 e\u0301';
const longUnicode = 'Café naïve résumé — 中文 日本語 한국어 العربية שלום 👩🏽‍🚀 🧑‍💻 e\u0301';
for (const theme of ['light', 'dark', 'classic']) {
  test(`previews and downloads captured redline PDF with text moves and decisions in ${theme}`, async ({ page }, info) => {
    await page.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'scroll' } }));
    }, theme);
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({ name: 'redline-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
      formData: { subject: 'SYNTHETIC REDLINE', from: 'Original sender', to: 'Original recipient', classLevel: 'unclassified' },
      paragraphs: [{ id: 'redline-one', text: 'Original reviewed paragraph.', level: 0 }, { id: 'redline-move', text: 'Move source body.', level: 0 }, { id: 'redline-destination', text: 'Destination body.', level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [],
    })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    let modal = await reviews(page);
    await modal.getByLabel('Review name', { exact: true }).fill('Synthetic redline round');
    await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
    await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
    await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Synthetic redline round' });
    await modal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Synthetic reviewer');
    for (const [target, value] of [['To', 'ACCEPTED_RECIPIENT'], ['From', 'REJECTED_RETAINED'], ['Paragraph 1', `${unicode}\n${rtlFirst}\n${longUnicode}\n${'LongToken'.repeat(180)} PROPOSED_END`]]) {
      await modal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: target });
      await modal.getByLabel('Proposed replacement', { exact: true }).fill(value);
      await modal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
      await expect(modal.getByRole('status', { name: 'Suggestion submission status' })).toHaveText('Suggestion submitted to this review.');
    }
    await modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true }).getByRole('button', { name: 'Accept suggestion', exact: true }).click();
    await expect(modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true })).toContainText('Accepted');
    await modal.getByRole('article', { name: 'Suggestion 2: Replace from', exact: true }).getByRole('button', { name: 'Reject suggestion', exact: true }).click();
    await expect(modal.getByRole('article', { name: 'Suggestion 2: Replace from', exact: true })).toContainText('Rejected');
    await modal.getByLabel('Reviewed paragraph to move', { exact: true }).selectOption('redline-move');
    await modal.getByLabel('Destination sibling', { exact: true }).selectOption('redline-destination');
    await modal.getByRole('button', { name: 'Add move proposal', exact: true }).click();
    await expect(modal.getByText('Move proposal submitted. The reviewed document is unchanged.', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');await expect(modal).toBeHidden();
    await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 1', exact: true }), 'CURRENT_INDEPENDENT_EDIT');
    modal = await reviews(page);
    const report = modal.getByRole('article', { name: 'Review Synthetic redline round', exact: true }).getByRole('group', { name: 'Redline review PDF', exact: true });
    await report.getByRole('button', { name: 'Prepare redline PDF', exact: true }).click();
    await expect(report.getByRole('checkbox')).toBeVisible({ timeout: 45_000 });
    await expect(report.getByRole('button', { name: 'Open in browser tab', exact: true })).toHaveCount(0);
    await expect(report).toContainText('Accepted: 1 · Rejected: 1 · Open: 1 · Conflicting: 1');
    const button = report.getByRole('button', { name: 'Download reviewed redline (.pdf)', exact: true });await expect(button).toBeDisabled();
    await report.getByRole('checkbox').check();
    await report.scrollIntoViewIfNeeded();await page.screenshot({ path: info.outputPath(`redline-${theme}.png`), fullPage: true, scale: 'css' });
    const downloading = page.waitForEvent('download');await button.click();const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^review-redline-.*\.pdf$/);await download.saveAs(info.outputPath('redline.pdf'));
    const bytes = new Uint8Array(await readFile((await download.path())!));expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const task = getDocument({ data: bytes, useSystemFonts: false });const pdf = await task.promise;
    let text = '';try { expect(pdf.numPages).toBeGreaterThan(2);for (let i = 1; i <= pdf.numPages; i++) text += (await (await pdf.getPage(i)).getTextContent({ disableNormalization: true })).items.flatMap(item => 'str' in item ? [item.str, item.hasEOL ? ' ' : ''] : []).join('') + '\n'; } finally { await task.destroy(); }
    for (const value of ['REVIEW COPY', 'ACCEPTED_RECIPIENT', 'REJECTED_RETAINED', 'PROPOSED_END', 'CURRENT_INDEPENDENT_EDIT', 'MOVE', 'Move source body.', 'Destination body.', unicode, rtlFirst, longUnicode]) expect(text).toContain(value);
    await page.keyboard.press('Escape');await expect(modal).toBeHidden();
    expect(await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).innerText()).toContain('CURRENT_INDEPENDENT_EDIT');
    expect(await page.getByRole('textbox', { name: 'Paragraph 2', exact: true }).innerText()).toContain('Move source body.');
    expect(await page.getByRole('textbox', { name: 'Paragraph 3', exact: true }).innerText()).toContain('Destination body.');
  });
}
