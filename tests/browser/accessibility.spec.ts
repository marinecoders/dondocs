import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

async function scan(page: Page, info: TestInfo, state: string) {
  // Default axe rules, full current page including every visible overlay.
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page }).analyze();
  await info.attach(`${state}-axe`, { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), state).toEqual([]);
}

async function previewReady(page: Page, projectName: string) {
  if (projectName !== 'desktop') return;
  const preview = page.locator('.workspace-preview');
  await expect(preview.locator(':scope > [aria-live="polite"]')).toHaveText('Compilation complete', { timeout: 60_000 });
  const pageNumber = preview.getByRole('textbox', { name: 'Page number', exact: true });
  await expect(pageNumber).toBeEnabled({ timeout: 30_000 });
  await expect(pageNumber).toHaveCSS('opacity', '1');
}

async function keyboardOpen(control: Locator) {
  await control.focus();
  await expect(control).toBeFocused();
  await control.press('Enter');
}

async function containedFocus(page: Page, dialog: Locator) {
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  // Visit a complete forward cycle, then cross its reverse boundary.
  await page.keyboard.press('Tab');
  const focusIndex = () => dialog.evaluate(element => [...element.querySelectorAll('*')].indexOf(document.activeElement as Element));
  const first = await focusIndex();
  expect(first).toBeGreaterThanOrEqual(0);
  let cycled = false;
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press('Tab');
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    if (await focusIndex() === first) { cycled = true; break; }
  }
  expect(cycled, 'Tab must wrap within the dialog').toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await focusIndex()).toBe(first);
}

async function action(page: Page, name: string) {
  await keyboardOpen(page.getByRole('button', { name: 'Document actions', exact: true }));
  await page.getByRole('menuitem', { name: name === 'Save checkpoint' ? /^Save checkpoint/ : name, exact: name !== 'Save checkpoint' }).press('Enter');
}

const letter = 'From: Example sender\nTo: Example recipient\nSubj: ACCESSIBILITY SAMPLE\n\n1. First fictional training paragraph.\n\nA. EXAMPLE';

