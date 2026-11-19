import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const theme of ['light', 'dark', 'classic']) {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 320, height: 568 }]) {
    test.describe(`${theme} at ${viewport.width}px`, () => {
      test.use({ viewport });

      test('reviews current findings and opens the exact editor field without editing it', async ({ page }, testInfo) => {
        await page.addInitScript(theme => {
          localStorage.setItem('browser-test-visitor', 'returning');
          localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme, editorLayout: 'focused' }, version: 1 }));
        }, theme);
        await page.goto('/');
        const draft = {
          documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
          formData: { unitLine1: 'SYNTHETIC UNIT', from: 'Commanding Officer', to: 'Director', date: '2026-11-12',
            sigLast: 'EXAMPLE', subject: 'SYNTHETIC REVIEW' },
          paragraphs: [{ id: 'synthetic-review-body', text: 'A synthetic paragraph for review.', level: 0 }],
          references: [], enclosures: [], copyTos: [], distributions: [],
        };
        await page.getByLabel('Import draft file').setInputFiles({ name: 'synthetic-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
        await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Review draft', exact: true })).toBeHidden();
        const entry = page.getByRole('button', { name: /^Proofread: \d+ findings?$/ });
        await entry.click();
        const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
        await expect(dialog.getByText('Use the date format for this document.', { exact: true })).toBeVisible();
        const status = dialog.getByRole('status').first();
        const count = Number((await status.textContent())?.match(/\d+/)?.[0]);
        expect(count).toBeGreaterThan(0);
        await expect(dialog.locator('li')).toHaveCount(count);
        await expect(dialog.getByText(/Birth Date.*pattern/)).toHaveCount(0);
        expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
        await page.screenshot({ path: testInfo.outputPath(`proofread-${theme}-${viewport.width}.png`) });
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(entry).toBeFocused();

        await entry.click();
        const dateFinding = dialog.locator('li').filter({ hasText: 'Use the date format for this document.' });
        const go = dateFinding.getByRole('button', { name: 'Go to Addressing', exact: true });
        await go.focus();
        await page.keyboard.press('Enter');
        await expect(dialog).toBeHidden();
        const date = page.locator('#date');
        await expect(date).toBeFocused();
        await expect(date).toHaveValue('2026-11-12');
        await expect(page.locator('#subject')).toHaveValue('SYNTHETIC REVIEW');
        await page.getByRole('button', { name: 'Apply date formatting fix' }).click();
        await expect(date).toHaveValue('12 Nov 26');
        await entry.click();
        await expect(dialog.getByText('Use the date format for this document.', { exact: true })).toHaveCount(0);
        await expect(dialog.getByText(/No findings from the available checks/)).toBeVisible();
        await dialog.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(dialog).toBeHidden();
      });
    });
  }
}

test('combines existing check groups and links a sensitive-text finding to its own paragraph', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'focused' }, version: 1 }));
  });
  await page.goto('/');
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
    formData: { unitLine1: '', from: 'Commanding Officer', to: 'Director', date: '2026-11-12',
      sigLast: 'EXAMPLE', subject: 'SYNTHETIC REVIEW', classLevel: 'unclassified' },
    paragraphs: [{ id: 'synthetic-opening', text: 'NATO reference (z).', level: 0 },
      { id: 'synthetic-sensitive', text: 'Synthetic example 123-45-6789.', header: 'Synthetic heading', level: 1, portionMarking: 'S' }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'synthetic-findings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review draft', exact: true })).toBeHidden();
  await page.getByRole('button', { name: /^Proofread: \d+ findings?$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
  for (const group of ['Required fields', 'Formatting', 'Paragraph structure', 'References', 'Markings', 'Abbreviations', 'Sensitive text']) {
    await expect(dialog.getByRole('heading', { name: new RegExp(`^${group} \\(`) })).toHaveCount(1);
  }
  await expect(dialog).not.toContainText('123-45-6789');
  const privacy = dialog.locator('li').filter({ hasText: 'Social Security Number pattern in Paragraph 2' });
  await privacy.getByRole('button', { name: 'Go to Paragraphs', exact: true }).click();
  await expect(dialog).toBeHidden();
  const body = page.locator('[data-paragraph-id="synthetic-sensitive"] [contenteditable="true"]');
  await expect(body).toBeFocused();
  await expect(body).toHaveText('Synthetic example 123-45-6789.');
});

