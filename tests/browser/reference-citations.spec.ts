import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

test('reviews reference order, preserves targets through Undo, reload and PDF export', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
    formData: { subject: 'REFERENCE TARGET CHECK', from: 'Commanding Officer', to: 'Training Officer', date: '13 Nov 26', sigLast: 'DOE', via: 'Office w/ref (b)' },
    paragraphs: [{ text: 'Follow reference (b), then reference (a).', level: 0 }],
    references: [{ letter: 'a', title: 'Alpha directive', url: 'https://example.com/alpha' }, { letter: 'b', title: 'Bravo directive', url: 'https://example.com/bravo' }],
    enclosures: [], copyTos: [{ text: 'Office w/ref (b)' }], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'reference-check.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const review = page.getByRole('button', { name: 'Review first-citation order' });
  await review.click();
  const preview = page.getByRole('dialog', { name: 'Review reference changes' });
  await expect(preview.getByText('Follow reference (a), then reference (b).')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true, includeHidden: true })).toHaveText('Follow reference (b), then reference (a).');
  await page.screenshot({ path: testInfo.outputPath('reference-preview.png'), fullPage: false });
  await preview.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText('Follow reference (a), then reference (b).');
  await expect(page.getByLabel('Reference (a) title', { exact: true })).toHaveValue('Bravo directive');
  await expect(page.getByLabel('Reference (a) URL', { exact: true })).toHaveValue('https://example.com/bravo');
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Undo/ }).click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText('Follow reference (b), then reference (a).');
  await expect(page.getByLabel('Reference (a) title', { exact: true })).toHaveValue('Alpha directive');
  const drag = page.getByRole('button', { name: 'Drag to reorder reference 2', exact: true });
  await drag.scrollIntoViewIfNeeded();
  await drag.focus();
  await page.keyboard.press('Space');
  await expect(drag).toHaveAttribute('aria-pressed', 'true');
  // The keyboard sensor installs its document listener after activation.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('status').filter({ hasText: /moved/ })).toContainText('droppable area ref-0');
  await page.keyboard.press('Space');
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Apply changes', exact: true }).click();
  // A real edit after the correction must survive the normal save/reload path.
  await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill('Follow reference (a), then reference (b). Keep this later edit.');
  await page.waitForTimeout(1100);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText('Follow reference (a), then reference (b). Keep this later edit.');
  await page.getByRole('button', { name: 'Remove reference 1', exact: true }).click();
  await expect(preview.getByRole('alert')).toContainText('is still cited');
  await expect(preview.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(0);
  await preview.getByRole('button', { name: 'Close', exact: true }).first().click();
  // Compile the preview from the saved revision, then inspect the downloaded PDF.
  const showPreview = page.getByRole('button', { name: 'Preview', exact: true });
  let exportPdf: () => Promise<void>;
  if (await showPreview.getAttribute('aria-haspopup') === 'dialog') {
    await showPreview.click();
    const modal = page.getByRole('dialog', { name: 'PDF preview', exact: true });
    const download = modal.getByRole('button', { name: 'Download', exact: true });
    await expect(download).toBeVisible({ timeout: 60_000 });
    exportPdf = () => download.click();
  } else {
    if (await showPreview.getAttribute('aria-pressed') !== 'true') await showPreview.click();
    await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });
    exportPdf = async () => {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
    };
  }
  let pdfBytes: Uint8Array;
  if (testInfo.project.name === 'mobile-chrome-ios') {
    // iOS Chrome opens the PDF handoff page before offering a saved download.
    const opening = page.waitForEvent('popup');
    await exportPdf();
    const popup = await opening;
    try {
      const frame = popup.locator('iframe');
      await expect(frame).toHaveAttribute('src', /^data:application\/pdf;base64,/, { timeout: 30_000 });
      const handoffBytes = Buffer.from((await frame.getAttribute('src'))!.split(',')[1], 'base64');
      await expectReferenceTargets(handoffBytes);
      const saving = popup.waitForEvent('download');
      await popup.getByRole('link', { name: 'Download PDF', exact: true }).click();
      const download = await saving;
      expect(await download.failure()).toBeNull();
      pdfBytes = await readFile((await download.path())!);
    } finally { await popup.close(); }
  } else {
    const downloading = page.waitForEvent('download');
    await exportPdf();
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    pdfBytes = await readFile((await download.path())!);
  }
  await expectReferenceTargets(pdfBytes);
});

