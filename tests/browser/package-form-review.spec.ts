import { expect, test, type Page, type Locator, type Download } from '@playwright/test';
import { projectBrowserContextOptions } from '../_helpers/projectBrowserContext';
import { readFile } from 'node:fs/promises';
import type { ActionPackage } from '../../src/lib/actionPackages';
test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(120_000);
async function packages(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true }).or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole('dialog', { name: 'Action packages', exact: true });
}
for (const theme of ['light', 'dark', 'classic']) for (const width of [1440, 320]) test(`exact form comments persist and travel with review in ${theme} at ${width}px`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await context.addInitScript(value => { localStorage.setItem('browser-test-visitor', 'returning'); localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } })); }, theme);
  await page.goto('/'); let dialog = await packages(page);
  await dialog.locator('summary').filter({ hasText: /^Quick request starter/ }).click();
  const starter = dialog.getByRole('region', { name: 'Administrative request starter', exact: true });
  await starter.getByRole('button', { name: 'Start an administrative request', exact: true }).click();
  for (const [label, value] of Object.entries({ Requester: 'Alex Example', Organization: 'Fictional Training Unit', Recipient: 'Training Officer', 'Request subject': 'Form review exercise', 'Request date': '2026-11-17', SSIC: '1500', 'Printed signature name': 'A. EXAMPLE', 'Requested action and justification': 'Request fictional training to verify exact package form review.' })) await starter.getByLabel(label, { exact: label !== 'Printed signature name' }).fill(value);
  await starter.getByRole('button', { name: 'Review request starter', exact: true }).click();
  await starter.getByRole('checkbox', { name: /^I reviewed these request details/ }).check();
  await starter.getByRole('button', { name: 'Create reviewed request package', exact: true }).click();
  await expect(dialog.getByLabel('Package name', { exact: true })).toHaveValue('Request: Form review exercise');
  await dialog.getByRole('button', { name: 'Start package review', exact: true }).click();
  await dialog.getByRole('navigation', { name: 'Captured review members', exact: true }).getByRole('button', { name: 'DonDocs request details worksheet', exact: true }).click();
  let review = dialog.getByRole('region', { name: 'Captured form field feedback', exact: true });
  const fields = review.getByLabel('Reviewed form field', { exact: true });
  await expect(fields.locator('option')).not.toHaveCount(1);
  await fields.selectOption({ index: 1 });
  const targetLabel = await fields.locator('option:checked').textContent(); expect(targetLabel).toBeTruthy();
  await review.getByLabel('Form comment reviewer name', { exact: true }).fill('Blair Sample');
  await review.getByLabel('Form field comment', { exact: true }).fill('Please confirm this exact captured answer.');
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Saved packages', { exact: true })).toBeDisabled();
  await review.getByRole('button', { name: 'Post form field comment', exact: true }).click();
  await expect(review.locator('article').getByText('Please confirm this exact captured answer.', { exact: false })).toBeVisible();
  await expect(review.locator('article')).toContainText(targetLabel!);
  await dialog.getByRole('button', { name: 'Undo member comment', exact: true }).click();
  await expect(review.locator('article')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Redo member comment', exact: true }).click();
  await expect(review.locator('article')).toHaveCount(1);
  await review.getByRole('button', { name: 'Resolve form comment', exact: true }).click();
  await expect(review.locator('article')).toContainText('Resolved');
  await review.getByRole('button', { name: 'Reopen form comment', exact: true }).click();
  await dialog.getByRole('button', { name: 'Prepare package feedback return', exact: true }).click();
  await dialog.getByRole('checkbox', { name: /^I reviewed all captured members, original PDF pages/ }).check();
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download package feedback return', exact: true }).click();
  const downloaded = await downloading; expect(await downloaded.failure()).toBeNull();
  const returned = JSON.parse((await readFile((await downloaded.path())!)).toString());
  expect(JSON.stringify(returned)).toContain('Please confirm this exact captured answer.'); expect(JSON.stringify(returned)).toContain('fieldReview');
  await page.reload(); dialog = await packages(page);
  await dialog.getByRole('button', { name: 'Open review Package review 1', exact: true }).click();
  await dialog.getByRole('navigation', { name: 'Captured review members', exact: true }).getByRole('button', { name: 'DonDocs request details worksheet', exact: true }).click();
  review = dialog.getByRole('region', { name: 'Captured form field feedback', exact: true });
  await expect(review.locator('article')).toContainText('Please confirm this exact captured answer.');
  await review.scrollIntoViewIfNeeded();
  const geometry = await dialog.evaluate(root => ({ width: root.clientWidth, scroll: root.scrollWidth, left: root.scrollLeft, rect: root.getBoundingClientRect().width, padding: getComputedStyle(root).paddingRight,
    children: [...root.querySelectorAll<HTMLElement>('*')].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1 && !['INPUT','TEXTAREA','SELECT','OPTION','PRE'].includes(element.tagName)).sort((a,b) => (b.scrollWidth-b.clientWidth)-(a.scrollWidth-a.clientWidth)).slice(0,12).map(element => ({ tag: element.tagName, cls: element.className, width: element.clientWidth, scroll: element.scrollWidth, right: element.getBoundingClientRect().right, text: element.textContent?.slice(0,40) })) }));
  expect(geometry.scroll <= geometry.width + 1, JSON.stringify(geometry)).toBe(true);
  await page.screenshot({ path: info.outputPath(`form-field-review-${theme}-${width}px.png`) });
});

