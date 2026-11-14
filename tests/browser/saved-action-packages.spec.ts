import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function appearance(context: BrowserContext, theme: string) { await context.addInitScript(value => { localStorage.setItem('browser-test-visitor', 'returning');localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } })); }, theme); }
async function packages(page: Page) { await page.getByRole('button', { name: 'Packages', exact: true }).click();return page.getByRole('dialog', { name: 'Action packages', exact: true }); }
async function importDraft(page: Page, value: unknown) { await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'training-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });await page.getByRole('button', { name: 'Open as new document', exact: true }).click(); }
async function actions(page: Page, name: string | RegExp) { await page.getByRole('button', { name: 'Document actions', exact: true }).click();await page.getByRole('menuitem', { name, exact: typeof name === 'string' }).click(); }
async function workspace(page: Page, name: string) { const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true }).or(page.getByRole('button', { name, exact: true })).first().click();if (await drawer.isVisible()) await drawer.getByRole('button', { name, exact: true }).click(); }
async function approve(page: Page, button: string) { const modal = page.getByRole('dialog', { name: 'Action packages', exact: true });await modal.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();await modal.getByRole('button', { name: button, exact: true }).click(); }
async function download(page: Page, prepare: string, deliver: string) { const modal = page.getByRole('dialog', { name: 'Action packages', exact: true });await modal.getByRole('button', { name: prepare, exact: true }).click();await expect(modal.getByRole('heading', { name: /^Package readiness:/ })).toBeVisible();const pending = page.waitForEvent('download');await approve(page, deliver);return readFile((await (await pending).path())!); }
async function text(bytes: Uint8Array) { const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;try { const pages: string[] = [];for (let index = 1; index <= pdf.numPages; index++) pages.push((await (await pdf.getPage(index)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '));return pages; } finally { await pdf.destroy(); } }
async function originalPdf() { const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);page.drawText('SYNTHETIC ORIGINAL - RETAIN EXACT BYTES', { x: 50, y: 730, font: await pdf.embedFont(StandardFonts.Helvetica), size: 14 });return Buffer.from(await pdf.save()); }

for (const theme of ['light', 'dark', 'classic']) {
  test(`saved package owns revisions, source adoption, signed originals and exact offline output in ${theme}`, async ({ page, context, browser, baseURL }, info) => {
    await appearance(context, theme);await page.goto('/');
    const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter', formData: { subject: `TRAINING SOURCE ${theme}`, unitLine1: 'FICTIONAL TRAINING UNIT', from: 'Training Office', to: 'Training Officer', date: '14 Nov 26', ssic: '1000', serial: '001', classLevel: 'unclassified', sigFirst: 'Alex', sigLast: 'Example' }, paragraphs: [{ id: 'package-body', text: 'Fictional package content. See enclosure (1).', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
    await importDraft(page, source);let modal = await packages(page);
    await modal.getByLabel('Package name', { exact: true }).fill(`Training action ${theme}`);await modal.getByRole('button', { name: 'Create package', exact: true }).click();
    await modal.getByRole('button', { name: 'Capture current document', exact: true }).click();
    await expect(modal.getByRole('heading', { name: `1. TRAINING SOURCE ${theme}`, exact: true })).toBeVisible();
    const original = await originalPdf();await modal.getByLabel('New member role', { exact: true }).selectOption('enclosure');await modal.getByRole('checkbox', { name: 'Uploaded original is signed (preserve unchanged)', exact: true }).check();
    await modal.getByLabel('Add original PDF', { exact: true }).setInputFiles({ name: 'signed-original.pdf', mimeType: 'application/pdf', buffer: original });
    await expect(modal.getByText('Signed original PDF', { exact: false })).toBeVisible();
    await modal.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();await expect(modal.getByRole('heading', { name: 'Package readiness: ready', exact: true })).toBeVisible();
    await approve(page, 'Assemble and retain PDF');await expect(modal.getByRole('status')).toContainText('Assembled PDF retained.', { timeout: 60_000 });
    const retained = await download(page, 'Download retained PDF', 'Download reviewed retained PDF'), rendered = await text(retained);
    expect(rendered).toHaveLength(2);expect(rendered[0]).toContain('Fictional package content');expect(rendered[1]).toContain('SYNTHETIC ORIGINAL');expect(rendered[1]).toContain('Enclosure (1)');
    const portable = await download(page, 'Export editable package', 'Download reviewed editable package'), packet = JSON.parse(portable.toString('utf8'));
    expect(packet.package.revisions).toHaveLength(1);const selected = packet.package.revisions[0], output = selected.outputs[0];expect(output.asset.sha256).toBe(sha(retained));
    expect(output.boundaries.map((boundary: { startPage: number; pageCount: number }) => [boundary.startPage, boundary.pageCount])).toEqual([[1, 1], [2, 1]]);
    const originalEntry = packet.portableResources.entries.find((entry: { path: string }) => entry.path === `assets/${selected.members[1].original.id}`);expect(Buffer.from(originalEntry.data, 'base64')).toEqual(original);
    await writeFile(info.outputPath(`retained-${theme}.pdf`), retained);await info.attach('retained-pdf', { body: retained, contentType: 'application/pdf' });
    // Native editing creates an ordinary, separately named working copy.
    await modal.getByRole('button', { name: 'Edit working copy', exact: true }).click();await expect(modal).toBeHidden();
    await page.getByLabel('Document section', { exact: true }).selectOption('addressing');await page.getByRole('textbox', { name: 'Subject', exact: true }).fill(`WORKING COPY ${theme}`);
    modal = await packages(page);await modal.getByLabel('Saved packages', { exact: true }).selectOption(packet.package.id);await modal.getByRole('button', { name: 'Save working copy as new revision', exact: true }).click();await expect(modal.getByLabel('Package revision', { exact: true })).toContainText('Revision 4');
    await modal.getByRole('button', { name: 'Compare newer source', exact: true }).click();await expect(modal.getByText('WORKING COPY ' + theme, { exact: true })).toBeVisible();await modal.getByRole('button', { name: 'Cancel comparison', exact: true }).click();
    await page.keyboard.press('Escape');await workspace(page, `TRAINING SOURCE ${theme}`);
    await page.getByLabel('Document section', { exact: true }).selectOption('addressing');await page.getByRole('textbox', { name: 'Subject', exact: true }).fill(`NEWER SOURCE ${theme}`);await actions(page, /^Save checkpoint/);
    modal = await packages(page);await modal.getByLabel('Saved packages', { exact: true }).selectOption(packet.package.id);await modal.getByRole('button', { name: 'Compare newer source', exact: true }).click();await expect(modal.getByText(`NEWER SOURCE ${theme}`, { exact: true })).toBeVisible();await modal.getByRole('button', { name: 'Adopt source as new revision', exact: true }).click();
    await expect(modal.getByLabel('Package revision', { exact: true })).toContainText('Revision 5');await modal.getByLabel('Package revision', { exact: true }).selectOption(selected.id);
    expect(await download(page, 'Download retained PDF', 'Download reviewed retained PDF')).toEqual(retained);
    await page.keyboard.press('Escape');await workspace(page, `Actions for NEWER SOURCE ${theme}`);await page.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();await workspace(page, 'Trash');
    const trash = page.getByRole('dialog', { name: 'Trash', exact: true });await trash.getByRole('button', { name: 'Delete permanently', exact: true }).click();await page.getByRole('alertdialog', { name: 'Permanently delete this document?', exact: true }).getByRole('button', { name: 'Delete permanently', exact: true }).click();await trash.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();modal = await packages(page);await modal.getByLabel('Saved packages', { exact: true }).selectOption(packet.package.id);await expect(modal.getByText('Source: unavailable; preserved copy retained', { exact: false })).toBeVisible();await modal.getByLabel('Package revision', { exact: true }).selectOption(selected.id);
    expect(await download(page, 'Download retained PDF', 'Download reviewed retained PDF')).toEqual(retained);
    await page.screenshot({ path: info.outputPath(`package-${theme}.png`), scale: 'css' });
    const fresh = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent), isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch, serviceWorkers: 'block' });
    try {
      await appearance(fresh, theme);const restored = await fresh.newPage();await restored.goto(baseURL!);await expect(restored.getByRole('button', { name: 'Packages', exact: true })).toBeVisible();await fresh.setOffline(true);
      const freshModal = await packages(restored);await freshModal.getByLabel('Import editable package', { exact: true }).setInputFiles({ name: 'retained.dondocs-package.json', mimeType: 'application/json', buffer: portable });
      await expect(freshModal.getByRole('heading', { name: `1. TRAINING SOURCE ${theme}`, exact: true })).toBeVisible();expect(await download(restored, 'Download retained PDF', 'Download reviewed retained PDF')).toEqual(retained);
      const originalDownload = restored.waitForEvent('download');await freshModal.getByRole('button', { name: 'Download unchanged original', exact: true }).click();expect(await readFile((await (await originalDownload).path())!)).toEqual(original);
      await freshModal.getByRole('button', { name: 'Edit working copy', exact: true }).click();await expect(freshModal).toBeHidden();await restored.getByLabel('Document section', { exact: true }).selectOption('addressing');await expect(restored.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(`TRAINING SOURCE ${theme}`);
    } finally { await fresh.close(); }
  });
}

test('configured package survives fresh offline import, native editing, reload and exact pinned output', async ({ page, context, browser, baseURL }, info) => {
  await appearance(context, 'dark');const pdf = await PDFDocument.create(), blank = pdf.addPage([612, 792]);blank.drawText('EXACT PACKAGE FORM BLANK', { x: 40, y: 750, font: await pdf.embedFont(StandardFonts.Helvetica), size: 12 });const bytes = Buffer.from(await pdf.save()), hash = sha(bytes);
  const definition = { schemaVersion: 2, formId: 'package_fixture', label: 'Package fixture', definitionRevision: 'exact-v1', templateRevision: hash, directory: 'package-fixture', pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256: hash }], fields: { name: { kind: 'text', label: 'Fictional name', requiredAt: 'export' } }, placements: [{ fieldId: 'name', page: 1, appearance: 'text', overflow: 'error', box: { left: 40, top: 710, width: 400, height: 24 } }], sections: [{ id: 'identity', title: 'Identity', fields: ['name'] }], rowGroups: {} };
  await page.route('**/templates/**', route => route.request().url().endsWith('/package-fixture/page1.pdf') ? route.fulfill({ contentType: 'application/pdf', body: bytes }) : route.fulfill({ json: { templates: [] } }));
  await page.goto('/');await importDraft(page, { genericForm: { definition, answers: { name: 'Fictional retained form' }, rows: {}, answerRevision: 0 } });
  let modal = await packages(page);await modal.getByLabel('Package name', { exact: true }).fill('Configured package');await modal.getByRole('button', { name: 'Create package', exact: true }).click();await modal.getByRole('button', { name: 'Capture current document', exact: true }).click();
  await modal.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();await expect(modal.getByRole('heading', { name: 'Package readiness: ready', exact: true })).toBeVisible();await approve(page, 'Assemble and retain PDF');await expect(modal.getByRole('status')).toContainText('Assembled PDF retained.');
  const retained = await download(page, 'Download retained PDF', 'Download reviewed retained PDF');expect((await text(retained))[0]).toContain('EXACT PACKAGE FORM BLANK');expect((await text(retained))[0]).toContain('Fictional retained form');
  const portable = await download(page, 'Export editable package', 'Download reviewed editable package');await info.attach('configured-retained-pdf', { body: retained, contentType: 'application/pdf' });
  const fresh = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent), isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch, serviceWorkers: 'block' });
  try {
    await appearance(fresh, 'dark');await fresh.route('**/templates/**', route => route.abort());const restored = await fresh.newPage();await restored.goto(baseURL!);await fresh.setOffline(true);modal = await packages(restored);
    await modal.getByLabel('Import editable package', { exact: true }).setInputFiles({ name: 'configured-package.json', mimeType: 'application/json', buffer: portable });await expect(modal.getByRole('button', { name: 'Edit working copy', exact: true })).toBeVisible();
    expect(await download(restored, 'Download retained PDF', 'Download reviewed retained PDF')).toEqual(retained);await modal.getByRole('button', { name: 'Edit working copy', exact: true }).click();await expect(restored.getByRole('textbox', { name: 'Fictional name', exact: true })).toHaveValue('Fictional retained form');await restored.getByRole('textbox', { name: 'Fictional name', exact: true }).fill('Fictional working form');
    await actions(restored, /^Save checkpoint/);await fresh.setOffline(false);await restored.reload();await fresh.setOffline(true);await expect(restored.getByRole('textbox', { name: 'Fictional name', exact: true })).toHaveValue('Fictional working form');modal = await packages(restored);await modal.getByLabel('Saved packages', { exact: true }).selectOption(JSON.parse(portable.toString('utf8')).package.id);await modal.getByRole('button', { name: 'Save working copy as new revision', exact: true }).click();await modal.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();await expect(modal.getByRole('heading', { name: 'Package readiness: ready', exact: true })).toBeVisible();await approve(restored, 'Assemble and retain PDF');await expect(modal.getByRole('status')).toContainText('Assembled PDF retained.');
    const edited = await download(restored, 'Download retained PDF', 'Download reviewed retained PDF');expect((await text(edited))[0]).toContain('Fictional working form');await restored.screenshot({ path: info.outputPath('configured-package.png'), scale: 'css' });
  } finally { await fresh.close(); }
});
