import { openPackagePreparation, newPackage, importPackage, packageSection, expandPackageTools, packageVersion, preparePackageExport, packageTool, packageHeading, downloadPackageExport, openPackageWorkspace, choosePackageById } from './_helpers/packageWorkspace';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
async function openPackages(page: Page) {
  return openPackagePreparation(page);
}
async function download(page: Page, action: () => Promise<void>) {
  const pending = page.waitForEvent('download', { timeout: 90_000 }); await action(); const file = await pending;
  expect(await file.failure()).toBeNull(); return readFile((await file.path())!);
}
async function exportPackage(page: Page, dialog: Locator) {
  return downloadPackageExport(page, dialog, 'Export editable package', 'Download editable package');
}
async function createRequest(dialog: Locator, person: string, subject: string, signature: string) {
  await newPackage(dialog);
  await expandPackageTools(dialog);
  const quick = dialog.locator('summary').filter({ hasText: /^Start with a reviewed worksheet/ });
  if (!await dialog.getByRole('region', { name: 'Administrative request starter', exact: true }).isVisible()) await quick.click();
  const starter = await packageTool(dialog, 'Administrative request starter');
  await starter.getByRole('button', { name: 'Start an administrative request', exact: true }).click();
  const values = { Requester: person, Organization: 'Fictional Training Unit', Recipient: 'Training Officer', 'Request subject': subject,
    'Request date': '2026-11-17', SSIC: '1500', 'Printed signature name': signature, 'Requested action and justification': `Request training for ${person}. The activity supports assigned duties.` };
  for (const [label, value] of Object.entries(values)) {
    const field = starter.getByLabel(label, { exact: label !== 'Printed signature name' });
    await expect(field).toHaveValue(''); await field.fill(value);
  }
  await starter.getByRole('button', { name: 'Review request starter', exact: true }).click();
  await starter.getByRole('checkbox', { name: /^I reviewed these request details/ }).check();
  await starter.getByRole('button', { name: 'Create reviewed request package', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: `Request: ${subject}`, exact: true, level: 1 })).toBeVisible();
  await expect((await packageHeading(dialog, '2. DonDocs request details worksheet'))).toBeVisible();
}
async function applySubject(dialog: Locator, subject: string, overrideLink?: string) {
  const information = await packageTool(dialog, /^(Details|Package information)$/);
  await information.getByLabel('Value 4', { exact: true }).fill(subject);
  if (overrideLink) await information.getByLabel(`Link decision ${overrideLink}`, { exact: true }).selectOption('keep-local');
  await information.getByRole('button', { name: /^(Review changes|Preview package changes)$/ }).click();
  await expect(information.getByRole('button', { name: 'Apply package changes', exact: true })).toBeVisible(); if (await information.getByRole('checkbox', { name: /^I reviewed the package values, linked field changes/ }).isVisible()) await information.getByRole('checkbox', { name: /^I reviewed the package values, linked field changes/ }).check();
  await information.getByRole('button', { name: 'Apply package changes', exact: true }).click();
  await expect(information.getByLabel('Value 4', { exact: true })).toHaveValue(subject);
  await expect(information.getByRole('button', { name: 'Undo package changes', exact: true })).toBeVisible();
}
async function pdfText(bytes: Buffer) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) pages.push((await (await pdf.getPage(index)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '));
    return pages;
  } finally { await pdf.destroy(); }
}

for (const theme of ['light', 'dark', 'classic']) test(`administrative request links, exceptions, history and fresh transfer work in ${theme}`, async ({ page, context, browser, baseURL }, info) => {
  await context.addInitScript(value => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
  }, theme);
  await page.goto('/');
  let dialog = await openPackages(page);
  await createRequest(dialog, 'Alex Example', 'Attend training', 'A. EXAMPLE');
  const initialBytes = await exportPackage(page, dialog), initial = JSON.parse(initialBytes.toString());
  const initialRevision = initial.package.revisions[0];
  expect(initialRevision.bindings.items).toHaveLength(12);
  const letterSubject = initialRevision.bindings.items.find((link: { target: { kind: string; field: string } }) => link.target.kind === 'correspondence' && link.target.field === 'subject');
  await applySubject(dialog, 'Revised training request', letterSubject.id);
  await applySubject(dialog, 'Final training request');
  const updatedBytes = await exportPackage(page, dialog), updated = JSON.parse(updatedBytes.toString());
  const updatedRevision = updated.package.revisions[0];
  expect(updatedRevision.members[0].session.formData.subject).toBe('ATTEND TRAINING');
  expect(updatedRevision.members[1].session.genericForm.answers.subject).toBe('Final training request');
  expect(updatedRevision.bindings.items.find((link: { id: string }) => link.id === letterSubject.id).mode).toBe('override');
  await packageVersion(dialog, initialRevision.id);
  await expect(dialog.getByRole('region', { name: /^(Details|Package information)$/ }).getByLabel('Value 4', { exact: true })).toHaveValue('Attend training');
  await expect(dialog.getByRole('button', { name: 'Apply package changes', exact: true })).toHaveCount(0);
  await packageVersion(dialog, updatedRevision.id);
  await page.reload(); dialog = await openPackageWorkspace(page);
  await choosePackageById(dialog, initial.package.id);
  await expect(dialog).toHaveAttribute('data-package-id', initial.package.id);
  await expect(dialog.getByRole('region', { name: /^(Details|Package information)$/ }).getByLabel('Value 4', { exact: true })).toHaveValue('Final training request');
  await createRequest(dialog, 'Blair Sample', 'Second training action', 'B. SAMPLE');
  const secondBytes = await exportPackage(page, dialog), second = JSON.parse(secondBytes.toString());
  expect(second.package.id).not.toBe(initial.package.id);
  expect(second.package.revisions).toHaveLength(1);
  expect(JSON.stringify(second.package)).not.toContain('Alex Example');
  expect(JSON.stringify(second.package)).not.toContain('A. EXAMPLE');
  const oldFactIds = new Set(initialRevision.information.facts.map((fact: { id: string }) => fact.id));
  expect(second.package.revisions[0].information.facts.some((fact: { id: string }) => oldFactIds.has(fact.id))).toBe(false);
  await preparePackageExport(dialog, 'pdf');
  await expect(dialog.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  if (await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).isVisible()) await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
  await dialog.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await expect(dialog.getByText(/^PDF downloaded\./)).toBeVisible({ timeout: 60_000 });
  await preparePackageExport(dialog, 'saved');
  if (await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).isVisible()) await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
  const output = await download(page, () => dialog.getByRole('button', { name: 'Download reviewed retained PDF', exact: true }).click());
  const pages = await pdfText(output);
  await writeFile(info.outputPath('administrative-request-text.json'), JSON.stringify(pages, null, 2));
  expect(pages).toHaveLength(2); expect(pages[0]).toContain('SECOND TRAINING ACTION');
  expect(pages[0]).toContain('B. SAMPLE'); expect(pages[1]).toContain('DonDocs request details worksheet');
  expect(pages[1]).toContain('Blair Sample'); expect(pages.join(' ')).not.toContain('Alex Example');
  await writeFile(info.outputPath('administrative-request.pdf'), output);
  const receiver = await browser.newContext({ viewport: page.viewportSize()!, serviceWorkers: 'block' });
  try {
    await receiver.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    const receivedPage = await receiver.newPage(); await receivedPage.goto(baseURL!);
    const receivedDialog = await openPackages(receivedPage);
    await importPackage(receivedDialog, { name: 'request-package.json', mimeType: 'application/json', buffer: updatedBytes });
  await packageSection(receivedDialog, 'Overview', true);
    await expect(receivedDialog).toHaveAttribute('data-package-id', initial.package.id);
    await expect(receivedDialog.getByRole('region', { name: /^(Details|Package information)$/ }).getByLabel('Value 4', { exact: true })).toHaveValue('Final training request');
    await expect(receivedDialog).toHaveAttribute('aria-busy', 'false');
    const transferred = JSON.parse((await exportPackage(receivedPage, receivedDialog)).toString());
    expect(transferred.package.revisions[0].information).toEqual(updatedRevision.information);
    expect(transferred.package.revisions[0].bindings).toEqual(updatedRevision.bindings);
  } finally { await receiver.close(); }
  await dialog.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath(`administrative-request-${theme}.png`) });
});
