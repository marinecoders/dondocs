import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });
test.setTimeout(90_000);

async function exportDraft(page: Page) {
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const file = await saving;
  expect(await file.failure()).toBeNull();
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}

for (const kind of ['basic letter', 'enclosure'] as const) {
  test(`${kind} protected PDF confirmation preserves the exact original through reload`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
    });
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({ name: 'protected-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      documentMode: 'custom', documentCategory: 'correspondence',
      docType: kind === 'basic letter' ? 'new_page_endorsement' : 'naval_letter',
      formData: { subject: 'SYNTHETIC PROTECTED PDF', from: 'Training Officer', to: 'Commanding Officer', date: '19 Nov 26', sigLast: 'EXAMPLE' },
      paragraphs: [{ id: 'protected-body', text: 'Synthetic PDF attachment verification.', level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [],
    })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /^Subject/ })).toHaveValue('SYNTHETIC PROTECTED PDF');
    const upload = page.getByLabel(kind === 'basic letter' ? 'Upload basic letter PDF' : 'Upload enclosure PDFs', { exact: true }).last();
    const fixture = resolve('tests/fixtures/permission-pdfs/owner-aes.pdf');
    await upload.setInputFiles(fixture);
    const confirm = page.getByRole('alertdialog', { name: 'Include PDF pages as images?', exact: true });
    await expect(confirm).toContainText('digital signatures do not carry');
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    const cancelled = await exportDraft(page);
    expect(cancelled.formData.basicLetterFile).toBeUndefined();
    expect(cancelled.enclosures).toHaveLength(0);

    // Retry the same file after cancellation; the file input must reset.
    await upload.setInputFiles(fixture);
    await confirm.getByRole('button', { name: 'Include page images', exact: true }).click();
    await expect(page.getByText('owner-aes.pdf', { exact: true })).toBeVisible();
    const expected = (await readFile(fixture)).toString('base64');
    const retained = (draft: Awaited<ReturnType<typeof exportDraft>>) => kind === 'basic letter' ? draft.formData.basicLetterFile : draft.enclosures[0]?.file;
    expect(retained(await exportDraft(page))?.data).toBe(expected);
    await expect(page.getByText(/^Saved(?: ·.*)?$/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: /^Subject/ })).toHaveValue('SYNTHETIC PROTECTED PDF');
    expect(retained(await exportDraft(page))?.data).toBe(expected);
  });
}
