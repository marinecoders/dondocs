import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';
import { closeReviewRounds } from '../_helpers/closeReviewRounds';

test.use({ serviceWorkers: 'block' });
test.setTimeout(180_000);
async function action(page: Page, name: string) {
  await page.getByRole('button', { name: name === 'Undo' || name === 'Redo' ? 'Document tools' : 'Document actions', exact: true }).click();await page.getByRole('menuitem', { name: name === 'Undo' || name === 'Redo' ? new RegExp(`^${name}`) : name, exact: true }).click();
}
async function reviews(page: Page) {
  await action(page, 'Review rounds…');return page.getByRole('dialog', { name: 'Review rounds', exact: true });
}
async function download(page: Page, operation: () => Promise<unknown>) {
  const pending = page.waitForEvent('download');await operation();return readFile((await (await pending).path())!);
}
for (const theme of ['light', 'dark', 'classic']) test(`round-bound replacement proposals preserve newer work in ${theme}`, async ({ page, browser, baseURL }, info) => {
  const appearance = { theme, editorLayout: 'scroll' };
  const init = (value: typeof appearance) => {
    localStorage.setItem('browser-test-visitor', 'returning');localStorage.setItem('dondocs_ui', JSON.stringify({ state: value, version: 1 }));
  };
  await page.addInitScript(init, appearance);await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL SUGGESTION SOURCE', from: 'Training Office', to: 'Original recipient', unitAddress: 'Original training address', date: '13 Nov 26', sigLast: 'EXAMPLE' },
    paragraphs: [{ id: 'suggestion-first', text: 'Original first paragraph.', level: 0 }, { id: 'suggestion-second', text: 'Original second paragraph.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill('Replacement review');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  const copy = await download(page, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());
  await closeReviewRounds(modal);
  const reviewerContext = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent), serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
  try {
    await reviewerContext.addInitScript(init, appearance);const reviewer = await reviewerContext.newPage();await reviewer.goto(baseURL!);
    let reviewModal = await reviews(reviewer);
    await reviewModal.getByLabel('Import reviewer copy', { exact: true }).setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: copy });
    await reviewModal.getByRole('button', { name: 'Open as new review copy', exact: true }).click();await expect(reviewModal).toBeHidden();
    reviewModal = await reviews(reviewer);await reviewModal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Replacement review' });
    await reviewModal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Example chief');
    await reviewModal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'To' });
    await reviewModal.getByLabel('Proposed replacement', { exact: true }).fill('Reviewed recipient');
    await reviewModal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
    await expect(reviewModal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true })).toBeVisible();
    await reviewModal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'Paragraph 1' });
    await reviewModal.getByLabel('Proposed replacement', { exact: true }).fill('Reviewer revised first paragraph.');
    await reviewModal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
    await expect(reviewModal.getByRole('article', { name: 'Suggestion 2: Replace paragraph 1', exact: true })).toBeVisible();
    await reviewModal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'Unit address' });
    await reviewModal.getByLabel('Proposed replacement', { exact: true }).fill('123 Example Rd\nQuantico VA 22134');
    await reviewModal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
    await expect(reviewModal.getByRole('article', { name: 'Suggestion 3: Replace unit address', exact: true })).toBeVisible();
    await reviewModal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'Paragraph 2' });
    await reviewModal.getByLabel('Proposed replacement', { exact: true }).fill('Fictional SSN 123-45-6789 overlapping paragraph.');
    await reviewModal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
    await expect(reviewModal.getByRole('article', { name: 'Suggestion 4: Replace paragraph 2', exact: true })).toBeVisible();
    await reviewModal.getByRole('button', { name: 'Prepare feedback return', exact: true }).click();
    await expect(reviewModal.getByText(/Possible sensitive information:/)).toBeVisible();
    const returned = await download(reviewer, () => reviewModal.getByRole('button', { name: 'Download feedback return', exact: true }).click());
    const payload = JSON.parse(returned.toString('utf8'));expect(payload.version).toBe(2);expect(payload.proposals).toHaveLength(4);expect(payload.formData).toBeUndefined();
    await writeFile(info.outputPath(`review-return-${theme}.json`), returned);
    await reviewModal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'wrong-owner.json', mimeType: 'application/json', buffer: returned });
    await expect(reviewModal.getByRole('alert')).toHaveText(/original draft/);
    await expect(reviewModal.getByRole('button', { name: 'Import reviewed feedback', exact: true })).toHaveCount(0);
    await reviewer.screenshot({ path: info.outputPath(`wrong-owner-${theme}.png`), scale: 'css' });
    await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 2', exact: true }), 'Newer author paragraph survives acceptance.');
    modal = await reviews(page);await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'return.json', mimeType: 'application/json', buffer: returned });
    await modal.getByRole('button', { name: 'Import reviewed feedback', exact: true }).click();await expect(modal.getByText(/Feedback imported/)).toBeVisible();
    await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Replacement review' });
    const address = modal.getByRole('article', { name: 'Suggestion 3: Replace unit address', exact: true });
    await address.getByRole('button', { name: 'Accept suggestion', exact: true }).click();await expect(address.getByText(/· Accepted$/)).toBeVisible();
    const firstParagraph = modal.getByRole('article', { name: 'Suggestion 2: Replace paragraph 1', exact: true });
    await firstParagraph.getByRole('button', { name: 'Accept suggestion', exact: true }).click();await expect(firstParagraph.getByText(/· Accepted$/)).toBeVisible();
    const recipient = modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true });
    await recipient.getByRole('button', { name: 'Accept suggestion', exact: true }).click();await expect(recipient.getByText(/· Accepted$/)).toBeVisible();
    const paragraph = modal.getByRole('article', { name: 'Suggestion 4: Replace paragraph 2', exact: true });
    await expect(paragraph.getByText(/Current draft differs; acceptance is blocked/)).toBeVisible();
    await expect(paragraph.getByRole('button', { name: 'Accept suggestion', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`stale-target-${theme}.png`), scale: 'css' });
    await paragraph.getByRole('button', { name: 'Reject suggestion', exact: true }).click();await expect(paragraph.getByText(/· Rejected$/)).toBeVisible();
    expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`suggestions-${theme}.png`), scale: 'css' });
    await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');await expect(modal).toBeHidden();
    await action(page, 'Undo');
    const undone = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));expect(undone.formData.to).toBe('Original recipient');
    await action(page, 'Redo');
    const redone = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));expect(redone.formData.to).toBe('Reviewed recipient');
    await page.reload();
    const saved = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
    expect(saved.formData.to).toBe('Reviewed recipient');expect(saved.formData.unitAddress).toBe('123 Example Rd\nQuantico VA 22134');expect(saved.paragraphs[1].text).toBe('Newer author paragraph survives acceptance.');
    expect(saved.paragraphs[0].text).toBe('Reviewer revised first paragraph.');expect(JSON.stringify(saved)).not.toContain('123-45-6789');expect(saved.proposals).toBeUndefined();
    await writeFile(info.outputPath(`clean-draft-${theme}.json`), JSON.stringify(saved, null, 2));
    modal = await reviews(page);await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Replacement review' });
    await expect(modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true }).getByText(/· Accepted$/)).toBeVisible();
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'again.json', mimeType: 'application/json', buffer: returned });
    await expect(modal.getByText(/This return has already been imported/)).toBeVisible();
  } finally { await reviewerContext.close(); }
});

