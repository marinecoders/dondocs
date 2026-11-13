import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block' });
test.setTimeout(180_000);
const NOTE = 'REVIEW_ONLY_NOTE_9817 😀';
const BODY = 'PUBLIC LETTER BODY: confirm training requirements.';

async function openComments(page: Page) {
  await page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ }).click();
  return page.getByRole('dialog', { name: 'Document comments', exact: true });
}

test('comments survive editing, reload and draft transfer while clean Word and PDF omit review text', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'comments.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'ORIGINAL SUBJECT', from: 'Commanding Officer', to: 'Training Officer', date: '13 Nov 26', sigLast: 'DOE' },
    paragraphs: [{ text: BODY, level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let comments = await openComments(page);
  await comments.getByLabel('Comment on', { exact: true }).selectOption('subject');
  await comments.getByLabel('Reviewer name', { exact: true }).fill('Chief');
  await comments.getByLabel('Comment', { exact: true }).fill(NOTE);
  await comments.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(comments.getByRole('article', { name: 'Comment on Subject', exact: true })).toContainText(NOTE);
  await comments.getByRole('button', { name: 'Close comments', exact: true }).click();
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('LATER SUBJECT');
  comments = await openComments(page);
  await expect(comments.getByRole('article')).toContainText('changed after the comment');
  await comments.getByRole('button', { name: 'Reply', exact: true }).click();
  await comments.getByLabel('Reviewer name', { exact: true }).fill('Drafter');
  await comments.getByLabel('Reply', { exact: true }).fill('Updated without changing the original feedback.');
  await comments.getByRole('button', { name: 'Post reply', exact: true }).click();
  await comments.getByRole('button', { name: 'Resolve', exact: true }).click();
  await comments.getByRole('button', { name: 'Resolved (1)', exact: true }).click();
  expect(await comments.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('resolved-field-comment.png') });
  await comments.getByRole('button', { name: 'Close comments', exact: true }).click();
  await expect(page.locator('[title^="Saved "]').first()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  comments = await openComments(page);
  await comments.getByRole('button', { name: 'Resolved (1)', exact: true }).click();
  await expect(comments.getByRole('article')).toContainText(NOTE);
  await expect(comments.getByRole('article')).toContainText('Updated without changing');
  await comments.getByRole('button', { name: 'Reopen', exact: true }).click();
  await comments.getByRole('button', { name: 'Close comments', exact: true }).click();

  const draftPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const draft = JSON.parse(await readFile((await (await draftPending).path())!, 'utf8'));
  expect(draft.kind).toBe('dondocs-draft');expect(draft.version).toBe(2);
  expect(draft.reviewComments.threads[0].messages[0].text).toBe(NOTE);
  await page.getByLabel('Import draft file').setInputFiles({ name: 'returned-comments.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  comments = await openComments(page);
  await expect(comments.getByRole('article')).toContainText(NOTE);
  await comments.getByRole('button', { name: 'Close comments', exact: true }).click();

  const wordPending = page.waitForEvent('download', { predicate: download => download.suggestedFilename().endsWith('.docx') });
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await wordPending).path())!));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('PUBLIC LETTER BODY');expect(xml).not.toContain('REVIEW_ONLY_NOTE_9817');
  expect(xml).not.toContain('ORIGINAL SUBJECT');
  const commentsXml = await zip.file('word/comments.xml')?.async('string');
  if (commentsXml) {
    const count = await page.evaluate(value => new DOMParser().parseFromString(value, 'application/xml').getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'comment').length, commentsXml);
    expect(count).toBe(0);expect(commentsXml).not.toContain('REVIEW_ONLY_NOTE_9817');
  }
  const bytes = await downloadPdf(page, testInfo.project.name);
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const content = await (await pdf.getPage(index)).getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    const text = pages.join(' ').replace(/\s+/g, ' ');
    expect(text).toContain(BODY);expect(text).not.toContain('REVIEW_ONLY_NOTE_9817');expect(text).not.toContain('ORIGINAL SUBJECT');
  } finally { await pdf.destroy(); }
});

async function downloadPdf(page: Page, project: string): Promise<Uint8Array> {
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  let exportPdf: () => Promise<void>;
  if (await preview.getAttribute('aria-haspopup') === 'dialog') {
    await preview.click();
    const download = page.getByRole('dialog', { name: 'PDF preview', exact: true }).getByRole('button', { name: 'Download', exact: true });
    await expect(download).toBeVisible({ timeout: 60_000 });
    exportPdf = () => download.click();
  } else {
    if (await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
    await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });
    exportPdf = async () => {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
    };
  }
  if (project === 'mobile-chrome-ios') {
    const opening = page.waitForEvent('popup');await exportPdf();const popup = await opening;
    try {
      await expect(popup.locator('iframe')).toHaveAttribute('src', /^data:application\/pdf;base64,/, { timeout: 30_000 });
      const saving = popup.waitForEvent('download');await popup.getByRole('link', { name: 'Download PDF', exact: true }).click();
      const download = await saving;expect(await download.failure()).toBeNull();return await readFile((await download.path())!);
    } finally { await popup.close(); }
  }
  const saving = page.waitForEvent('download');await exportPdf();const download = await saving;
  expect(await download.failure()).toBeNull();return await readFile((await download.path())!);
}