const worksheetLabel = 'DonDocs request details worksheet';
async function requestPackage(page: Page, subject: string) {
  await page.goto('/'); const dialog = await packages(page);
  await dialog.locator('summary').filter({ hasText: /^Quick request starter/ }).click();
  const starter = dialog.getByRole('region', { name: 'Administrative request starter', exact: true });
  await starter.getByRole('button', { name: 'Start an administrative request', exact: true }).click();
  for (const [label, value] of Object.entries({ Requester: 'Alex Example', Organization: 'Fictional Training Unit', Recipient: 'Training Officer', 'Request subject': subject,
    'Request date': '2026-11-17', SSIC: '1500', 'Printed signature name': 'A. EXAMPLE', 'Requested action and justification': 'Fictional training request for browser qualification.' }))
    await starter.getByLabel(label, { exact: label !== 'Printed signature name' }).fill(value);
  await starter.getByRole('button', { name: 'Review request starter', exact: true }).click();
  await starter.getByRole('checkbox', { name: /^I reviewed these request details/ }).check();
  await starter.getByRole('button', { name: 'Create reviewed request package', exact: true }).click();
  await expect(dialog.getByLabel('Package name', { exact: true })).toHaveValue(`Request: ${subject}`);
  return dialog;
}
async function openWorksheet(dialog: Locator) {
  await dialog.getByRole('navigation', { name: 'Captured review members', exact: true }).getByRole('button', { name: worksheetLabel, exact: true }).click();
  return dialog.getByRole('region', { name: 'Captured form field feedback', exact: true });
}
async function proposeField(dialog: Locator, label: string, value: string, author = 'Blair Sample') {
  const fields = dialog.getByRole('region', { name: 'Captured form field feedback', exact: true });
  await fields.getByLabel('Reviewed form field', { exact: true }).selectOption({ label });
  await fields.getByLabel('Form comment reviewer name', { exact: true }).fill(author);
  await fields.getByLabel('Proposed form answer', { exact: true }).fill(value);
  await fields.getByRole('button', { name: 'Suggest field correction', exact: true }).click();
  await expect(fields.locator('article').filter({ hasText: `Proposed: ${value}` })).toBeVisible();
  await expect(fields.getByLabel('Proposed form answer', { exact: true })).toHaveValue('');
}
async function saveDecision(dialog: Locator) {
  const decisions = dialog.getByRole('region', { name: 'Decide captured form corrections', exact: true });
  const preview = decisions.getByRole('region', { name: 'Reviewed form correction preview', exact: true });
  await preview.getByRole('checkbox', { name: /^I reviewed this decision/ }).check();
  await preview.getByRole('button', { name: 'Save reviewed form decision', exact: true }).click();
  await expect(preview).toHaveCount(0);
}
async function savedPackage(page: Page, id: string): Promise<ActionPackage> {
  return page.evaluate(key => new Promise<ActionPackage>((resolve, reject) => {
    const opened = indexedDB.open('dondocs'); opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const database = opened.result, request = database.transaction('app', 'readonly').objectStore('app').get(`action-package:${key}`);
      request.onsuccess = () => { database.close(); resolve(request.result.value); };
      request.onerror = () => { database.close(); reject(request.error); };
    };
  }), id);
}
function answers(record: ActionPackage) {
  const member = record.revisions.find(revision => revision.id === record.currentRevisionId)!.members.find(member => member.label === worksheetLabel);
  if (member?.kind !== 'native' || !member.session.genericForm) throw new Error('The saved worksheet is unavailable.');
  return member.session.genericForm.answers;
}
async function downloaded(download: Download) {
  expect(await download.failure()).toBeNull(); const path = await download.path(); if (!path) throw new Error('The reviewed file was not downloaded.');
  return readFile(path);
}
async function reviewFile(page: Page, dialog: Locator, mode: 'copy' | 'return') {
  await dialog.getByRole('button', { name: mode === 'copy' ? 'Prepare package reviewer copy' : 'Prepare package feedback return', exact: true }).click();
  const transfer = dialog.getByRole('region', { name: 'Portable package reviews', exact: true });
  await transfer.getByRole('checkbox', { name: /^I reviewed all captured members/ }).check();
  const download = page.waitForEvent('download');
  await transfer.getByRole('button', { name: mode === 'copy' ? 'Download package reviewer copy' : 'Download package feedback return', exact: true }).click();
  return downloaded(await download);
}
async function importReviewer(page: Page, bytes: Buffer) {
  const dialog = await packages(page);
  await dialog.getByLabel('Import package reviewer copy', { exact: true }).setInputFiles({ name: 'reviewer-copy.json', mimeType: 'application/json', buffer: bytes });
  const transfer = dialog.getByRole('region', { name: 'Portable package reviews', exact: true });
  await transfer.getByRole('checkbox', { name: /^I reviewed all captured members/ }).check();
  await transfer.getByRole('button', { name: 'Import reviewed package reviewer copy', exact: true }).click();
  await expect(dialog.getByText('Reviewing exact saved package revision', { exact: true })).toBeVisible();
  return dialog;
}
const initialize = () => { localStorage.setItem('browser-test-visitor', 'returning'); };

