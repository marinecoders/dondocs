import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(150_000);

async function appearance(context: BrowserContext, theme: string) {
  await context.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
}
async function workspace(page: Page, name: string) {
  const label = name.startsWith('Portable form ') ? new RegExp(`^${name}(?:\\s|$)`) : name;
  const exact = typeof label === 'string';
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (await drawer.isVisible()) { await drawer.getByRole('button', { name: label, exact }).click();return; }
  await page.getByRole('button', { name: 'Open workspace', exact: true }).or(page.getByRole('button', { name: label, exact })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: label, exact }).click();
}
async function actions(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: typeof name === 'string' }).click();
}
async function draft(page: Page) {
  const pending = page.waitForEvent('download');await actions(page, 'Export draft (.json)');
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
}
async function importDraft(page: Page, value: unknown) {
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'portable-form.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
}
async function pdf(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
  const file = await pending;expect(await file.failure()).toBeNull();
  const bytes = await readFile((await file.path())!);
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    expect(document.numPages).toBe(1);
    const content = await (await document.getPage(1)).getTextContent();
    const text = content.items.map(item => 'str' in item ? item.str : '').join(' ');
    expect(text).toContain('EXACT PORTABLE BLANK');expect(text).toContain('Fictional retained');
  } finally { await document.destroy(); }
  return bytes;
}
async function fixture(theme: string) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
  page.drawText('EXACT PORTABLE BLANK', { x: 40, y: 760, font: await pdf.embedFont(StandardFonts.Helvetica), size: 12 });
  const bytes = Buffer.from(await pdf.save()), sha256 = createHash('sha256').update(bytes).digest('hex');
  const definition = { schemaVersion: 2, formId: 'portable_fixture', label: `Portable form ${theme}`, definitionRevision: 'original-v1', templateRevision: sha256,
    directory: 'portable-fixture', pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256 }],
    fields: { name: { kind: 'text', label: 'Fictional name', requiredAt: 'export' } },
    placements: [{ fieldId: 'name', page: 1, appearance: 'text', overflow: 'error', box: { left: 40, top: 710, width: 400, height: 24 } }],
    sections: [{ id: 'identity', title: 'Identity', fields: ['name'] }], rowGroups: {} };
  return { bytes, definition, legacy: { genericForm: { definition, answers: { name: 'Fictional first' }, rows: {}, answerRevision: 0 } } };
}

