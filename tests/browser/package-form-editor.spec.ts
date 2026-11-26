import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, test, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { capturePackageDocument } from '../_helpers/capturePackageDocument';
import { openAddDocuments, newBlankPackage, openPackageWorkspace, packageSection } from './_helpers/packageWorkspace';

test.use({ serviceWorkers: 'block' });
test.setTimeout(150_000);

async function checkPreview(editor: Locator, page: Page, expected: string, field?: string) {
  const show = editor.getByRole('button', { name: 'Show preview' });
  if (await show.isVisible()) await show.click();
  await expect(editor.locator('[data-pdf-layer="active"] canvas').first()).toBeVisible({ timeout: 30_000 });
  let previous: string | undefined, text = '';
  let box: number[] | undefined;
  await expect.poll(async () => {
    const url = await editor.locator('[data-pdf-layer="active"]').getAttribute('data-preview-blob');
    if (!url || previous === url) return text;
    const data = await page.evaluate(async url => {
      try {
        const blob = await (await fetch(url)).blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch { return ''; } // A newer preview can revoke the URL during a retry.
    }, url);
    if (!data) return '';
    previous = url;
    const pdf = await getDocument({ data: Uint8Array.from(Buffer.from(data, 'base64')), useSystemFonts: true }).promise;
    try {
      if (field) {
        const fields = await pdf.getFieldObjects();
        const widget = fields?.[field]?.[0] as { value?: string; rect?: number[]; page?: number } | undefined;
        text = String(widget?.value ?? '');
        if (widget?.rect && widget.page === 0) {
          const view = (await pdf.getPage(1)).getViewport({ scale: 1 });
          box = view.convertToViewportRectangle(widget.rect).map((coordinate, i) =>
            coordinate / (i % 2 ? view.height : view.width));
        }
      } else {
        const content = await (await pdf.getPage(1)).getTextContent();
        text = content.items.map(item => 'str' in item ? item.str : '').join(' ');
      }
    } finally { await pdf.destroy(); }
    return text;
  }, { timeout: 30_000 }).toContain(expected);
  // Compare the pixels inside the official name widget too. Stored answers alone do not prove a visible appearance.
  let painted = '';
  if (field) {
    expect(box).toBeDefined();
    const canvas = editor.locator('[data-pdf-layer="active"] [data-page-number="1"] canvas');
    painted = await canvas.evaluate(async (element, coords) => {
      const c = element as HTMLCanvasElement;
      const [x1, y1, x2, y2] = coords;
      const pixels = c.getContext('2d')!.getImageData(Math.min(x1, x2) * c.width, Math.min(y1, y2) * c.height,
        Math.abs(x2 - x1) * c.width, Math.abs(y2 - y1) * c.height);
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(pixels.data)))).join(',');
    }, box!);
  }
  const fields = editor.getByRole('button', { name: 'Show fields' });
  if (await fields.isVisible()) await fields.click();
  return painted;
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
  });
});

async function injectPackageWriteFailure(context: BrowserContext) {
  await context.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const request = put.call(this, value, ...args);
      if (sessionStorage.getItem('test-fail-package-write') && value?.key?.startsWith('action-package:')) this.transaction.abort();
      return request;
    };
  });
}