async function workspace(page: Page, name: string | RegExp) {
  const trigger = page.getByRole('button', { name: 'Open workspace', exact: true });
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  const target = { name, exact: typeof name === 'string' };
  if (await drawer.isVisible()) {
    await drawer.getByRole('button', target).click();return;
  }
  await trigger.or(page.getByRole('button', target)).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', target).click();
}
async function workspaceBackup(page: Page) {
  await workspace(page, 'Settings');const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  const bytes = await download(page, () => settings.getByRole('button', { name: 'Download workspace backup', exact: true }).click());
  await expect(settings.getByRole('button', { name: 'Download workspace backup', exact: true })).toBeEnabled();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();return bytes;
}
async function restoreWorkspace(page: Page, bytes: Buffer) {
  await workspace(page, 'Settings');const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByLabel('Backup file', { exact: true }).setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: bytes });
  await expect(settings.getByRole('status')).toContainText('review baseline', { timeout: 15_000 });
  await expect(settings.getByRole('button', { name: 'Restore from backup', exact: true })).toBeEnabled({ timeout: 15_000 });
  await expect(settings.getByRole('alert')).toHaveCount(0);
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
}

for (const theme of ['light', 'dark', 'classic']) test(`two reviewer returns reconcile with newer work in ${theme}`, async ({ page, browser, baseURL }, info) => {
  const appearance = { theme, editorLayout: 'scroll' };
  const init = (value: typeof appearance) => {
    localStorage.setItem('browser-test-visitor', 'returning');localStorage.setItem('dondocs_ui', JSON.stringify({ state: value, version: 1 }));
  };
  await page.addInitScript(init, appearance);await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL RECONCILIATION SOURCE', from: 'Training Office', to: 'Training Officer', date: '13 Nov 26', sigLast: 'EXAMPLE' },
    paragraphs: [{ id: 'meeting', text: 'Alpha team meets on Friday.', level: 0 }, { id: 'newer-work', text: 'Original other paragraph.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill('Combined review');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  const copy = await download(page, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());
  await closeReviewRounds(modal, 'close-button');
  const returns: Buffer[] = [];
  for (const author of ['Reviewer Alpha', 'Reviewer Bravo']) {
    const context = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent),
      serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
    try {
      await context.addInitScript(init, appearance);const reviewer = await context.newPage();await reviewer.goto(baseURL!);
      let dialog = await reviews(reviewer);
      await dialog.getByLabel('Import reviewer copy', { exact: true }).setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: copy });
      await dialog.getByRole('button', { name: 'Open as new review copy', exact: true }).click();await expect(dialog).toBeHidden();
      dialog = await reviews(reviewer);await dialog.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Combined review' });
      await dialog.getByLabel('Reviewer name for suggestion', { exact: true }).fill(author);
      await dialog.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'Paragraph 1' });
      await dialog.getByLabel('Proposed replacement', { exact: true }).fill(author === 'Reviewer Alpha' ? 'Alpha team meets on Monday.' : 'Charlie team meets on Friday.');
      await dialog.getByRole('button', { name: 'Add suggestion', exact: true }).click();
      await expect(dialog.getByRole('status', { name: 'Suggestion submission status' })).toHaveText('Suggestion submitted to this review.');
      await dialog.getByLabel('Suggestion target', { exact: true }).selectOption({ label: author === 'Reviewer Alpha' ? 'To' : 'From' });
      await dialog.getByLabel('Proposed replacement', { exact: true }).fill(author === 'Reviewer Alpha' ? 'Reviewed recipient' : 'Reviewed sender');
      await dialog.getByRole('button', { name: 'Add suggestion', exact: true }).click();await expect(dialog.getByRole('article', { name: /^Suggestion \d+:/ })).toHaveCount(2);
      await dialog.getByRole('button', { name: 'Prepare feedback return', exact: true }).click();
      returns.push(await download(reviewer, () => dialog.getByRole('button', { name: 'Download feedback return', exact: true }).click()));
    } finally { await context.close(); }
  }
  const untouched = 'Newer author work survives. Équipe Café';
  await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 2', exact: true }), untouched);
  await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 1', exact: true }), 'Bravo team meets on Friday.');
  modal = await reviews(page);
  for (const returned of theme === 'dark' ? [...returns].reverse() : returns) {
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'return.json', mimeType: 'application/json', buffer: returned });
    await modal.getByRole('button', { name: 'Import reviewed feedback', exact: true }).click();await expect(modal.getByText(/Feedback imported/)).toBeVisible();
  }
  await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Combined review' });await expect(modal.getByRole('article', { name: /^Suggestion \d+:/ })).toHaveCount(4);
  for (const name of ['Replace to', 'Replace from']) {
    const item = modal.getByRole('article', { name: new RegExp(`: ${name}$`) });
    await item.getByRole('button', { name: 'Accept suggestion', exact: true }).click();await expect(item.getByText(/· Accepted$/)).toBeVisible();
  }
  const alpha = modal.getByRole('article', { name: /Replace paragraph 1$/ }).filter({ hasText: 'Reviewer Alpha' });
  await alpha.getByRole('button', { name: 'Reconcile suggestion', exact: true }).click();
  await expect(alpha.getByLabel('Resolved replacement', { exact: true })).toHaveValue('Bravo team meets on Monday.');
  await alpha.getByRole('button', { name: 'Apply resolution', exact: true }).click();await expect(alpha.getByText(/· Accepted$/)).toBeVisible();
  const bravo = modal.getByRole('article', { name: /Replace paragraph 1$/ }).filter({ hasText: 'Reviewer Bravo' });
  await bravo.getByRole('button', { name: 'Reconcile suggestion', exact: true }).click();await expect(bravo.getByText(/These edits overlap/)).toBeVisible();
  await bravo.getByRole('button', { name: 'Cancel reconciliation', exact: true }).click();
  await expect(bravo.getByRole('button', { name: 'Reconcile suggestion', exact: true })).toBeEnabled();
  await bravo.getByRole('button', { name: 'Reconcile suggestion', exact: true }).click();
  const combined = 'Charlie team meets on Monday.\nÉquipe Café';await bravo.getByLabel('Resolved replacement', { exact: true }).fill(combined);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`resolution-${theme}.png`), scale: 'css' });
  await bravo.getByRole('button', { name: 'Apply resolution', exact: true }).click();await expect(bravo.getByText(/· Accepted$/)).toBeVisible();
  await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await action(page, 'Undo');
  let draft = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
  expect(draft.paragraphs[0].text).toBe('Bravo team meets on Monday.');expect(draft.paragraphs[1].text).toBe(untouched);
  await action(page, 'Redo');
  draft = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
  expect(draft.paragraphs[0].text).toBe(combined);await page.reload();
  draft = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
  expect(draft.paragraphs[0].text).toBe(combined);expect(draft.paragraphs[1].text).toBe(untouched);
  expect(draft.formData.to).toBe('Reviewed recipient');expect(draft.formData.from).toBe('Reviewed sender');expect(draft.decisions).toBeUndefined();
  const backup = await workspaceBackup(page), bundle = JSON.parse(backup.toString('utf8'));expect(bundle.version).toBe(10);
  expect(bundle.reviewSuggestions[0].state.decisions.filter((item: { resolutions?: unknown }) => item.resolutions)).toHaveLength(2);
  await writeFile(info.outputPath(`reconciled-workspace-${theme}.json`), backup);
  const context = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent),
    serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
  try {
    await context.addInitScript(init, appearance);const restored = await context.newPage();await restored.goto(baseURL!);await restoreWorkspace(restored, backup);
    await workspace(restored, /^FICTIONAL RECONCILIATION SOURCE /);
    modal = await reviews(restored);await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Combined review' });
    await expect(modal.getByRole('article').filter({ hasText: 'Accepted resolution' })).toHaveCount(2);
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'again.json', mimeType: 'application/json', buffer: returns[0] });
    await expect(modal.getByText(/This return has already been imported/)).toBeVisible();await modal.getByRole('button', { name: 'Close', exact: true }).click();
    const transferred = JSON.parse((await download(restored, () => action(restored, 'Export draft (.json)'))).toString('utf8'));
    expect(transferred.paragraphs[0].text).toBe(combined);expect(transferred.paragraphs[1].text).toBe(untouched);
  } finally { await context.close(); }
});

