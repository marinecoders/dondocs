import { openPackageWorkspace, showPackageLibrary, newPackage, importPackage, packageSection, expandPackageTools, packageVersion, inspectPackageMember } from './_helpers/packageWorkspace';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type PreviewLayoutDialog = HTMLElement & { previewLayoutProbe?: { heights: number[]; observer: MutationObserver } };

test.use({ serviceWorkers: 'block' });
test.setTimeout(90_000);

for (const theme of ['light', 'dark', 'classic']) test.describe(`package workspace in ${theme}`, () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
    }, theme);
  });

  test('untouched action starters support Back, Escape and Close without saving packages', async ({ page }, info) => {
    await page.goto('/');
    let dialog = await openPackageWorkspace(page);
    for (const action of ['administrative request', 'training participation', 'evidence submission']) {
      await newPackage(dialog);
      const start = dialog.getByRole('button', { name: `Start ${action}`, exact: true });
      await start.click();
      const back = dialog.getByRole('button', { name: 'Back to actions', exact: true });
      await expect(back).toBeEnabled();
      if (action === 'administrative request') await page.screenshot({ path: info.outputPath('package-action-back.png') });
      await back.click();
      await expect(dialog.getByRole('heading', { name: 'Start from an action', exact: true })).toBeFocused();
      await start.click();
      await expect(back).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      dialog = await openPackageWorkspace(page);
      await newPackage(dialog);
      await dialog.getByRole('button', { name: `Start ${action}`, exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Back to actions', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toBeHidden();
      dialog = await openPackageWorkspace(page);
      await showPackageLibrary(dialog);
      await expect(dialog.getByText('No packages yet. Create one to bring your documents together.', { exact: true })).toBeVisible();
    }
  });

  test('edited action answers recover after Escape and cancelled Back until discard is confirmed', async ({ page }) => {
    await page.goto('/');
    let dialog = await openPackageWorkspace(page);
    await newPackage(dialog);
    await dialog.getByRole('button', { name: 'Start administrative request', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Requester', exact: true }).fill('Alex Example');
    await expect(dialog.getByText('Draft saved locally · not applied', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.reload();
    dialog = await openPackageWorkspace(page);
    const requester = dialog.getByRole('textbox', { name: 'Requester', exact: true });
    await expect(requester).toHaveValue('Alex Example');
    const back = dialog.getByRole('button', { name: 'Back to actions', exact: true });
    await back.click();
    const confirmation = page.getByRole('alertdialog', { name: 'Discard this draft?', exact: true });
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(requester).toHaveValue('Alex Example');
    await back.click();
    await confirmation.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Start from an action', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('package workspace resumes the exact selected revision and original member', async ({ page }, info) => {
    await page.goto('/');
    let dialog = await openPackageWorkspace(page);
    const bytes = await readFile(new URL('../fixtures/package-render/baseline-1.3.98.dondocs-package.json', import.meta.url));
    const fixture = JSON.parse(bytes.toString()), savedRevision = fixture.package.currentRevisionId;
    const original = fixture.package.revisions[0].members[1];
    await importPackage(dialog, { name: 'synthetic-package.json', mimeType: 'application/json', buffer: bytes });
    await inspectPackageMember(dialog, original.id);
    const originalHeading = dialog.getByRole('heading', { name: `2. ${original.label}`, exact: true });
    const member = dialog.locator(`[id="package-member-${original.id}"]`);
    await expandPackageTools(member);
    await member.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(originalHeading).toBeHidden();
    await packageVersion(dialog, savedRevision);
    await inspectPackageMember(dialog, original.id);
    await expect(member).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    dialog = await openPackageWorkspace(page);
    expect(await packageVersion(dialog)).toBe(savedRevision);
    await expect(member).toHaveAttribute('data-selected', 'true');
    await page.reload();
    dialog = await openPackageWorkspace(page);
    expect(await packageVersion(dialog)).toBe(savedRevision);
    await expect(dialog.getByText(/Historical/)).toBeVisible();
    await inspectPackageMember(dialog, original.id);
    await expect(member).toHaveAttribute('data-selected', 'true');
    await expandPackageTools(member);
    await expect(member.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
    await expect(member.getByRole('button', { name: 'Download unchanged original', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('package-workspace-history.png') });
    await packageSection(dialog, 'Overview');
    await page.screenshot({ path: info.outputPath('package-workspace-overview.png') });
  });
});

test('phone-sized workspace keeps Close and Version history accessible', async ({ page, context }, info) => {
  await context.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  const dialog = await openPackageWorkspace(page);
  await importPackage(dialog, new URL('../fixtures/package-render/baseline-1.3.98.dondocs-package.json', import.meta.url).pathname);
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  const bounds = await close.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(await dialog.evaluate(root => root.scrollWidth)).toBeLessThanOrEqual(320);
  await dialog.getByRole('button', { name: 'Version history', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Version history', exact: true });
  await expect(history.getByLabel('Package revision', { exact: true })).toBeEnabled();
  await history.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ path: info.outputPath('package-mobile-navigation.png') });
  await close.click();
  await expect(dialog).toBeHidden();
});

for (const width of [1440, 320]) test(`document preview reserves its final height while rendering at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 950 });
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  const dialog = await openPackageWorkspace(page);
  const bytes = await readFile(new URL('../fixtures/package-render/baseline-1.3.98.dondocs-package.json', import.meta.url));
  const fixture = JSON.parse(bytes.toString());
  await importPackage(dialog, { name: 'preview-layout.json', mimeType: 'application/json', buffer: bytes });
  const label = `Preview of ${fixture.package.revisions[0].members[0].label}`;
  await dialog.evaluate((root, label) => {
    const heights: number[] = [];
    const observer = new MutationObserver(() => {
      const preview = [...root.querySelectorAll<HTMLElement>('section[aria-label]')].find(element => element.getAttribute('aria-label') === label);
      if (!preview?.getClientRects().length || !preview.textContent?.includes('Preparing document preview…')) return;
      const height = preview.getBoundingClientRect().height;
      if (height > 0) heights.push(height);
    });
    (root as PreviewLayoutDialog).previewLayoutProbe = { heights, observer };
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  }, label);
  await dialog.getByRole('navigation', { name: 'Package workspace', exact: true }).getByRole('button', { name: 'Documents', exact: true }).click();
  const preview = dialog.getByRole('region', { name: label, exact: true });
  await expect(preview.locator('canvas').first()).toBeVisible({ timeout: 90_000 });
  const readyHeight = await preview.evaluate(element => element.getBoundingClientRect().height);
  const loadingHeights = await dialog.evaluate(root => {
    const probe = (root as PreviewLayoutDialog).previewLayoutProbe!;
    probe.observer.disconnect();
    return probe.heights;
  });
  expect(loadingHeights.length).toBeGreaterThan(0);
  for (const height of loadingHeights) expect(Math.abs(height - readyHeight)).toBeLessThanOrEqual(1);
});

