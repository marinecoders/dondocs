import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';

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
  const copy = await download(page, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());await page.keyboard.press('Escape');
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
    await expect(modal.getByRole('region', { name: 'Paragraph 1 replacement comparison', exact: true })).toContainText('Accepted archive paragraph.');
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
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
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
