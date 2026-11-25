import { capturePackageDocument } from '../_helpers/capturePackageDocument';
import { openPackagePreparation, packageSection, expandPackageTools, preparePackageExport, packageTool, newBlankPackage, importPackage as importWorkspacePackage, openPackageWorkspace, choosePackageById } from './_helpers/packageWorkspace';
import { projectBrowserContextOptions } from '../_helpers/projectBrowserContext';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compileFormDefinition } from '../../src/services/forms/model';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(150_000);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function packages(page: Page) {
  return openPackagePreparation(page);
}
async function section(dialog: Locator, name: string) {
  const panel = await packageTool(dialog, name);
  if (!await panel.isVisible()) await expandPackageTools(dialog);
  await expect(panel).toBeVisible(); return panel;
}
async function download(page: Page, click: () => Promise<void>) { const pending = page.waitForEvent('download', { timeout: 90_000 }); await click(); const file = await pending; expect(await file.failure()).toBeNull(); return readFile((await file.path())!); }
async function pdf(text: string, pages = 1) { const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica); for (let index = 0; index < pages; index++) document.addPage([612, 792]).drawText(`${text} ${index + 1}`, { x: 54, y: 700, size: 12, font }); return Buffer.from(await document.save()); }
const asset = (id: string, name: string, type: string, bytes: Uint8Array) => ({ id, name, type, size: bytes.byteLength, sha256: sha(bytes) });
const resource = (entry: ReturnType<typeof asset>, bytes: Uint8Array) => ({ path: `assets/${entry.id}`, name: entry.name, mediaType: entry.type, size: entry.size, sha256: entry.sha256, data: Buffer.from(bytes).toString('base64') });
function packet(id: string, name: string, revisions: unknown[], currentRevisionId: string, entries: unknown[]) { return Buffer.from(JSON.stringify({ kind: 'dondocs-action-package', version: 1,
  package: { kind: 'dondocs-action-package-record', version: 1, id, historyScope: 'selected-revision', name, archived: false, sequence: 0, currentRevisionId, revisions }, portableResources: { kind: 'dondocs-resources', version: 1, entries } })); }
