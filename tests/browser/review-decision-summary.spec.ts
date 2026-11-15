import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';

test.use({ serviceWorkers: 'block' });
test.setTimeout(150_000);
async function reviews(page: Page) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Review rounds…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Review rounds', exact: true });
}

for (const theme of ['light', 'dark', 'classic']) {
  test(`downloads exact captured review decisions and pending discussions in ${theme}`, async ({ page }, info) => {
    await page.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'scroll' } }));
    }, theme);
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({ name: 'summary-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
      formData: { subject: 'CAPTURED SUMMARY SUBJECT', from: 'Original sender', to: 'Original recipient', classLevel: 'unclassified' },
      paragraphs: [{ id: 'summary-first', text: 'First body.', level: 0 }, { id: 'summary-second', text: 'Second body.', level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [],
    })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    let modal = await reviews(page);
    await modal.getByLabel('Review name', { exact: true }).fill('Summary qualification round');
    await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
    await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
    await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Summary qualification round' });
    await modal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Reviewer <Example>');
    for (const [target, value, category] of [
      ['To', 'Accepted recipient', 'required-correction'], ['From', 'Rejected sender', 'edit'],
      ['Subject', 'Open proposed subject', 'question'], ['Paragraph 2', 'Reviewer replacement body', 'edit'],
    ]) {
      await modal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: target });
      await modal.getByLabel('Suggestion category', { exact: true }).selectOption(category);
      await modal.getByLabel('Proposed replacement', { exact: true }).fill(value);
      await modal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
      await expect(modal.getByRole('status', { name: 'Suggestion submission status' })).toHaveText('Suggestion submitted to this review.');
    }
    await modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true }).getByRole('button', { name: 'Accept suggestion', exact: true }).click();
    await expect(modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true })).toContainText('Accepted');
    await modal.getByRole('article', { name: 'Suggestion 2: Replace from', exact: true }).getByRole('button', { name: 'Reject suggestion', exact: true }).click();
    await expect(modal.getByRole('article', { name: 'Suggestion 2: Replace from', exact: true })).toContainText('Rejected');
    await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 2', exact: true }), 'Independent current body creates a conflict.');
    await page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ }).click();
    const comments = page.getByRole('dialog', { name: 'Document comments', exact: true });
    await comments.getByLabel('Reviewer name', { exact: true }).fill('Discussion reviewer');
    await comments.getByLabel('Comment', { exact: true }).fill('PENDING_DISCUSSION_END SSN 234-56-7890 <script>unsafe()</script>');
    await comments.getByRole('button', { name: 'Post comment', exact: true }).click();
    await comments.getByRole('button', { name: 'Close comments', exact: true }).click();
    // Deliberately do not wait for autosave before preparing the report.
    modal = await reviews(page);
    const report = modal.getByRole('article', { name: 'Review Summary qualification round', exact: true }).getByRole('group', { name: 'Review decision summary', exact: true });
    let release!: () => void;
    let entered!: () => void;
    const requested = new Promise<void>(resolve => { entered = resolve; });
    let hold = true;
    await page.route('**/classification.config.json?deployment-policy=runtime*', async route => {
      if (hold) { hold = false;entered();await new Promise<void>(resolve => { release = resolve; }); }
      await route.continue();
    });
    await report.getByRole('button', { name: 'Prepare decision summary', exact: true }).click();
    await requested;
    // A queued editor input can arrive after capture while policy is loading.
    // Use the real React change handler and verify the saved draft below.
    await page.locator('#subject').evaluate(element => {
      const input = element as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'LATE EDIT EXCLUDED FROM SUMMARY');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    release();
    await expect(report).toContainText('Accepted: 1 · Rejected: 1 · Open: 1 · Conflicting: 1');
    await expect(report.getByRole('status')).toContainText('Social Security Number');
    const button = report.getByRole('button', { name: 'Download reviewed decision summary (.html)', exact: true });
    const downloading = page.waitForEvent('download');
    await button.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^review-decisions-.*\.html$/);
    const html = await readFile((await download.path())!, 'utf8');
    for (const text of ['Accepted: 1 · Rejected: 1 · Open: 1 · Conflicting: 1', 'Accepted recipient', 'Rejected sender', 'Open proposed subject', 'Independent current body', 'PENDING_DISCUSSION_END', '234-56-7890', 'Captured draft record SHA-256:', 'REVIEW DERIVATIVE']) expect(html).toContain(text);
    expect(html).not.toContain('LATE EDIT EXCLUDED');expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;unsafe()');expect(html).toContain('Reviewer &lt;Example&gt;');
    const artifact = await page.context().newPage();
    await artifact.setContent(html);
    await expect(artifact.getByRole('heading', { name: 'Review decision summary', exact: true })).toBeVisible();
    expect(await artifact.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true);
    await artifact.screenshot({ path: info.outputPath(`summary-${theme}.png`), fullPage: true, scale: 'css' });
    await artifact.close();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    const draftDownload = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
    const draft = JSON.parse(await readFile((await (await draftDownload).path())!, 'utf8'));
    expect(draft.formData.subject).toBe('LATE EDIT EXCLUDED FROM SUMMARY');
    expect(draft.formData.to).toBe('Accepted recipient');expect(draft.formData.from).toBe('Original sender');
  });
}
