import { openAddDocuments, openPackagePreparation, packageSection, expandPackageTools, selectedPackageId, packageTool, prepareReviewTransfer, openPackageWorkspace, choosePackage, choosePackageById } from './_helpers/packageWorkspace';
import { expect, test, type Page, type Locator, type Download } from '@playwright/test';
import { projectBrowserContextOptions } from '../_helpers/projectBrowserContext';
import { readFile } from 'node:fs/promises';
import { PDFDocument, degrees } from 'pdf-lib';
import type { ActionPackage } from '../../src/lib/actionPackages';
test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(120_000);
async function packages(page: Page) {
  return openPackagePreparation(page);
}
for (const theme of ['light', 'dark', 'classic']) for (const width of [1440, 320]) test(`exact form comments persist and travel with review in ${theme} at ${width}px`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await context.addInitScript(value => { localStorage.setItem('browser-test-visitor', 'returning'); localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } })); }, theme);
  await page.goto('/'); let dialog = await packages(page);
  await expandPackageTools(dialog);
  const starter = await packageTool(dialog, 'Administrative request starter');
  await starter.getByRole('button', { name: 'Start an administrative request', exact: true }).click();
  for (const [label, value] of Object.entries({ Requester: 'Alex Example', Organization: 'Fictional Training Unit', Recipient: 'Training Officer', 'Request subject': 'Form review exercise', 'Request date': '2026-11-17', SSIC: '1500', 'Printed signature name': 'A. EXAMPLE', 'Requested action and justification': 'Request fictional training to verify exact package form review.' })) await starter.getByLabel(label, { exact: label !== 'Printed signature name' }).fill(value);
  await starter.getByRole('button', { name: 'Review request starter', exact: true }).click();
  await starter.getByRole('checkbox', { name: /^I reviewed these request details/ }).check();
  await starter.getByRole('button', { name: 'Create reviewed request package', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Request: Form review exercise', exact: true, level: 1 })).toBeVisible();
  await packageSection(dialog, 'Review', true);
  await dialog.getByRole('button', { name: 'New review copy', exact: true }).click();
  await dialog.getByRole('navigation', { name: 'Captured review members', exact: true }).getByRole('button', { name: 'DonDocs request details worksheet', exact: true }).click();
  let review = await packageTool(dialog, 'Captured form field feedback');
  const fields = review.getByLabel('Reviewed form field', { exact: true });
  await expect(fields.locator('option')).not.toHaveCount(1);
  await fields.selectOption({ index: 1 });
  const targetLabel = await fields.locator('option:checked').textContent(); expect(targetLabel).toBeTruthy();
  await review.getByLabel('Form comment reviewer name', { exact: true }).fill('Blair Sample');
  await review.getByLabel('Form field comment', { exact: true }).fill('Please confirm this exact captured answer.');
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue editing', exact: true })).toBeVisible();
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
  await prepareReviewTransfer(dialog, 'copy');
  if (await dialog.getByRole('checkbox', { name: /^I reviewed all captured members, original PDF pages/ }).isVisible()) await dialog.getByRole('checkbox', { name: /^I reviewed all captured members, original PDF pages/ }).check();
  const downloading = page.waitForEvent('download', { timeout: 90_000 });
  await dialog.getByRole('button', { name: 'Download review copy', exact: true }).click();
  const downloaded = await downloading; expect(await downloaded.failure()).toBeNull();
  const returned = JSON.parse((await readFile((await downloaded.path())!)).toString());
  expect(JSON.stringify(returned)).toContain('Please confirm this exact captured answer.'); expect(JSON.stringify(returned)).toContain('fieldReview');
  await page.reload(); dialog = await openPackageWorkspace(page);
  await choosePackage(dialog, 'Request: Form review exercise');
  await packageSection(dialog, 'Review', true);
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
  await expandPackageTools(dialog);
  const starter = await packageTool(dialog, 'Administrative request starter');
  await starter.getByRole('button', { name: 'Start an administrative request', exact: true }).click();
  for (const [label, value] of Object.entries({ Requester: 'Alex Example', Organization: 'Fictional Training Unit', Recipient: 'Training Officer', 'Request subject': subject,
    'Request date': '2026-11-17', SSIC: '1500', 'Printed signature name': 'A. EXAMPLE', 'Requested action and justification': 'Fictional training request for browser qualification.' }))
    await starter.getByLabel(label, { exact: label !== 'Printed signature name' }).fill(value);
  await starter.getByRole('button', { name: 'Review request starter', exact: true }).click();
  await starter.getByRole('checkbox', { name: /^I reviewed these request details/ }).check();
  await starter.getByRole('button', { name: 'Create reviewed request package', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: `Request: ${subject}`, exact: true, level: 1 })).toBeVisible();
  return dialog;
}
async function openWorksheet(dialog: Locator) {
  await dialog.getByRole('navigation', { name: 'Captured review members', exact: true }).getByRole('button', { name: worksheetLabel, exact: true }).click();
  return dialog.getByRole('region', { name: 'Captured form field feedback', exact: true });
}
async function proposeField(dialog: Locator, label: string, value: string, author = 'Blair Sample') {
  const fields = await packageTool(dialog, 'Captured form field feedback');
  await fields.getByLabel('Reviewed form field', { exact: true }).selectOption({ label });
  await fields.getByLabel('Form comment reviewer name', { exact: true }).fill(author);
  await fields.getByLabel('Proposed form answer', { exact: true }).fill(value);
  await fields.getByRole('button', { name: 'Suggest field correction', exact: true }).click();
  await expect(fields.locator('article').filter({ hasText: `Proposed: ${value}` })).toBeVisible();
  await expect(fields.getByLabel('Proposed form answer', { exact: true })).toHaveValue('');
}
async function saveDecision(dialog: Locator) {
  const decisions = await packageTool(dialog, 'Decide captured form corrections');
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
  const transfer = await prepareReviewTransfer(dialog, mode);
  if (await transfer.getByRole('checkbox', { name: /^I reviewed all captured members/ }).isVisible()) await transfer.getByRole('checkbox', { name: /^I reviewed all captured members/ }).check();
  const download = page.waitForEvent('download', { timeout: 90_000 });
  await transfer.getByRole('button', { name: mode === 'copy' ? 'Download review copy' : 'Download feedback', exact: true }).click();
  return downloaded(await download);
}
async function importReviewer(page: Page, bytes: Buffer) {
  const dialog = await packages(page);
  await dialog.getByLabel('Import package reviewer copy', { exact: true }).setInputFiles({ name: 'reviewer-copy.json', mimeType: 'application/json', buffer: bytes });
  const transfer = await packageTool(dialog, 'Portable package reviews');
  if (await transfer.getByRole('checkbox', { name: /^I reviewed all captured members/ }).isVisible()) await transfer.getByRole('checkbox', { name: /^I reviewed all captured members/ }).check();
  await transfer.getByRole('button', { name: 'Import review copy', exact: true }).click();
  await expect(dialog.getByText('Reviewing exact saved package revision', { exact: true })).toBeVisible();
  return dialog;
}
const initialize = () => { localStorage.setItem('browser-test-visitor', 'returning'); };