async function text(bytes: Uint8Array) { const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise; try { const pages: string[] = []; for (let number = 1; number <= document.numPages; number++) pages.push((await (await document.getPage(number)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')); return pages; } finally { await document.destroy(); } }
async function importPackage(dialog: Locator, buffer: Buffer) { await importWorkspacePackage(dialog, { name: 'synthetic-qualification.json', mimeType: 'application/json', buffer });
  await packageSection(dialog, 'Delivery', true); }

for (const width of [1440, 320]) {
  test(`assembly controls persist covers and contents, physical navigation and exact output at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 950 }); await context.addInitScript(value => { localStorage.setItem('browser-test-visitor', 'returning'); localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } })); }, width === 320 ? 'dark' : 'light');
    const main = await pdf('SYNTHETIC BASIC LETTER', 2), supporting = await pdf('SYNTHETIC ENCLOSURE');
    const mainAsset = asset('asset_assembly_main', 'Basic.pdf', 'application/pdf', main), proofAsset = asset('asset_assembly_proof', 'Enclosure.pdf', 'application/pdf', supporting);
    const members = [{ kind: 'original', id: 'member_main', revisionId: 'member_main_revision', label: 'Training basic letter', role: 'basic-letter', required: true, signedOriginal: false, original: mainAsset },
      { kind: 'original', id: 'member_proof', revisionId: 'member_proof_revision', label: 'Training enclosure', role: 'enclosure', required: true, signedOriginal: false, original: proofAsset }];
    await page.goto('/'); let dialog = await packages(page);
    await importPackage(dialog, packet('package_assembly_browser', 'Covered training package', [{ id: 'revision_assembly_source', createdAt: 1, members, outputs: [] }], 'revision_assembly_source', [resource(mainAsset, main), resource(proofAsset, supporting)]));
    await expect(dialog.getByRole('heading', { name: 'Covered training package', exact: true, level: 1 })).toBeVisible();
    let layout = await section(dialog, 'Assembly layout');
    await layout.getByLabel('Assembly profile', { exact: true }).selectOption('letter-led'); await layout.getByLabel('Assembly profile', { exact: true }).selectOption('mixed');
    await layout.getByRole('checkbox', { name: 'Include a package cover', exact: true }).check(); await layout.getByRole('checkbox', { name: 'Include linked contents', exact: true }).check();
    await expect(layout.getByRole('button', { name: 'Save assembly settings', exact: true })).toBeDisabled();
    await layout.getByRole('checkbox', { name: /^I reviewed the assembly profile/ }).check(); await layout.getByRole('button', { name: 'Save assembly settings', exact: true }).click();
    await expect(layout.getByText('Showing saved assembly settings.', { exact: true })).toBeVisible();
    await page.reload(); dialog = await openPackageWorkspace(page);
    await choosePackageById(dialog, 'package_assembly_browser');
    layout = await section(dialog, 'Assembly layout');
    await expect(layout.getByLabel('Assembly profile', { exact: true })).toHaveValue('mixed'); await expect(layout.getByRole('checkbox', { name: 'Include a package cover', exact: true })).toBeChecked(); await expect(layout.getByRole('checkbox', { name: 'Include linked contents', exact: true })).toBeChecked();
    await preparePackageExport(dialog, 'pdf');
  await expect(dialog.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
    if (await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).isVisible()) await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check(); await dialog.getByRole('button', { name: 'Download PDF', exact: true }).click();
    await expect(dialog.getByText(/^PDF downloaded\./)).toBeVisible();
    const contents = await packageTool(dialog, 'Saved PDF contents'); await expect(contents.getByText('PDF pages 3–4 · first printed label 1', { exact: true })).toBeVisible(); await expect(contents.getByText('PDF pages 5–5 · first printed label Enclosure (1)', { exact: true })).toBeVisible();
    if (await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).isVisible()) await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
    await preparePackageExport(dialog, 'saved');
    const bytes = await download(page, () => dialog.getByRole('button', { name: 'Download reviewed retained PDF', exact: true }).click());
    const output = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(output.getPageCount()).toBe(5);
    expect(output.getCreator()).toBe('DonDocs');
    expect(output.getProducer()).toBe('DonDocs (pdf-lib)');
    const outlines = output.catalog.lookup(PDFName.of('Outlines'), PDFDict), first = outlines.lookup(PDFName.of('First'), PDFDict), last = outlines.lookup(PDFName.of('Last'), PDFDict);
    expect(first.lookup(PDFName.of('Dest'), PDFArray).get(0)).toEqual(output.getPage(2).ref); expect(last.lookup(PDFName.of('Dest'), PDFArray).get(0)).toEqual(output.getPage(4).ref);
    const labels = output.catalog.lookup(PDFName.of('PageLabels'), PDFDict).lookup(PDFName.of('Nums'), PDFArray); expect(labels.lookup(0, PDFNumber).asNumber()).toBe(2); expect(labels.lookup(2, PDFNumber).asNumber()).toBe(4);
    const pages = await text(bytes); expect(pages[0]).toContain('Covered training package'); expect(pages[1]).toContain('Contents'); expect(pages[2]).toContain('SYNTHETIC BASIC LETTER 1'); expect(pages[4]).toContain('SYNTHETIC ENCLOSURE 1');
    await contents.getByRole('button', { name: 'Open PDF page 5', exact: true }).click();
    if (await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).isVisible()) await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check(); await dialog.getByRole('button', { name: 'Preview reviewed retained PDF', exact: true }).click();
    await expect(dialog.getByLabel('Page number', { exact: true })).toHaveValue('5'); await expect(dialog.locator('canvas').first()).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true); await info.attach('covered-package.pdf', { body: bytes, contentType: 'application/pdf' }); await page.screenshot({ path: info.outputPath(`assembly-${width}px.png`) });
  });

  test(`recipient UI renders only selected native form content at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 950 }); await context.addInitScript(() => { localStorage.setItem('browser-test-visitor', 'returning'); localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: 'classic', editorLayout: 'focused' } })); });
    const blank = await pdf('PUBLIC FORM BACKGROUND'), privatePdf = await pdf('PRIVATE EXCLUDED FILE');
    const template = asset('asset_recipient_template', 'page1.pdf', 'application/pdf', blank), excluded = asset('asset_recipient_private', 'PRIVATE excluded.pdf', 'application/pdf', privatePdf);
    const definition = compileFormDefinition({ schemaVersion: 2, formId: 'recipient_ui_fixture', label: 'Recipient form', definitionRevision: 'v1', templateRevision: template.sha256, directory: 'recipient-ui-fixture', pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256: template.sha256 }], fields: { name: { kind: 'text', label: 'Public name', requiredAt: 'export' } }, placements: [{ fieldId: 'name', page: 1, appearance: 'text', box: { left: 40, top: 630, width: 400, height: 24 } }], sections: [{ id: 'identity', title: 'Identity', fields: ['name'] }], rowGroups: {} });
    const session = { documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: definition.formId, genericForm: { definition, answers: { name: 'PUBLIC SELECTED PERSON' }, rows: {}, answerRevision: 0 }, formData: { subject: 'SECRET\nPRIVATE INACTIVE SOURCE SUBJECT\nSECRET' }, paragraphs: [{ id: 'inactive', text: 'PRIVATE INACTIVE CORRESPONDENCE', level: 0 }], references: [], enclosures: [], copyTos: [], endItems: [], publicationTables: {}, distributions: [], timestamp: 0 };
    const draftBytes = Buffer.from(JSON.stringify({ kind: 'dondocs-draft', version: 2, documentKind: 'configured-form', ...session })), draft = asset('asset_recipient_draft', 'PRIVATE editable draft.json', 'application/json', draftBytes);
    const native = { kind: 'native', id: 'member_recipient_native', revisionId: 'member_recipient_native_revision', label: 'Selected public form', role: 'basic-letter', required: true, session, draft, templates: { 'page1.pdf': template } };
    const support = { kind: 'original', id: 'member_recipient_private', revisionId: 'member_recipient_private_revision', label: 'PRIVATE supporting file', role: 'enclosure', required: true, original: excluded, signedOriginal: false };
    await page.goto('/'); const dialog = await packages(page);
    await importPackage(dialog, packet('package_recipient_browser', 'PRIVATE source package', [{ id: 'revision_private_history', createdAt: 1, members: [support], outputs: [] }, { id: 'revision_recipient_source', parentId: 'revision_private_history', createdAt: 2, members: [native, support], outputs: [] }], 'revision_recipient_source', [resource(template, blank), resource(draft, draftBytes), resource(excluded, privatePdf)]));
    await expect(dialog.getByRole('heading', { name: 'PRIVATE source package', exact: true, level: 1 })).toBeVisible(); const delivery = await section(dialog, 'Recipient delivery');
    await delivery.getByLabel('Delivery name', { exact: true }).fill('Public selected delivery'); await delivery.getByLabel('Delivery purpose', { exact: true }).selectOption('recipient'); await delivery.getByLabel('Include PRIVATE supporting file', { exact: true }).uncheck();
    await delivery.getByRole('button', { name: 'Prepare selected delivery', exact: true }).click();
    const captured = delivery.getByRole('region', { name: 'Captured delivery contents', exact: true }); await expect(captured).toContainText('1 included documents · 1 excluded · 1 captured files');
    await captured.getByRole('button', { name: 'Preview document-1.pdf', exact: true }).click(); await expect(captured.getByRole('region', { name: 'Captured delivery file preview', exact: true }).locator('canvas').first()).toBeVisible();
    await expect(captured.getByRole('button', { name: 'Open in browser tab', exact: true })).toHaveCount(0);
    await expect(captured.getByRole('button', { name: 'Download reviewed delivery package', exact: true })).toBeEnabled();
    const bytes = await download(page, () => captured.getByRole('button', { name: 'Download reviewed delivery package', exact: true }).click()), exported = JSON.parse(bytes.toString());
    expect(exported.package.revisions).toHaveLength(1); expect(exported.package.revisions[0].members).toHaveLength(1); expect(exported.package.revisions[0].members[0].kind).toBe('original'); expect(exported.portableResources.entries).toHaveLength(1);
    expect(JSON.stringify(exported.package)).not.toMatch(/PRIVATE|SECRET|genericForm|reviewRounds|workingCopies|session/);
    const entry = exported.portableResources.entries[0], pdfBytes = Buffer.from(entry.data, 'base64'); expect(sha(pdfBytes)).toBe(entry.sha256); expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBe(1); expect((await text(pdfBytes)).join('\n')).toContain('PUBLIC SELECTED PERSON'); expect((await text(pdfBytes)).join('\n')).not.toMatch(/PRIVATE|SECRET/);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true); await info.attach('public-recipient.pdf', { body: pdfBytes, contentType: 'application/pdf' }); await delivery.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`recipient-${width}px.png`) });
  });
}

