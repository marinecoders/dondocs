import { openPackagePreparation, importPackage, packageSection, choosePackageById, packageTool, prepareReviewTransfer } from './_helpers/packageWorkspace';
import { expect, test, type Download, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('../fixtures/package-render/baseline-1.3.98.dondocs-package.json', import.meta.url));
test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(150_000);
async function packages(page: Page) {
  return openPackagePreparation(page);
}
async function bytes(download: Download) {
  const path = await download.path(); if (!path) throw new Error('The review file was not downloaded.'); return readFile(path);
}
for (const theme of ['light', 'dark', 'classic']) test(`package reviewer copy and exact member feedback return in ${theme}`, async ({ page, context, browser }, info) => {
  const initialize = (value: string) => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  };
  await context.addInitScript(initialize, theme); await page.goto('/');
  const modal = await packages(page); const input = await readFile(fixturePath), fixture = JSON.parse(input.toString());
  const native = fixture.package.revisions[0].members[0], original = fixture.package.revisions[0].members[1];
  await importPackage(modal, { name: 'synthetic-package.json', mimeType: 'application/json', buffer: input });
  await packageSection(modal, 'Review', true);
  await packageSection(modal, 'Review', true);
  await modal.getByRole('button', { name: 'New review copy', exact: true }).click();
  await prepareReviewTransfer(modal, 'copy');
  const transfer = await packageTool(modal, 'Portable package reviews');
  if (await transfer.getByRole('checkbox').isVisible()) await transfer.getByRole('checkbox').check();
  const ownerDownload = page.waitForEvent('download', { timeout: 90_000 });
  await transfer.getByRole('button', { name: 'Download review copy', exact: true }).click();
  const copy = await bytes(await ownerDownload); const copyValue = JSON.parse(copy.toString());
  expect(copyValue.package.id).toBe(fixture.package.id); expect(copyValue.package.reviewRounds[0].ownerPackageId).toBeUndefined();
  const independent = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch, serviceWorkers: 'block' });
  try {
    await independent.addInitScript(initialize, theme); const reviewer = await independent.newPage(); await reviewer.goto(new URL('/', page.url()).href);
    let reviewModal = await packages(reviewer);
    await reviewModal.getByLabel('Import package reviewer copy', { exact: true }).setInputFiles({ name: 'reviewer-copy.json', mimeType: 'application/json', buffer: copy });
    let reviewTransfer = reviewModal.getByRole('region', { name: 'Portable package reviews' });
    if (await reviewTransfer.getByRole('checkbox').isVisible()) await reviewTransfer.getByRole('checkbox').check();
    await reviewTransfer.getByRole('button', { name: 'Import review copy', exact: true }).click();
    await expect(reviewModal.getByText('Reviewing exact saved package revision', { exact: true })).toBeVisible();
    await expect(reviewModal.getByRole('button', { name: /^End Package review/ })).toHaveCount(0);
    let navigation = reviewModal.getByRole('navigation', { name: 'Captured review members' });
    await navigation.getByRole('button', { name: native.label, exact: true }).click();
    await reviewModal.getByLabel('Package comment reviewer name', { exact: true }).fill('Synthetic reviewer');
    await reviewModal.getByLabel('Package member comment', { exact: true }).fill('Synthetic native member question.');
    await reviewModal.getByRole('button', { name: 'Post member comment', exact: true }).click();
    await expect(reviewModal.getByText('Synthetic native member question.', { exact: true })).toBeVisible();
    await reviewModal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Synthetic reviewer');
    await reviewModal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'Subject' });
    await reviewModal.getByLabel('Proposed replacement', { exact: true }).fill('SYNTHETIC RETURNED SUBJECT');
    await reviewModal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
    await expect(reviewModal.getByText('Suggestion submitted to this review.', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page: reviewer }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    await reviewModal.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await reviewModal.getByRole('button', { name: 'Continue review', exact: true }).click();
    await expect(reviewModal.getByText(/Comments do not alter PDF bytes or signatures/)).toBeVisible();
    await reviewModal.getByLabel('Package comment reviewer name', { exact: true }).fill('Synthetic reviewer');
    await reviewModal.getByLabel('Package member comment', { exact: true }).fill('Synthetic original PDF question.');
    await reviewModal.getByRole('button', { name: 'Post member comment', exact: true }).click();
    await expect(reviewModal.getByText('Synthetic original PDF question.', { exact: true })).toBeVisible();
    await expect(navigation.getByRole('button', { name: original.label, exact: true })).toBeEnabled();
    await expect(reviewModal.getByRole('region', { name: 'Review suggestions', exact: true })).toHaveCount(0);
    await reviewer.reload(); reviewModal = await packages(reviewer);
    await choosePackageById(reviewModal, fixture.package.id);
  await packageSection(reviewModal, 'Review', true);
    await reviewModal.getByRole('button', { name: 'Open review Package review 1', exact: true }).click();
    navigation = reviewModal.getByRole('navigation', { name: 'Captured review members' });
    await expect(reviewModal.getByText(/1 of .* read on this device/)).toBeVisible();
    await navigation.getByRole('button', { name: original.label, exact: true }).click();
    await expect(reviewModal.getByText('Synthetic original PDF question.', { exact: true })).toBeVisible();
    await prepareReviewTransfer(reviewModal, 'return');
    reviewTransfer = reviewModal.getByRole('region', { name: 'Portable package reviews' });
    if (await reviewTransfer.getByRole('checkbox').isVisible()) await reviewTransfer.getByRole('checkbox').check(); const returnDownload = reviewer.waitForEvent('download', { timeout: 90_000 });
    await reviewTransfer.getByRole('button', { name: 'Download feedback', exact: true }).click();
    const returned = await bytes(await returnDownload); const payload = JSON.parse(returned.toString());
    expect(payload.kind).toBe('dondocs-package-review-return');
    expect(payload.package.reviewRounds[0].id).toBe(copyValue.package.reviewRounds[0].id);
    const children = payload.package.reviewRounds[0].memberReviews;
    expect(children.find((child: { binding: { memberId: string } }) => child.binding.memberId === native.id).suggestions.proposals).toHaveLength(1);
    expect(children.find((child: { binding: { memberId: string } }) => child.binding.memberId === original.id).comments.threads[0].messages[0].text).toBe('Synthetic original PDF question.');
    expect(payload.portableResources).toEqual(copyValue.portableResources);
    await info.attach('package-feedback-return', { body: returned, contentType: 'application/json' });
  } finally { await independent.close(); }
});
