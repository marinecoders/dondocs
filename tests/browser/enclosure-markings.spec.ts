import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

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
    formData: { classLevel: 'cui', cuiControlledBy: 'Synthetic office', cuiCategory: 'Privacy', pocEmail: 'synthetic@example.test',
      date: '20 Nov 26', subject: 'SYNTHETIC ENCLOSURE MARKINGS', unitLine1: 'SYNTHETIC TRAINING UNIT', from: 'Synthetic sender', to: 'Synthetic recipient', sigLast: 'EXAMPLE' },
    enclosures: [{ title: 'Synthetic appendix', marking: { classLevel: 'cui', cuiCategory: 'Legal' },
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
  await page.getByLabel('CUI categories', { exact: true }).fill('Privacy');
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
