import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);
for (const kind of ['blocked marking', 'privacy review'] as const) {
  test(`enforces ${kind} when downloading an uploaded signing PDF`, async ({ page }, info) => {
    await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    await page.route('**/classification.config.json?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ maxLevel: 'unclassified', allowedLevels: ['unclassified'] }) }));
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([400, 600]).drawText(kind === 'blocked marking' ? 'SECRET' : 'SYNTHETIC SSN 123-45-6789', { x: 20, y: 500, font, size: 12 });
    const bytes = Buffer.from(await pdf.save());
    await page.goto('/');await page.getByRole('button', { name: 'Download', exact: true }).click();await page.getByRole('menuitem', { name: 'Signing workspace', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Signing workspace', exact: true });
    await dialog.getByLabel('Unsigned PDF for signing').setInputFiles({ name: 'Review.pdf', mimeType: 'application/pdf', buffer: bytes });
    await expect(dialog.getByText('Exact source PDF saved. Add the fields you need.')).toBeVisible();
    await dialog.getByRole('checkbox', { name: /^I reviewed every page,/ }).check();
    await dialog.getByRole('button', { name: 'Download unchanged source PDF', exact: true }).click();
    if (kind === 'blocked marking') {
      await expect(dialog.getByRole('alert')).toContainText('outside this deployment');return;
    }
    const review = page.getByRole('alertdialog', { name: 'Review signing export', exact: true });
    await expect(review).toBeVisible();await expect(review).not.toContainText('123-45-6789');
    if (info.project.name === 'mobile-chrome-ios') {
      const pending = page.waitForEvent('popup');await review.getByRole('button', { name: 'Download reviewed signing files', exact: true }).click();const popup = await pending;
      try {
        await expect(popup.locator('iframe')).toHaveAttribute('src', /^data:application\/pdf;base64,/);
        const saving = popup.waitForEvent('download');await popup.getByRole('link', { name: 'Download PDF', exact: true }).click();
        expect(await readFile((await (await saving).path())!)).toEqual(bytes);
      } finally { await popup.close(); }
    } else {
      const saving = page.waitForEvent('download');await review.getByRole('button', { name: 'Download reviewed signing files', exact: true }).click();
      expect(await readFile((await (await saving).path())!)).toEqual(bytes);
    }
  });
}
