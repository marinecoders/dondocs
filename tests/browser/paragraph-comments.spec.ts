import { expect, test, type Page } from '@playwright/test';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block' });
test.setTimeout(180_000);
const NOTE = 'REVIEW_ONLY_NOTE_42: please check this paragraph.';
const BODY = 'Second paragraph edited after review.';

async function closeComments(page: Page) {
  await page.getByRole('dialog', { name: 'Document comments', exact: true }).getByRole('button', { name: 'Close comments', exact: true }).click();
}
async function openComments(page: Page) {
  await page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ }).click();
  return page.getByRole('dialog', { name: 'Document comments', exact: true });
}
async function checkPdf(bytes: Uint8Array) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const content = await (await pdf.getPage(index)).getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    const text = pages.join(' ').replace(/\s+/g, ' ');
    expect(text).toContain(BODY);
    expect(text).not.toContain('REVIEW_ONLY_NOTE_42');
    expect(text).not.toContain('fixture-second');
  } finally { await pdf.destroy(); }
}

test('paragraph feedback follows identity through move, deletion, Undo, reload and portable clean exports', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const draft = { documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'PARAGRAPH COMMENT CHECK', from: 'Commanding Officer', to: 'Training Officer', date: '13 Nov 26', sigLast: 'DOE' },
    paragraphs: [{ id: 'fixture-first', text: 'First paragraph for review.', level: 0 }, { id: 'fixture-second', text: 'Second paragraph for review.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'paragraph-check.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: 'Comment on paragraph 2', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Document comments', exact: true });
  await expect(modal.getByLabel('Comment on', { exact: true })).toHaveValue('paragraph:fixture-second');
  await modal.getByLabel('Reviewer name', { exact: true }).fill('Chief');
  await modal.getByLabel('Comment', { exact: true }).fill(NOTE);
  await modal.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(modal.getByRole('article', { name: 'Comment on Paragraph 2', exact: true })).toContainText(NOTE);
  await closeComments(page);
  await page.locator('[data-paragraph-id="fixture-second"]').getByRole('button', { name: 'Move up (⌘↑)', exact: true }).click();
  await expect(page.locator('[data-paragraph-id]').first()).toHaveAttribute('data-paragraph-id', 'fixture-second');
  await page.getByRole('button', { name: 'Add paragraph', exact: true }).click();
  await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 3', exact: true }), 'New leading paragraph.');
  const inserted = page.locator('[data-paragraph-id]').last();
  const insertedId = await inserted.getAttribute('data-paragraph-id');
  const insertedRow = page.locator(`[data-paragraph-id="${insertedId}"]`);
  await insertedRow.getByRole('button', { name: 'Move up (⌘↑)', exact: true }).click();
  await insertedRow.getByRole('button', { name: 'Move up (⌘↑)', exact: true }).click();
  await openComments(page);
  await expect(modal.getByRole('article', { name: 'Comment on Paragraph 2', exact: true })).toContainText(NOTE);
  await modal.getByRole('button', { name: 'Go to paragraph', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 2', exact: true })).toBeFocused();
  await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 2', exact: true }), BODY);
  await page.waitForTimeout(750);
  await page.locator('[data-paragraph-id="fixture-second"]').getByRole('button', { name: 'Delete paragraph', exact: true }).click();
  await openComments(page);
  const detached = modal.getByRole('article', { name: 'Comment on Deleted or unavailable paragraph', exact: true });
  await expect(detached).toContainText(NOTE);
  await expect(modal.getByRole('button', { name: 'Go to paragraph', exact: true })).toHaveCount(0);
  await detached.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('paragraph-detached.png') });
  await closeComments(page);
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Undo/ }).click();
  await expect(page.locator('[data-paragraph-id="fixture-second"]')).toHaveCount(1);
  await page.waitForTimeout(1100);
  await page.reload();
  await openComments(page);
  const thread = modal.getByRole('article', { name: 'Comment on Paragraph 2', exact: true });
  await expect(thread).toContainText(NOTE);
  await expect(thread).toContainText('text or markings changed');
  await thread.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('paragraph-comments.png') });
  await closeComments(page);
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  const savingDraft = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const portable = await readFile((await (await savingDraft).path())!);
  const parsed = JSON.parse(portable.toString('utf8'));
  expect(parsed.reviewComments.version).toBe(2);
  expect(parsed.reviewComments.threads[0].anchor.paragraphId).toBe('fixture-second');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'portable-paragraph-check.json', mimeType: 'application/json', buffer: portable });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await openComments(page);
  await expect(modal.getByRole('article', { name: 'Comment on Paragraph 2', exact: true })).toContainText(NOTE);
  await closeComments(page);
  const savingWord = page.waitForEvent('download', { predicate: download => download.suggestedFilename().endsWith('.docx') });
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const word = await JSZip.loadAsync(await readFile((await (await savingWord).path())!));
  const document = await word.file('word/document.xml')!.async('string');
  expect(document).toContain(BODY);
  expect(document).not.toContain('REVIEW_ONLY_NOTE_42');
  expect(document).not.toContain('fixture-second');
  expect(document).not.toContain('w:commentRangeStart');
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  let exportPdf: () => Promise<void>;
  if (await preview.getAttribute('aria-haspopup') === 'dialog') {
    await preview.click();
    const pdfModal = page.getByRole('dialog', { name: 'PDF preview', exact: true });
    const download = pdfModal.getByRole('button', { name: 'Download', exact: true });
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
  if (testInfo.project.name === 'mobile-chrome-ios') {
    const opening = page.waitForEvent('popup');
    await exportPdf();
    const popup = await opening;
    try {
      const frame = popup.locator('iframe');
      await expect(frame).toHaveAttribute('src', /^data:application\/pdf;base64,/, { timeout: 30_000 });
      await checkPdf(Buffer.from((await frame.getAttribute('src'))!.split(',')[1], 'base64'));
      const downloading = popup.waitForEvent('download');
      await popup.getByRole('link', { name: 'Download PDF', exact: true }).click();
      await checkPdf(await readFile((await (await downloading).path())!));
    } finally { await popup.close(); }
  } else {
    const downloading = page.waitForEvent('download');
    await exportPdf();
    await checkPdf(await readFile((await (await downloading).path())!));
  }
});

