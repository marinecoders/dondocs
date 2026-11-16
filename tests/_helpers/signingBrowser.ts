import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export async function signingPdfDownload(page: Page, projectName: string, action: () => Promise<void>): Promise<Buffer> {
  if (projectName === 'mobile-chrome-ios') {
    const pending = page.waitForEvent('popup');await action();const popup = await pending;
    try {
      await expect(popup.locator('iframe')).toHaveAttribute('src', /^data:application\/pdf;base64,/);
      const saving = popup.waitForEvent('download');await popup.getByRole('link', { name: 'Download PDF', exact: true }).click();
      return readFile((await (await saving).path())!);
    } finally { await popup.close(); }
  }
  const saving = page.waitForEvent('download');await action();return readFile((await (await saving).path())!);
}
