import type { Page } from '@playwright/test';

/** A real reload creates a new document, independently of clock precision. */
export function documentIdentity(page: Page): Promise<string> {
  return page.evaluate(() => {
    const current = document as Document & { __dondocsTestIdentity?: string };
    return current.__dondocsTestIdentity ??= crypto.randomUUID();
  });
}
