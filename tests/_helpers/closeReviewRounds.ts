import { expect, type Locator } from '@playwright/test';

export async function closeReviewRounds(modal: Locator): Promise<void> {
  // Browser downloads can start before the review operation releases its close guard.
  await expect(modal.getByLabel('Review name', { exact: true })).toBeEnabled();
  await modal.page().keyboard.press('Escape');
  await expect(modal).toBeHidden();
}
