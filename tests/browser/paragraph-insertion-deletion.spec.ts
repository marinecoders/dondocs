import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';

test.use({ serviceWorkers: 'block' });
test.setTimeout(180_000);
async function action(page: Page, name: string) {
  await page.getByRole('button', { name: ['Undo', 'Redo'].includes(name) ? 'Document tools' : 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: ['Undo', 'Redo'].includes(name) ? new RegExp(`^${name}`) : name, exact: true }).click();
}
async function reviews(page: Page) { await action(page, 'Review rounds…');return page.getByRole('dialog', { name: 'Review rounds', exact: true }); }
async function download(page: Page, operation: () => Promise<unknown>) {
  const pending = page.waitForEvent('download');await operation();return readFile((await (await pending).path())!);
}
for (const theme of ['light', 'dark', 'classic']) test(`paragraph insertion and deletion return, decisions and Undo in ${theme}`, async ({ page, browser, baseURL }, info) => {
  const init = (appearance: string) => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: appearance, editorLayout: 'scroll' } }));
  };
  await page.addInitScript(init, theme);await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'SYNTHETIC PARAGRAPH REVIEW', to: 'Training Office', classLevel: 'unclassified' },
    paragraphs: [{ id: 'structure-first', text: 'Keep the first paragraph.', level: 0 }, { id: 'structure-second', text: 'Remove this reviewed paragraph.', level: 0 }, { id: 'structure-third', text: 'Original independent third.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'paragraphs.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill('Paragraph baseline');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  const copy = await download(page, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());await page.keyboard.press('Escape');
  const context = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent),
    serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
  try {
    await context.addInitScript(init, theme);const reviewer = await context.newPage();await reviewer.goto(baseURL!);
    let remote = await reviews(reviewer);
    await remote.getByLabel('Import reviewer copy', { exact: true }).setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: copy });
    await remote.getByRole('button', { name: 'Open as new review copy', exact: true }).click();await expect(remote).toBeHidden();
    remote = await reviews(reviewer);await remote.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Paragraph baseline' });
    await remote.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Synthetic paragraph reviewer');
    await remote.getByLabel('Insert at reviewed position', { exact: true }).selectOption('3');
    await remote.getByLabel('New paragraph text', { exact: true }).fill('Cancelled paragraph.');
    await remote.getByRole('button', { name: 'Cancel paragraph proposal', exact: true }).click();
    await expect(remote.getByRole('article', { name: /^Suggestion / })).toHaveCount(0);
    await remote.getByLabel('Insert at reviewed position', { exact: true }).selectOption('3');
    await remote.getByLabel('New paragraph text', { exact: true }).fill('Inserted Équipe 👩🏽‍✈️ paragraph.');
    await remote.getByRole('button', { name: 'Add paragraph proposal', exact: true }).click();
    await expect(remote.getByRole('article', { name: 'Suggestion 1: Insert paragraph', exact: true })).toBeVisible();
    await remote.getByLabel('Paragraph operation', { exact: true }).selectOption('delete-paragraph');
    for (const id of ['structure-second', 'structure-first']) {
      await remote.getByLabel('Reviewed paragraph to delete', { exact: true }).selectOption(id);
      await remote.getByRole('button', { name: 'Add paragraph proposal', exact: true }).click();
    }
    await expect(remote.getByRole('article', { name: /^Suggestion / })).toHaveCount(3);
    await expect(remote.getByRole('button', { name: 'Accept suggestion', exact: true })).toHaveCount(0);
    await remote.getByRole('button', { name: 'Prepare feedback return', exact: true }).click();
    const returned = await download(reviewer, () => remote.getByRole('button', { name: 'Download feedback return', exact: true }).click());
    const payload = JSON.parse(returned.toString('utf8'));
    const newId = payload.proposals[0].changes[0].target.operation.after[0].id;
    expect(payload.proposals[0].changes[0].target.operation).toMatchObject({ kind: 'insert-paragraph', before: [], gap: { before: { id: 'structure-third', level: 0 }, after: null } });
    expect(newId).not.toBe('structure-first');await info.attach('paragraph-feedback-return.json', { body: returned, contentType: 'application/json' });
    await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 3', exact: true }), 'Newer independent third.');
    modal = await reviews(page);
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'returned.json', mimeType: 'application/json', buffer: returned });
    await modal.getByRole('button', { name: 'Import reviewed feedback', exact: true }).click();await expect(modal.getByText(/Feedback imported/)).toBeVisible();
    await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Paragraph baseline' });
    for (const name of ['Suggestion 1: Insert paragraph', 'Suggestion 2: Delete paragraph']) {
      const proposal = modal.getByRole('article', { name, exact: true });
      await proposal.getByRole('button', { name: 'Accept suggestion', exact: true }).click();await expect(proposal.getByText(/· Accepted$/)).toBeVisible();
    }
    const rejected = modal.getByRole('article', { name: 'Suggestion 3: Delete paragraph', exact: true });
    await rejected.getByRole('button', { name: 'Reject suggestion', exact: true }).click();await expect(rejected.getByText(/· Rejected$/)).toBeVisible();
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`paragraph-proposals-${theme}.png`), scale: 'css' });await page.keyboard.press('Escape');
    await action(page, 'Undo');
    const undone = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
    expect(undone.paragraphs.map((paragraph: {id:string}) => paragraph.id)).toEqual(['structure-first', 'structure-second', 'structure-third', newId]);
    expect(undone.paragraphs[2].text).toBe('Newer independent third.');
    await action(page, 'Redo');await page.reload();
    const reloaded = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
    expect(reloaded.paragraphs.map((paragraph: {id:string}) => paragraph.id)).toEqual(['structure-first', 'structure-third', newId]);
    expect(reloaded.paragraphs.map((paragraph: {text:string}) => paragraph.text)).toEqual(['Keep the first paragraph.', 'Newer independent third.', 'Inserted Équipe 👩🏽‍✈️ paragraph.']);
    expect(reloaded.proposals).toBeUndefined();expect(JSON.stringify(reloaded)).not.toContain('Synthetic paragraph reviewer');
    modal = await reviews(page);await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Paragraph baseline' });
    await expect(modal.getByRole('article', { name: 'Suggestion 1: Insert paragraph', exact: true }).getByText(/· Accepted$/)).toBeVisible();
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'repeated.json', mimeType: 'application/json', buffer: returned });
    await expect(modal.getByText(/This return has already been imported/)).toBeVisible();
    await page.keyboard.press('Escape');await expect(modal).toBeHidden();
    // Accepted Unicode content must also compile through the clean PDF path.
    const preview = page.getByRole('button', { name: 'Preview', exact: true });
    let exportPdf: () => Promise<unknown>;
    if (await preview.getAttribute('aria-haspopup') === 'dialog') {
      await preview.click();
      const pdfPreview = page.getByRole('dialog', { name: 'PDF preview', exact: true });
      const save = pdfPreview.getByRole('button', { name: 'Download', exact: true });
      await expect(save).toBeVisible({ timeout: 60_000 });exportPdf = () => save.click();
    } else {
      if (await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
      await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });
      exportPdf = async () => {
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
      };
    }
    const cleanPdf = await download(page, exportPdf);
    await info.attach('accepted-paragraph-clean.pdf', { body: cleanPdf, contentType: 'application/pdf' });
    const pdf = await getDocument({ data: new Uint8Array(cleanPdf), useSystemFonts: false }).promise;
    try {
      let text = '';
      for (let index = 1; index <= pdf.numPages; index++) {
        const content = await (await pdf.getPage(index)).getTextContent();
        text += content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' ') + ' ';
      }
      // The bundled TeX font can expose the acute and capital E as separate PDF text items.
      expect(text.replace(/\s+/g, ' ')).toMatch(/Inserted (?:É|´\s*E)quipe paragraph\./u);
      expect(text).toContain('Newer independent third.');
      expect(text).not.toContain('Remove this reviewed paragraph.');
    } finally { await pdf.destroy(); }
  } finally { await context.close(); }
});
