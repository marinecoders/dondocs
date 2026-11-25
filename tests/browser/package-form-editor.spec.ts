import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { newBlankPackage, openPackageWorkspace, packageSection } from './_helpers/packageWorkspace';

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

test('two Unit Punishment Books retain independent answers, previews and recovery drafts', async ({ page, context }) => {
  await context.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const request = put.call(this, value, ...args);
      if (sessionStorage.getItem('test-fail-package-write') && value?.key?.startsWith('action-package:')) this.transaction.abort();
      return request;
    };
  });
  await page.goto('/');
  const workspace = await openPackageWorkspace(page);
  await newBlankPackage(workspace, 'Two form test');
  await packageSection(workspace, 'Documents');
  await workspace.getByText('Add documents', { exact: true }).click();
  const add = workspace.getByRole('button', { name: 'Add Unit Punishment Book' });
  await add.click();
  await expect(workspace).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(workspace.getByRole('button', { name: 'Edit form', exact: true })).toBeEnabled();
  await add.click();
  await expect(workspace).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(workspace.locator('li[id^="package-member-"]')).toHaveCount(2);
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Two form test', exact: true });
  const picker = editor.getByRole('combobox', { name: 'Package form', exact: true });
  const section = editor.getByRole('combobox', { name: 'Form section', exact: true });
  await expect(picker.locator('option')).toHaveCount(2);
  const [first, second] = await picker.locator('option').evaluateAll(opts => opts.map(o => (o as HTMLOptionElement).value));
  const name = editor.getByLabel('18 Accused full name', { exact: true });
  const remarks = editor.getByLabel('21 Remarks', { exact: true });
  await picker.selectOption(first);
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
  await section.selectOption({ label: 'Unit punishment record' });
  await expect(name).toHaveValue('BRAVO EXAMPLE');
  await picker.selectOption(first);
  await expect(name).toHaveValue('ALPHA EXAMPLE');
});

test('Page 11 edits appear in the printable preview and survive returning to the package', async ({ page }) => {
  await page.goto('/');
  const workspace = await openPackageWorkspace(page);
  await newBlankPackage(workspace, 'Page 11 editing');
  await packageSection(workspace, 'Documents');
  await workspace.getByText('Add documents', { exact: true }).click();
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
  await workspace.getByText('Add documents', { exact: true }).click();
  await workspace.getByRole('button', { name: 'Add Unit Punishment Book' }).click();
  await expect(workspace).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Official signature test', exact: true });
  await editor.getByLabel('18 Accused full name', { exact: true }).fill('TRAINING EXAMPLE');
  await editor.getByRole('button', { name: 'Back to package' }).click();
  await workspace.getByRole('button', { name: 'Sign official form' }).click();
  const signing = page.getByRole('region', { name: 'Official form signatures' });
  const confirm = page.getByRole('button', { name: 'Download reviewed signing files' });
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
