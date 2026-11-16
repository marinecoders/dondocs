import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { capturePackageDocument } from '../_helpers/capturePackageDocument';
import { PDFDocument, PDFName, PDFSignature } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { StoredDocument } from '@/lib/documentsDb';
import type { ActionPackage, NativePackageMember } from '@/lib/actionPackages';
import type { PackageTemplate } from '@/lib/packageTemplateLibrary';
import type { SigningRecord } from '@/lib/signingWorkspace';
import { signingPdfDownload } from '../_helpers/signingBrowser';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(240_000);

const PREVIOUS_SUBJECT = 'PREVIOUS TRAINING DRAFT';
const PREVIOUS_BODY = 'This fictional draft must remain unchanged throughout the complete workflow.';
const IMPORTED_SUBJECT = 'ACTION FOR {{NAME}}';
const SOURCE_PACKAGE = 'Scanned training starter';
const TEMPLATE = 'Scanned action template';
const FRESH_PACKAGE = 'Fresh scanned training action';
const lines = ['1500', '16 Nov 26', 'From: Training Office', 'To: ORIGINAL MARINE',
  'Subj: SCANNED TRAINING ACTION', '', '1. Approve ORIGINAL MARINE for the training activity.', '', 'A. EXAMPLE'];

async function textFromPdf(bytes: Uint8Array): Promise<string> {
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    const pages = [];
    for (let page = 1; page <= document.numPages; page++) {
      pages.push((await (await document.getPage(page)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    return pages.join('\n');
  } finally { await document.destroy(); }
}

async function imageOnlyLetter(page: Page): Promise<Buffer> {
  const png = await page.evaluate(source => {
    const canvas = document.createElement('canvas');canvas.width = 1500;canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black';context.font = '32px Arial';
    source.forEach((line, index) => context.fillText(line, 80, 110 + index * 65));
    return canvas.toDataURL('image/png').split(',')[1];
  }, lines);
  const pdf = await PDFDocument.create(), image = await pdf.embedPng(Buffer.from(png, 'base64'));
  pdf.addPage([750, 600]).drawImage(image, { x: 0, y: 0, width: 750, height: 600 });
  const bytes = Buffer.from(await pdf.save());
  expect((await textFromPdf(bytes)).trim()).toBe('');
  return bytes;
}

interface WorkspaceSnapshot { documents: StoredDocument[]; packages: ActionPackage[]; templates: PackageTemplate[]; signing: SigningRecord[] }
async function snapshot(page: Page): Promise<WorkspaceSnapshot> {
  return page.evaluate(() => new Promise<WorkspaceSnapshot>((resolve, reject) => {
    const opening = indexedDB.open('dondocs');opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction(['documents', 'app'], 'readonly');
      const documents = transaction.objectStore('documents').getAll(), app = transaction.objectStore('app').getAll();
      transaction.oncomplete = () => {
        db.close();const entries = app.result as Array<{ key: string; value: unknown }>;
        const values = (prefix: string) => entries.filter(entry => entry.key.startsWith(prefix)).map(entry => entry.value);
        resolve({ documents: documents.result, packages: values('action-package:') as ActionPackage[],
          templates: values('package-template:') as PackageTemplate[], signing: values('signing-workspace:') as SigningRecord[] });
      };
      transaction.onerror = () => { db.close();reject(transaction.error); };
      transaction.onabort = () => { db.close();reject(transaction.error); };
    };
  }));
}

async function openPackages(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true }).or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole('dialog', { name: 'Action packages', exact: true });
}

async function download(page: Page, action: () => Promise<void>): Promise<Buffer> {
  const pending = page.waitForEvent('download');await action();const result = await pending;
  expect(await result.failure()).toBeNull();return readFile((await result.path())!);
}

async function retainedPackagePdf(page: Page, dialog: ReturnType<Page['getByRole']>) {
  await dialog.getByRole('button', { name: 'Download retained PDF', exact: true }).click();
  await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
  return download(page, () => dialog.getByRole('button', { name: 'Download reviewed retained PDF', exact: true }).click());
}

function documentContents(document: StoredDocument) {
  return { id: document.id, formData: document.session.formData, paragraphs: document.session.paragraphs,
    references: document.session.references, enclosures: document.session.enclosures };
}

async function attachPdf(info: TestInfo, filename: string, bytes: Buffer) {
  await writeFile(info.outputPath(filename), bytes);await info.attach(filename, { body: bytes, contentType: 'application/pdf' });
}