test('correspondence edits, previews and recovery stay with the selected package member', async ({ page, context }) => {
  await injectPackageWriteFailure(context);
  await context.addInitScript(() => localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused' } })));
  await page.goto('/');
  const workspace = await openPackageWorkspace(page);
  await newBlankPackage(workspace, 'Two letters');
  for (const count of [1, 2]) {
    await openAddDocuments(workspace);
    await workspace.getByRole('button', { name: 'Add letter', exact: true }).click();
    await expect(workspace.locator('li[id^="package-member-"]')).toHaveCount(count);
  }
  await workspace.getByRole('button', { name: 'Edit document', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Two letters', exact: true });
  const picker = editor.locator('header').getByRole('combobox', { name: 'Package document' });
  const section = editor.getByLabel('Document section', { exact: true });
  const subject = editor.getByRole('textbox', { name: 'Subject', exact: true });
  await expect(picker.locator('option')).toHaveCount(2);
  const ids = await picker.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  expect(ids).toHaveLength(2);
  const originalMember = await picker.inputValue(), other = ids.find(id => id !== originalMember)!;
  await section.selectOption('addressing');
  await subject.fill('SYNTHETIC ALPHA');
  await subject.blur();
  await checkPreview(editor, page, 'SYNTHETIC ALPHA');
  await picker.selectOption(other);
  await expect(picker).toHaveValue(other);
  await section.selectOption('addressing');
  await expect(subject).not.toHaveValue('SYNTHETIC ALPHA');
  await page.evaluate(() => sessionStorage.setItem('test-fail-package-write', '1'));
  await subject.fill('SYNTHETIC BRAVO'); await subject.blur();
  await picker.selectOption(originalMember);
  await expect(editor.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await expect(picker).toHaveValue(other);
  await expect(subject).toHaveValue('SYNTHETIC BRAVO');
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(subject).toHaveValue('SYNTHETIC BRAVO');
  await expect(editor.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem('test-fail-package-write'));
  await editor.getByRole('button', { name: 'Retry save' }).click();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible();
  await page.reload();
  await expect(picker).toHaveValue(other);
  await expect(subject).toHaveValue('SYNTHETIC BRAVO');
  await picker.selectOption(originalMember);
  await expect(section).toHaveValue('addressing');
  await expect(subject).toHaveValue('SYNTHETIC ALPHA');
  await page.keyboard.press('Escape');
  await expect(workspace.getByRole('button', { name: 'Edit document', exact: true })).toBeVisible();
});

test('two Unit Punishment Books retain independent answers, previews and recovery drafts', async ({ page, context }) => {
  await injectPackageWriteFailure(context);
  await page.goto('/');
  const workspace = await openPackageWorkspace(page);
  await newBlankPackage(workspace, 'Two form test');
  await packageSection(workspace, 'Documents');
  const add = workspace.getByRole('button', { name: 'Add Unit Punishment Book' });
  await openAddDocuments(workspace);
  await add.click();
  await expect(workspace).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(workspace.getByRole('button', { name: 'Edit form', exact: true })).toBeEnabled();
  await openAddDocuments(workspace);
  await add.click();
  await expect(workspace).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(workspace.locator('li[id^="package-member-"]')).toHaveCount(2);
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Two form test', exact: true });
  const picker = editor.locator('header').getByRole('combobox', { name: 'Package document', exact: true });
  const section = editor.getByRole('combobox', { name: 'Form section', exact: true });
  await expect(picker.locator('option')).toHaveCount(2);
  const [first, second] = await picker.locator('option').evaluateAll(opts => opts.map(o => (o as HTMLOptionElement).value));
  const name = editor.getByLabel('18 Accused full name', { exact: true });
  const remarks = editor.getByLabel('21 Remarks', { exact: true });
  await picker.selectOption(first);
  await expect(section).toHaveValue('all');
  await expect(remarks).toBeVisible();
  await name.fill('ALPHA EXAMPLE');
  await picker.selectOption(second);
  await expect(name).toHaveValue('');
  await name.fill('BRAVO EXAMPLE');
  await section.selectOption({ label: 'Remarks and victim information' });
  await remarks.fill('Second member only');
  await picker.selectOption(first);
  await expect(name).toHaveValue('ALPHA EXAMPLE');
  const alpha = await checkPreview(editor, page, 'ALPHA EXAMPLE', '18 ACCUSED FULL NAME');
  await picker.selectOption(second);
  await expect(remarks).toHaveValue('Second member only');
  const bravo = await checkPreview(editor, page, 'BRAVO EXAMPLE', '18 ACCUSED FULL NAME');
  expect(bravo).not.toEqual(alpha);
  await page.reload();
  await expect(picker).toHaveValue(second);
  await expect(remarks).toHaveValue('Second member only');
  await page.evaluate(() => sessionStorage.setItem('test-fail-package-write', '1'));
  await remarks.fill('Recover this exact input');
  await picker.selectOption(first);
  await expect(editor.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await expect(picker).toHaveValue(second);
  await expect(remarks).toHaveValue('Recover this exact input');
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(remarks).toHaveValue('Recover this exact input');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  const retry = editor.getByRole('button', { name: 'Retry save', exact: true });
  await expect(retry).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem('test-fail-package-write'));
  await retry.click();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Back to package' }).click();
  await expect(workspace.getByRole('heading', { name: '2. Unit Punishment Book' })).toBeVisible();
  const history = workspace.locator('li[id^="package-member-"]:visible');
  await history.getByText('Document versions', { exact: true }).click();
  await expect(history.getByRole('button', { name: 'Version 3 · Editable document' })).toBeDisabled();
  await history.getByRole('button', { name: 'Version 1 · Editable document' }).click();
  await expect(history.getByRole('button', { name: 'Version 1 · Editable document' })).toBeDisabled();
  await workspace.getByRole('button', { name: 'Back to current version' }).click();
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
  await expect(remarks).toHaveValue('Recover this exact input');
  await section.selectOption({ label: 'Full document' });
  await expect(remarks).toHaveValue('Recover this exact input');
  await expect(name).toHaveValue('BRAVO EXAMPLE');
  await picker.selectOption(first);
  await expect(name).toHaveValue('ALPHA EXAMPLE');
});

test('Page 11 edits appear in the printable preview and survive returning to the package', async ({ page }) => {
  await page.goto('/');
  const workspace = await openPackageWorkspace(page);
  await newBlankPackage(workspace, 'Page 11 editing');
  await packageSection(workspace, 'Documents');
  await workspace.getByRole('button', { name: 'Add Page 11', exact: true }).click();
  await workspace.getByRole('button', { name: 'Edit form' }).click();
  const editor = page.getByRole('dialog', { name: 'Page 11 editing' });
  await editor.getByLabel('Last Name', { exact: true }).fill('EXAMPLE');
  await checkPreview(editor, page, 'EXAMPLE');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(workspace.getByRole('heading', { name: '1. Page 11' })).toBeVisible();
  await workspace.getByRole('button', { name: 'Edit form' }).click();
  await expect(editor.getByLabel('Last Name', { exact: true })).toHaveValue('EXAMPLE');
});

test('reviews a saved Unit Punishment Book signature location before pairing', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const workspace = await openPackageWorkspace(page);
  await newBlankPackage(workspace, 'Official signature test');
  await packageSection(workspace, 'Documents');
  await workspace.getByRole('button', { name: 'Add Unit Punishment Book' }).click();
  await expect(workspace).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Official signature test', exact: true });
  await editor.getByLabel('18 Accused full name', { exact: true }).fill('TRAINING EXAMPLE');
  await editor.getByRole('button', { name: 'Back to package' }).click();
  await workspace.getByRole('button', { name: 'Sign official form' }).click();
  const signing = page.getByRole('region', { name: 'Official form signatures' });
  const confirm = page.getByRole('button', { name: 'Continue to signing' });
  await expect(signing.or(confirm)).toBeVisible({ timeout: 45_000 });
  if (await confirm.isVisible()) await confirm.click();
  await signing.getByRole('button', { name: 'Review signature location' }).click();
  const location = signing.getByRole('combobox', { name: 'PDF signature location' });
  await location.selectOption('9 NJP AUTHORITY SIGNATURE');
  const preview = signing.locator('[data-signing-preview-page]');
  await expect(preview).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(preview.locator('span[aria-hidden]')).toBeVisible();
  await signing.getByRole('button', { name: 'Next page' }).click();
  await expect(signing.getByText('Page 2 of 3')).toBeVisible();
  await expect(preview.locator('span[aria-hidden]')).toHaveCount(0);
  await signing.getByRole('button', { name: 'Previous page' }).click();
  await expect(preview.locator('span[aria-hidden]')).toBeVisible({ timeout: 30_000 });
  await expect(signing.getByLabel('Local bridge pairing code')).toHaveValue('');
});

test('administrative action forms edit and recover inside the package', async ({ page, context }) => {
  await injectPackageWriteFailure(context);
  await page.goto('/');
  const draft = { documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: 'navmc_10274',
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [],
    forms: { navmc10274: { actionNo: 'INITIAL' }, includeCoverPage: false } };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'action.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.locator('#actionNo')).toHaveValue('INITIAL');
  const workspace = await openPackageWorkspace(page);
  await newBlankPackage(workspace, 'Two action forms');
  await capturePackageDocument(workspace);
  await capturePackageDocument(workspace);
  await workspace.getByRole('button', { name: 'Edit document', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Two action forms', exact: true });
  const picker = editor.locator('header').getByRole('combobox', { name: 'Package document' });
  const action = editor.locator('#actionNo');
  const first = await picker.inputValue();
  const other = await picker.locator('option').evaluateAll(options =>
    options.map(option => (option as HTMLOptionElement).value));
  await action.fill('ALPHA-01');
  await action.blur();
  await checkPreview(editor, page, 'ALPHA-01');
  await picker.selectOption(other.find(id => id !== first)!);
  await expect(action).toHaveValue('INITIAL');
  await page.evaluate(() => sessionStorage.setItem('test-fail-package-write', '1'));
  await action.fill('BRAVO-02');
  await picker.selectOption(first);
  await expect(editor.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await expect(action).toHaveValue('BRAVO-02');
  await page.evaluate(() => sessionStorage.removeItem('test-fail-package-write'));
  await editor.getByRole('button', { name: 'Retry save' }).click();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible();
  await page.reload();
  await expect(action).toHaveValue('BRAVO-02');
  await picker.selectOption(first);
  await expect(action).toHaveValue('ALPHA-01');
});

test('legacy Page 11 saves uploaded signature bytes in its package working copy', async ({ page }) => {
  await page.goto('/');
  const draft = { documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: 'navmc_118_11',
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [],
    forms: { navmc11811: { lastName: 'EXAMPLE', signatureBlocks: [{ name: 'Training signer', statement: '', style: 'typed' }] }, includeCoverPage: false } };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const workspace = await openPackageWorkspace(page);
  await newBlankPackage(workspace, 'Legacy images');
  await capturePackageDocument(workspace);
  await workspace.getByRole('button', { name: 'Edit document', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Legacy images', exact: true });
  await editor.getByRole('tab', { name: 'Signature block 1: upload or draw a signature' }).click();
  const fileInput = editor.locator('input[type=file][accept="image/*"]').first();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 50; canvas.height = 20;
    canvas.getContext('2d')!.fillRect(5, 5, 40, 3);
    return canvas.toDataURL().split(',')[1];
  });
  await fileInput.setInputFiles({ name: 'training.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(editor.getByRole('button', { name: 'Remove signature image' })).toBeVisible();
  await editor.getByRole('button', { name: 'Back to package' }).click();
  await workspace.getByRole('button', { name: 'Edit document' }).click();
  await expect(editor.getByRole('button', { name: 'Remove signature image' })).toBeVisible();
});

test('delivery corrections preserve input after a failed save and advance to the next document', async ({ page, context }) => {
  await injectPackageWriteFailure(context);
  await context.addInitScript(() => localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused' } })));
  await page.goto('/');
  const workspace = await openPackageWorkspace(page);
  await newBlankPackage(workspace, 'Two incomplete letters');
  await packageSection(workspace, 'Documents');
  for (let i = 0; i < 2; i++) {
    await openAddDocuments(workspace);
    await workspace.getByRole('button', { name: 'Add letter', exact: true }).click();
    await expect(workspace.locator('li[id^="package-member-"]')).toHaveCount(i + 1);
  }
  await packageSection(workspace, 'Delivery');
  const included = workspace.getByRole('region', { name: 'Included documents', exact: true });
  const documents = included.locator('ol > li');
  await expect(documents).toHaveCount(2);
  await expect(documents.nth(1).locator('summary')).toHaveText('4 items to resolve');
  await expect(workspace.getByRole('group', { name: 'Next delivery action' })).toBeVisible();
  await documents.nth(1).locator('summary').click();
  await documents.nth(1).getByRole('button', { name: 'Complete addressing', exact: true }).click();
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('combobox', { name: 'Package document', exact: true }) });
  const picker = editor.getByLabel('Package document', { exact: true });
  await expect(picker).toHaveValue(await picker.locator('option').nth(1).getAttribute('value') ?? '');
  await expect(editor.getByLabel('Document section', { exact: true })).toHaveValue('addressing');
  const section = editor.getByLabel('Document section', { exact: true });
  const position = async () => [await picker.inputValue(), await section.inputValue()];
  const startingPosition = await position();
  const subject = editor.getByRole('textbox', { name: 'Subject', exact: true });
  await page.evaluate(() => sessionStorage.setItem('test-fail-package-write', '1'));
  await subject.fill('SECOND DOCUMENT');
  await editor.getByRole('button', { name: 'Next item' }).click();
  await expect(editor.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await expect(subject).toHaveValue('SECOND DOCUMENT');
  await page.evaluate(() => sessionStorage.removeItem('test-fail-package-write'));
  await editor.getByRole('button', { name: 'Retry save' }).click();
  await editor.getByRole('button', { name: 'Next item' }).click();
  await expect.poll(position).not.toEqual(startingPosition);
  const nextPosition = await position();
  await editor.getByRole('button', { name: 'Next item' }).click();
  await expect.poll(position).not.toEqual(nextPosition);
  await editor.getByRole('button', { name: 'Back to Delivery' }).click();
  await expect(workspace.getByRole('navigation', { name: 'Package workspace' }).getByRole('button', { name: 'Delivery' })).toHaveAttribute('aria-current', 'location');
});
