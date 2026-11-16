import { expect, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function readPdf(download: Download): Promise<Buffer> {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  return bytes;
}

/** Follow the PDF tab used by iOS Chrome before reading its actual download. */
export async function downloadBrowserPdf(page: Page, projectName: string, action: () => Promise<unknown>): Promise<Buffer> {
  if (projectName === 'mobile-chrome-ios') {
    const opening = page.waitForEvent('popup');
    await action();
    const popup = await opening;
    try {
      await expect(popup.locator('iframe')).toHaveAttribute('src', /^data:application\/pdf;base64,/, { timeout: 60_000 });
      const saving = popup.waitForEvent('download');
      await popup.getByRole('link', { name: 'Download PDF', exact: true }).click();
      return await readPdf(await saving);
    } finally { await popup.close(); }
  }
  const saving = page.waitForEvent('download');
  await action();
  return readPdf(await saving);
}