for (const theme of ['light', 'dark', 'classic'] as const) {
  test(`scanned letter becomes an independent package and retained signing handoff in ${theme}`, async ({ page, context }, info) => {
    await context.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'scroll' } }));
    }, theme);
    await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill(PREVIOUS_SUBJECT);
    await page.getByRole('textbox', { name: 'Paragraph 1', exact: true }).fill(PREVIOUS_BODY);
    const scan = await imageOnlyLetter(page), ocrRequests: string[] = [];
    context.on('request', request => { if (new URL(request.url()).pathname.includes('/lib/ocr/')) ocrRequests.push(request.url()); });

    await test.step('Recognize an image-only PDF and review its corrected template text', async () => {
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Import letter…', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Import a letter', exact: true });
      await dialog.getByRole('button', { name: 'Scan or photo', exact: true }).click();
      await dialog.getByLabel('Scanned PDF or image', { exact: true }).setInputFiles({ name: 'scanned-training-letter.pdf', mimeType: 'application/pdf', buffer: scan });
      const corrected = dialog.getByRole('textbox', { name: 'Corrected text for page 1', exact: true });
      await expect(corrected).toBeVisible({ timeout: 90_000 });
      expect(await corrected.inputValue()).toContain('SCANNED TRAINING ACTION');
      expect(await corrected.inputValue()).toContain('ORIGINAL MARINE');
      expect(ocrRequests.some(url => url.includes('worker.min.js'))).toBe(true);
      expect(ocrRequests.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
      await expect(dialog.getByRole('button', { name: 'Review recognized letter', exact: true })).toBeDisabled();
      await corrected.fill(lines.join('\n').replaceAll('ORIGINAL MARINE', '{{NAME}}').replace('SCANNED TRAINING ACTION', IMPORTED_SUBJECT));
      await dialog.getByRole('checkbox', { name: 'I checked the recognized text against this page.', exact: true }).check();
      await dialog.getByRole('button', { name: 'Review recognized letter', exact: true }).click();
      await expect(dialog.getByText(IMPORTED_SUBJECT, { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Import into editor', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(IMPORTED_SUBJECT);
      await page.locator('#unitLine1').fill('FICTIONAL TRAINING UNIT');
      await expect.poll(async () => (await snapshot(page)).documents.map(document => document.session.formData.subject))
        .toEqual(expect.arrayContaining([PREVIOUS_SUBJECT, IMPORTED_SUBJECT]));
      await expect.poll(async () => (await snapshot(page)).documents.find(document => document.session.formData.subject === IMPORTED_SUBJECT)?.session.formData.unitLine1)
        .toBe('FICTIONAL TRAINING UNIT');
      await attachPdf(info, 'image-only-source.pdf', scan);
    });

    const importedState = await snapshot(page), importedDraft = importedState.documents.find(document => document.session.formData.subject === IMPORTED_SUBJECT)!;
    const previousDraft = importedState.documents.find(document => document.session.formData.subject === PREVIOUS_SUBJECT)!;
    expect(importedDraft.id).not.toBe(previousDraft.id);expect(previousDraft.session.paragraphs[0].text).toBe(PREVIOUS_BODY);
    let sourcePackage: ActionPackage, freshPackage: ActionPackage, template: PackageTemplate, assembled: Buffer;

    await test.step('Retain a reusable source package and instantiate a fresh action', async () => {
      let dialog = await openPackages(page);
      await dialog.getByLabel('Package name', { exact: true }).fill(SOURCE_PACKAGE);
      await dialog.getByRole('button', { name: 'Create package', exact: true }).click();
      await capturePackageDocument(dialog);
      await expect(dialog.getByRole('heading', { name: `1. ${IMPORTED_SUBJECT}`, exact: true })).toBeVisible();
      sourcePackage = (await snapshot(page)).packages.find(record => record.name === SOURCE_PACKAGE)!;
      await dialog.locator('summary').filter({ hasText: 'Reusable package templates' }).click();
      let panel = dialog.getByRole('region', { name: 'Reusable package templates', exact: true });
      await panel.getByLabel('Template name', { exact: true }).fill(TEMPLATE);
      await panel.getByRole('checkbox', { name: /I reviewed the source starter text/ }).check();
      await panel.getByRole('button', { name: 'Save package template', exact: true }).click();
      await expect(panel.getByText('Package template saved.', { exact: true })).toBeVisible();
      template = (await snapshot(page)).templates.find(record => record.name === TEMPLATE)!;
      await page.reload();dialog = await openPackages(page);
      await dialog.locator('summary').filter({ hasText: 'Reusable package templates' }).click();
      panel = dialog.getByRole('region', { name: 'Reusable package templates', exact: true });
      await panel.getByLabel('Saved package templates', { exact: true }).selectOption({ label: TEMPLATE });
      await panel.getByLabel('New action name', { exact: true }).fill(FRESH_PACKAGE);
      await panel.getByLabel('Template value NAME', { exact: true }).fill('NEW MARINE');
      await panel.getByRole('checkbox', { name: /I reviewed the retained starter contents/ }).check();
      await panel.getByRole('button', { name: 'Create package from template', exact: true }).click();
      await expect(dialog.getByLabel('Package name', { exact: true })).toHaveValue(FRESH_PACKAGE);
      await expect(dialog.getByRole('heading', { name: '1. ACTION FOR NEW MARINE', exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();
      await expect(dialog.getByRole('heading', { name: 'Package readiness: ready', exact: true })).toBeVisible();
      await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
      await dialog.getByRole('button', { name: 'Assemble and retain PDF', exact: true }).click();
      await expect(dialog.getByText(/^Assembled PDF retained\./)).toBeVisible({ timeout: 90_000 });
      assembled = await retainedPackagePdf(page, dialog);
      const deliveredText = await textFromPdf(assembled);
      expect(deliveredText).toContain('NEW MARINE');expect(deliveredText).not.toContain('{{NAME}}');
      expect((await PDFDocument.load(assembled)).getForm().getFields()).toHaveLength(0);
      freshPackage = (await snapshot(page)).packages.find(record => record.name === FRESH_PACKAGE)!;
      expect(freshPackage.id).not.toBe(sourcePackage.id);
      const fresh = freshPackage.revisions.at(-1)!.members[0] as NativePackageMember;
      const original = sourcePackage.revisions.at(-1)!.members[0] as NativePackageMember;
      expect(fresh.source).toBeUndefined();expect(fresh.session.formData.signatureType ?? 'none').toBe('none');
      expect(fresh.session.paragraphs[0].id).not.toBe(original.session.paragraphs[0].id);
      expect(fresh.session.paragraphs[0].text).toContain('NEW MARINE');expect(original.session.paragraphs[0].text).toContain('{{NAME}}');
      expect(freshPackage.revisions.at(-1)!.outputs.at(-1)!.asset.sha256).toBe(createHash('sha256').update(assembled).digest('hex'));
      await attachPdf(info, 'fresh-assembled-package.pdf', assembled);
      await page.screenshot({ path: info.outputPath('fresh-package.png'), fullPage: true });
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    });

    let returned: Buffer, handoff: Buffer;
    await test.step('Sign a retained PDF through an explicit unverified return association', async () => {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Signing workspace', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Signing workspace', exact: true });
      await dialog.getByLabel('Unsigned PDF for signing').setInputFiles({ name: 'fresh-training-package.pdf', mimeType: 'application/pdf', buffer: assembled! });
      await expect(dialog.getByText('Exact source PDF saved. Add the fields you need.')).toBeVisible();
      await dialog.getByRole('button', { name: 'Add signature box', exact: true }).click();
      await dialog.getByLabel('Signer name', { exact: true }).fill('A. EXAMPLE');
      await dialog.getByLabel('Left (%)', { exact: true }).fill('50');await dialog.getByLabel('Top (%)', { exact: true }).fill('32');
      await dialog.getByLabel('Height (%)', { exact: true }).fill('5');
      await dialog.getByRole('checkbox', { name: /^I reviewed every page,/ }).check();
      await dialog.getByRole('button', { name: 'Save exact signing handoff', exact: true }).click();
      await expect(dialog.getByText('Exact signing handoff saved. Download it when you are ready to share.')).toBeVisible();
      const zip = await JSZip.loadAsync(await download(page, () => dialog.getByRole('button', { name: 'Download handoff 1', exact: true }).click()));
      handoff = await zip.file('ready-to-sign.pdf')!.async('nodebuffer');
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
      expect(manifest.sourceSha256).toBe(createHash('sha256').update(assembled!).digest('hex'));
      expect(manifest.pdfSha256).toBe(createHash('sha256').update(handoff).digest('hex'));
      expect(manifest.fields[0].signer).toBe('A. EXAMPLE');
      const synthetic = await PDFDocument.load(handoff);
      expect(synthetic.getForm().getFields()).toHaveLength(1);
      expect(synthetic.getForm().getFields()[0]).toBeInstanceOf(PDFSignature);
      // Deliberately synthetic /V dictionary: this workflow must never imply certificate validity.
      synthetic.getForm().getFields()[0].acroField.dict.set(PDFName.of('V'), synthetic.context.obj({ Type: 'Sig', ByteRange: [0, 0, 0, 0] }));
      returned = Buffer.from(await synthetic.save());
      await dialog.getByLabel('Returned PDF', { exact: true }).setInputFiles({ name: 'synthetic-return.pdf', mimeType: 'application/pdf', buffer: returned });
      await expect(dialog.getByRole('status').filter({ hasText: 'Page geometry, content streams, page resources and the handoff marker agree.' })).toBeVisible();
      await dialog.getByRole('button', { name: 'View exact handoff', exact: true }).click();
      await expect(dialog.getByLabel('Exact handoff PDF', { exact: true }).locator('canvas').first()).toBeVisible();
      await dialog.getByRole('button', { name: 'View returned file', exact: true }).click();
      await expect(dialog.getByLabel('Candidate returned PDF', { exact: true }).locator('canvas').first()).toBeVisible();
      await dialog.getByRole('checkbox', { name: /^I compared every page/ }).check();
      await dialog.getByRole('button', { name: 'Associate returned PDF', exact: true }).click();
      await expect(dialog.getByText('Return 1: synthetic-return.pdf · associated, signer authenticity unverified', { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Preview saved return 1', exact: true }).click();
      await dialog.getByRole('checkbox', { name: /^I reviewed this retained returned PDF/ }).check();
      expect(await signingPdfDownload(page, info.project.name, () => dialog.getByRole('button', { name: 'Download unchanged returned PDF', exact: true }).click())).toEqual(returned);
      await attachPdf(info, 'exact-signing-handoff.pdf', handoff);await attachPdf(info, 'synthetic-unverified-return.pdf', returned);
      await page.screenshot({ path: info.outputPath('unverified-return.png'), fullPage: true });
    });

    await test.step('Reopen the browser and verify original drafts, template, package and exact returned bytes', async () => {
      await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(IMPORTED_SUBJECT);
      const retained = await snapshot(page);
      expect(documentContents(retained.documents.find(document => document.id === previousDraft.id)!)).toEqual(documentContents(previousDraft));
      expect(documentContents(retained.documents.find(document => document.id === importedDraft.id)!)).toEqual(documentContents(importedDraft));
      expect(retained.packages.find(record => record.id === sourcePackage!.id)).toEqual(sourcePackage!);
      expect(retained.packages.find(record => record.id === freshPackage!.id)).toEqual(freshPackage!);
      expect(retained.templates.find(record => record.id === template!.id)).toEqual(template!);
      expect(retained.signing).toHaveLength(1);
      const signing = retained.signing[0];
      expect(Buffer.from(signing.source.data, 'base64')).toEqual(assembled!);
      expect(Buffer.from(signing.handoffs![0].pdf.data, 'base64')).toEqual(handoff!);
      expect(Buffer.from(signing.returns![0].pdf.data, 'base64')).toEqual(returned!);
      expect(signing.returns![0].status).toBe('associated-unverified');
      const dialog = await openPackages(page);
      await dialog.getByLabel('Saved packages', { exact: true }).selectOption({ label: FRESH_PACKAGE });
      expect(await retainedPackagePdf(page, dialog)).toEqual(assembled!);
      await writeFile(info.outputPath('retention-evidence.json'), JSON.stringify({ theme, project: info.project.name,
        previousDocumentId: previousDraft.id, importedDocumentId: importedDraft.id, sourcePackageId: sourcePackage!.id,
        freshPackageId: freshPackage!.id, templateId: template!.id, assembledSha256: createHash('sha256').update(assembled!).digest('hex'),
        handoffSha256: signing.handoffs![0].pdf.sha256, returnedSha256: signing.returns![0].pdf.sha256, returnStatus: signing.returns![0].status,
        ocrAssets: ocrRequests }, null, 2));
    });
  });
}
