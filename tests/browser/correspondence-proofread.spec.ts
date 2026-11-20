import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const theme of ['light', 'dark', 'classic']) {
  test(`reviews type-aware findings and clears personal checks in ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript(theme => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme, editorLayout: 'focused' }, version: 1 }));
    }, theme);
    await page.goto('/');
    const draft = {
      documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
      formData: { date: '19 Nov 26', subject: 'SYNTHETIC PROOFREAD.' },
      paragraphs: [{ text: 'See enclosure (2) for the fictional supporting document.', level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [],
    };
    const importDraft = async (name: string) => {
      await page.getByLabel('Import draft file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
      await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Review draft', exact: true })).toBeHidden();
    };
    await importDraft('proofread-synthetic.json');
    const proofread = page.getByRole('button', { name: /^Proofread: \d+ findings?$/ });
    await proofread.click();
    const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
    await expect(dialog.getByText('Review subject punctuation', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Check enclosure (2)', { exact: true })).toHaveCount(1);
    const firstCheck = dialog.getByRole('checkbox', { name: 'Inspect the letterhead and its alignment.' });
    await firstCheck.check();
    await expect(dialog.getByText('1 of 15 personal checks completed')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`proofread-${theme}.png`), fullPage: true });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await proofread.click();
    await expect(firstCheck).toBeChecked();
    const subjectFinding = dialog.getByRole('listitem').filter({ has: page.getByText('Review subject punctuation', { exact: true }) });
    await subjectFinding.getByRole('button', { name: /^Go to/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#subject')).toBeFocused();
    await page.locator('#subject').fill('SYNTHETIC PROOFREAD');
    await proofread.click();
    await expect(dialog.getByText('Review subject punctuation', { exact: true })).toHaveCount(0);
    await expect(firstCheck).not.toBeChecked();
    await firstCheck.check();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();

    // Importing the same content as another document must not carry confirmations.
    await importDraft('another-proofread-synthetic.json');
    await proofread.click();
    await expect(firstCheck).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
}

test('opens the CUI contact field in a format without a Signature section', async ({ page }) => {
  // Synthetic content under the application's supported local deployment override.
  await page.route('**/classification.config.json*', route => route.fulfill({
    json: { maxLevel: 'cui', allowedLevels: ['unclassified', 'cui'] },
  }));
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'focused', previewVisible: false }, version: 1 }));
  });
  await page.goto('/');
  const draft = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'joint_letter', formType: 'navmc_10274',
    formData: { date: '19 Nov 26', jointJuniorDate: '19 Nov 26', jointSubject: 'SYNTHETIC CONTACT CHECK',
      classLevel: 'cui', cuiControlledBy: 'Synthetic training office', cuiCategory: 'PRVCY' },
    paragraphs: [{ text: 'Fictional test content.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'fictional-cui-contact.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const proofread = page.getByRole('button', { name: /^Proofread: \d+ findings?$/ });
  await proofread.click();
  const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
  const finding = dialog.getByRole('listitem').filter({ has: page.getByText('POC email is empty', { exact: true }) });
  await finding.getByRole('button', { name: 'Go to Classification', exact: true }).click();
  await expect(page.locator('#cuiPocEmail')).toBeFocused();
  await page.locator('#cuiPocEmail').fill('training-office@example.test');
  await proofread.click();
  await expect(dialog.getByText('POC email is empty', { exact: true })).toHaveCount(0);
});

test('checks visible enclosure citations through native formatting and retains literal protections', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused', previewVisible: false } }));
  });
  await page.goto('/');
  for (const citation of ['__enclosure (2)__', '**enclosure** (2)', 'enclosure **(2)**']) {
    const draft = {
      documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter', formType: 'navmc_10274',
      formData: { date: '19 Nov 26', subject: 'SYNTHETIC FORMATTED CITATION', unitLine1: 'SYNTHETIC TRAINING UNIT', from: 'Synthetic sender', to: 'Synthetic recipient', sigLast: 'EXAMPLE' },
      paragraphs: [{ id: 'formatted-citation', level: 0, text: `See ${citation}. Example **"enclosure (3)"** stays literal.` }],
      references: [], enclosures: [{ title: 'Only existing enclosure' }], copyTos: [], distributions: [],
    };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'formatted-citation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await page.getByRole('button', { name: /^Proofread:/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
    const finding = dialog.getByRole('listitem').filter({ has: page.getByText('Check enclosure (2)', { exact: true }) });
    await expect(finding).toHaveCount(1);
    await expect(dialog.getByText('Check enclosure (3)', { exact: true })).toHaveCount(0);
    await finding.getByRole('button', { name: 'Go to Paragraphs', exact: true }).click();
    const editor = page.locator('[data-paragraph-id="formatted-citation"] [contenteditable="true"]');
    await expect(editor).toBeFocused();
    await expect(editor).toContainText('See enclosure (2).');
  }
});

test('keeps imported additional endorsement identities distinct from the primary editor target', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused', previewVisible: false } }));
  });
  await page.goto('/');
  const draft = {
    documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter', formType: 'navmc_10274',
    formData: { date: '19 Nov 26', subject: 'SYNTHETIC ENDORSEMENT TARGET', unitLine1: 'SYNTHETIC TRAINING UNIT', from: 'Synthetic sender', to: 'Synthetic recipient', sigLast: 'EXAMPLE',
      appendEndorsement: true, endorsementBody: 'Primary endorsement already complete.', additionalEndorsements: [{ id: 'first-endorsement', endorsementSigLast: 'EXTRA' }] },
    paragraphs: [{ id: 'endorsement-body', level: 0, text: 'Synthetic body.' }], references: [], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'endorsement-target.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const proofread = page.getByRole('button', { name: /^Proofread:/ });
  const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
  await proofread.click();
  await dialog.getByRole('listitem').filter({ hasText: 'Additional endorsement needs text' }).getByRole('button', { name: 'Go to Signature', exact: true }).click();
  const extra = page.locator('#additional-endorsement-first-endorsement-body');
  await expect(extra).toBeFocused();
  await expect(page.locator('[id="first-endorsement-body"]')).toHaveCount(1);
  await expect(page.locator('#first-endorsement-body')).toHaveValue('Primary endorsement already complete.');
  await extra.fill('See __enclosure (3)__.');
  await proofread.click();
  await expect(dialog.getByText('Additional endorsement needs text', { exact: true })).toHaveCount(0);
  await dialog.getByRole('listitem').filter({ has: page.getByText('Check enclosure (3)', { exact: true }) }).getByRole('button', { name: 'Go to Signature', exact: true }).click();
  await expect(extra).toBeFocused();
  await expect(page.locator('#first-endorsement-body')).toHaveValue('Primary endorsement already complete.');
  await page.screenshot({ path: info.outputPath('additional-endorsement-target.png') });
});

test('checks enclosure ranges and semicolon lists and exposes ambiguous clauses for review', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused', previewVisible: false } }));
  });
  await page.goto('/');
  for (const [text, title] of [
    ['See enclosures (1)-(2).', 'Check enclosure range (1)–(2)'],
    ['See enclosures (1); (2).', 'Check enclosure (2)'],
    ['See enclosures (1) through (9007199254740991).', 'Check enclosure range (1)–(9007199254740991)'],
    ['See enclosures (1): (2).', 'Review the enclosure citation'],
  ]) {
    const draft = {
      documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter', formType: 'navmc_10274',
      formData: { date: '19 Nov 26', subject: 'SYNTHETIC ENCLOSURE CLAUSE', unitLine1: 'SYNTHETIC TRAINING UNIT', from: 'Synthetic sender', to: 'Synthetic recipient', sigLast: 'EXAMPLE' },
      paragraphs: [{ id: 'enclosure-clause', level: 0, text }], references: [], enclosures: [{ title: 'Only existing enclosure' }], copyTos: [], distributions: [],
    };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'enclosure-clause.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await page.getByRole('button', { name: /^Proofread:/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
    const finding = dialog.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) });
    await expect(finding).toHaveCount(1);
    await page.screenshot({ path: info.outputPath(`enclosure-clause-${title.includes('9007') ? 'large' : title.includes('range') ? 'range' : title.includes('Review') ? 'manual' : 'list'}.png`) });
    await finding.getByRole('button', { name: 'Go to Paragraphs', exact: true }).click();
    const editor = page.locator('[data-paragraph-id="enclosure-clause"] [contenteditable="true"]');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText(text);
  }
});
