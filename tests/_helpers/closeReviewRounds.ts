import { expect, type Locator } from '@playwright/test';

export async function closeReviewRounds(modal: Locator, dismissal: 'escape' | 'close-button' = 'escape'): Promise<void> {
  // Browser downloads can start before the review operation releases its close guard.
  await expect(modal.getByLabel('Review name', { exact: true })).toBeEnabled();
  if (dismissal === 'close-button') await modal.getByRole('button', { name: 'Close', exact: true }).click();
  else await modal.page().keyboard.press('Escape');
  await expect(modal).toBeHidden();
}