for (const theme of ['light', 'dark', 'classic']) test(`ambiguous repeated text requires deliberate reconciliation in ${theme}`, async ({ page }, info) => {
  await page.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: value, editorLayout: 'scroll' }, version: 1 }));
  }, theme);await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL REPEATED TEXT REVIEW', from: 'Training Office', to: 'Training Officer', date: '13 Nov 26', sigLast: 'EXAMPLE' },
    paragraphs: [{ id: 'repeated-team', text: 'Alpha Alpha team reports.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'repeated-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill('Repeated text review');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Repeated text review' });
  await modal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Example reviewer');
  await modal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'Paragraph 1' });
  await modal.getByLabel('Proposed replacement', { exact: true }).fill('Bravo Alpha team reports.');
  await modal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
  await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 1', exact: true }), 'Alpha team reports.');
  modal = await reviews(page);await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Repeated text review' });
  const proposal = modal.getByRole('article', { name: 'Suggestion 1: Replace paragraph 1', exact: true });
  await proposal.getByRole('button', { name: 'Reconcile suggestion', exact: true }).click();
  await expect(proposal.getByText(/These edits overlap/)).toBeVisible();
  await expect(proposal.getByLabel('Resolved replacement', { exact: true })).toHaveValue('Alpha team reports.');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`repeated-resolution-${theme}.png`), scale: 'css' });
  await proposal.getByRole('button', { name: 'Cancel reconciliation', exact: true }).click();
  await expect(proposal.getByText(/Current draft differs; acceptance is blocked/)).toBeVisible();
  await proposal.getByRole('button', { name: 'Reconcile suggestion', exact: true }).click();
  await proposal.getByLabel('Resolved replacement', { exact: true }).fill('Bravo team reports.');
  await proposal.getByRole('button', { name: 'Apply resolution', exact: true }).click();
  await expect(proposal.getByText(/· Accepted$/)).toBeVisible();
  await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await action(page, 'Undo');
  let draft = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
  expect(draft.paragraphs[0].text).toBe('Alpha team reports.');await action(page, 'Redo');
  draft = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
  expect(draft.paragraphs[0].text).toBe('Bravo team reports.');await page.reload();
  draft = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
  expect(draft.paragraphs[0].text).toBe('Bravo team reports.');
  const backup = JSON.parse((await workspaceBackup(page)).toString('utf8'));expect(backup.version).toBe(10);
  expect(backup.reviewSuggestions[0].state.decisions.map((decision: { action: string }) => decision.action)).toEqual(['accepted', 'reversed', 'restored']);
  expect(backup.reviewSuggestions[0].state.decisions[0].resolutions[0]).toMatchObject({ expectedCurrent: 'Alpha team reports.', value: 'Bravo team reports.' });
});

