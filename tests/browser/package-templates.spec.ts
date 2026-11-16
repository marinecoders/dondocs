import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
async function openPackages(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true }).or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole('dialog', { name: 'Action packages', exact: true });
}
async function downloaded(page: Page, action: () => Promise<void>) {
  const pending = page.waitForEvent('download'); await action(); const download = await pending;
  expect(await download.failure()).toBeNull(); return readFile((await download.path())!);
}
for (const theme of ['light', 'dark']) {
  test(`creates independent packages from a retained template and renders fresh contents in ${theme}`, async ({ page, context }, info) => {
    await context.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
    }, theme);
    await page.goto('/');
    await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'starter.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
      formData: { subject: 'ACTION FOR {{NAME}}', unitLine1: 'FICTIONAL TRAINING UNIT', from: 'Training Office', to: '{{NAME}}',
        sigFirst: 'Alex', sigLast: 'Example', classLevel: 'unclassified', date: '16 Nov 26', signatureType: 'digital' },
      paragraphs: [{ id: 'starter-body', text: 'Approve {{NAME}} for the training activity.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [],
    })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Review draft', exact: true })).toBeHidden();
    let dialog = await openPackages(page);
    await dialog.getByLabel('Package name', { exact: true }).fill('Training action starter');
    await dialog.getByRole('button', { name: 'Create package', exact: true }).click();
    await dialog.getByRole('button', { name: 'Capture current document', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '1. ACTION FOR {{NAME}}', exact: true })).toBeVisible();
    const pdf = await PDFDocument.create(); const pdfPage = pdf.addPage([612, 792]);
    pdfPage.drawText('FRESH TRAINING ENCLOSURE', { x: 40, y: 730, font: await pdf.embedFont(StandardFonts.Helvetica), size: 12 });
    const fresh = Buffer.from(await pdf.save());
    await dialog.getByLabel('New member role', { exact: true }).selectOption('enclosure');
    await dialog.getByLabel('Add original PDF', { exact: true }).setInputFiles({ name: 'support.pdf', mimeType: 'application/pdf', buffer: fresh });
    await expect(dialog.getByRole('heading', { name: '2. support.pdf', exact: true })).toBeVisible();
    await dialog.locator('summary').filter({ hasText: 'Reusable package templates' }).click();
    let panel = dialog.getByRole('region', { name: 'Reusable package templates', exact: true });
    await panel.getByLabel('Template name', { exact: true }).fill('Training package template');
    await panel.getByRole('checkbox', { name: /I reviewed the source starter text/ }).check();
    await panel.getByRole('button', { name: 'Save package template', exact: true }).click();
    await expect(panel.getByText('Package template saved.', { exact: true })).toBeVisible();
    await page.reload();
    dialog = await openPackages(page); await dialog.locator('summary').filter({ hasText: 'Reusable package templates' }).click(); panel = dialog.getByRole('region', { name: 'Reusable package templates', exact: true });
    await panel.getByLabel('Saved package templates', { exact: true }).selectOption({ label: 'Training package template' });
    await panel.getByRole('button', { name: 'Review template export', exact: true }).click();
    await panel.getByRole('checkbox', { name: /I reviewed this template's retained text/ }).check();
    const templateFile = await downloaded(page, () => panel.getByRole('button', { name: 'Download reviewed package template', exact: true }).click());
    const portable = JSON.parse(templateFile.toString('utf8'));
    expect(portable.members[1].kind).toBe('attachment');
    expect(portable.members[1].original).toBeUndefined();
    await panel.getByRole('button', { name: 'Delete template', exact: true }).click();
    await expect(panel.getByLabel('Saved package templates', { exact: true }).getByRole('option', { name: 'Training package template', exact: true })).toHaveCount(0);
    await panel.getByLabel('Import package template', { exact: true }).setInputFiles({ name: 'portable-starter.json', mimeType: 'application/json', buffer: templateFile });
    await expect(panel.getByRole('button', { name: 'Import reviewed package template', exact: true })).toBeDisabled();
    await panel.getByRole('checkbox', { name: /I reviewed this template's retained text/ }).check();
    await panel.getByRole('button', { name: 'Import reviewed package template', exact: true }).click();
    await expect(panel.getByText('Package template imported.', { exact: true })).toBeVisible();
    await panel.getByRole('heading', { name: 'Reusable package templates', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('template-controls.png'), fullPage: true });
    await panel.getByLabel('New action name', { exact: true }).fill('Fresh training action');
    await panel.getByLabel('Template value NAME', { exact: true }).fill('NEW MARINE');
    await panel.getByRole('checkbox', { name: /I reviewed the retained starter contents/ }).check();
    await expect(panel.getByRole('button', { name: 'Create package from template', exact: true })).toBeDisabled();
    await panel.getByLabel('Fresh PDF for support.pdf', { exact: true }).setInputFiles({ name: 'fresh-support.pdf', mimeType: 'application/pdf', buffer: fresh });
    await expect(panel.getByText('fresh-support.pdf', { exact: true })).toBeVisible();
    await panel.getByRole('checkbox', { name: /I reviewed the retained starter contents/ }).check();
    await panel.getByRole('button', { name: 'Create package from template', exact: true }).click();
    await expect(dialog.getByLabel('Package name', { exact: true })).toHaveValue('Fresh training action');
    await dialog.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Package readiness: ready', exact: true })).toBeVisible();
    await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
    await dialog.getByRole('button', { name: 'Assemble and retain PDF', exact: true }).click();
    await expect(dialog.getByText(/^Assembled PDF retained\./)).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Download retained PDF', exact: true }).click();
    await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
    const output = await downloaded(page, () => dialog.getByRole('button', { name: 'Download reviewed retained PDF', exact: true }).click());
    expect((await PDFDocument.load(output)).getForm().getFields()).toHaveLength(0);
    const document = await getDocument({ data: new Uint8Array(output), useSystemFonts: false }).promise;
    try {
      expect(document.numPages).toBe(2);
      const text = (await (await document.getPage(1)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
      expect(text).toContain('NEW MARINE'); expect(text).not.toContain('{{NAME}}');
      const second = (await (await document.getPage(2)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
      expect(second).toContain('FRESH TRAINING ENCLOSURE');
    } finally { await document.destroy(); }
    await writeFile(info.outputPath('fresh-package.pdf'), output);
    await info.attach('fresh-package.pdf', { body: output, contentType: 'application/pdf' });
    await page.screenshot({ path: info.outputPath('package-template.png'), fullPage: true });
  });
}