async function expectReferenceTargets(bytes: Uint8Array) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const content = await (await pdf.getPage(index)).getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    const text = pages.join(' ').replace(/\s+/g, ' ');
    expect(text).toContain('Follow reference (a), then reference (b). Keep this later edit.');
    expect(text).toContain('Bravo directive');
    expect(text).toContain('Alpha directive');
    expect(text.indexOf('Bravo directive')).toBeLessThan(text.indexOf('Alpha directive'));
    expect(text).toContain('Office w/ref (a)');
  } finally { await pdf.destroy(); }
}


test('blocks reference reordering within quoted text containing an apostrophe', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const text = 'He wrote ‘the commander’s reference (b)’. Then follow reference (a).';
  await page.getByLabel('Import draft file').setInputFiles({ name: 'quoted-reference.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'QUOTED REFERENCE CHECK' },
    paragraphs: [{ text, level: 0 }],
    references: [{ letter: 'a', title: 'Alpha directive' }, { letter: 'b', title: 'Bravo directive' }],
    enclosures: [], copyTos: [], distributions: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: 'Review first-citation order', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Review reference changes' });
  await expect(preview.getByRole('alert')).toContainText('quoted text');
  await expect(preview.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(0);
  await preview.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText(text);
  await expect(page.getByLabel('Reference (a) title', { exact: true })).toHaveValue('Alpha directive');
});

test('blocks reference reordering inside a fenced code sample with nested backticks', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const text = '```javascript\nconst citation = `reference (b)`;\n```\nUse reference (a).';
  await page.getByLabel('Import draft file').setInputFiles({ name: 'code-reference.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formData: { subject: 'CODE SAMPLE' },
    paragraphs: [{ text, level: 0 }], references: [{ letter: 'a', title: 'Alpha' }, { letter: 'b', title: 'Bravo' }],
    enclosures: [], copyTos: [], distributions: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: 'Review first-citation order', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Review reference changes' });
  await expect(preview.getByRole('alert')).toContainText('code');
  await expect(preview.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(0);
  await preview.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText(text, { useInnerText: true });
});

test('preserves endorsement citation targets through a format that temporarily hides references', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'reference-roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'same_page_endorsement',
    formData: { subject: 'REFERENCE ROUNDTRIP', startingReferenceLetter: 'g', via: 'Office w/ref (h)' },
    paragraphs: [{ text: 'Use reference (h), then reference (g).', level: 0 }],
    references: [{ letter: 'g', title: 'Alpha', url: 'https://example.com/alpha' }, { letter: 'h', title: 'Bravo', url: 'https://example.com/bravo' }],
    enclosures: [], copyTos: [{ text: 'Office w/ref (g)' }], distributions: [{ text: 'Office w/ref (h)' }],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: 'Correspondence type', exact: true }).click();
  await page.getByRole('option', { name: 'Business Letter', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText('Use reference (b), then reference (a).');
  await page.getByRole('button', { name: 'Correspondence type', exact: true }).click();
  await page.getByRole('option', { name: 'Same-Page Endorsement', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText('Use reference (h), then reference (g).');
  await expect(page.getByLabel('Reference (g) title', { exact: true })).toHaveValue('Alpha');
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const saved = JSON.parse(await readFile((await (await saving).path())!, 'utf8'));
  expect(saved.paragraphs[0].text).toBe('Use reference (h), then reference (g).');
  expect(saved.formData.via).toBe('Office w/ref (h)');
  expect(saved.copyTos[0].text).toBe('Office w/ref (g)');
  expect(saved.distributions[0].text).toBe('Office w/ref (h)');
  expect(saved.references.map((reference: { letter: string; url: string }) => [reference.letter, reference.url])).toEqual([
    ['g', 'https://example.com/alpha'], ['h', 'https://example.com/bravo'],
  ]);
});