test('accepted paragraph decisions survive workspace transfer and permanent source deletion', async ({ page, browser, baseURL }, info) => {
  const init = () => { localStorage.setItem('browser-test-visitor', 'returning'); };
  await page.addInitScript(init);await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'ARCHIVE REVIEW SOURCE', from: 'Training Office', to: 'Training Officer', date: '13 Nov 26', sigLast: 'EXAMPLE' },
    paragraphs: [{ id: 'archive-paragraph', text: 'Archive baseline paragraph.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'archive-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill('Archive review');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  // Durable capture can outlast the short notice assertion while the preview engine starts.
  await expect(modal.getByRole('button', { name: 'Start review from current draft', exact: true })).toBeEnabled({ timeout: 15_000 });
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Archive review' });
  await modal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Example drafter');
  await modal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'Paragraph 1' });
  await modal.getByLabel('Proposed replacement', { exact: true }).fill('Accepted archive paragraph.');
  await modal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
  const proposal = modal.getByRole('article', { name: 'Suggestion 1: Replace paragraph 1', exact: true });
  await proposal.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
  await expect(proposal.getByText(/· Accepted$/)).toBeVisible();await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  const fullBackup = await workspaceBackup(page), bundle = JSON.parse(fullBackup.toString('utf8'));
  expect(bundle.version).toBe(9);expect(bundle.reviewSuggestions).toHaveLength(1);
  expect(bundle.reviewSuggestions[0].state.decisions.map((decision: { action: string }) => decision.action)).toEqual(['accepted']);
  const ownerId = bundle.reviewSuggestions[0].documentId;
  await writeFile(info.outputPath('accepted-workspace-backup.json'), fullBackup);
  const restoredContext = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent), serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
  try {
    await restoredContext.addInitScript(init);const restored = await restoredContext.newPage();await restored.goto(baseURL!);await restoreWorkspace(restored, fullBackup);
    await workspace(restored, /^ARCHIVE REVIEW SOURCE /);
    modal = await reviews(restored);await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Archive review' });
    await expect(modal.getByRole('article', { name: 'Suggestion 1: Replace paragraph 1', exact: true }).getByText(/· Accepted$/)).toBeVisible();
    await expect(modal.getByRole('region', { name: 'Paragraph 1 replacement comparison, suggestion 1', exact: true })).toContainText('Accepted archive paragraph.');
    await restored.screenshot({ path: info.outputPath('restored-accepted-decision.png'), scale: 'css' });
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    const clean = JSON.parse((await download(restored, () => action(restored, 'Export draft (.json)'))).toString('utf8'));
    expect(clean.paragraphs[0].text).toBe('Accepted archive paragraph.');expect(clean.proposals).toBeUndefined();expect(clean.decisions).toBeUndefined();
    await workspace(restored, 'Actions for ARCHIVE REVIEW SOURCE');
    await restored.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
    await workspace(restored, 'Trash');const trash = restored.getByRole('dialog', { name: 'Trash', exact: true });
    await trash.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await restored.getByRole('alertdialog', { name: 'Permanently delete this document?', exact: true }).getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(trash.getByText('Trash is empty.', { exact: true })).toBeVisible();await trash.getByRole('button', { name: 'Close', exact: true }).click();await restored.reload();
    modal = await reviews(restored);await expect(modal.getByText('Source unavailable; the saved baseline is retained.', { exact: false })).toBeVisible();
    await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
    const baseline = await download(restored, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());
    expect(JSON.parse(baseline.toString('utf8')).draft.paragraphs[0].text).toBe('Archive baseline paragraph.');
    await restored.screenshot({ path: info.outputPath('archived-review-after-source-deletion.png'), scale: 'css' });
    await closeReviewRounds(modal, 'close-button');
    const archivedBackup = await workspaceBackup(restored), archived = JSON.parse(archivedBackup.toString('utf8'));
    expect(archived.version).toBe(9);expect(archived.documents.some((document: { id: string }) => document.id === ownerId)).toBe(false);
    expect(archived.reviewSuggestions).toEqual(bundle.reviewSuggestions);expect(archived.reviewSuggestionWrites).toEqual(bundle.reviewSuggestionWrites);
    await writeFile(info.outputPath('archived-workspace-backup.json'), archivedBackup);await writeFile(info.outputPath('archived-reviewer-copy.json'), baseline);
    const archivedContext = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent), serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
    try {
      await archivedContext.addInitScript(init);const recovered = await archivedContext.newPage();await recovered.goto(baseURL!);await restoreWorkspace(recovered, archivedBackup);
      const recoveredModal = await reviews(recovered);await expect(recoveredModal.getByText('Source unavailable; the saved baseline is retained.', { exact: false })).toBeVisible();
      await recoveredModal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
      const recoveredBaseline = await download(recovered, () => recoveredModal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());
      expect(JSON.parse(recoveredBaseline.toString('utf8'))).toEqual(JSON.parse(baseline.toString('utf8')));
      await recovered.screenshot({ path: info.outputPath('restored-archived-review.png'), scale: 'css' });
    } finally { await archivedContext.close(); }
  } finally { await restoredContext.close(); }
});

test('retained custom labels do not bypass the recognized review marking floor', async ({ page }, info) => {
  await page.route('**/classification.config.json?**', route => route.fulfill({ json: { maxLevel: 'secret', allowedLevels: ['unclassified', 'cui', 'confidential', 'secret'] } }));
  await page.addInitScript(() => { localStorage.setItem('browser-test-visitor', 'returning'); });await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL MARKING FLOOR SOURCE', from: 'Training Office', to: 'Training Officer', date: '13 Nov 26', sigLast: 'EXAMPLE', classLevel: 'custom', customClassification: 'INTERNAL HANDLING' },
    paragraphs: [{ id: 'marking-floor-paragraph', text: 'Fictional reviewed baseline paragraph.', level: 0, portionMarking: 'S' }], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'marking-floor-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill('Marking floor review');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Marking floor review' });
  await modal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Example drafter');
  await modal.getByLabel('Suggestion target', { exact: true }).selectOption({ label: 'Subject' });
  await modal.getByLabel('Proposed replacement', { exact: true }).fill('REVIEWED MARKING FLOOR SUBJECT');
  await modal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
  await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Portion marking: Secret. Change', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '(U) Unclassified', exact: true }).click();
  await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 1', exact: true }), 'Fictional lower-marked current paragraph.');
  modal = await reviews(page);await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Marking floor review' });
  const proposal = modal.getByRole('article', { name: 'Suggestion 1: Replace subject', exact: true });
  await proposal.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('marked below the reviewed content');
  await expect(proposal.getByText(/· Pending$/)).toBeVisible();await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('rejected-below-recognized-floor.png'), scale: 'css' });
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  const clean = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
  expect(clean.formData.subject).toBe('FICTIONAL MARKING FLOOR SOURCE');expect(clean.formData.customClassification).toBe('INTERNAL HANDLING');
  expect(clean.paragraphs[0]).toMatchObject({ text: 'Fictional lower-marked current paragraph.', portionMarking: 'U' });
  const backup = await workspaceBackup(page), bundle = JSON.parse(backup.toString('utf8'));
  expect(bundle.reviewSuggestions[0].state.proposals).toHaveLength(1);expect(bundle.reviewSuggestions[0].state.decisions).toEqual([]);
  await writeFile(info.outputPath('unchanged-after-floor-rejection-backup.json'), backup);await writeFile(info.outputPath('unchanged-after-floor-rejection-draft.json'), JSON.stringify(clean, null, 2));
});

