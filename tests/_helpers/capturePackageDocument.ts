import { expect, type Locator } from '@playwright/test';

/** Capturing includes asynchronous draft validation and saving the new revision. */
export async function capturePackageDocument(modal: Locator): Promise<void> {
  await modal.getByRole('button', { name: 'Capture current document', exact: true }).click();
  await expect(modal).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
}
