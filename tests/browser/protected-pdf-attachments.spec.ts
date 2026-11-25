import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PROTECTED_PDF_LIMITS } from '../../src/services/pdf/assemblyPdf';

test.use({ serviceWorkers: 'block' });
test.setTimeout(90_000);

// Image preparation has its own bounded deadline, beyond a simple UI update.
const pdfPreparation = { timeout: PROTECTED_PDF_LIMITS.milliseconds + 5_000 };

async function exportDraft(page: Page) {
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const file = await saving;
  expect(await file.failure()).toBeNull();
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}

async function openSyntheticDraft(page: Page, docType = 'naval_letter') {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll', previewVisible: false }, version: 1 }));
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'protected-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentMode: 'custom', documentCategory: 'correspondence', docType,
    formData: { subject: 'SYNTHETIC PROTECTED PDF', from: 'Training Officer', to: 'Commanding Officer', date: '19 Nov 26', sigLast: 'EXAMPLE' },
    paragraphs: [{ id: 'protected-body', text: 'Synthetic PDF attachment verification.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Subject/ })).toHaveValue('SYNTHETIC PROTECTED PDF');
}

for (const kind of ['basic letter', 'enclosure'] as const) {
  test(`${kind} protected PDF confirmation preserves the exact original through reload`, async ({ page }) => {
    await openSyntheticDraft(page, kind === 'basic letter' ? 'new_page_endorsement' : 'naval_letter');
    const upload = page.getByLabel(kind === 'basic letter' ? 'Upload basic letter PDF' : 'Upload enclosure PDFs', { exact: true }).last();
    const fixture = resolve('tests/fixtures/permission-pdfs/owner-aes.pdf');
    await upload.setInputFiles(fixture);
    const confirm = page.getByRole('alertdialog', { name: 'Include PDF pages as images?', exact: true });
    await expect(confirm).toContainText('digital signatures do not carry', pdfPreparation);
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

  for (const [name, message] of [
    ['corrupt-image.pdf', /JPEG.*unreadable|image could not be decoded/],
    ['corrupt-image-owner-aes.pdf', /JPEG.*unreadable|image could not be decoded/],
    ['valued-field-missing-appearance-owner-aes.pdf', /valued printable form field.*flattened/],
    ['xfa-only-owner-aes.pdf', /XFA.*flattened/],
  ] as const) {
    test(`${kind} rejects ${name} without changing retained attachments`, async ({ page }) => {
      await openSyntheticDraft(page, kind === 'basic letter' ? 'new_page_endorsement' : 'naval_letter');
      const label = kind === 'basic letter' ? 'Upload basic letter PDF' : 'Upload enclosure PDFs';
      if (kind === 'enclosure') {
        await page.getByLabel(label, { exact: true }).last().setInputFiles(resolve('tests/fixtures/permission-pdfs/source.pdf'));
        await expect(page.getByText('source.pdf', { exact: true })).toBeVisible();
      }
      const before = await exportDraft(page);
      await page.getByLabel(label, { exact: true }).first().setInputFiles(resolve(`tests/fixtures/permission-pdfs/${name}`));
      if (kind === 'enclosure') {
        const error = page.getByRole('alertdialog', { name: 'Could not attach PDF', exact: true });
        await expect(error).toContainText(message, pdfPreparation);
        await error.getByRole('button', { name: 'OK', exact: true }).click();
      } else {
        await expect(page.getByRole('alert')).toContainText(message, pdfPreparation);
      }
      await expect(page.getByRole('alertdialog', { name: 'Include PDF pages as images?', exact: true })).not.toBeVisible();
      const after = await exportDraft(page);
      expect(after.formData.basicLetterFile).toEqual(before.formData.basicLetterFile);
      expect(after.enclosures).toEqual(before.enclosures);
    });
  }
}

for (const name of ['printable-stamp.pdf', 'printable-link.pdf']) test(`printable enclosure ${name} explains image copies and retains the original`, async ({ page }) => {
  await openSyntheticDraft(page);
  const fixture = resolve(`tests/fixtures/permission-pdfs/${name}`);
  await page.getByLabel('Upload enclosure PDFs', { exact: true }).last().setInputFiles(fixture);
  const confirm = page.getByRole('alertdialog', { name: 'Include PDF pages as images?', exact: true });
  await expect(confirm).toContainText('printable annotations or form fields', pdfPreparation);
  await expect(confirm).not.toContainText('permission restrictions', pdfPreparation);
  await confirm.getByRole('button', { name: 'Include page images', exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  expect((await exportDraft(page)).enclosures[0].file.data).toBe((await readFile(fixture)).toString('base64'));
});

test('an encrypted filled form with a verifiable saved appearance remains supported', async ({ page }) => {
  await openSyntheticDraft(page);
  const fixture = resolve('tests/fixtures/permission-pdfs/owner-saved-field.pdf');
  await page.getByLabel('Upload enclosure PDFs', { exact: true }).last().setInputFiles(fixture);
  const confirm = page.getByRole('alertdialog', { name: 'Include PDF pages as images?', exact: true });
  await expect(confirm).toContainText('permission restrictions', pdfPreparation);
  await confirm.getByRole('button', { name: 'Include page images', exact: true }).click();
  await expect(page.getByText('owner-saved-field.pdf', { exact: true })).toBeVisible();
  expect((await exportDraft(page)).enclosures[0].file.data).toBe((await readFile(fixture)).toString('base64'));
});

test('an official three-page form with a compressed encrypted field dictionary can be printed', async ({ page }) => {
  await openSyntheticDraft(page);
  await page.getByLabel('Upload enclosure PDFs', { exact: true }).last()
    .setInputFiles(resolve('public/templates/NAVMC10132 - Unit Punishment Book/original.pdf'));
  const confirm = page.getByRole('alertdialog', { name: 'Include PDF pages as images?', exact: true });
  await expect(confirm).toContainText('permission restrictions', pdfPreparation);
  await confirm.getByRole('button', { name: 'Include page images', exact: true }).click();
  await expect(page.getByText('original.pdf', { exact: true })).toBeVisible();
});
