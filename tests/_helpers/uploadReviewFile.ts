import { expect, type Locator } from '@playwright/test';

/** File selection must respect the same review-operation guard as a user. */
export async function uploadReviewFile(input: Locator, files: Parameters<Locator['setInputFiles']>[0]): Promise<void> {
  // setInputFiles can dispatch change while a native file control is disabled.
  await expect(input).toBeEnabled();
  await input.setInputFiles(files);
}