for (const width of [1440, 320]) {
  test(`typed form correction accepts, rejects and undoes through saved controls at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 900 }); await context.addInitScript(initialize);
    const dialog = await requestPackage(page, 'Typed field decisions'), id = await selectedPackageId(dialog);
  await packageSection(dialog, 'Review', true);
    await dialog.getByRole('button', { name: 'New review copy', exact: true }).click(); await openWorksheet(dialog);
    const fields = await packageTool(dialog, 'Captured form field feedback');
    await fields.getByLabel('Reviewed form field', { exact: true }).selectOption({ label: 'Request date' });
    await fields.getByLabel('Form comment reviewer name', { exact: true }).fill('Blair Sample');
    await fields.getByLabel('Proposed form answer', { exact: true }).fill('2026-02-30');
    await fields.getByRole('button', { name: 'Suggest field correction', exact: true }).click();
    await expect(fields.getByRole('alert')).toContainText('Enter a real date');
    await fields.getByRole('button', { name: 'Cancel field correction', exact: true }).click();
    await proposeField(dialog, 'Requester', 'Blair Sample');
    let decisions = await packageTool(dialog, 'Decide captured form corrections');
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
    await page.reload(); const reopened = await openPackageWorkspace(page);
    await choosePackageById(reopened, id);
    await packageSection(reopened, 'Review', true);
    await reopened.getByRole('button', { name: 'Open review Package review 1', exact: true }).click(); await openWorksheet(reopened);
    await expect(reopened.getByText('Rejected in a saved package revision.', { exact: true })).toBeVisible();
    await info.attach('saved-form-decisions', { body: JSON.stringify(await savedPackage(page, id), null, 2), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath(`typed-form-decisions-${width}px.png`) });
  });

  test(`returned form proposals reconcile newer answers in a fresh reviewer browser at ${width}px`, async ({ page, context, browser }, info) => {
    await page.setViewportSize({ width, height: 900 }); await context.addInitScript(initialize);
    const dialog = await requestPackage(page, 'Returned field reconciliation'), id = await selectedPackageId(dialog);
  await packageSection(dialog, 'Review', true);
    await dialog.getByRole('button', { name: 'New review copy', exact: true }).click();
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
      let decisions = await packageTool(dialog, 'Decide captured form corrections');
      await decisions.getByRole('button', { name: 'Review acceptance for Requester', exact: true }).click(); await saveDecision(dialog);
      await proposeField(dialog, 'Organization', 'Preserved Newer Organization', 'Alex Example');
      decisions = dialog.getByRole('region', { name: 'Decide captured form corrections', exact: true });
      await decisions.getByRole('button', { name: 'Review acceptance for Organization', exact: true }).click(); await saveDecision(dialog);
      const collect = decisions.locator('details').filter({ has: page.locator('summary', { hasText: /^Collect returned form feedback$/ }) });
      if (await collect.getAttribute('open') === null) await collect.locator('summary').first().click();
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

  test(`original PDF regions render, accept pointer and keyboard comments and return exact bytes at ${width}px`, async ({ page, context, browser }, info) => {
    await page.setViewportSize({ width, height: 900 }); await context.addInitScript(initialize);
    const dialog = await requestPackage(page, 'Original region review');
    const pdf = await PDFDocument.create(); pdf.addPage([612, 792]).drawText('Synthetic original first page.', { x: 54, y: 700, size: 12 });
    const cropped = pdf.addPage([400, 600]); cropped.setCropBox(-20, 30, 500, 500); cropped.setRotation(degrees(90)); cropped.drawText('Synthetic cropped rotated page.', { x: 40, y: 300, size: 12 });
    const original = Buffer.from(await pdf.save()), filename = 'Synthetic region original.pdf';
  await packageSection(dialog, 'Documents', true);
    await openAddDocuments(dialog);
    await dialog.getByLabel('New member role', { exact: true }).selectOption('enclosure');
    await dialog.getByLabel('Uploaded original is signed (preserve unchanged)', { exact: true }).check();
  await packageSection(dialog, 'Documents', true);
    await dialog.getByLabel('Add original PDF', { exact: true }).setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: original });
    await expect(dialog.getByRole('navigation', { name: 'Package documents', exact: true }).locator('option').filter({ hasText: filename })).toHaveCount(1);
  await packageSection(dialog, 'Review', true);
    await dialog.getByRole('button', { name: 'New review copy', exact: true }).click();
    const copy = await reviewFile(page, dialog, 'copy'), independent = await browser.newContext({ ...projectBrowserContextOptions(info), viewport: { width, height: 900 }, serviceWorkers: 'block' });
    try {
      await independent.addInitScript(initialize); const reviewer = await independent.newPage(); await reviewer.goto(new URL('/', page.url()).href);
      expect(await reviewer.evaluate(() => navigator.userAgent)).toBe(await page.evaluate(() => navigator.userAgent));
      expect(await reviewer.evaluate(() => navigator.maxTouchPoints)).toBe(await page.evaluate(() => navigator.maxTouchPoints));
      const reviewDialog = await importReviewer(reviewer, copy);
      await reviewDialog.getByRole('navigation', { name: 'Captured review members', exact: true }).getByRole('button', { name: filename, exact: true }).click();
      const regions = await packageTool(reviewDialog, 'Original PDF region review');
      await regions.getByLabel('Original PDF page for comment', { exact: true }).selectOption('2');
      const surface = regions.getByRole('button', { name: 'Draw a region on captured PDF page', exact: true }); await expect(surface).toBeEnabled();
      await surface.scrollIntoViewIfNeeded(); const bounds = await surface.boundingBox(); if (!bounds) throw new Error('The rendered original page has no geometry.');
      expect(bounds.width / bounds.height).toBeCloseTo(500 / 400, 1);
      await reviewer.mouse.move(bounds.x + bounds.width * 0.15, bounds.y + bounds.height * 0.2); await reviewer.mouse.down();
      await reviewer.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.45, { steps: 5 }); await reviewer.mouse.up();
      await regions.getByLabel('PDF region reviewer name', { exact: true }).fill('Blair Sample');
      await regions.getByLabel('PDF region comment', { exact: true }).fill('Pointer-selected exact rotated region.');
      await regions.getByRole('button', { name: 'Post PDF region comment', exact: true }).click();
      await expect(regions.getByText('Original page 2 · Open', { exact: true })).toBeVisible();
      await regions.getByRole('button', { name: 'Reply to PDF region', exact: true }).click();
      await regions.getByLabel('PDF region comment', { exact: true }).fill('Reply on the same captured page.');
      await regions.getByRole('button', { name: 'Post PDF region reply', exact: true }).click();
      await expect(regions.getByLabel('PDF region comment', { exact: true })).toHaveValue('');
      await regions.getByLabel('Original PDF page for comment', { exact: true }).selectOption('1');
      for (const [key, value] of Object.entries({ left: '12.5', top: '15', width: '20', height: '10' })) await regions.getByLabel(`PDF region ${key} percent`, { exact: true }).fill(value);
      await regions.getByLabel('PDF region comment', { exact: true }).fill('Keyboard-selected exact first-page region.');
      await regions.getByRole('button', { name: 'Post PDF region comment', exact: true }).click();
      await expect(regions.getByText('Original page 1 · Open', { exact: true })).toBeVisible();
      const returned = await reviewFile(reviewer, reviewDialog, 'return'), payload = JSON.parse(returned.toString());
      const round = payload.package.reviewRounds[0], member = round.baseline.members.find((member: { label: string }) => member.label === filename);
      const comments = round.memberReviews.find((child: { binding: { memberId: string } }) => child.binding.memberId === member.id).pdfReview.comments;
      expect(comments).toHaveLength(2); expect(comments[0].messages).toHaveLength(2);
      expect(comments[0].anchor.geometry).toEqual({ x: 0, y: 30, width: 400, height: 500, rotation: 90 });
      // Browser pointer coordinates can round to whole CSS pixels. Compare in
      // rendered pixels, allowing the stored region's 0.001 quantization too.
      const drawn = comments[0].anchor.region;
      expect(Math.abs(drawn.left - 0.15)).toBeLessThanOrEqual(1 / bounds.width + 0.001);
      expect(Math.abs(drawn.top - 0.2)).toBeLessThanOrEqual(1 / bounds.height + 0.001);
      expect(Math.abs(drawn.width - 0.4)).toBeLessThanOrEqual(2 / bounds.width + 0.001);
      expect(Math.abs(drawn.height - 0.25)).toBeLessThanOrEqual(2 / bounds.height + 0.001);
      expect(comments[1].anchor.region).toEqual({ left: 0.125, top: 0.15, width: 0.2, height: 0.1 });
      const retained = payload.portableResources.entries.find((entry: { path: string }) => entry.path === `assets/${member.original.id}`);
      expect(Buffer.from(retained.data, 'base64')).toEqual(original);
      await info.attach('original-region-feedback-return', { body: returned, contentType: 'application/json' });
      await reviewer.screenshot({ path: info.outputPath(`original-region-review-${width}px.png`) });
    } finally { await independent.close(); }
  });
}
