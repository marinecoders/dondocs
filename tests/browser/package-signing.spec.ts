import { openPackagePreparation, importPackage, packageSection, expandPackageTools, preparePackageExport, packageTool } from './_helpers/packageWorkspace';
import { projectBrowserContextOptions } from '../_helpers/projectBrowserContext';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { signingPdfDownload } from '../_helpers/signingBrowser';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
async function packages(page: Page) {
  return openPackagePreparation(page);
}
async function signingPanel(dialog: Locator) {
  const panel = await packageTool(dialog, 'Package signing');
  if (!await panel.isVisible()) await expandPackageTools(dialog);
  await expect(panel).toBeVisible(); return panel;
}
async function capturedHandoff(panel: Locator) {
  await packageSection(panel.page().getByRole('dialog', { name: 'Action packages', exact: true }), 'Delivery', true);
  const review = panel.getByRole('button', { name: 'Review retained handoff 1', exact: true });
  if (!await review.isVisible()) await expandPackageTools(panel);
  await review.click(); await expect(panel.getByLabel('Exact retained package handoff PDF', { exact: true }).locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  const source = panel.getByText('Inspect retained source PDF', { exact: true });
  if (!await panel.getByLabel('Exact retained package signing source PDF', { exact: true }).locator('canvas').first().isVisible()) await source.click(); await expect(panel.getByLabel('Exact retained package signing source PDF', { exact: true }).locator('canvas').first()).toBeVisible(); await source.click();
}
async function download(page: Page, action: () => Promise<void>) {
  const pending = page.waitForEvent('download', { timeout: 90_000 }); await action(); const file = await pending;
  expect(await file.failure()).toBeNull(); return readFile((await file.path())!);
}
async function inputPackage() {
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
  page.drawText('SYNTHETIC PACKAGE SIGNING SOURCE', { x: 60, y: 720, size: 12 });
  pdf.setCreationDate(new Date('2026-11-17T12:00:00Z')); pdf.setModificationDate(new Date('2026-11-17T12:00:00Z'));
  const bytes = await pdf.save(), sha256 = createHash('sha256').update(bytes).digest('hex');
  const asset = { id: 'asset_signing_source', name: 'Synthetic signing source.pdf', type: 'application/pdf', size: bytes.byteLength, sha256 };
  return { sha256, buffer: Buffer.from(JSON.stringify({ kind: 'dondocs-action-package', version: 1,
    package: { kind: 'dondocs-action-package-record', version: 1, id: 'package_signing_browser', historyScope: 'selected-revision', name: 'Synthetic signing action', archived: false, sequence: 0,
      currentRevisionId: 'revision_signing_source', revisions: [{ id: 'revision_signing_source', createdAt: 100, outputs: [], members: [
        { kind: 'original', id: 'member_signing_source', revisionId: 'member_revision_signing_source', label: asset.name, role: 'basic-letter', required: true, original: asset, signedOriginal: false },
      ] }] }, portableResources: { kind: 'dondocs-resources', version: 1, entries: [{ path: `assets/${asset.id}`, name: asset.name, mediaType: asset.type, size: asset.size, sha256, data: Buffer.from(bytes).toString('base64') }] },
  })) };
}

for (const theme of ['light', 'dark', 'classic']) for (const width of [1440, 320]) test(`exact package signing and reviewed returns preserve newer work in ${theme} at ${width}px`, async ({ page, context, browser, baseURL }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await context.addInitScript(value => { localStorage.setItem('browser-test-visitor', 'returning'); localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } })); }, theme);
  const fixture = await inputPackage(); await page.goto('/'); let dialog = await packages(page);
  await importPackage(dialog, { name: 'synthetic-signing-package.json', mimeType: 'application/json', buffer: fixture.buffer });
  await packageSection(dialog, 'Delivery', true);
  await expect(dialog.getByRole('heading', { name: 'Synthetic signing action', exact: true, level: 1 })).toBeVisible();
  let panel = await signingPanel(dialog);
  await panel.getByLabel('Package signing PDF', { exact: true }).selectOption({ label: 'Original PDF: Synthetic signing source.pdf' });
  await panel.getByRole('button', { name: 'Review signing source', exact: true }).click();
  // The first source review includes cold PDF-worker startup on hosted Firefox.
  await expect(panel.getByLabel('Exact package signing source PDF', { exact: true }).locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('checkbox', { name: /^I reviewed the exact source PDF/ }).check();
  await panel.getByRole('button', { name: 'Open signing workspace for this PDF', exact: true }).click();
  let workspace = page.getByRole('dialog', { name: 'Signing workspace', exact: true }); await expect(workspace).toBeVisible();
  await workspace.getByRole('button', { name: 'Add signature box', exact: true }).click();
  await workspace.getByLabel('Signer name', { exact: true }).fill('Alex Example');
  await workspace.getByRole('checkbox', { name: /^I reviewed every page, signer assignments/ }).check();
  await workspace.getByRole('button', { name: 'Save exact signing handoff', exact: true }).click();
  await expect(workspace.getByText('Exact signing handoff saved. Download it when you are ready to share.', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: 'Close', exact: true }).click();
  await panel.getByRole('button', { name: 'Refresh saved signing handoffs', exact: true }).click();
  await expect(panel.getByLabel('Package signing handoff', { exact: true }).getByRole('option').filter({ hasText: /^Handoff 1/ })).toHaveCount(1);
  await panel.getByLabel('Package signing handoff', { exact: true }).selectOption({ index: 1 });
  await panel.getByRole('button', { name: 'Review exact package handoff', exact: true }).click();
  await expect(panel.getByLabel('Exact prepared package handoff PDF', { exact: true }).locator('canvas').first()).toBeVisible();
  await panel.getByRole('checkbox', { name: /^I reviewed the handoff PDF/ }).check();
  await panel.getByRole('button', { name: 'Capture handoff in new package revision', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Check signing applicability', exact: true })).toBeVisible();
  await capturedHandoff(panel);
  await panel.getByRole('button', { name: 'Check signing applicability', exact: true }).click();
  await expect(panel.getByText(/^inputs-match:/)).toBeVisible();
  await panel.getByRole('checkbox', { name: /^I reviewed every retained source and handoff page/ }).check();
  const zipBytes = await download(page, () => panel.getByRole('button', { name: 'Download exact package signing handoff', exact: true }).click());
  const archive = await JSZip.loadAsync(zipBytes), handoffBytes = await archive.file('ready-to-sign.pdf')!.async('nodebuffer');
  const manifest = JSON.parse(await archive.file('manifest.json')!.async('string'));
  expect(manifest.package).toMatchObject({ id: 'package_signing_browser', revisionId: 'revision_signing_source', sourceSha256: fixture.sha256, signerAuthenticity: 'unverified' });
  expect(createHash('sha256').update(handoffBytes).digest('hex')).toBe(manifest.pdfSha256);
  const handedPdf = await PDFDocument.load(handoffBytes); expect(handedPdf.getPageCount()).toBe(1); expect(handedPdf.getForm().getFields()).toHaveLength(1);
  await panel.getByRole('button', { name: 'Open captured signing workspace', exact: true }).click();
  workspace = page.getByRole('dialog', { name: 'Signing workspace', exact: true });
  await workspace.getByLabel('Returned PDF', { exact: true }).setInputFiles({ name: 'Synthetic associated return.pdf', mimeType: 'application/pdf', buffer: handoffBytes });
  await expect(workspace.getByText(/^This is the unchanged handoff PDF\./)).toBeVisible();
  await workspace.getByRole('checkbox', { name: /^I compared every page and the signer assignments/ }).check();
  await workspace.getByRole('checkbox', { name: /^I understand this file is unchanged, differs/ }).check();
  await workspace.getByRole('button', { name: 'Associate returned PDF', exact: true }).click();
  await expect(workspace.getByText('Returned PDF associated with the saved handoff. Signer authenticity and approval remain unverified.', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: 'Close', exact: true }).click();
  const information = await packageTool(dialog, /^(Details|Package information)$/);
  await information.getByRole('button', { name: 'Add shared value', exact: true }).click();
  await information.getByLabel('Value label 1', { exact: true }).fill('Newer coordination note');
  await information.getByLabel('Value 1', { exact: true }).fill('Preserve this newer package work');
  await information.getByRole('button', { name: /^(Review changes|Preview package changes)$/ }).click();
  await expect(information.getByRole('button', { name: 'Apply package changes', exact: true })).toBeVisible(); if (await information.getByRole('checkbox', { name: /^I reviewed the package values, linked field changes/ }).isVisible()) await information.getByRole('checkbox', { name: /^I reviewed the package values, linked field changes/ }).check();
  await information.getByRole('button', { name: 'Apply package changes', exact: true }).click();
  await expect(information.getByText('Package changes saved as a new revision.', { exact: true })).toBeVisible();
  await capturedHandoff(panel);
  await panel.getByRole('button', { name: 'Check signing applicability', exact: true }).click();
  await expect(panel.getByText(/Other package context changed/)).toBeVisible();
  await panel.getByRole('button', { name: 'Refresh associated signing returns', exact: true }).click();
  await expect(panel.getByLabel('Associated package signing return', { exact: true }).getByRole('option')).toHaveCount(2);
  await panel.getByLabel('Associated package signing return', { exact: true }).selectOption({ index: 1 });
  await panel.getByRole('button', { name: 'Review adding return to package', exact: true }).click();
  await expect(panel.getByLabel('Returned package PDF to preserve', { exact: true }).locator('canvas').first()).toBeVisible();
  const add = panel.getByRole('button', { name: 'Add reviewed return in new package revision', exact: true });
  await panel.getByRole('checkbox', { name: /^I reviewed the exact returned PDF/ }).check(); await expect(add).toBeDisabled();
  await panel.getByRole('checkbox', { name: /^I acknowledge the unchanged, differing/ }).check(); await add.click();
  await expect(add).not.toBeVisible(); await capturedHandoff(panel); await expect(panel.locator('p').filter({ hasText: /Return 1: Synthetic associated return.pdf/ })).toBeVisible();
  await packageSection(dialog, 'Overview', true);
  await expect(information.getByLabel('Value 1', { exact: true })).toHaveValue('Preserve this newer package work');
  await page.reload(); dialog = await packages(page); panel = await signingPanel(dialog);
  await capturedHandoff(panel); await expect(panel.locator('p').filter({ hasText: /Return 1: Synthetic associated return.pdf/ })).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`package-signing-${theme}-${width}px.png`) });
  await preparePackageExport(dialog, 'editable');
  if (await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).isVisible()) await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
  const portable = await download(page, () => dialog.getByRole('button', { name: 'Download editable package', exact: true }).click());
  const exported = JSON.parse(portable.toString()); expect(exported.package.revisions[0].members).toHaveLength(2);
  const receiver = await browser.newContext({ ...projectBrowserContextOptions(info), viewport: { width, height: 950 }, serviceWorkers: 'block', userAgent: await page.evaluate(() => navigator.userAgent) });
  try {
    await receiver.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    const incoming = await receiver.newPage(); await incoming.goto(baseURL!); const received = await packages(incoming);
    await importPackage(received, { name: 'portable-signing-package.json', mimeType: 'application/json', buffer: portable });
  await packageSection(received, 'Delivery', true);
    await expect(received.getByRole('heading', { name: 'Synthetic signing action', exact: true, level: 1 })).toBeVisible();
    const incomingPanel = await signingPanel(received); await capturedHandoff(incomingPanel);
    await incomingPanel.getByRole('button', { name: 'Check signing applicability', exact: true }).click();
    await expect(incomingPanel.getByText(/^unknown: The signing files are preserved/)).toBeVisible();
    await incomingPanel.getByLabel('Captured package signing return', { exact: true }).selectOption({ index: 1 });
    await incomingPanel.getByRole('button', { name: 'Preview captured signing return', exact: true }).click();
    await expect(incomingPanel.getByLabel('Exact retained package return PDF', { exact: true }).locator('canvas').first()).toBeVisible();
    await incomingPanel.getByRole('checkbox', { name: /^I reviewed this exact retained returned PDF/ }).check();
    const returned = await signingPdfDownload(incoming, info.project.name, () => incomingPanel.getByRole('button', { name: 'Download unchanged captured return', exact: true }).click());
    expect(returned).toEqual(handoffBytes);
    await packageSection(received, 'Overview', true);
    await expect(received.getByRole('region', { name: /^(Details|Package information)$/ }).getByLabel('Value 1', { exact: true })).toHaveValue('Preserve this newer package work');
  } finally { await receiver.close(); }
});
