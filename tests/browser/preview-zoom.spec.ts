import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

const canvas = (page: Page) => page.locator('[data-pdf-layer="active"] canvas').first();
const readout = (page: Page) => page.locator('button[aria-label^="Zoom "][aria-label$="reset to fit width"]');

async function openPreview(page: Page) {
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  if (await preview.getAttribute('aria-haspopup') === 'dialog') {
    if (!await page.getByRole('dialog', { name: 'PDF preview', exact: true }).isVisible()) await preview.click();
  } else if (await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
  await expect(canvas(page)).toBeVisible({ timeout: 60_000 });
}

async function closePreview(page: Page) {
  const close = page.getByRole('button', { name: 'Close preview', exact: true });
  if (await close.isVisible()) await close.click();
  else await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('region', { name: /^PDF document/ })).toHaveCount(0);
}

async function selectMode(page: Page, mode: string) {
  if (mode === '110%') {
    // Always enter manual mode, even if the current fit happens to show 110%.
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    for (let i = 0; i < 20; i++) {
      const percent = Number((await readout(page).getAttribute('aria-label'))!.match(/\d+/)![0]);
      if (percent === 110) return;
      await page.getByRole('button', { name: percent > 110 ? 'Zoom out' : 'Zoom in', exact: true }).click();
    }
    throw new Error('Zoom controls did not reach 110%');
  }
  const button = page.getByRole('button', { name: mode, exact: true });
  if (await button.isVisible()) await button.click();
  else {
    await page.getByRole('button', { name: 'More preview actions', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: mode, exact: true }).click();
  }
}

async function expectMode(page: Page, mode: string) {
  await expect(canvas(page)).toBeVisible({ timeout: 60_000 });
  if (mode === '110%') {
    await expect(readout(page)).toHaveAttribute('aria-label', 'Zoom 110 percent — reset to fit width');
  } else {
    await expect(page.getByRole('button', { name: mode, exact: true, includeHidden: true }))
      .toHaveAttribute('aria-pressed', 'true');
    // pdf.js paints asynchronously after the toolbar changes. Wait for the
    // rendered dimensions rather than inspecting the outgoing canvas once.
    await expect.poll(async () => {
      const paper = await canvas(page).boundingBox();
      const viewport = await page.getByRole('region', { name: /^PDF document/ }).boundingBox();
      if (!paper || !viewport) return Infinity;
      return Math.max(paper.width - viewport.width + 48,
        mode === 'Fit page' ? paper.height - viewport.height + 48 : 0);
    }).toBeLessThanOrEqual(2);
  }
}

for (const mode of ['110%', 'Fit page', 'Fit width']) {
  test(`${mode} survives document/form switches, preview reopening, and reload`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('PREVIEW ZOOM VERIFICATION');
    await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill('Fictional training content for preview zoom verification.');
    await openPreview(page);
    await selectMode(page, mode);
    await expectMode(page, mode);
    await closePreview(page);
    await openPreview(page);
    await expectMode(page, mode);

    for (const category of ['Forms', 'Correspondence']) {
      const close = page.getByRole('button', { name: 'Close preview', exact: true });
      if (await close.isVisible()) await close.click();
      await page.getByRole('button', { name: category, exact: true }).click();
      await openPreview(page);
      await expectMode(page, mode);
    }
    await page.reload();
    await openPreview(page);
    await expectMode(page, mode);
  });
}
