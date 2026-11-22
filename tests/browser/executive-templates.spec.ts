import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });
test('Chapter 12 templates disclose preprinted stock and open independent documents', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('PRESERVE MY ORIGINAL');
  const workspace = page.getByRole('button', { name: 'Open workspace', exact: true });
  if (await workspace.isVisible()) await workspace.click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Template category').selectOption('Executive Correspondence');
  await dialog.getByRole('button', { name: /CNO Flag Stationery/ }).click();
  await expect(dialog.getByRole('button', { name: /^CNO Flag Stationery/ }).getByText(/does not reproduce flag artwork/)).toBeVisible();
  await dialog.locator('summary').filter({ hasText: 'Preview:' }).click();
  await expect(dialog.getByRole('link', { name: /figure 12-8/ })).toHaveAttribute('href', /#page=127$/);
  await dialog.getByRole('button', { name: 'Load template', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const draftDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const download = await draftDownload;
  const saved = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(saved.docType).toBe('executive_correspondence');
  expect(saved.formData).toMatchObject({ stationerySize: '5x7', letterheadMode: 'preprinted', fontSize: '12pt', fontFamily: 'times' });
  expect(saved.paragraphs[0].text).toBe('[WRITE A SHORT PERSONAL NOTE.]');
  await page.screenshot({ path: info.outputPath('flag-template.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Paragraph 1', exact: true })).toHaveText('[WRITE A SHORT PERSONAL NOTE.]');
  if (info.project.name === 'chromium') {
    await page.locator('#to').fill('Training Recipient\n123 Synthetic Road');
    await page.locator('#salutation').fill('Dear Training Recipient:');
    await page.locator('#sigFirst').fill('TRAINING');
    await page.locator('#sigLast').fill('EXAMPLE');
    await page.locator('#date').fill('November 21, 2026');
    await page.locator('#date').press('Tab');
    await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill('Thank you for your help with our training event.');
    for (const [label, extension] of [['Download Word (.docx)', 'docx'], ['Download PDF (.pdf)', 'pdf']]) {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: extension === 'pdf' ? /^Download PDF(?:\s|$)/ : label, exact: extension !== 'pdf' }).click();
      const result = await downloading;
      expect(await result.failure()).toBeNull();
      const bytes = await readFile((await result.path())!);
      if (extension === 'docx') {
        const zip = await JSZip.loadAsync(bytes);
        const xml = await zip.file('word/document.xml')!.async('string');
        expect(xml).toContain('w:w="7200" w:h="10080"');
        expect(xml).toContain('Thank you for your help');
      } else {
        const pdf = await PDFDocument.load(bytes);
        expect(pdf.getPage(0).getWidth()).toBeCloseTo(360, 1);
        expect(pdf.getPage(0).getHeight()).toBeCloseTo(504, 1);
      }
      await result.saveAs(info.outputPath(`cno-personal-note.${extension}`));
    }
  }
  const workspaceAfter = page.getByRole('button', { name: 'Open workspace', exact: true });
  if (await workspaceAfter.isVisible()) await workspaceAfter.click();
  await expect(page.getByRole('button', { name: /^PRESERVE MY ORIGINAL / })).toBeVisible();

});