for (const theme of ['light', 'dark', 'classic']) {
  test(`configured form draft and workspace backup restore exact pages offline in ${theme}`, async ({ page, context, browser, baseURL }, info) => {
    await appearance(context, theme);const source = await fixture(theme);
    await page.route('**/templates/**', route => route.request().url().endsWith('/portable-fixture/page1.pdf')
      ? route.fulfill({ status: 200, contentType: 'application/pdf', body: source.bytes }) : route.fulfill({ status: 200, json: { templates: [] } }));
    await page.goto('/');await importDraft(page, source.legacy);
    const name = page.getByRole('textbox', { name: 'Fictional name', exact: true });
    await expect(name).toHaveValue('Fictional first');await actions(page, /^Save checkpoint/);await name.fill('Fictional retained');
    const packet = await draft(page);expect(packet.version).toBe(3);expect(packet.portableResources.entries).toHaveLength(1);
    expect(packet.portableResources.entries[0].data).toBe(source.bytes.toString('base64'));
    await workspace(page, 'Settings');const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    const downloading = page.waitForEvent('download');await settings.getByRole('button', { name: 'Download workspace backup', exact: true }).click();
    const backup = await readFile((await (await downloading).path())!);
    expect(JSON.parse(backup.toString('utf8')).version).toBe(11);expect(JSON.parse(backup.toString('utf8')).portableResources.entries).toHaveLength(1);
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await workspace(page, `Actions for ${source.definition.label}`);await page.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
    await workspace(page, 'Trash');const trash = page.getByRole('dialog', { name: 'Trash', exact: true });
    await trash.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Permanently delete this document?', exact: true }).getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(trash.getByText('Trash is empty.', { exact: true })).toBeVisible();
    for (const mode of ['draft', 'backup']) {
      const fresh = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent),
        isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch, serviceWorkers: 'block' });
      try {
        await appearance(fresh, theme);await fresh.route('**/templates/**', route => route.abort());
        const restored = await fresh.newPage();await restored.goto(baseURL!);
        await expect(restored.getByRole('button', { name: 'Document actions', exact: true })).toBeVisible();await fresh.setOffline(true);
        if (mode === 'draft') await importDraft(restored, packet);
        else {
          await workspace(restored, 'Settings');await restored.getByLabel('Backup file', { exact: true }).setInputFiles({ name: 'portable-backup.json', mimeType: 'application/json', buffer: backup });
          const modal = restored.getByRole('dialog', { name: 'Settings', exact: true });
          await expect(modal.getByRole('status')).toContainText('doc', { timeout: 15_000 });await expect(modal.getByRole('alert')).toHaveCount(0);
          await modal.getByRole('button', { name: 'Close', exact: true }).click();await workspace(restored, source.definition.label);
        }
        await expect(restored.getByRole('textbox', { name: 'Fictional name', exact: true })).toHaveValue('Fictional retained');
        expect(await restored.evaluate(async hash => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs');request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
          try { return await new Promise<number>((resolve, reject) => { const request = db.transaction('attachments').objectStore('attachments').get(`form-template-${hash}`);request.onsuccess = () => resolve(request.result?.data?.byteLength ?? 0);request.onerror = () => reject(request.error); }); } finally { db.close(); }
        }, source.definition.pages[0].sha256)).toBe(source.bytes.byteLength);
        const rendered = await pdf(restored);
        await writeFile(info.outputPath(`${mode}-${theme}.pdf`), rendered);
        await info.attach(`${mode}-${theme}.pdf`, { body: rendered, contentType: 'application/pdf' });
        expect((await draft(restored)).portableResources).toEqual(packet.portableResources);
        await fresh.setOffline(false);await restored.reload();
        await expect(restored.getByRole('textbox', { name: 'Fictional name', exact: true })).toHaveValue('Fictional retained');
        expect(await restored.evaluate(async hash => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs');request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
          try { return await new Promise<number>((resolve, reject) => { const request = db.transaction('attachments').objectStore('attachments').get(`form-template-${hash}`);request.onsuccess = () => resolve(request.result?.data?.byteLength ?? 0);request.onerror = () => reject(request.error); }); } finally { db.close(); }
        }, source.definition.pages[0].sha256)).toBe(source.bytes.byteLength);
        await fresh.setOffline(true);
        expect((await draft(restored)).portableResources).toEqual(packet.portableResources);
        await restored.screenshot({ path: info.outputPath(`${mode}-${theme}.png`), fullPage: true });
      } finally { await fresh.close(); }
    }
  });
}

test('corrupt and unwritable template imports preserve newer work', async ({ page, context }) => {
  await appearance(context, 'light');const source = await fixture('boundaries');
  await page.route('**/templates/**', route => route.request().url().endsWith('/portable-fixture/page1.pdf')
    ? route.fulfill({ status: 200, contentType: 'application/pdf', body: source.bytes }) : route.fulfill({ status: 200, json: { templates: [] } }));
  await page.goto('/');await importDraft(page, source.legacy);
  const packet = await draft(page), name = page.getByRole('textbox', { name: 'Fictional name', exact: true });await name.fill('Newer fictional work');
  const corrupt = structuredClone(packet);corrupt.portableResources.entries[0].sha256 = 'a'.repeat(64);
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'corrupt-form.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(corrupt)) });
  const alert = page.getByRole('alertdialog', { name: 'Could not import draft', exact: true });await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'OK', exact: true }).click();await expect(name).toHaveValue('Newer fictional work');
  const alternate = await PDFDocument.load(source.bytes);alternate.setTitle('Alternate required template');
  const alternateBytes = Buffer.from(await alternate.save()), hash = createHash('sha256').update(alternateBytes).digest('hex');
  const incoming = structuredClone(packet);incoming.genericForm.definition.pages[0].sha256 = hash;
  incoming.portableFormTemplates[0].definitionSha256 = createHash('sha256').update(JSON.stringify(incoming.genericForm.definition)).digest('hex');
  incoming.portableFormTemplates[0].pages['page1.pdf'] = `forms/${hash}.pdf`;
  Object.assign(incoming.portableResources.entries[0], { path: `forms/${hash}.pdf`, sha256: hash, size: alternateBytes.byteLength, data: alternateBytes.toString('base64') });
  await page.evaluate(() => { const add = IDBObjectStore.prototype.add;IDBObjectStore.prototype.add = function (...args) { if (this.name === 'attachments') throw new DOMException('Synthetic storage quota failure', 'QuotaExceededError');return add.apply(this, args); }; });
  await importDraft(page, incoming);
  await expect(page.getByText('Could not finish opening the draft. Check browser storage and try again.', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Review draft', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(name).toHaveValue('Newer fictional work');
});

