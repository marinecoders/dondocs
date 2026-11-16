import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

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
async function select(editor: Locator, start: number, end = start) {
  await editor.focus();await editor.evaluate((element: HTMLTextAreaElement, span) => {
    element.setSelectionRange(span.start, span.end);element.dispatchEvent(new Event('select', { bubbles: true }));
  }, { start, end });
}
for (const theme of ['light', 'dark', 'classic']) test(`natural typed suggestions return, apply and Undo in ${theme}`, async ({ page, browser, baseURL }, info) => {
  const init = (appearance: string) => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: appearance, editorLayout: 'scroll' } }));
  };
  await page.addInitScript(init, theme);await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'SYNTHETIC TYPED REVIEW', to: 'Training Office', classLevel: 'unclassified' },
    paragraphs: [{ id: 'typed-one', text: 'Keep Alpha Alpha ending.', level: 0 }, { id: 'typed-two', text: 'Delete word please.', level: 0 },
      { id: 'typed-three', text: 'Paste here.', level: 0 }, { id: 'typed-rich', text: '{{SyntheticVariable}}', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'typing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('Typing baseline');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  const copy = await download(page, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());
  await page.keyboard.press('Escape');
  const context = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent),
    serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
  try {
    await context.addInitScript(init, theme);const reviewer = await context.newPage();await reviewer.goto(baseURL!);
    let remote = await reviews(reviewer);
    await remote.getByLabel('Import reviewer copy', { exact: true }).setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: copy });
    await remote.getByRole('button', { name: 'Open as new review copy', exact: true }).click();await expect(remote).toBeHidden();remote = await reviews(reviewer);
    await remote.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Typing baseline' });
    await expect(remote.getByRole('button', { name: 'Suggest Changes mode', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await remote.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Synthetic typed reviewer');
    await remote.getByRole('button', { name: 'Suggest Changes mode', exact: true }).click();
    const paragraph = remote.getByLabel('Paragraph for suggested typing', { exact: true });
    await expect(paragraph.getByRole('option', { name: 'Paragraph 4 (unsupported content)' })).toBeDisabled();
    await paragraph.selectOption('typed-one');const editor = remote.getByRole('textbox', { name: 'Suggested paragraph text', exact: true });
    await select(editor, 11);await editor.pressSequentially('new ');
    await expect(editor).toHaveValue('Keep Alpha new Alpha ending.');
    await expect(remote.getByText('Unsaved suggested changes · Insertion', { exact: true })).toBeVisible();
    await expect(paragraph).toBeDisabled();await expect(remote.getByLabel('Review for suggested edits', { exact: true })).toBeDisabled();
    await expect(remote.getByRole('button', { name: 'Prepare feedback return', exact: true })).toBeDisabled();
    await reviewer.keyboard.press('Escape');await expect(remote).toBeVisible();
    await remote.getByRole('button', { name: 'Cancel typed changes', exact: true }).click();
    await expect(remote.getByRole('article', { name: /^Suggestion / })).toHaveCount(0);
    await select(editor, 11, 16);await editor.pressSequentially('Bravo');
    await expect(remote.getByRole('region', { name: 'Typed change comparison', exact: true })).toContainText('Alpha');
    await remote.getByRole('button', { name: 'Save typed suggestion', exact: true }).click();
    await expect(remote.getByText('Typed suggestion submitted. The reviewed baseline is unchanged.', { exact: true })).toBeVisible();
    await paragraph.selectOption('typed-two');await select(editor, 7, 12);await editor.press('Backspace');
    await expect(editor).toHaveValue('Delete please.');await expect(remote.getByText('Unsaved suggested changes · Deletion', { exact: true })).toBeVisible();
    await remote.getByRole('button', { name: 'Save typed suggestion', exact: true }).click();
    await expect(editor).toHaveValue('Delete word please.');
    await paragraph.selectOption('typed-three');await select(editor, 0);await editor.pressSequentially('New ');
    await editor.evaluate((element: HTMLTextAreaElement) => {
      const clipboard = new DataTransfer();clipboard.setData('text/plain', 'Équipe ');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    });
    await expect(editor).toHaveValue('New Équipe Paste here.');
    await select(editor, 11);
    await editor.evaluate((element: HTMLTextAreaElement) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(element, 'New Équipe 日本語Paste here.');
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true, data: '日本語' }));
    });
    await expect(remote.getByRole('button', { name: 'Save typed suggestion', exact: true })).toBeDisabled();
    await editor.dispatchEvent('compositionend', { data: '日本語' });await expect(editor).toHaveValue('New Équipe 日本語Paste here.');
    await remote.getByRole('button', { name: 'Save typed suggestion', exact: true }).click();
    await expect(remote.getByRole('article', { name: /^Suggestion / })).toHaveCount(3);
    await expect(remote.getByRole('button', { name: 'Accept suggestion', exact: true })).toHaveCount(0);
    expect((await new AxeBuilder({ page: reviewer }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    expect(await remote.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await reviewer.screenshot({ path: info.outputPath(`suggest-changes-${theme}.png`), scale: 'css' });
    await remote.getByRole('button', { name: 'Prepare feedback return', exact: true }).click();
    const returned = await download(reviewer, () => remote.getByRole('button', { name: 'Download feedback return', exact: true }).click());
    const payload = JSON.parse(returned.toString('utf8'));
    expect(payload.proposals.map((proposal: { changes: unknown[] }) => proposal.changes[0])).toMatchObject([
      { expected: 'Alpha', proposed: 'Bravo', target: { start: 11, end: 16 } }, { expected: 'word ', proposed: '', target: { start: 7, end: 12 } },
      { expected: '', proposed: 'New Équipe 日本語', target: { start: 0, end: 0 } },
    ]);
    await info.attach('typed-feedback-return.json', { body: returned, contentType: 'application/json' });
    modal = await reviews(page);await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'returned.json', mimeType: 'application/json', buffer: returned });
    await modal.getByRole('button', { name: 'Import reviewed feedback', exact: true }).click();await expect(modal.getByText(/Feedback imported/)).toBeVisible();
    await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Typing baseline' });
    for (const label of ['Replacement', 'Deletion', 'Insertion']) {
      const article = modal.getByRole('article', { name: new RegExp(`^Suggestion [123]: ${label} from typed changes$`) });
      await article.getByRole('button', { name: 'Accept suggestion', exact: true }).click();await expect(article.getByText(/· Accepted$/)).toBeVisible();
    }
    await page.keyboard.press('Escape');await action(page, 'Undo');
    let exported = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
    expect(exported.paragraphs.map((item: { text: string }) => item.text).slice(0, 3)).toEqual(['Keep Alpha Bravo ending.', 'Delete please.', 'Paste here.']);
    await action(page, 'Redo');await page.reload();
    exported = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
    expect(exported.paragraphs.map((item: { text: string }) => item.text).slice(0, 3)).toEqual(['Keep Alpha Bravo ending.', 'Delete please.', 'New Équipe 日本語Paste here.']);
    expect(JSON.stringify(exported)).not.toContain('Synthetic typed reviewer');expect(exported.proposals).toBeUndefined();
    modal = await reviews(page);await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Typing baseline' });
    await expect(modal.getByText(/· Accepted$/)).toHaveCount(3);
  } finally { await context.close(); }
});