for (const width of [1440, 320]) {
  test(`typed form correction accepts, rejects and undoes through saved controls at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 900 }); await context.addInitScript(initialize);
    const dialog = await requestPackage(page, 'Typed field decisions'), id = await dialog.getByLabel('Saved packages', { exact: true }).inputValue();
    await dialog.getByRole('button', { name: 'Start package review', exact: true }).click(); await openWorksheet(dialog);
    const fields = dialog.getByRole('region', { name: 'Captured form field feedback', exact: true });
    await fields.getByLabel('Reviewed form field', { exact: true }).selectOption({ label: 'Request date' });
    await fields.getByLabel('Form comment reviewer name', { exact: true }).fill('Blair Sample');
    await fields.getByLabel('Proposed form answer', { exact: true }).fill('2026-02-30');
    await fields.getByRole('button', { name: 'Suggest field correction', exact: true }).click();
    await expect(fields.getByRole('alert')).toContainText('Enter a real date');
    await fields.getByRole('button', { name: 'Cancel field correction', exact: true }).click();
    await proposeField(dialog, 'Requester', 'Blair Sample');
    let decisions = dialog.getByRole('region', { name: 'Decide captured form corrections', exact: true });
    await decisions.getByRole('button', { name: 'Review acceptance for Requester', exact: true }).click(); await saveDecision(dialog);
    await expect.poll(async () => answers(await savedPackage(page, id)).requester).toBe('Blair Sample');
    await expect(decisions.getByText('Accepted in a saved package revision.', { exact: true })).toBeVisible();
    await decisions.getByRole('button', { name: 'Review Undo for Requester', exact: true }).click(); await saveDecision(dialog);
    await expect.poll(async () => answers(await savedPackage(page, id)).requester).toBe('Alex Example');
    await proposeField(dialog, 'Organization', 'Another Fictional Unit');
    decisions = dialog.getByRole('region', { name: 'Decide captured form corrections', exact: true });
    await decisions.getByRole('button', { name: 'Review rejection for Organization', exact: true }).click(); await saveDecision(dialog);
    await expect.poll(async () => answers(await savedPackage(page, id)).organization).toBe('Fictional Training Unit');
    await expect(decisions.getByText('Rejected in a saved package revision.', { exact: true })).toBeVisible();
    await page.reload(); const reopened = await packages(page);
    await reopened.getByRole('button', { name: 'Open review Package review 1', exact: true }).click(); await openWorksheet(reopened);
    await expect(reopened.getByText('Rejected in a saved package revision.', { exact: true })).toBeVisible();
    await info.attach('saved-form-decisions', { body: JSON.stringify(await savedPackage(page, id), null, 2), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath(`typed-form-decisions-${width}px.png`) });
  });

  test(`returned form proposals reconcile newer answers in a fresh reviewer browser at ${width}px`, async ({ page, context, browser }, info) => {
    await page.setViewportSize({ width, height: 900 }); await context.addInitScript(initialize);
    const dialog = await requestPackage(page, 'Returned field reconciliation'), id = await dialog.getByLabel('Saved packages', { exact: true }).inputValue();
    await dialog.getByRole('button', { name: 'Start package review', exact: true }).click();
    const copy = await reviewFile(page, dialog, 'copy');
    const independent = await browser.newContext({ ...projectBrowserContextOptions(info), viewport: { width, height: 900 }, serviceWorkers: 'block' });
    try {
      await independent.addInitScript(initialize); const reviewer = await independent.newPage(); await reviewer.goto(new URL('/', page.url()).href);
      expect(await reviewer.evaluate(() => navigator.userAgent)).toBe(await page.evaluate(() => navigator.userAgent));
      expect(await reviewer.evaluate(() => navigator.maxTouchPoints)).toBe(await page.evaluate(() => navigator.maxTouchPoints));
      const reviewDialog = await importReviewer(reviewer, copy); await openWorksheet(reviewDialog);
      await proposeField(reviewDialog, 'Requester', 'Returned Reviewer Name');
      await proposeField(reviewDialog, 'SSIC', '1600');
      const returned = await reviewFile(reviewer, reviewDialog, 'return');
      await openWorksheet(dialog); await proposeField(dialog, 'Requester', 'Newer Owner Name', 'Alex Example');
      let decisions = dialog.getByRole('region', { name: 'Decide captured form corrections', exact: true });
      await decisions.getByRole('button', { name: 'Review acceptance for Requester', exact: true }).click(); await saveDecision(dialog);
      await proposeField(dialog, 'Organization', 'Preserved Newer Organization', 'Alex Example');
      decisions = dialog.getByRole('region', { name: 'Decide captured form corrections', exact: true });
      await decisions.getByRole('button', { name: 'Review acceptance for Organization', exact: true }).click(); await saveDecision(dialog);
      const collect = decisions.locator('details').filter({ has: page.locator('summary', { hasText: /^Collect returned form feedback$/ }) });
      await collect.locator('summary').click();
      await collect.getByLabel('Collect form feedback return', { exact: true }).setInputFiles({ name: 'returned-feedback.json', mimeType: 'application/json', buffer: returned });
      await collect.getByRole('checkbox', { name: /^I reviewed the returned field feedback/ }).check();
      await collect.getByRole('button', { name: 'Save bound form feedback', exact: true }).click();
      await expect.poll(async () => answers(await savedPackage(page, id))).toMatchObject({ requester: 'Newer Owner Name', organization: 'Preserved Newer Organization' });
      const independentField = decisions.locator('article').filter({ hasText: 'Proposed: 1600' });
      await expect(independentField).toContainText('This exact answer is unchanged');
      await independentField.getByRole('button', { name: 'Review acceptance for SSIC', exact: true }).click(); await saveDecision(dialog);
      await expect.poll(async () => answers(await savedPackage(page, id))).toMatchObject({ ssic: '1600', requester: 'Newer Owner Name', organization: 'Preserved Newer Organization' });
      const remote = decisions.locator('article').filter({ hasText: 'Proposed: Returned Reviewer Name' });
      const accept = remote.getByRole('button', { name: 'Review acceptance for Requester', exact: true });
      await expect(accept).toBeDisabled();
      await expect(remote).toContainText('Latest saved: Newer Owner Name');
      await remote.getByRole('checkbox', { name: 'Replace this exact latest saved answer with the proposed answer.', exact: true }).check();
      await accept.click(); await saveDecision(dialog);
      await expect.poll(async () => answers(await savedPackage(page, id))).toMatchObject({ requester: 'Returned Reviewer Name', organization: 'Preserved Newer Organization' });
      await page.screenshot({ path: info.outputPath(`returned-form-reconciliation-${width}px.png`) });
    } finally { await independent.close(); }
  });
}
