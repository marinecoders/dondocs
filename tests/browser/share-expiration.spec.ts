import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
// One scenario performs several real encryption/decryption and import rounds.
test.setTimeout(60_000);
const NOW = Date.UTC(2026, 10, 13, 12);

async function waitForShareOperation(dialog: Locator) {
  // Real encryption/decryption can run alongside preview compilation in CI.
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled({ timeout: 30_000 });
}

async function share(page: Page) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const desktop = page.getByRole('button', { name: 'Share', exact: true });
  if (await desktop.isVisible()) await desktop.click();
  else {
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Create share link/ }).click();
  }
  return page.getByRole('dialog', { name: 'Share document', exact: true });
}

async function review(page: Page, link: string) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open from share link', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Open shared document', exact: true });
  await dialog.getByLabel('Share link', { exact: true }).fill(link);
  await dialog.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await dialog.getByRole('button', { name: 'Decrypt and review', exact: true }).click();
  await waitForShareOperation(dialog);
  return dialog;
}

test('opens a legacy encrypted letter from the URL fragment', async ({ page }) => {
  // A synthetic draft encrypted independently with the original unprefixed codec.
  const token = 'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW63Y3ZGi-RR5KTHiTKRc19dQZ11mS4n1j8sqrGpW9cyxDT-7jZa60IjPqeM3eV97s8qhZwQYAu1fjtUKNOiP4l-n5JxzB5goFJLKRfIN7r7ljcdwv8xgcFQAbvXNR9D4t12KnWAtRekcLCUg2IL_S1o-SqdgC0kDYRb0XhgCL1awmziVrMYrIwaEoOIVNruk0c4JKHaUlVaREEmVYF6VedsqgpJHvfVhv2ZYj_-BQA4J-ij-DFdVkTbSTkxR1aTgrhLvFrDE3v1xFXX7M76SzqKEubU';
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto(`/#s=${token}`);
  const dialog = page.getByRole('dialog', { name: 'Open shared document', exact: true });
  await dialog.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await dialog.getByRole('button', { name: 'Decrypt and review', exact: true }).click();
  await expect(dialog).toContainText('SYNTHETIC LEGACY LETTER');
  await dialog.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('SYNTHETIC LEGACY LETTER');
});

for (const theme of ['light', 'dark', 'classic']) {
  test(`expiration protects import while ordinary shares remain usable in ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: value, editorLayout: 'scroll' }, version: 1 }));
    }, theme);
    await page.clock.install({ time: NOW });
    await page.clock.setFixedTime(NOW);
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
      formData: { subject: 'SHARED SYNTHETIC SUBJECT' }, paragraphs: [{ text: 'Synthetic shared text.', level: 0 }], references: [], enclosures: [], copyTos: [],
    })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    let dialog = await share(page);
    await dialog.getByLabel('Password for this link', { exact: true }).fill('synthetic-password');
    await dialog.getByLabel('Link expiration', { exact: true }).selectOption('hour');
    await dialog.getByRole('button', { name: 'Generate link', exact: true }).click();
    await waitForShareOperation(dialog);
    const output = dialog.locator('#generated-share-link');
    await expect(output).toBeVisible();
    const expiringLink = await output.inputValue();
    expect(new URL(expiringLink).hash).toMatch(/^#s=v2\./);
    await expect(dialog).toContainText('Requires an updated DonDocs reader.');
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await output.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`share-expiration-${theme}.png`) });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('CURRENT DRAFT PRESERVED');

    dialog = await review(page, expiringLink);
    await expect(dialog).toContainText('SHARED SYNTHETIC SUBJECT');
    await dialog.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('SHARED SYNTHETIC SUBJECT');
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('CURRENT DRAFT PRESERVED');

    dialog = await review(page, expiringLink);
    await expect(dialog.getByRole('button', { name: 'Open as new document', exact: true })).toBeVisible();
    await page.clock.setFixedTime(NOW + 3_600_000);
    await dialog.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('expired');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('CURRENT DRAFT PRESERVED');

    dialog = await review(page, expiringLink);
    await expect(dialog.getByRole('alert')).toContainText('expired');
    await expect(dialog.getByRole('button', { name: 'Open as new document', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('CURRENT DRAFT PRESERVED');

    dialog = await share(page);
    await expect(dialog.getByLabel('Link expiration')).toHaveValue('none');
    await dialog.getByLabel('Password for this link', { exact: true }).fill('synthetic-password');
    await dialog.getByRole('button', { name: 'Generate link', exact: true }).click();
    await waitForShareOperation(dialog);
    await expect(dialog.locator('#generated-share-link')).toBeVisible();
    const ordinaryLink = await dialog.locator('#generated-share-link').inputValue();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.clock.setFixedTime(NOW + 8 * 86_400_000);
    dialog = await review(page, ordinaryLink);
    await dialog.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('CURRENT DRAFT PRESERVED');
  });
}

test('rejects a weak new share password and opens a link with an app-generated password', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'scroll', previewVisible: false } }));
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'generated-share-password.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'GENERATED PASSWORD FIXTURE' }, paragraphs: [{ text: 'Synthetic password policy training.', level: 0 }], references: [], enclosures: [], copyTos: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let dialog = await share(page);
  const passwordInput = dialog.getByLabel('Password for this link');
  await passwordInput.fill('weak');
  await dialog.getByRole('button', { name: 'Generate link', exact: true }).click();
  await expect(dialog.getByText('Set a password of at least 15 characters or generate a random one.')).toBeVisible();
  await expect(dialog.locator('#generated-share-link')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Generate password', exact: true }).click();
  const password = await passwordInput.inputValue();
  expect(password).toMatch(/^[A-Za-z0-9_-]{22}$/);
  await dialog.getByRole('button', { name: 'Generate link', exact: true }).click();
  const link = await dialog.locator('#generated-share-link').inputValue();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open from share link', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Open shared document', exact: true });
  await dialog.getByLabel('Share link', { exact: true }).fill(link);
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Decrypt and review', exact: true }).click();
  await expect(dialog).toContainText('GENERATED PASSWORD FIXTURE');
  await dialog.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('GENERATED PASSWORD FIXTURE');
});