test('encrypted configured forms retain exact templates in a fresh offline browser', async ({ page, context, browser, baseURL }, info) => {
  await appearance(context, 'light');const source = await fixture('encrypted');
  await page.route('**/templates/**', route => route.request().url().endsWith('/portable-fixture/page1.pdf')
    ? route.fulfill({ status: 200, contentType: 'application/pdf', body: source.bytes }) : route.fulfill({ status: 200, json: { templates: [] } }));
  await page.goto('/');await importDraft(page, source.legacy);
  await page.getByRole('textbox', { name: 'Fictional name', exact: true }).fill('Fictional retained');
  const packet = await draft(page), desktop = page.getByRole('button', { name: 'Share', exact: true });
  if (await desktop.isVisible()) await desktop.click();else await actions(page, /^Create share link/);
  const sharing = page.getByRole('dialog', { name: 'Share document', exact: true });
  await sharing.getByLabel('Password for this link', { exact: true }).fill('synthetic-form-password');
  await sharing.getByRole('button', { name: 'Generate link', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await sharing.getByRole('button', { name: 'Download encrypted share file', exact: true }).click();
  const encrypted = await readFile((await (await downloading).path())!);
  expect(encrypted.toString('utf8')).not.toContain('Fictional retained');
  const fresh = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent),
    isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch, serviceWorkers: 'block' });
  try {
    await appearance(fresh, 'light');await fresh.route('**/templates/**', route => route.abort());
    const recipient = await fresh.newPage();await recipient.goto(baseURL!);
    await expect(recipient.getByRole('button', { name: 'Document actions', exact: true })).toBeVisible();await fresh.setOffline(true);
    await actions(recipient, 'Open from share link');
    const incoming = recipient.getByRole('dialog', { name: 'Open shared document', exact: true });
    await incoming.getByLabel('Encrypted share file', { exact: true }).setInputFiles({ name: 'encrypted-form.json', mimeType: 'application/json', buffer: encrypted });
    await incoming.getByLabel('Password', { exact: true }).fill('synthetic-form-password');
    await incoming.getByRole('button', { name: 'Decrypt and review', exact: true }).click();
    await expect(incoming).toContainText('attachments passed their size, type and checksum checks');
    await incoming.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(incoming).toBeHidden();await expect(recipient.getByRole('textbox', { name: 'Fictional name', exact: true })).toHaveValue('Fictional retained');
    const rendered = await pdf(recipient);await writeFile(info.outputPath('encrypted-form.pdf'), rendered);
    expect((await draft(recipient)).portableResources).toEqual(packet.portableResources);
    await fresh.setOffline(false);await recipient.reload();await fresh.setOffline(true);
    await expect(recipient.getByRole('textbox', { name: 'Fictional name', exact: true })).toHaveValue('Fictional retained');
    expect((await draft(recipient)).portableResources).toEqual(packet.portableResources);
  } finally { await fresh.close(); }
});
