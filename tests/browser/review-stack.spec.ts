import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { docxImageFixture } from '../_helpers/docxImageFixture';

test.use({ serviceWorkers: 'block' });
test.setTimeout(180_000);

test('combined review actions preserve paragraph feedback, reference URLs and images through portable drafts and clean exports', async ({ page }, testInfo) => {
  const images = await docxImageFixture();
  const note = 'STACK_REVIEW_PRIVATE_NOTE: verify the source and report date.';
  const original = 'Report 05 Nov 2026 under reference (b), then reference (a).';
  const corrected = 'Report 5 November 2026 under reference (a), then reference (b).';
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const draft = {
    documentCategory: 'correspondence', documentMode: 'custom', docType: 'business_letter',
    formData: { subject: 'COMBINED REVIEW CHECK', to: 'Training Office', date: 'November 13, 2026',
      sigFirst: 'Alex', sigLast: 'Example', signatureType: 'image', includeHyperlinks: false,
      signatureImage: { name: 'signature.png', size: images.signature.length, data: images.signature.toString('base64') } },
    paragraphs: [{ id: 'review-body', text: original, level: 0 }, { id: 'review-figure', text: 'Training diagram', level: 0,
      figure: { name: 'diagram.png', type: 'image/png', width: 400, height: 200, data: images.figure.toString('base64') } }],
    references: [{ letter: 'a', title: 'Alpha source ( notal )', url: 'https://example.com/alpha' },
      { letter: 'b', title: 'Bravo source', url: 'https://example.com/bravo?a=1&b=2#section' }],
    enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'combined-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: 'Comment on paragraph 1', exact: true }).click();
  const comments = page.getByRole('dialog', { name: 'Document comments', exact: true });
  await comments.getByLabel('Reviewer name', { exact: true }).fill('Reviewer');
  await comments.getByLabel('Comment', { exact: true }).fill(note);
  await comments.getByRole('button', { name: 'Post comment', exact: true }).click();
  await comments.getByRole('button', { name: 'Close comments', exact: true }).click();

  const body = page.locator('#sec-body');
  await body.getByRole('combobox', { name: 'Body date audience' }).click();
  await page.getByRole('option', { name: 'Military — 5 November 2026', exact: true }).click();
  await body.getByRole('button', { name: 'Review body date formatting' }).click();
  await page.getByRole('dialog', { name: 'Review formatting corrections' }).getByRole('button', { name: 'Apply 1 correction', exact: true }).click();
  await page.getByRole('button', { name: 'Review NOTAL formatting', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review formatting corrections' }).getByRole('button', { name: 'Apply 1 correction', exact: true }).click();
  await page.getByRole('button', { name: 'Review first-citation order', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review reference changes' }).getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText(corrected);
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Undo/ }).click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText(original.replace('05 Nov 2026', '5 November 2026'));
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Redo/ }).click();
  await page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ }).click();
  await expect(comments.getByRole('article')).toContainText(note);
  await expect(comments.getByRole('article')).toContainText('text or markings changed');
  await comments.getByRole('button', { name: 'Close comments', exact: true }).click();

  const savingDraft = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const portable = await readFile((await (await savingDraft).path())!);
  const parsed = JSON.parse(portable.toString('utf8'));
  expect(parsed.reviewComments.threads[0].anchor.paragraphId).toBe('review-body');
  expect(parsed.reviewComments.threads[0].anchor.context).toBe(original);
  expect(parsed.paragraphs[0].id).toBe('review-body');
  expect(parsed.references[0].url).toBe(draft.references[1].url);
  await page.getByLabel('Import draft file').setInputFiles({ name: 'portable-review.json', mimeType: 'application/json', buffer: portable });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText(corrected);
  await page.getByRole('button', { name: /^Comments(?: \(\d+\))?$/ }).click();
  await expect(comments.getByRole('article', { name: 'Comment on Paragraph 1', exact: true })).toContainText(note);
  await expect(comments.getByRole('article')).toContainText(original);
  await comments.getByRole('button', { name: 'Close comments', exact: true }).click();

  const savingWord = page.waitForEvent('download', { predicate: download => download.suggestedFilename().endsWith('.docx') });
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await savingWord).path())!));
  const xml = await zip.file('word/document.xml')!.async('string');
  const relationships = await zip.file('word/_rels/document.xml.rels')!.async('string');
  const media = await Promise.all(Object.values(zip.files).filter(file => file.name.startsWith('word/media/') && !file.dir).map(file => file.async('nodebuffer')));
  expect(media.some(bytes => bytes.equals(images.signature))).toBe(true);
  expect(media.some(bytes => bytes.equals(images.figure))).toBe(true);
  expect(xml).toContain('5 November 2026');
  expect(xml).toContain('Alpha source (NOTAL)');
  expect(xml).not.toContain('STACK_REVIEW_PRIVATE_NOTE');
  expect(xml).not.toContain('review-body');
  expect(relationships).toContain('https://example.com/bravo?a=1&amp;b=2#section');

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
  let pdfBytes: Uint8Array;
  if (testInfo.project.name === 'mobile-chrome-ios') {
    const opening = page.waitForEvent('popup');
    await exportPdf();
    const popup = await opening;
    try {
      await expect(popup.locator('iframe')).toHaveAttribute('src', /^data:application\/pdf;base64,/, { timeout: 30_000 });
      const saving = popup.waitForEvent('download');
      await popup.getByRole('link', { name: 'Download PDF', exact: true }).click();
      pdfBytes = await readFile((await (await saving).path())!);
    } finally { await popup.close(); }
  } else {
    const saving = page.waitForEvent('download', { predicate: download => download.suggestedFilename().endsWith('.pdf') });
    await exportPdf();
    pdfBytes = await readFile((await (await saving).path())!);
  }
  const pdf = await getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: false }).promise;
  try {
    const text: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const content = await (await pdf.getPage(index)).getTextContent();
      text.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    const output = text.join(' ').replace(/\s+/g, ' ');
    expect(output.toLowerCase()).toContain(corrected.toLowerCase());
    expect(output).toContain('Training diagram');
    expect(output).not.toContain('STACK_REVIEW_PRIVATE_NOTE');
    expect(output).not.toContain('review-body');
  } finally { await pdf.destroy(); }
});
