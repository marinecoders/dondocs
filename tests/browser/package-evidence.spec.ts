import { expect, test, type Page, type Locator } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
async function packages(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true }).or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole('dialog', { name: 'Action packages', exact: true });
}
async function section(dialog: Locator, title: string) { const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${title}`) }).first(); const details = summary.locator('..'); if (!await details.getAttribute('open').then(value => value !== null)) await summary.click(); return details; }
async function download(page: Page, action: () => Promise<void>) { const pending = page.waitForEvent('download'); await action(); const value = await pending; expect(await value.failure()).toBeNull(); return readFile((await value.path())!); }
function asset(bytes: Uint8Array, id: string, name: string) { return { id, name, type: 'application/pdf', size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }; }
async function fixture(png: Buffer, format: 'image' | 'pdf') {
  const primary = await PDFDocument.create(), main = primary.addPage([612, 792]);
  if (format === 'pdf') { const image = await primary.embedPng(png); main.drawImage(image, { x: 0, y: 100, width: 612, height: 612 }); } else main.drawText('PUBLIC PRIMARY PACKAGE LETTER', { x: 50, y: 720 });
  const excluded = await PDFDocument.create(); excluded.addPage([612, 792]).drawText('PRIVATE_SCOPE_SENTINEL', { x: 50, y: 720 });
  const first = await primary.save(), second = await excluded.save(), files = [asset(first, 'asset_primary', format === 'pdf' ? 'Paper evidence.pdf' : 'Primary letter.pdf'), asset(second, 'asset_excluded', 'Excluded supporting.pdf')];
  return Buffer.from(JSON.stringify({ kind: 'dondocs-action-package', version: 1, package: { kind: 'dondocs-action-package-record', version: 1, id: 'package_evidence_browser', historyScope: 'selected-revision', name: 'Captured evidence exercise', archived: false, sequence: 0, currentRevisionId: 'revision_source', revisions: [{ id: 'revision_source', createdAt: 100, outputs: [], members: files.map((file, index) => ({ kind: 'original', id: `member_${index}`, revisionId: `member_revision_${index}`, label: file.name, role: index ? 'supporting-document' : 'basic-letter', required: true, original: file, signedOriginal: false })) }] }, portableResources: { kind: 'dondocs-resources', version: 1, entries: files.map((file, index) => ({ path: `assets/${file.id}`, name: file.name, mediaType: file.type, size: file.size, sha256: file.sha256, data: Buffer.from(index ? second : first).toString('base64') })) } }));
}
const cases = [ ...['light', 'dark', 'classic'].flatMap(theme => [1440, 320].map(width => ({ theme, width, format: 'image' as const }))), ...[1440, 320].map(width => ({ theme: 'light', width, format: 'pdf' as const })) ];
for (const { theme, width, format } of cases) test(`captured ${format} evidence OCR correction search and scoped recovery in ${theme} at ${width}px`, async ({ page, context, browser, baseURL }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await context.addInitScript(value => { localStorage.setItem('browser-test-visitor', 'returning'); localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } })); }, theme);
  await page.goto('/');
  const png = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 1500; canvas.height = 1500; const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1500, 1500); ctx.fillStyle = 'black'; ctx.font = 'bold 42px Arial'; ctx.fillText('TRAINING EVIDENCE EXERCISE', 85, 220); ctx.font = '36px Arial'; ctx.fillText('Synthetic paper source for package review.', 85, 320); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
  let dialog = await packages(page);
  await dialog.getByLabel('Import editable package', { exact: true }).setInputFiles({ name: 'evidence.dondocs-package.json', mimeType: 'application/json', buffer: await fixture(png, format) });
  await expect(dialog.getByLabel('Package name', { exact: true })).toHaveValue('Captured evidence exercise');
  const sourceName = format === 'image' ? 'Paper evidence.png' : 'Paper evidence.pdf';
  if (format === 'image') {
    const evidence = await section(dialog, 'Supporting evidence files');
    await evidence.getByLabel('Choose supporting evidence', { exact: true }).setInputFiles({ name: sourceName, mimeType: 'image/png', buffer: png });
    await expect(evidence.getByRole('img', { name: `Original supporting evidence: ${sourceName}`, exact: true })).toBeVisible();
    const add = evidence.getByRole('button', { name: 'Add reviewed evidence file', exact: true }); await expect(add).toBeDisabled();
    await evidence.getByRole('checkbox', { name: /^I reviewed this original file/ }).check(); await add.click(); await expect(add).not.toBeVisible();
  }
  const external: string[] = [];
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.protocol.startsWith('http') && url.origin !== new URL(page.url()).origin) { external.push(url.href); return route.abort(); } return route.continue(); });
  let scans = await section(dialog, 'Scanned evidence');
  await scans.getByLabel('Captured scan source', { exact: true }).selectOption({ label: sourceName });
  await scans.getByRole('button', { name: 'Recognize captured source', exact: true }).click();
  const text = scans.getByLabel('Corrected source text', { exact: true }); await expect(text).toBeVisible({ timeout: 90_000 }); expect(await text.inputValue()).toContain('TRAINING EVIDENCE EXERCISE');
  if (format === 'image') await expect(scans.getByRole('img', { name: `Captured source: ${sourceName}`, exact: true })).toBeVisible(); else await expect(scans.locator('canvas')).toBeVisible();
  await text.fill('User corrected package evidence excerpt.');
  await scans.getByRole('button', { name: 'Review corrected extraction', exact: true }).click();
  const save = scans.getByRole('button', { name: 'Save reviewed extraction', exact: true }); await expect(save).toBeDisabled();
  await scans.getByRole('checkbox', { name: /^I reviewed the exact source, all corrected pages/ }).check(); await save.click(); await expect(save).not.toBeVisible();
  await page.reload(); dialog = await packages(page); scans = await section(dialog, 'Scanned evidence');
  await scans.getByLabel('Saved extraction', { exact: true }).selectOption({ index: 1 }); await scans.getByRole('button', { name: 'Open saved extraction', exact: true }).click();
  await expect(scans.getByLabel('Corrected source text', { exact: true })).toHaveValue('User corrected package evidence excerpt.');
  await scans.getByText('Adopt a corrected excerpt as a package value', { exact: true }).click();
  await scans.getByLabel('Recognized package value label', { exact: true }).fill('Confirmed evidence note'); await scans.getByLabel('Recognized package value excerpt', { exact: true }).fill('package evidence excerpt');
  await scans.getByRole('button', { name: 'Review recognized package value', exact: true }).click();
  await scans.getByRole('checkbox', { name: /^I reviewed this excerpt/ }).check(); await scans.getByRole('button', { name: 'Adopt reviewed package value', exact: true }).click();
  const search = await section(dialog, 'Search captured package'); await search.getByLabel('Search captured package text', { exact: true }).fill('User corrected'); await search.getByRole('button', { name: 'Search captured text', exact: true }).click(); await expect(search.getByText(/Saved corrected source page 1/).first()).toBeVisible();
  const delivery = await section(dialog, 'Recipient delivery'); await delivery.getByLabel('Delivery name', { exact: true }).fill('Scoped evidence copy');
  await delivery.getByRole('checkbox', { name: 'Include Excluded supporting.pdf', exact: true }).uncheck(); if (format === 'image') await delivery.getByRole('checkbox', { name: 'Include Primary letter.pdf', exact: true }).uncheck();
  await delivery.getByRole('button', { name: 'Prepare selected delivery', exact: true }).click();
  await expect(delivery.getByRole('region', { name: 'Captured delivery contents', exact: true })).toBeVisible();
  await delivery.getByRole('button', { name: `Preview ${sourceName}`, exact: true }).click();
  if (format === 'image') { await expect(delivery.getByRole('img', { name: `Captured delivery source: ${sourceName}`, exact: true })).toBeVisible(); await delivery.getByLabel('Captured image zoom', { exact: true }).selectOption('4'); await delivery.getByLabel('Captured image zoom', { exact: true }).selectOption('1'); } else await expect(delivery.locator('canvas').first()).toBeVisible();
  await search.getByLabel('Captured package search scope', { exact: true }).selectOption('delivery'); await search.getByLabel('Search captured package text', { exact: true }).fill('PRIVATE_SCOPE_SENTINEL'); await search.getByRole('button', { name: 'Search captured text', exact: true }).click(); await expect(search.getByText('0 captured matches', { exact: true })).toBeVisible();
  await delivery.getByRole('checkbox', { name: /^I reviewed every included document/ }).check();
  const bundle = await download(page, () => delivery.getByRole('button', { name: 'Download reviewed delivery bundle', exact: true }).click());
  const zip = await JSZip.loadAsync(bundle), manifest = JSON.parse(await zip.file('manifest.json')!.async('string')), payload = JSON.parse(await zip.file('package.dondocs-package.json')!.async('string'));
  expect(manifest.members).toHaveLength(1); expect(JSON.stringify(payload)).not.toContain('PRIVATE_SCOPE_SENTINEL'); expect(JSON.stringify(payload)).not.toContain('scans'); expect(JSON.stringify(payload)).not.toContain('User corrected');
  if (format === 'image') { const included = manifest.files.find((file: { name: string }) => file.name === sourceName); expect(await zip.file(included.path)!.async('nodebuffer')).toEqual(png); }
  const geometry = await dialog.evaluate(root => ({ width: root.clientWidth, scroll: root.scrollWidth })); expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1); expect(external).toEqual([]);
  await delivery.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`evidence-${format}-${theme}-${width}px.png`) });
  const fresh = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, viewport: { width, height: 950 } });
  try { const recovered = await fresh.newPage(); await fresh.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning')); await recovered.goto(baseURL!); const target = await packages(recovered); await target.getByLabel('Import editable package', { exact: true }).setInputFiles({ name: 'scoped-evidence.zip', mimeType: 'application/zip', buffer: bundle }); await expect(target.getByLabel('Package name', { exact: true })).toHaveValue('Scoped evidence copy'); await expect(target.getByText('Excluded supporting.pdf', { exact: true })).toHaveCount(0); } finally { await fresh.close(); }
});