test('paragraph navigation reveals the body from another focused section', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'focused', sidebarOutlineVisible: false }, version: 1 }));
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'focused-paragraph.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FOCUSED PARAGRAPH CHECK', from: 'Commanding Officer', to: 'Training Officer', date: '13 Nov 26', sigLast: 'DOE' },
    paragraphs: [{ id: 'focused-target', text: 'Navigate back to this paragraph.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: 'Comment on paragraph 1', exact: true }).click();
  const comments = page.getByRole('dialog', { name: 'Document comments', exact: true });
  await comments.getByLabel('Reviewer name', { exact: true }).fill('Chief');
  await comments.getByLabel('Comment', { exact: true }).fill('Review this paragraph in the editor.');
  await comments.getByRole('button', { name: 'Post comment', exact: true }).click();
  await closeComments(page);
  await page.getByLabel('Document section', { exact: true }).selectOption('addressing');
  const paragraph = page.getByRole('textbox', { name: 'Paragraph 1', exact: true });
  await expect(paragraph).toBeHidden();
  await openComments(page);
  await comments.getByRole('button', { name: 'Go to paragraph', exact: true }).click();
  await expect(page.getByLabel('Document section', { exact: true })).toHaveValue('body');
  await expect(paragraph).toBeVisible();
  await expect(paragraph).toBeFocused();
});

test('resolved detached feedback survives portable drafts without matching replacement text or special IDs', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'dark', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const targetId = 'constructor:review.target';
  const detachedText = 'A replacement paragraph has the former text.';
  const notes = ['PRIVATE_LIVE_FEEDBACK', 'PRIVATE_DETACHED_FEEDBACK'];
  const makeThread = (paragraphId: string, context: string, text: string) => ({
    id: crypto.randomUUID(), anchor: { kind: 'paragraph', paragraphId, context, docType: 'naval_letter' }, resolved: true,
    messages: [{ id: crypto.randomUUID(), author: 'Chief', text, createdAt: '2026-11-13T00:00:00Z' }],
  });
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'RESOLVED PARAGRAPH CHECK', from: 'Commanding Officer', to: 'Training Officer', date: '13 Nov 26', sigLast: 'DOE' },
    paragraphs: [{ id: targetId, text: 'The current paragraph for resolved feedback.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [],
    reviewComments: { version: 2, threads: [
      makeThread(targetId, 'The current paragraph for resolved feedback.', notes[0]),
      makeThread('deleted:review.target', detachedText, notes[1]),
    ] },
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'resolved-paragraphs.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const comments = await openComments(page);
  await comments.getByRole('button', { name: 'Resolved (2)', exact: true }).click();
  await expect(comments.getByRole('article', { name: 'Comment on Deleted or unavailable paragraph', exact: true })).toContainText(notes[1]);
  await comments.getByRole('button', { name: 'Go to paragraph', exact: true }).click();
  const paragraph = page.getByRole('textbox', { name: 'Paragraph 1', exact: true });
  await expect(paragraph).toBeFocused();
  await replaceParagraphText(paragraph, 'The current paragraph changed after its resolved feedback.');
  await expect(paragraph).toHaveText('The current paragraph changed after its resolved feedback.');
  await page.getByRole('button', { name: 'Add paragraph', exact: true }).click();
  await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 2', exact: true }), detachedText);
  await openComments(page);
  await comments.getByRole('button', { name: 'Resolved (2)', exact: true }).click();
  await expect(comments.getByRole('article', { name: 'Comment on Paragraph 1', exact: true })).toContainText('text or markings changed');
  await expect(comments.getByRole('article', { name: 'Comment on Deleted or unavailable paragraph', exact: true })).toContainText(notes[1]);
  await expect(comments.getByRole('button', { name: 'Go to paragraph', exact: true })).toHaveCount(1);
  await closeComments(page);
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  const exporting = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const portable = await readFile((await (await exporting).path())!);
  const serialized = JSON.parse(portable.toString('utf8'));
  expect(serialized.reviewComments.threads.every((thread: { resolved: boolean }) => thread.resolved)).toBe(true);
  expect(serialized.paragraphs[0].id).toBe(targetId);
  expect(serialized.paragraphs[0].text).toBe('The current paragraph changed after its resolved feedback.');
  expect(serialized.paragraphs[1].id).not.toBe('deleted:review.target');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'returned-resolved-paragraphs.json', mimeType: 'application/json', buffer: portable });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await openComments(page);
  await comments.getByRole('button', { name: 'Resolved (2)', exact: true }).click();
  await expect(comments.getByRole('article', { name: 'Comment on Paragraph 1', exact: true })).toContainText(notes[0]);
  await expect(comments.getByRole('article', { name: 'Comment on Deleted or unavailable paragraph', exact: true })).toContainText(notes[1]);
  await comments.getByRole('button', { name: 'Go to paragraph', exact: true }).click();
  await expect(paragraph).toBeFocused();
  await expect(paragraph).toHaveText('The current paragraph changed after its resolved feedback.');
});
