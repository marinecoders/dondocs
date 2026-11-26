import { openPackageWorkspace, newPackage, importPackage, packageSection, expandPackageTools, packageVersion, inspectPackageMember, choosePackage, choosePackageById } from './_helpers/packageWorkspace';
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
      await expect(dialog.getByRole('heading', { name: 'Packages', exact: true, level: 1 })).toBeVisible();
      await newPackage(dialog);
      await dialog.getByRole('button', { name: `Start ${action}`, exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Back to actions', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toBeHidden();
      dialog = await openPackageWorkspace(page);
      await expect(dialog.getByRole('heading', { name: 'Packages', exact: true, level: 1 })).toBeVisible();
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
    await expect(dialog.getByRole('heading', { name: 'Packages', exact: true, level: 1 })).toBeVisible();
    await dialog.getByRole('button', { name: 'Resume unfinished action', exact: true }).click();
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

  test('closing a newly saved action returns to the library on the next launch', async ({ page }) => {
    await page.goto('/');
    const dialog = await openPackageWorkspace(page);
    await newPackage(dialog);
    await dialog.getByRole('button', { name: 'Start administrative request', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Requester', exact: true }).fill('Alex Example');
    await dialog.getByRole('button', { name: 'Save package draft', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Administrative request', exact: true, level: 1 })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    await openPackageWorkspace(page);
    await expect(dialog.getByRole('heading', { name: 'Packages', exact: true, level: 1 })).toBeVisible();
    await choosePackage(dialog, 'Administrative request');
    await expect(dialog.getByRole('textbox', { name: 'Requester', exact: true })).toHaveValue('Alex Example');
  });

  test('reopens to the library and keeps saved versions available', async ({ page }, info) => {
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
    await expect(dialog.getByRole('heading', { name: 'Packages', exact: true, level: 1 })).toBeVisible();
    await choosePackageById(dialog, fixture.package.id);
    expect(await packageVersion(dialog)).not.toBe(savedRevision);
    const currentRevision = await dialog.getAttribute('data-revision-id');
    await page.reload();
    dialog = await openPackageWorkspace(page);
    await expect(dialog).toHaveAttribute('data-package-id', fixture.package.id);
    await expect(dialog).toHaveAttribute('data-revision-id', currentRevision!);
    await packageVersion(dialog, savedRevision);
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

test('hands off workspace tools without waiting for exit animations and preserves launcher focus', async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await context.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'classic', editorLayout: 'focused' } }));
  });
  await page.goto('/');
  const launcher = page.getByRole('button', { name: 'Open workspace', exact: true });
  await page.addStyleTag({ content: `
    @keyframes held-workspace-exit { from { opacity: 1; } to { opacity: 0; } }
    [data-test-delayed-exit="true"][data-state="closed"] {
      animation: held-workspace-exit 7s linear !important;
    }
  ` });
  for (const tool of [
    { label: 'Packages', role: 'dialog', name: 'Action packages' },
    { label: 'Search', role: 'region', name: 'Search workspace' },
    { label: 'Settings', role: 'dialog', name: 'Settings' },
  ] as const) {
    await launcher.click();
    const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
    await expect(drawer).toBeVisible();
    await expect.poll(() => drawer.evaluate(root => root.contains(document.activeElement))).toBe(true);
    await drawer.evaluate(root => root.setAttribute('data-test-delayed-exit', 'true'));
    await drawer.getByRole('button', { name: tool.label, exact: true }).click();
    const destination = page.getByRole(tool.role, { name: tool.name, exact: true });
    await expect(destination).toBeVisible();
    await expect(page.locator('[data-test-delayed-exit="true"]')).toHaveCount(0, { timeout: 12_000 });
    await expect.poll(() => destination.evaluate(root => root.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(destination).toBeHidden();
    await expect(launcher).toBeFocused();
  }
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


test('refresh restores the open tab and Back to packages clears that route', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing' }).click();
  const dialog = await openPackageWorkspace(page);
  await newPackage(dialog);
  const custom = dialog.getByRole('group', { name: 'Custom package' });
  await custom.getByLabel('Package name').fill('Return location');
  await custom.getByRole('button', { name: 'Create package' }).click();
  await packageSection(dialog, 'Delivery');
  await page.reload();
  await expect(dialog.getByRole('heading', { name: 'Return location' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delivery', exact: true })).toHaveAttribute('aria-current', 'location');
  await dialog.getByRole('button', { name: 'Back to packages' }).click();
  await page.reload();
  await openPackageWorkspace(page);
  await expect(dialog.getByRole('heading', { name: 'Packages', exact: true, level: 1 })).toBeVisible();
});