for (const scenario of [
  { name: 'recognized downgrade', baseline: 'SECRET', proposed: 'UNCLASSIFIED', error: 'marked below the reviewed content' },
  { name: 'retained custom label removal', baseline: 'INTERNAL HANDLING', proposed: 'UNCLASSIFIED', error: 'unranked or incomplete markings' },
  { name: 'recognized upgrade', baseline: 'CUI', proposed: 'SECRET', error: null },
] as const) test(`custom marking replacement checks the resulting document: ${scenario.name}`, async ({ page }, info) => {
  await page.route('**/classification.config.json?**', route => route.fulfill({ json: { maxLevel: 'secret', allowedLevels: ['unclassified', 'cui', 'confidential', 'secret'] } }));
  await page.addInitScript(() => { localStorage.setItem('browser-test-visitor', 'returning'); });await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL CUSTOM MARKING REVIEW', from: 'Training Office', to: 'Training Officer', date: '13 Nov 26', sigLast: 'EXAMPLE', classLevel: 'custom', customClassification: scenario.baseline },
    paragraphs: [{ id: 'custom-marking-paragraph', text: 'Fictional baseline paragraph.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'custom-marking-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill('Custom marking review');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Custom marking review' });
  await modal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Example reviewer');
  await modal.getByLabel('Suggestion target', { exact: true }).selectOption('field:customClassification');
  await modal.getByLabel('Proposed replacement', { exact: true }).fill(scenario.proposed);
  await modal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
  const proposal = modal.getByRole('article', { name: 'Suggestion 1: Replace custom classification', exact: true });
  await proposal.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
  if (scenario.error) {
    await expect(modal.getByRole('alert')).toContainText(scenario.error);
    await expect(proposal.getByText(/· Pending$/)).toBeVisible();
  } else {
    await expect(proposal.getByText(/· Accepted$/)).toBeVisible();
    await expect(modal.getByText('Review change saved.', { exact: true })).toBeVisible();
  }
  await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath(`custom-marking-${scenario.name.replaceAll(' ', '-')}.png`), scale: 'css' });
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  const expected = scenario.error ? scenario.baseline : scenario.proposed;
  const clean = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
  expect(clean.formData.customClassification).toBe(expected);
  const backup = await workspaceBackup(page), bundle = JSON.parse(backup.toString('utf8'));
  expect(bundle.reviewSuggestions[0].state.decisions.map((decision: { action: string }) => decision.action)).toEqual(scenario.error ? [] : ['accepted']);
  await writeFile(info.outputPath('custom-marking-backup.json'), backup);
  await page.reload();
  const reopened = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
  expect(reopened.formData.customClassification).toBe(expected);
});

test('categorized feedback survives reload and downloadable returns', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'light', editorLayout: 'scroll' } }));
  });
  await page.goto('/');
  const draft = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL CATEGORY REVIEW', from: 'Training Office', to: 'Original recipient', date: '15 Nov 26' },
    paragraphs: [{ id: 'category-paragraph', text: 'Fictional training text.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'category.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  let comments = page.getByRole('dialog', { name: 'Document comments', exact: true });
  await comments.getByLabel('Reviewer name', { exact: true }).fill('Example chief');
  await comments.getByLabel('Comment', { exact: true }).fill('Which recipient should receive this?');
  await comments.getByLabel('Comment category', { exact: true }).selectOption('question');
  await comments.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(comments.getByRole('article')).toContainText('Question');
  await comments.getByLabel('Filter comment category', { exact: true }).selectOption('required-correction');
  await expect(comments.getByRole('article')).toHaveCount(0);
  await comments.getByRole('button', { name: 'Close comments', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Comments (1)', exact: true }).click();
  comments = page.getByRole('dialog', { name: 'Document comments', exact: true });
  await expect(comments.getByRole('article')).toContainText('Question');
  await comments.getByRole('button', { name: 'Close comments', exact: true }).click();
  let modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('Categorized round');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Open baseline as new review copy', exact: true }).click();
  await expect(modal).toBeHidden();
  modal = await reviews(page);
  await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Categorized round' });
  await modal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Example chief');
  await modal.getByLabel('Suggestion category', { exact: true }).selectOption('required-correction');
  await modal.getByLabel('Suggestion target', { exact: true }).selectOption('field:to');
  await modal.getByLabel('Proposed replacement', { exact: true }).fill('Corrected recipient');
  await modal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
  await expect(modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true })).toContainText('Required correction');
  await modal.getByRole('button', { name: 'Prepare feedback return', exact: true }).click();
  const returned = JSON.parse((await download(page, () => modal.getByRole('button', { name: 'Download feedback return', exact: true }).click())).toString('utf8'));
  expect(returned.proposals[0].category).toBe('required-correction');
  expect(returned.comments.threads[0].category).toBe('question');
  await info.attach('categorized-return.json', { body: JSON.stringify(returned, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('categorized-review.png'), scale: 'css' });
});

test('review lifecycle preserves late returns and requires deliberate reopening', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'dark', editorLayout: 'scroll' } }));
  });
  await page.goto('/');
  const draft = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL LIFECYCLE SOURCE', from: 'Training Office', to: 'Original recipient', date: '15 Nov 26' },
    paragraphs: [{ id: 'lifecycle-paragraph', text: 'Fictional training text.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'lifecycle.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('First lifecycle round');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Open baseline as new review copy', exact: true }).click();
  await expect(modal).toBeHidden();
  modal = await reviews(page);
  await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'First lifecycle round' });
  await modal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Example reviewer');
  await modal.getByLabel('Suggestion target', { exact: true }).selectOption('field:to');
  await modal.getByLabel('Proposed replacement', { exact: true }).fill('Reviewed recipient');
  await modal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
  await expect(modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Prepare feedback return', exact: true }).click();
  const returned = await download(page, () => modal.getByRole('button', { name: 'Download feedback return', exact: true }).click());
  await closeReviewRounds(modal);
  await workspace(page, /^(?:LTR\s*)?FICTIONAL LIFECYCLE SOURCE/);
  modal = await reviews(page);
  const first = modal.getByRole('article', { name: 'Review First lifecycle round', exact: true });
  await first.getByRole('button', { name: 'Close review', exact: true }).click();
  await expect(first).toContainText('Round status: closed');
  await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'late.json', mimeType: 'application/json', buffer: returned });
  await expect(modal.getByRole('alert')).toContainText('closed or superseded');
  await expect(modal.getByRole('button', { name: 'Import reviewed feedback', exact: true })).toHaveCount(0);
  await first.getByRole('button', { name: 'Reopen review', exact: true }).click();
  await expect(first).toContainText('Round status: active');
  await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'late.json', mimeType: 'application/json', buffer: returned });
  await modal.getByRole('button', { name: 'Import reviewed feedback', exact: true }).click();
  await expect(modal.getByText(/Feedback imported/)).toBeVisible();
  await modal.getByLabel('Review name', { exact: true }).fill('Replacement lifecycle round');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByRole('article', { name: 'Review Replacement lifecycle round', exact: true })).toBeVisible();
  await first.getByLabel('Replacement for First lifecycle round', { exact: true }).selectOption({ label: 'Replacement lifecycle round' });
  await first.getByRole('button', { name: 'Supersede review', exact: true }).click();
  await expect(first).toContainText('Round status: superseded');
  await expect(first).toContainText('Replaced by Replacement lifecycle round');
  await expect(first.getByRole('button', { name: 'Reopen review', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  modal = await reviews(page);
  await expect(modal.getByRole('article', { name: 'Review First lifecycle round', exact: true })).toContainText('Round status: superseded');
  await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'duplicate.json', mimeType: 'application/json', buffer: returned });
  await expect(modal.getByText(/This return has already been imported/)).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('retained-round-lifecycle.png'), scale: 'css' });
});