for (const width of [320, 1440]) test(`opens sensitive paragraph headings and table cells at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused', previewVisible: false } }));
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'rich-proofread.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { unitLine1: 'SYNTHETIC UNIT', date: '19 Nov 26', subject: 'SYNTHETIC RICH REVIEW', from: 'Training Officer', to: 'Director', sigLast: 'EXAMPLE' },
    paragraphs: [{ id: 'rich-heading', text: 'Ordinary body text.', header: 'Synthetic 123-45-6789', level: 0 },
      { id: 'rich-table', text: '', level: 0, bodyTable: { headerRows: 1, rows: [['One', 'Two'], ['Ordinary', 'Synthetic 321-54-9876']] } }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const proofread = page.getByRole('button', { name: /^Proofread:/ });
  for (const [title, name, value] of [
    ['Social Security Number pattern in Paragraph 1 heading', 'Heading for paragraph 1', 'Synthetic 123-45-6789'],
    ['Social Security Number pattern in Paragraph 2', 'Table 2, row 2, column 2', 'Synthetic 321-54-9876'],
  ]) {
    await proofread.click();
    const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
    const row = dialog.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) });
    await row.getByRole('button', { name: 'Go to Paragraphs', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name, exact: true })).toBeFocused();
    await expect(page.getByRole('textbox', { name, exact: true })).toHaveValue(value);
  }
});

test('filters retained inactive fields and follows a legacy signer into its current memo control', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused', previewVisible: false } }));
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'joint-proofread.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'joint_memorandum',
    formData: { date: '19 Nov 26', subject: 'SYNTHETIC JOINT REVIEW', classLevel: 'unclassified',
      cuiControlledBy: 'cui@example.test', classifiedBy: 'authority@example.test', jointSeniorSigName: 'legacy@example.test',
      jointMemoSeniorSigName: 'CURRENT SIGNER', jointMemoJuniorSigName: 'JUNIOR' },
    paragraphs: [{ id: 'joint-review', text: 'Synthetic body text.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const proofread = page.getByRole('button', { name: /^Proofread:/ });
  await proofread.click();
  const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
  await expect(dialog.getByText(/pattern in Form: (?:cuiControlledBy|classifiedBy|jointSeniorSigName)/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('combobox', { name: 'Document section', exact: true }).selectOption('joint_memo');
  const signer = page.locator('#jointMemoSeniorSigName');
  await signer.fill('current@example.test');
  await proofread.click();
  const row = dialog.getByRole('listitem').filter({ has: page.getByText('Personal Email Address pattern in Form: jointMemoSeniorSigName', { exact: true }) });
  await row.getByRole('button', { name: 'Go to Commands', exact: true }).click();
  await expect(signer).toBeFocused();
  await signer.fill('CURRENT SIGNER');
  await proofread.click();
  await expect(dialog.getByText(/Personal Email Address pattern/)).toHaveCount(0);
});

test('opens figure alternatives and table footnotes at their own inputs', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused', previewVisible: false } }));
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'figure-footnote-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentCategory: 'correspondence', documentMode: 'compliant', docType: 'i_type',
    formData: { date: '19 Nov 26', subject: 'SYNTHETIC FIGURE REVIEW', classLevel: 'unclassified' },
    paragraphs: [{ id: 'figure-caption', level: 0, text: 'Synthetic caption 123-45-6789', figure: { altText: 'Ordinary description' } },
      { id: 'figure-alternative', level: 0, text: 'Ordinary caption', figure: { altText: 'Synthetic alternative 321-54-9876' } },
      { id: 'table-footnote', level: 0, text: 'Ordinary text', tableKey: 'majorItems', tableFootnotes: [{ id: '1', text: 'Synthetic footnote 213-54-9876' }] }],
    references: [], enclosures: [], copyTos: [], distributions: [], publicationTables: {},
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  for (const [title, name] of [
    ['Social Security Number pattern in Paragraph 1', 'Paragraph 1'],
    ['Social Security Number pattern in Paragraph 2', 'Alternative text for image 2'],
    ['Social Security Number pattern in Paragraph 3 footnote 1', 'Table footnote 1'],
  ]) {
    await page.getByRole('button', { name: /^Proofread:/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
    await dialog.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) }).getByRole('button', { name: 'Go to Paragraphs', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name, exact: true })).toBeFocused();
  }
});

for (const docType of ['sl3', 'sl4']) test(`opens ${docType} stock-list illustration captions at their title input`, async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused', previewVisible: false } }));
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'stock-caption-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentCategory: 'correspondence', documentMode: 'compliant', docType,
    formData: { date: '19 Nov 26', subject: 'SYNTHETIC STOCK CAPTION', classLevel: 'unclassified' },
    paragraphs: [{ id: 'stock-caption', referenceId: 'stock-figure', level: 0, text: 'Synthetic caption 123-45-6789', figure: {} }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: /^Proofread:/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
  await dialog.getByRole('listitem').filter({ has: page.getByText('Social Security Number pattern in Paragraph 1', { exact: true }) }).getByRole('button', { name: 'Go to Illustrations', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Illustration 1 (unassigned) title', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Illustration 1 (unassigned) title', exact: true })).toHaveValue('Synthetic caption 123-45-6789');
});

test('reviews composed CUI statement text through its actual statement selector', async ({ page }) => {
  await page.route('**/classification.config.json?*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ maxLevel: 'cui', allowedLevels: ['unclassified', 'cui'], overrideDomain: '127.0.0.1' }) }));
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused', previewVisible: false } }));
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'statement-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter',
    formData: { date: '19 Nov 26', subject: 'SYNTHETIC STATEMENT REVIEW', classLevel: 'cui', cuiControlledBy: 'Training Office', cuiCategory: 'Privacy',
      cuiDistStatement: 'B', distDate: '2026-11-19', distReason: 'Synthetic reason 123-45-6789', controllingOffice: 'Synthetic office office@example.test' },
    paragraphs: [{ id: 'statement-body', text: 'Synthetic statement review.', level: 0, portionMarking: 'CUI' }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: /^Proofread:/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
  const ssn = dialog.getByRole('listitem').filter({ has: page.getByText('Social Security Number pattern in Distribution statement', { exact: true }) });
  await expect(ssn).toHaveCount(1);
  await expect(dialog.getByText('Personal Email Address pattern in Distribution statement', { exact: true })).toHaveCount(1);
  await ssn.getByRole('button', { name: 'Go to Classification', exact: true }).click();
  const statement = page.getByRole('combobox', { name: 'Distribution Statement', exact: true });
  await expect(statement).toBeFocused();
  await statement.click();
  await page.getByRole('option', { name: /^F - Further dissemination/ }).click();
  await page.getByRole('button', { name: /^Proofread:/ }).click();
  await expect(dialog.getByText('Social Security Number pattern in Distribution statement', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Personal Email Address pattern in Distribution statement', { exact: true })).toHaveCount(1);
});
