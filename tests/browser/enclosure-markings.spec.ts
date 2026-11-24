import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { downloadBrowserPdf } from '../_helpers/downloadBrowserPdf';

test.use({ serviceWorkers: 'block' });
test.setTimeout(60_000);

async function draftDownload(page: Page) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  const file = await download;
  expect(await file.failure()).toBeNull();
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}

for (const theme of ['light', 'dark', 'classic']) test(`reviews mixed enclosure markings and retains the original in ${theme}`, async ({ page }, info) => {
  await page.route('**/classification.config.json*', route => route.fulfill({
    json: { maxLevel: 'cui', allowedLevels: ['unclassified', 'cui'] },
  }));
  await page.addInitScript(theme => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme, editorLayout: 'focused', previewVisible: false } }));
  }, theme);
  await page.goto('/');
  const bytes = await readFile('tests/fixtures/permission-pdfs/source.pdf');
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
    formData: { classLevel: 'cui', cuiControlledBy: 'Synthetic office', cuiCategory: 'PRVCY', pocEmail: 'synthetic@example.test',
      date: '20 Nov 26', subject: 'SYNTHETIC ENCLOSURE MARKINGS', unitLine1: 'SYNTHETIC TRAINING UNIT', from: 'Synthetic sender', to: 'Synthetic recipient', sigLast: 'EXAMPLE' },
    enclosures: [{ title: 'Synthetic appendix', marking: { classLevel: 'cui', cuiCategory: 'PRIVILEGE' },
      file: { name: 'source.pdf', size: bytes.length, data: bytes.toString('base64') } }],
    paragraphs: [{ id: 'public-training', level: 0, text: 'Fictional public training text.' }], references: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'mixed-markings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review draft', exact: true })).toBeHidden();
  const proofread = page.getByRole('button', { name: /^Proofread:/ });
  await proofread.click();
  const panel = page.getByRole('dialog', { name: 'Proofread', exact: true });
  const finding = panel.getByRole('listitem').filter({ has: page.getByText('Review enclosure (1) marking', { exact: true }) });
  await expect(finding).toContainText('does not list all declared enclosure CUI categories');
  await finding.getByRole('button', { name: 'Go to Enclosures', exact: true }).click();
  const marking = page.getByRole('combobox', { name: 'Enclosure (1) marking', exact: true });
  await expect(marking).toBeFocused();
  await page.locator('#sec-enclosures').getByLabel('CUI categories', { exact: true }).fill('General Privacy');
  await proofread.click();
  await expect(panel.getByText('Review enclosure (1) marking', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`enclosure-markings-${theme}.png`), fullPage: true });
  await marking.click();
  await page.getByRole('option', { name: 'UNCLASSIFIED', exact: true }).click();
  const saved = await draftDownload(page);
  expect(saved.version).toBe(5);
  expect(saved.enclosures[0].marking).toEqual({ classLevel: 'unclassified' });
  expect(saved.enclosures[0].file.data).toBe(bytes.toString('base64'));
  await expect(page.getByText(/^Saved(?: ·.*)?$/)).toBeVisible();
  await page.reload();
  const retained = await draftDownload(page);
  expect(retained.enclosures[0].marking).toEqual({ classLevel: 'unclassified' });
  expect(retained.enclosures[0].file.data).toBe(bytes.toString('base64'));
  await proofread.click();
  await expect(panel.getByText('Review enclosure (1) marking', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
});

test('reviews saved CUI entries before downloading actual PDF and Word files', async ({ page }, info) => {
  await page.route('**/classification.config.json*', route => route.fulfill({
    json: { maxLevel: 'cui', allowedLevels: ['unclassified', 'cui'] },
  }));
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
    formData: {
      classLevel: 'cui', cuiControlledBy: 'Synthetic training office', cuiCategory: 'Privacy', cuiDissemination: 'NOFRN',
      date: '20 Nov 26', subject: 'SYNTHETIC CUI REVIEW', unitLine1: 'SYNTHETIC TRAINING UNIT',
      from: 'Synthetic sender', to: 'Synthetic recipient', sigLast: 'EXAMPLE',
    },
    paragraphs: [{ id: 'public-training', level: 0, text: 'Fictional public training text.' }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({
    name: 'legacy-cui.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)),
  });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review draft', exact: true })).toBeHidden();

  const proofread = page.getByRole('button', { name: /^Proofread:/ });
  await proofread.click();
  const panel = page.getByRole('dialog', { name: 'Proofread', exact: true });
  const categoryFinding = panel.getByRole('listitem').filter({ hasText: 'Review CUI categories' });
  await categoryFinding.getByRole('button', { name: /Go to/ }).click();
  const category = page.getByLabel('CUI categories', { exact: true });
  const control = page.getByLabel('Dissemination controls', { exact: true });
  await expect(category).toHaveValue('Privacy');
  await expect(control).toHaveValue('NOFRN');
  await expect(category).toHaveAttribute('aria-invalid', 'true');

  const word = async () => {
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  };
  await word();
  const failure = page.getByRole('dialog').filter({ hasText: 'Review CUI dissemination controls' });
  await expect(failure).toContainText('Review CUI categories');
  await failure.getByRole('button', { name: 'Close', exact: true }).last().click();

  await category.fill('General Privacy');
  await control.fill('fedcon');
  await expect(category).toHaveAttribute('aria-invalid', 'false');
  await expect(control).toHaveAttribute('aria-invalid', 'false');

  const saving = page.waitForEvent('download');
  await word();
  const wordDownload = await saving;
  const zip = await JSZip.loadAsync(await readFile((await wordDownload.path())!), { checkCRC32: true });
  const content = await zip.file('word/document.xml')!.async('string');
  expect(content).toContain('PRVCY');
  expect(content).toContain('FEDCON');
  expect(content).not.toContain('NOFRN');

  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  const launchPdf = async () => {
    if (await preview.getAttribute('aria-haspopup') === 'dialog') {
      await preview.click();
      await page.getByRole('dialog', { name: 'PDF preview', exact: true }).getByRole('button', { name: 'Download', exact: true }).click();
    } else {
      if (await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
      await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
    }
  };
  const pdf = await getDocument({ data: new Uint8Array(await downloadBrowserPdf(page, info.project.name, launchPdf)), useSystemFonts: false }).promise;
  try {
    const items = (await (await pdf.getPage(1)).getTextContent()).items.map(item => 'str' in item ? item.str : '');
    expect(items.filter(item => item === 'CUI')).toHaveLength(2);
    expect(items.join(' ')).toContain('PRVCY');
    expect(items.join(' ')).toContain('FEDCON');
    expect(items.join(' ')).not.toContain('NOFRN');
  } finally {
    await pdf.destroy();
  }
  const saved = await draftDownload(page);
  expect(saved.formData).toMatchObject({ cuiCategory: 'General Privacy', cuiDissemination: 'fedcon' });
});