test('received copies and backups advance compatible closed review history', async ({ page, browser, baseURL }, info) => {
  const initialize = () => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'light', editorLayout: 'scroll' } }));
  };
  await page.addInitScript(initialize);
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({
    name: 'received-state-source.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
      formData: { subject: 'SYNTHETIC RECEIVED STATE SOURCE', to: 'Example recipient' },
      paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [],
    })),
  });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('Received state review');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  const sourceRound = modal.getByRole('article', { name: 'Review Received state review', exact: true });
  await expect(sourceRound).toContainText('Round status: active');
  async function copy() {
    await sourceRound.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
    return download(page, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());
  }
  const activeFile = await copy();
  await sourceRound.getByRole('button', { name: 'Close review', exact: true }).click();
  await expect(sourceRound).toContainText('Round status: closed');
  const closedFile = await copy();
  const device = {
    viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent),
    isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch,
    serviceWorkers: 'block' as const, reducedMotion: 'reduce' as const,
  };
  await writeFile(info.outputPath('received-active.json'), activeFile);
  await writeFile(info.outputPath('received-closed.json'), closedFile);
  await page.close();

  async function importCopy(recipient: Page, bytes: Buffer) {
    const incoming = await reviews(recipient);
    await incoming.getByLabel('Import reviewer copy', { exact: true }).setInputFiles({
      name: 'received-review.json', mimeType: 'application/json', buffer: bytes,
    });
    await incoming.getByRole('button', { name: 'Open as new review copy', exact: true }).click();
    await expect(incoming).toBeHidden();
  }
  async function expectClosed(recipient: Page, screenshot: string) {
    const received = await reviews(recipient);
    const round = received.getByRole('article', { name: 'Review Received state review', exact: true });
    await expect(round).toContainText('Round status: closed');
    await expect(round).toContainText('Received reviewer baseline; no local source ownership is assigned.');
    await expect(round.getByRole('button', { name: 'Reopen review', exact: true })).toHaveCount(0);
    await received.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Received state review' });
    await expect(received.getByLabel('Reviewer name for suggestion', { exact: true })).toBeDisabled();
    await expect(received.getByLabel('Suggestion target', { exact: true })).toBeDisabled();
    await expect(received.getByRole('button', { name: 'Add suggestion', exact: true })).toBeDisabled();
    await expect(received.getByText('This round is closed or superseded. Its suggestions and decisions remain available for inspection.', { exact: true })).toBeVisible();
    await recipient.screenshot({ path: info.outputPath(screenshot), scale: 'css' });
    await recipient.keyboard.press('Escape');
    await expect(received).toBeHidden();
  }

  const first = await browser.newContext(device);
  let closedBackup: Buffer;
  try {
    await first.addInitScript(initialize);
    const recipient = await first.newPage();
    await recipient.goto(baseURL!);
    await importCopy(recipient, activeFile);
    modal = await reviews(recipient);
    await expect(modal.getByRole('article', { name: 'Review Received state review', exact: true })).toContainText('Round status: active');
    await recipient.keyboard.press('Escape');
    await importCopy(recipient, closedFile);
    await expectClosed(recipient, 'received-state-closed-copy.png');
    closedBackup = await workspaceBackup(recipient);
    const savedRound = JSON.parse(closedBackup.toString('utf8')).reviewRounds[0];
    expect(savedRound.ownerDocumentId).toBeUndefined();
    expect(savedRound.lifecycle.events.at(-1).state).toBe('closed');
    await writeFile(info.outputPath('received-closed-workspace.json'), closedBackup);
  } finally { await first.close(); }

  const second = await browser.newContext(device);
  try {
    await second.addInitScript(initialize);
    const recipient = await second.newPage();
    await recipient.goto(baseURL!);
    await importCopy(recipient, activeFile);
    await restoreWorkspace(recipient, closedBackup!);
    await recipient.reload();
    await expectClosed(recipient, 'received-state-restored.png');
  } finally { await second.close(); }
});

test('a round changed in another tab rejects stale state controls', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'classic', editorLayout: 'scroll' } }));
  });
  await page.goto('/');
  const draft = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL TWO TAB REVIEW', to: 'Example recipient' },
    paragraphs: [{ id: 'two-tab-review', text: 'Synthetic review content.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'two-tab.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('Concurrent round');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Close review', exact: true })).toBeVisible();
  const second = await page.context().newPage();
  try {
    await second.goto('/');
    const other = await reviews(second);
    await other.getByRole('button', { name: 'Close review', exact: true }).click();
    await expect(other.getByText('Round status: closed', { exact: true })).toBeVisible();
    await modal.getByRole('button', { name: 'Close review', exact: true }).click();
    await expect(modal.getByRole('alert')).toContainText('changed before the state could be saved');
    await modal.getByRole('button', { name: 'Refresh review rounds', exact: true }).click();
    await expect(modal.getByText('Round status: closed', { exact: true })).toBeVisible();
    await modal.getByRole('button', { name: 'Reopen review', exact: true }).click();
    await expect(modal.getByText('Round status: active', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('stale-lifecycle-rejected.png'), scale: 'css' });
  } finally {
    await second.close();
  }
});

