import { expect, type Locator } from '@playwright/test';
import { openAddDocuments, packageSection } from '../browser/_helpers/packageWorkspace';

/** Capturing includes asynchronous draft validation and saving the new revision. */
export async function capturePackageDocument(modal: Locator): Promise<void> {
  await packageSection(modal, 'Documents', true);
  await openAddDocuments(modal);
  await modal.getByRole('button', { name: 'Capture current document', exact: true }).click();
  await expect(modal).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
}
