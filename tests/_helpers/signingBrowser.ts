import type { Page } from '@playwright/test';
import { downloadBrowserPdf } from './downloadBrowserPdf';

export async function signingPdfDownload(page: Page, projectName: string, action: () => Promise<void>): Promise<Buffer> {
  return downloadBrowserPdf(page, projectName, action);
}