test('explicit reviewer checkpoints show later text and feedback outcomes after reload and transfer', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'classic', editorLayout: 'scroll' } }));
  });
  await page.goto('/');
  const draft = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL CHECKPOINT SOURCE', from: 'Training Office', to: 'Original recipient', date: '15 Nov 26' },
    paragraphs: [{ id: 'checkpoint-body', text: 'Earlier training paragraph.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'checkpoint.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('Checkpoint round');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Checkpoint round' });
  await modal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Example chief');
  await modal.getByLabel('Suggestion target', { exact: true }).selectOption('field:to');
  await modal.getByLabel('Proposed replacement', { exact: true }).fill('Reviewed recipient');
  await modal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
  const suggestion = modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true });
  await expect(suggestion).toBeVisible();
  await modal.getByLabel('Review for comparison checkpoint', { exact: true }).selectOption({ label: 'Checkpoint round' });
  await expect(modal.getByText(/No checkpoint is selected/)).toBeVisible();
  await modal.getByLabel('Reviewer label for checkpoint', { exact: true }).fill('Example chief');
  await modal.getByRole('button', { name: 'Mark current view reviewed', exact: true }).click();
  await expect(modal.getByText(/Current captured document and feedback marked reviewed/)).toBeVisible();
  await suggestion.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
  await expect(suggestion.getByText(/· Accepted$/)).toBeVisible();
  await expect(modal.getByLabel('Review for suggested edits', { exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 1', exact: true }), 'Later author paragraph.');
  modal = await reviews(page);
  await modal.getByLabel('Review for comparison checkpoint', { exact: true }).selectOption({ label: 'Checkpoint round' });
  await expect(modal.getByText(/No checkpoint is selected/)).toBeVisible();
  const reviewerOption = await modal.getByLabel('Reviewer checkpoint', { exact: true }).getByRole('option', { name: /Example chief/ }).getAttribute('value');
  await modal.getByLabel('Reviewer checkpoint', { exact: true }).selectOption(reviewerOption!);
  await modal.getByRole('button', { name: 'Show changes since checkpoint', exact: true }).click();
  await expect(modal.getByRole('region', { name: 'document changes since checkpoint', exact: true })).toContainText('Earlier training paragraph.');
  await expect(modal.getByRole('region', { name: 'document changes since checkpoint', exact: true })).toContainText('Later author paragraph.');
  await expect(modal.getByRole('region', { name: 'feedback changes since checkpoint', exact: true })).toContainText('Accepted');
  await modal.getByRole('button', { name: 'Prepare checkpoint file', exact: true }).click();
  const checkpointFile = await download(page, () => modal.getByRole('button', { name: 'Download checkpoint file', exact: true }).click());
  const checkpoint = JSON.parse(checkpointFile.toString('utf8'));
  expect(checkpoint.document.some((field: { value: string }) => field.value === 'Earlier training paragraph.')).toBe(true);
  await info.attach('explicit-reviewer-checkpoint.json', { body: checkpointFile, contentType: 'application/json' });
  await closeReviewRounds(modal);
  await page.reload();
  modal = await reviews(page);
  await modal.getByLabel('Review for comparison checkpoint', { exact: true }).selectOption({ label: 'Checkpoint round' });
  await modal.getByLabel('Reviewer checkpoint', { exact: true }).selectOption(checkpoint.reviewerId);
  await modal.getByRole('button', { name: 'Show changes since checkpoint', exact: true }).click();
  await expect(modal.getByRole('region', { name: 'feedback changes since checkpoint', exact: true })).toContainText('Accepted');
  const tampered = { ...checkpoint, reviewerLabel: 'Changed after capture' };
  await modal.getByLabel('Import reviewer checkpoint', { exact: true }).setInputFiles({ name: 'tampered.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tampered)) });
  await expect(modal.getByRole('alert')).toContainText('checksum');
  await modal.getByLabel('Import reviewer checkpoint', { exact: true }).setInputFiles({ name: 'checkpoint.json', mimeType: 'application/json', buffer: checkpointFile });
  await modal.getByRole('button', { name: 'Import this checkpoint', exact: true }).click();
  await expect(modal.getByText('Reviewer checkpoint imported. Document text and review decisions were kept.', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Show changes since checkpoint', exact: true }).click();
  await expect(modal.getByRole('region', { name: 'feedback changes since checkpoint', exact: true })).toContainText('Accepted');
  await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  const reviewerCopy = JSON.parse((await download(page, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click())).toString('utf8'));
  expect(reviewerCopy.round.checkpoints).toHaveLength(1);
  expect(reviewerCopy.round.checkpoints[0].digest).toBe(checkpoint.digest);
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('since-last-reviewed-checkpoint.png'), scale: 'css' });
});

test('retained checkpoint markings block both file downloads after a stricter policy refresh', async ({ page }, info) => {
  let restricted = false;
  await page.route('**/classification.config.json?**', route => route.fulfill({ json: restricted
    ? { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }
    : { maxLevel: 'secret', allowedLevels: ['unclassified', 'cui', 'confidential', 'secret'] } }));
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'light', editorLayout: 'scroll' } }));
  });
  await page.goto('/');
  const draft = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL CHECKPOINT MARKING TEST', to: 'Example recipient', classLevel: 'custom', customClassification: 'UNCLASSIFIED' },
    paragraphs: [{ id: 'checkpoint-marking', text: 'Synthetic training text only.', level: 0, portionMarking: 'U' }],
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'checkpoint-marking.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('Unclassified retained baseline');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await page.getByRole('button', { name: 'Portion marking: Unclassified. Change', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '(S) Secret', exact: true }).click();
  modal = await reviews(page);
  const checkpoints = modal.getByRole('region', { name: 'Since you last reviewed', exact: true });
  await checkpoints.getByLabel('Review for comparison checkpoint', { exact: true }).selectOption({ label: 'Unclassified retained baseline' });
  await checkpoints.getByLabel('Reviewer label for checkpoint', { exact: true }).fill('Example chief');
  await checkpoints.getByRole('button', { name: 'Mark current view reviewed', exact: true }).click();
  await expect(checkpoints.getByText(/Current captured document and feedback marked reviewed/)).toBeVisible();
  await checkpoints.getByRole('button', { name: 'Prepare checkpoint file', exact: true }).click();
  await expect(checkpoints.getByText('Example chief · SECRET', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  await expect(modal.getByRole('heading', { name: 'Check this reviewer copy before downloading', exact: true })).toBeVisible();
  const downloads: string[] = [];
  page.on('download', event => downloads.push(event.suggestedFilename()));
  restricted = true;
  await checkpoints.getByRole('button', { name: 'Download checkpoint file', exact: true }).click();
  await expect(checkpoints.getByRole('alert')).toContainText('configured levels');
  await modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click();
  await expect(modal.getByRole('alert').filter({ hasText: 'configured levels' })).toHaveCount(2);
  expect(downloads).toEqual([]);
  await page.screenshot({ path: info.outputPath('checkpoint-retained-marking-downloads-blocked.png'), scale: 'css' });
});