test('delivery ZIP recovers its exact selected original in a fresh browser context', async ({ page, context, browser }, info) => {
  await context.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  const includedBytes = await pdf('PUBLIC UNCHANGED DELIVERY ORIGINAL'), excludedBytes = await pdf('PRIVATE EXCLUDED SUPPORT');
  const included = asset('asset_bundle_original', 'Public original.pdf', 'application/pdf', includedBytes), excluded = asset('asset_bundle_excluded', 'PRIVATE support.pdf', 'application/pdf', excludedBytes);
  const members = [{ kind: 'original', id: 'member_bundle_original', revisionId: 'member_bundle_original_revision', label: 'Public selected original', role: 'basic-letter', required: true, signedOriginal: true, original: included },
    { kind: 'original', id: 'member_bundle_excluded', revisionId: 'member_bundle_excluded_revision', label: 'PRIVATE excluded support', role: 'enclosure', required: true, signedOriginal: false, original: excluded }];
  await page.goto('/'); const dialog = await packages(page);
  await importPackage(dialog, packet('package_bundle_browser', 'PRIVATE source workspace', [{ id: 'revision_bundle_source', createdAt: 1, members, outputs: [] }], 'revision_bundle_source', [resource(included, includedBytes), resource(excluded, excludedBytes)]));
  await expect(dialog.getByRole('heading', { name: 'PRIVATE source workspace', exact: true, level: 1 })).toBeVisible();
  const delivery = await section(dialog, 'Recipient delivery');
  await delivery.getByLabel('Delivery name', { exact: true }).fill('Public recovered delivery');
  await delivery.getByLabel('Include PRIVATE excluded support', { exact: true }).uncheck();
  await delivery.getByRole('button', { name: 'Prepare selected delivery', exact: true }).click();
  const captured = delivery.getByRole('region', { name: 'Captured delivery contents', exact: true });
  await expect(captured).toContainText('1 included documents · 1 excluded · 1 captured files');
  await expect(captured.getByRole('button', { name: 'Download reviewed delivery bundle', exact: true })).toBeEnabled();
  const bundle = await download(page, () => captured.getByRole('button', { name: 'Download reviewed delivery bundle', exact: true }).click());
  const zip = await JSZip.loadAsync(bundle), manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  expect(Object.keys(zip.files).sort()).toEqual([...manifest.files.map((file: { path: string }) => file.path), 'manifest.json'].sort());
  for (const file of manifest.files) expect(sha(await zip.file(file.path)!.async('uint8array'))).toBe(file.sha256);
  const payload = await zip.file('package.dondocs-package.json')!.async('string');
  expect(payload).not.toMatch(/PRIVATE|member_bundle_excluded|package_bundle_browser/);
  expect(await zip.file('index.html')!.async('string')).toContain('Public selected original');
  const fresh = await browser.newContext({ ...projectBrowserContextOptions(info), baseURL: new URL(page.url()).origin, serviceWorkers: 'block', viewport: { width: 320, height: 950 } });
  try {
    await fresh.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    const freshPage = await fresh.newPage(); await freshPage.goto('/'); const recovered = await packages(freshPage);
    await importWorkspacePackage(recovered, { name: 'public-delivery.zip', mimeType: 'application/zip', buffer: bundle });
  await packageSection(recovered, 'Documents', true);
    await expect(recovered.getByRole('heading', { name: 'Public recovered delivery', exact: true, level: 1 })).toBeVisible();
    await expect(recovered.getByRole('button', { name: 'Download unchanged original', exact: true })).toHaveCount(1);
    await recovered.getByRole('button', { name: 'Download unchanged original', exact: true }).click();
    if (await recovered.getByRole('checkbox', { name: /^I reviewed every included member/ }).isVisible()) await recovered.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
    const restoredBytes = await download(freshPage, () => recovered.getByRole('button', { name: 'Download reviewed unchanged original', exact: true }).click());
    expect(restoredBytes).toEqual(includedBytes);
    expect(await recovered.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await info.attach('delivery-recovered-original.pdf', { body: restoredBytes, contentType: 'application/pdf' });
    await freshPage.screenshot({ path: info.outputPath('delivery-fresh-browser-320px.png') });
  } finally { await fresh.close(); }
});

for (const docType of ['naval_letter', 'plain_paper_memorandum', 'letterhead_memorandum', 'mfr', 'mf']) {
  test(`downloads a tagged ${docType} with unchanged originals`, async ({ page, context }, info) => {
    await context.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    const support = await pdf('ORIGINAL SUPPORT');
    const session = {
      documentMode: 'compliant', documentCategory: 'correspondence', docType,
      formData: { subject: 'SYNTHETIC TAGGED DELIVERY', from: 'Training Office', to: 'Training Staff',
        date: '21 Nov 26', letterheadMode: 'preprinted', signatureType: 'none', classLevel: 'unclassified' },
      paragraphs: [{ id: 'p1', level: 0, text: 'Review the separately retained original.' }],
      references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {}, timestamp: 0,
    };
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({
      name: 'Training draft.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ kind: 'dondocs-draft', version: 7, documentKind: 'correspondence', ...session })),
    });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Review draft', exact: true })).toBeHidden();
    const dialog = await packages(page);
    await newBlankPackage(dialog, 'Tagged delivery training');
    await capturePackageDocument(dialog);
    await dialog.getByLabel('New member role', { exact: true }).selectOption('enclosure');
    await dialog.getByLabel('Add original PDF', { exact: true }).setInputFiles({ name: 'Original.pdf', mimeType: 'application/pdf', buffer: support });
    await expect(dialog.getByRole('heading', { name: /Original\.pdf/i }).first()).toBeVisible();
    const delivery = await section(dialog, 'Recipient delivery');
    await delivery.getByRole('checkbox', { name: /^Tag supported correspondence PDFs/ }).check();
    await delivery.getByRole('button', { name: 'Prepare selected delivery', exact: true }).click();
    const rendered = delivery.getByRole('region', { name: 'Captured delivery contents', exact: true });
    await expect(rendered.or(delivery.getByRole('alert'))).toBeVisible({ timeout: 90_000 });
    await expect(delivery.getByRole('alert')).toHaveCount(0);
    await expect(rendered).toContainText('document-1-tagged.pdf');
    const bytes = await download(page, () => rendered.getByRole('button', { name: 'Download reviewed delivery bundle', exact: true }).click());
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { files: { name: string; path: string }[] };
    const taggedPath = manifest.files.find(file => file.name === 'document-1-tagged.pdf')?.path;
    const originalPath = manifest.files.find(file => file.name === 'Original.pdf')?.path;
    expect(taggedPath).toBeDefined();
    expect(originalPath).toBeDefined();
    const tagged = await PDFDocument.load(await zip.file(taggedPath!)!.async('uint8array'));
    expect(tagged.catalog.has(PDFName.of('StructTreeRoot'))).toBe(true);
    expect(await zip.file(originalPath!)!.async('nodebuffer')).toEqual(support);
    expect(await zip.file('index.html')!.async('string')).toContain('Original files retain their existing accessibility.');
    if (docType === 'plain_paper_memorandum') {
      await info.attach('tagged-memo-delivery.zip', { body: bytes, contentType: 'application/zip' });
    }

  });
}

test('complete delivery opens a manual confirmation and selected files remain independently deliverable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  const bytes = await pdf('TRAINING HANDOFF');
  const original = asset('delivery_resource', 'Training.pdf', 'application/pdf', bytes);
  const member = { kind: 'original', id: 'training', revisionId: 'saved_copy', label: 'Training PDF',
    role: 'basic-letter', required: true, signedOriginal: false, original };
  const requirements = { version: 1, items: [{ id: 'receipt', kind: 'confirmation', operations: ['pdf'],
    label: 'Confirm receipt', condition: 'active' }] };
  await page.goto('/');
  const dialog = await packages(page);
  await importPackage(dialog, packet('delivery_scope', 'Training handoff', [
    { id: 'first', createdAt: 1, members: [member], requirements, outputs: [] },
  ], 'first', [resource(original, bytes)]));
  const delivery = await section(dialog, 'Recipient delivery');
  await delivery.getByLabel('Delivery name').fill('My selected files');
  await delivery.getByRole('button', { name: 'Prepare selected delivery' }).click();
  await delivery.getByRole('button', { name: 'Review requirement' }).click();
  await expect(dialog.getByRole('checkbox', { name: /User declaration for Confirm receipt/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Return to delivery' }).click();
  await expect(delivery.getByLabel('Delivery name')).toHaveValue('My selected files');
  await delivery.getByLabel('Delivery scope').selectOption('selected');
  await delivery.getByRole('button', { name: 'Prepare selected delivery' }).click();
  await expect(delivery.getByRole('button', { name: 'Download reviewed delivery bundle' })).toBeEnabled();
});