for (const theme of ['light', 'dark', 'classic']) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }, info) => {
      await page.addInitScript(appearance => {
        localStorage.setItem('browser-test-visitor', 'returning');
        localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: appearance, editorLayout: 'scroll' } }));
      }, theme);
      await page.goto('/');
      await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toBeVisible();
      await previewReady(page, info.project.name);
    });

    test('History comparison and document, field and paragraph comments keep keyboard access', async ({ page }, info) => {
      const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
      await subject.fill('EARLIER ACCESSIBILITY SUBJECT');
      await action(page, 'Save checkpoint');
      await expect(page.getByRole('status').filter({ hasText: /checkpoint/i })).toBeVisible();
      await subject.fill('CURRENT ACCESSIBILITY SUBJECT');
      await previewReady(page, info.project.name);
      const historyButton = page.getByRole('button', { name: 'History', exact: true });
      await keyboardOpen(historyButton);
      const history = page.getByRole('dialog', { name: 'Version history', exact: true });
      const select = history.getByRole('combobox', { name: 'Saved version', exact: true });
      if (info.project.name === 'phone') {
        await expect(select).toBeEnabled();
        await select.selectOption('0');
        await expect(select).toHaveValue('0');
      } else {
        const version = history.getByRole('button', { name: /^Compare version 1 from/ });
        await keyboardOpen(version);
        await expect(version).toHaveAttribute('aria-pressed', 'true');
      }
      await expect(history.getByRole('button', { name: 'Restore selected version', exact: true })).toBeEnabled();
      await expect(history.getByRole('region', { name: 'Version comparison', exact: true })).toContainText('EARLIER ACCESSIBILITY SUBJECT');
      await containedFocus(page, history);
      await scan(page, info, 'history-comparison');
      await page.screenshot({ path: info.outputPath('history-comparison.png') });
      await page.keyboard.press('Escape');
      await expect(history).toBeHidden();
      await expect(historyButton).toBeFocused();
      await expect(subject).toHaveValue('CURRENT ACCESSIBILITY SUBJECT');

      const commentsButton = page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ });
      await subject.fill('Synthetic long field '.repeat(1_001));
      if (info.project.name === 'desktop') {
        // The context-limit fixture also exceeds the printable address block.
        const compileError = page.getByRole('dialog', { name: 'Preview compile failed', exact: true });
        await expect(compileError).toBeVisible({ timeout: 60_000 });
        const compileLog = compileError.getByRole('region', { name: 'Compile error log', exact: true });
        await expect(compileLog).toContainText('Address block is too tall');
        await compileLog.focus();
        await expect(compileLog).toBeFocused();
        await compileLog.press('End');
        await expect.poll(() => compileLog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await containedFocus(page, compileError);
        await scan(page, info, 'oversized-field-preview-error');
        await page.screenshot({ path: info.outputPath('oversized-field-preview-error.png') });
        await page.keyboard.press('Escape');
        await expect(compileError).toBeHidden();
        await expect(subject).toBeFocused();
      }
      await keyboardOpen(commentsButton);
      const comments = page.getByRole('dialog', { name: 'Document comments', exact: true });
      const post = comments.getByRole('button', { name: 'Post comment', exact: true });
      await comments.getByLabel('Comment on', { exact: true }).selectOption('subject');
      await comments.getByRole('textbox', { name: 'Reviewer name', exact: true }).fill('Example reviewer');
      await comments.getByRole('textbox', { name: 'Comment', exact: true }).fill('Review this field.');
      await expect(post).toBeDisabled();
      await expect(comments.getByRole('alert')).toContainText('too long to capture');
      await expect(comments.getByLabel('Comment on', { exact: true })).toHaveAttribute('aria-invalid', 'true');
      await expect(comments.getByLabel('Comment on', { exact: true })).toHaveAccessibleDescription(/too long to capture/);
      const context = comments.getByRole('region', { name: 'Current field value', exact: true });
      await context.focus();
      await context.press('End');
      await expect.poll(() => context.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await scan(page, info, 'comment-target-error');
      await page.keyboard.press('Escape');
      await expect(comments).toBeHidden();
      await subject.fill('CURRENT ACCESSIBILITY SUBJECT');
      await previewReady(page, info.project.name);
      await keyboardOpen(commentsButton);
      await expect(post).toBeDisabled();
      for (const [target, label] of [['document', 'Whole document'], ['subject', 'Subject'], ['paragraph:0', 'Paragraph 1']]) {
        const targets = comments.getByLabel('Comment on', { exact: true });
        if (target === 'paragraph:0') await targets.selectOption({ label: 'Paragraph 1' });
        else await targets.selectOption(target);
        await comments.getByRole('textbox', { name: 'Reviewer name', exact: true }).fill('Example reviewer');
        await comments.getByRole('textbox', { name: 'Comment', exact: true }).fill(`Review the ${label}.`);
        await keyboardOpen(post);
        const feedback = comments.getByRole('status');
        await expect(feedback).toContainText('Comment changes saved');
        await expect(feedback).toBeFocused();
        await expect(comments.getByRole('article', { name: `Comment on ${label}`, exact: true })).toBeVisible();
      }
      await containedFocus(page, comments);
      await comments.getByText('Field context', { exact: true }).press('Enter');
      await comments.getByText('Paragraph context', { exact: true }).press('Enter');
      await scan(page, info, 'comments-open');
      const paragraphThread = comments.getByRole('article', { name: 'Comment on Paragraph 1', exact: true });
      await keyboardOpen(paragraphThread.getByRole('button', { name: 'Reply', exact: true }));
      await expect(comments.getByRole('textbox', { name: 'Reply', exact: true })).toBeFocused();
      await expect(comments.getByRole('button', { name: 'Post reply', exact: true })).toBeDisabled();
      await scan(page, info, 'comment-reply');
      await keyboardOpen(comments.getByRole('button', { name: 'Cancel edit', exact: true }));
      await keyboardOpen(paragraphThread.getByRole('button', { name: 'Resolve', exact: true }));
      await expect(comments.getByRole('status')).toBeFocused();
      const resolved = comments.getByRole('button', { name: 'Resolved (1)', exact: true });
      await keyboardOpen(resolved);
      await expect(resolved).toHaveAttribute('aria-pressed', 'true');
      await scan(page, info, 'comments-resolved');
      await page.screenshot({ path: info.outputPath('comments-resolved.png') });
      await keyboardOpen(paragraphThread.getByRole('button', { name: 'Go to paragraph', exact: true }));
      await expect(comments).toBeHidden();
      await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toBeFocused();
      await keyboardOpen(commentsButton);
      await page.keyboard.press('Escape');
      await expect(comments).toBeHidden();
      await expect(commentsButton).toBeFocused();
    });

    test('export progress and failure dialogs announce state and allow keyboard recovery', async ({ page }, info) => {
      // Hold the real engine request to inspect progress, then fail the resource.
      let failEngine: (() => void) | undefined;
      const waiting = new Promise<void>(resolve => { failEngine = resolve; });
      await page.route('**/lib/pandoc/pandoc.js*', async route => { await waiting; await route.abort('failed'); });
      await page.reload();
      await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toBeVisible();
      await previewReady(page, info.project.name);
      await keyboardOpen(page.getByRole('button', { name: 'Download', exact: true }));
      await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).press('Enter');
      const progress = page.getByRole('dialog');
      try {
        await expect(progress).toBeVisible();
        await expect(progress).toHaveAccessibleName(/engine|Word|DOCX/i);
        await containedFocus(page, progress);
        await page.keyboard.press('Escape');
        await expect(progress).toBeVisible();
        await scan(page, info, 'export-progress');
      } finally { failEngine?.(); }
      const failure = page.getByRole('dialog', { name: 'DOCX download failed', exact: true });
      await expect(failure).toBeVisible();
      await expect(failure.getByRole('alert')).toContainText(/failed|could|load|fetch|import/i);
      await containedFocus(page, failure);
      await scan(page, info, 'export-error');
      await page.screenshot({ path: info.outputPath('export-error.png') });
      await page.keyboard.press('Escape');
      await expect(failure).toBeHidden();
      await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeFocused();
    });

    test('import exposes names, errors and keyboard focus through review', async ({ page }, info) => {
      await scan(page, info, 'editor');
      await action(page, 'Import letter…');
      const dialog = page.getByRole('dialog', { name: 'Import a letter', exact: true });
      await expect(dialog.getByLabel('Choose a PDF or Word file', { exact: true })).toBeAttached();
      await containedFocus(page, dialog);
      await scan(page, info, 'import-file');
      await dialog.getByLabel('Choose a PDF or Word file', { exact: true }).setInputFiles({ name: 'legacy.doc', mimeType: 'application/msword', buffer: Buffer.from('Synthetic unsupported document') });
      await expect(dialog.getByRole('alert')).toContainText('Legacy Word');
      await scan(page, info, 'import-file-error');
      await keyboardOpen(dialog.getByRole('button', { name: 'Choose a different file', exact: true }));
      await keyboardOpen(dialog.getByRole('button', { name: 'Paste letter text', exact: true }));
      const input = dialog.getByRole('textbox', { name: 'Paste letter text', exact: true });
      await expect(input).toBeFocused();
      const read = dialog.getByRole('button', { name: 'Read letter', exact: true });
      await expect(read).toBeDisabled();
      await input.fill('unrecognized');
      await keyboardOpen(read);
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toHaveAccessibleDescription(/Couldn't recognize/);
      await expect(dialog.getByRole('alert')).toContainText('Check that you pasted the full letter');
      await scan(page, info, 'import-error');
      await input.fill(letter);
      await expect(input).toHaveAttribute('aria-invalid', 'false');
      await keyboardOpen(read);
      await expect(dialog.getByRole('combobox', { name: 'Document type', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Import into editor', exact: true })).toBeEnabled();
      await scan(page, info, 'import-review');
      await page.screenshot({ path: info.outputPath('import-review.png') });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('button', { name: 'Document actions', exact: true })).toBeFocused();
    });
  });
}

test('the scan gate rejects a genuine unnamed interactive control', async ({ page }, info) => {
  await page.setContent('<html lang="en"><head><title>Negative accessibility fixture</title></head><body><main><h1>Fixture</h1><button></button></main></body></html>');
  // Exercise the same rejecting assertion used for application scans.
  await expect(scan(page, info, 'negative-control')).rejects.toThrow(/button-name/);
});