for (const kind of ['signature', 'basic-letter'] as const) test(`reviewer-copy disclosure scans the actual retained ${kind} filename`, async ({ page }, info) => {
  const { docxImageFixture } = await import('../_helpers/docxImageFixture');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Synthetic retained original.');
  const bytes = kind === 'signature' ? (await docxImageFixture()).signature : Buffer.from(await pdf.save());
  const name = `Synthetic SSN 123-45-6789.${kind === 'signature' ? 'png' : 'pdf'}`;
  await page.addInitScript(theme => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme, editorLayout: 'scroll' } }));
  }, kind === 'signature' ? 'dark' : 'classic');
  await page.goto('/');
  const file = { name, size: bytes.length, data: bytes.toString('base64') };
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: kind === 'signature' ? 'naval_letter' : 'new_page_endorsement',
    formData: { subject: 'SYNTHETIC RETAINED FILE NAME', to: 'Training office', classLevel: 'unclassified',
      ...(kind === 'signature' ? { signatureType: 'image', signatureImage: file } : { basicLetterFile: file }) },
    paragraphs: [{ id: 'SECRET', text: 'Synthetic benign training paragraph.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('Retained filename disclosure');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  const contents = modal.getByRole('region', { name: 'Review copy contents', exact: true });
  await expect(contents).toContainText('Automatic checks cover text and filenames.');
  const disclosure = await contents.innerText();
  await page.screenshot({ path: info.outputPath(`${kind}-filename-disclosure.png`), scale: 'css' });
  const actual = await download(page, () => contents.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());
  const envelope = JSON.parse(actual.toString('utf8'));
  expect(envelope.draft.paragraphs[0].id).toBe('SECRET');
  const retained = envelope.draft.formData[kind === 'signature' ? 'signatureImage' : 'basicLetterFile'];
  expect(retained.name).toBe(name);
  expect(Buffer.from(retained.data, 'base64')).toEqual(bytes);
  await info.attach(`${kind}-reviewer-copy.json`, { body: actual, contentType: 'application/json' });
  expect(disclosure).toContain('Possible sensitive information: Social Security Number.');
});

test('closed categorized decisions and earlier checkpoints survive Undo Redo and a fresh backup restore', async ({ page, browser, baseURL }, info) => {
  const init = () => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'light', editorLayout: 'scroll' } }));
  };
  await page.addInitScript(init);
  await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL CROSS REVIEW', to: 'Original recipient', classLevel: 'unclassified' },
    paragraphs: [{ id: 'overlap-body', text: 'Synthetic unchanged body.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'overlap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);
  await modal.getByLabel('Review name', { exact: true }).fill('Cross-feature round');
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: 'Cross-feature round' });
  await modal.getByLabel('Reviewer name for suggestion', { exact: true }).fill('Synthetic chief');
  await modal.getByLabel('Suggestion category', { exact: true }).selectOption('required-correction');
  await modal.getByLabel('Suggestion target', { exact: true }).selectOption('field:to');
  await modal.getByLabel('Proposed replacement', { exact: true }).fill('Accepted recipient');
  await modal.getByRole('button', { name: 'Add suggestion', exact: true }).click();
  const suggestion = modal.getByRole('article', { name: 'Suggestion 1: Replace to', exact: true });
  await expect(suggestion).toContainText('Required correction');
  await modal.getByLabel('Review for comparison checkpoint', { exact: true }).selectOption({ label: 'Cross-feature round' });
  await modal.getByLabel('Reviewer label for checkpoint', { exact: true }).fill('Synthetic chief');
  await modal.getByRole('button', { name: 'Mark current view reviewed', exact: true }).click();
  await expect(modal.getByText(/Current captured document and feedback marked reviewed/)).toBeVisible();
  await suggestion.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
  await expect(suggestion.getByText(/· Accepted$/)).toBeVisible();
  await modal.getByRole('button', { name: 'Close review', exact: true }).click();
  await expect(modal.getByText('Round status: closed', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await action(page, 'Undo');
  const undone = JSON.parse((await download(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
  expect(undone.formData.to).toBe('Original recipient');
  modal = await reviews(page);
  await modal.getByRole('button', { name: 'Prepare decision summary', exact: true }).click();
  const reversed = (await download(page, () => modal.getByRole('button', { name: 'Download reviewed decision summary (.html)', exact: true }).click())).toString('utf8');
  expect(reversed).toContain('Round status at capture: closed');
  expect(reversed).toContain('Accepted: 0 · Rejected: 0 · Open: 1 · Conflicting: 0');
  expect(reversed).toContain('reversed');
  await closeReviewRounds(modal);
  await action(page, 'Redo');
  const backup = await workspaceBackup(page);
  await info.attach('cross-review-backup.json', { body: backup, contentType: 'application/json' });
  const context = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent),
    serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
  try {
    await context.addInitScript(init);
    const restored = await context.newPage();
    await restored.goto(baseURL!);
    await restoreWorkspace(restored, backup);
    await workspace(restored, /^(?:LTR\s*)?FICTIONAL CROSS REVIEW/);
    const restoredModal = await reviews(restored);
    await expect(restoredModal.getByText('Round status: closed', { exact: true })).toBeVisible();
    await restoredModal.getByRole('button', { name: 'Prepare decision summary', exact: true }).click();
    const html = await download(restored, () => restoredModal.getByRole('button', { name: 'Download reviewed decision summary (.html)', exact: true }).click());
    expect(html.toString('utf8')).toContain('Accepted: 1 · Rejected: 0 · Open: 0 · Conflicting: 0');
    expect(html.toString('utf8')).toContain('restored');
    expect(html.toString('utf8')).toContain('Feedback category: Required correction');
    await info.attach('restored-closed-summary.html', { body: html, contentType: 'text/html' });
    await restoredModal.getByLabel('Review for comparison checkpoint', { exact: true }).selectOption({ label: 'Cross-feature round' });
    const marker = restoredModal.getByLabel('Reviewer checkpoint', { exact: true });
    const markerId = await marker.getByRole('option', { name: /Synthetic chief/ }).getAttribute('value');
    expect(markerId).toBeTruthy();
    await marker.selectOption(markerId!);
    await restoredModal.getByRole('button', { name: 'Show changes since checkpoint', exact: true }).click();
    await expect(restoredModal.getByRole('region', { name: 'feedback changes since checkpoint', exact: true })).toContainText('Accepted');
    await expect(restoredModal.getByRole('region', { name: 'document changes since checkpoint', exact: true })).toContainText('Original recipient');
    await expect(restoredModal.getByRole('region', { name: 'document changes since checkpoint', exact: true })).toContainText('Accepted recipient');
  } finally { await context.close(); }
});
