import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
async function openPackages(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true })
    .or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole('dialog', { name: 'Action packages', exact: true });
}
async function download(page: Page, action: () => Promise<void>) {
  const pending = page.waitForEvent('download'); await action(); const file = await pending;
  expect(await file.failure()).toBeNull(); return readFile((await file.path())!);
}
async function exportPackage(page: Page, dialog: Locator) {
  const prepare = dialog.getByRole('button', { name: 'Export editable package', exact: true });
  await expect(prepare).toBeEnabled(); await prepare.click();
  await expect(dialog).toHaveAttribute('aria-busy', 'false');
  const deliver = dialog.getByRole('button', { name: 'Download reviewed editable package', exact: true });
  await expect(deliver).toBeVisible(); await expect(deliver).toBeDisabled();
  const acknowledgement = dialog.getByRole('checkbox', { name: /^I reviewed every included member/ });
  await expect(acknowledgement).not.toBeChecked();
  await acknowledgement.scrollIntoViewIfNeeded(); await expect(acknowledgement).toBeInViewport();
  await acknowledgement.check(); await expect(acknowledgement).toBeChecked();
  await expect(deliver).toBeEnabled();
  return download(page, () => deliver.click());
}
async function createRequest(dialog: Locator, person: string, subject: string, signature: string) {
  const quick = dialog.locator('summary').filter({ hasText: /^Quick request starter/ });
  if (!await dialog.getByRole('region', { name: 'Administrative request starter', exact: true }).isVisible()) await quick.click();
  const starter = dialog.getByRole('region', { name: 'Administrative request starter', exact: true });
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
  await expect(dialog.getByLabel('Package name', { exact: true })).toHaveValue(`Request: ${subject}`);
  await expect(dialog.getByRole('heading', { name: '2. DonDocs request details worksheet', exact: true })).toBeVisible();
}
async function applySubject(dialog: Locator, subject: string, overrideLink?: string) {
  const information = dialog.getByRole('region', { name: 'Package information', exact: true });
  await information.getByLabel('Value 4', { exact: true }).fill(subject);
  if (overrideLink) await information.getByLabel(`Link decision ${overrideLink}`, { exact: true }).selectOption('keep-local');
  await information.getByRole('button', { name: 'Preview package changes', exact: true }).click();
  await information.getByRole('checkbox', { name: /^I reviewed the package values, linked field changes/ }).check();
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
  await dialog.getByLabel('Package revision', { exact: true }).selectOption(initialRevision.id);
  await expect(dialog.getByRole('region', { name: 'Package information', exact: true }).getByLabel('Value 4', { exact: true })).toHaveValue('Attend training');
  await expect(dialog.getByRole('button', { name: 'Apply package changes', exact: true })).toHaveCount(0);
  await dialog.getByLabel('Package revision', { exact: true }).selectOption(updatedRevision.id);
  await page.reload(); dialog = await openPackages(page);
  await expect(dialog.getByLabel('Saved packages', { exact: true })).toHaveValue(initial.package.id);
  await expect(dialog.getByRole('region', { name: 'Package information', exact: true }).getByLabel('Value 4', { exact: true })).toHaveValue('Final training request');
  await createRequest(dialog, 'Blair Sample', 'Second training action', 'B. SAMPLE');
  const secondBytes = await exportPackage(page, dialog), second = JSON.parse(secondBytes.toString());
  expect(second.package.id).not.toBe(initial.package.id);
  expect(second.package.revisions).toHaveLength(1);
  expect(JSON.stringify(second.package)).not.toContain('Alex Example');
  expect(JSON.stringify(second.package)).not.toContain('A. EXAMPLE');
  const oldFactIds = new Set(initialRevision.information.facts.map((fact: { id: string }) => fact.id));
  expect(second.package.revisions[0].information.facts.some((fact: { id: string }) => oldFactIds.has(fact.id))).toBe(false);
  await dialog.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Package readiness: ready', exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
  await dialog.getByRole('button', { name: 'Assemble and retain PDF', exact: true }).click();
  await expect(dialog.getByText(/^Assembled PDF retained\./)).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Download retained PDF', exact: true }).click();
  await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
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
    await receivedDialog.getByLabel('Import editable package', { exact: true }).setInputFiles({ name: 'request-package.json', mimeType: 'application/json', buffer: updatedBytes });
    await expect(receivedDialog.getByLabel('Saved packages', { exact: true })).toHaveValue(initial.package.id);
    await expect(receivedDialog.getByRole('region', { name: 'Package information', exact: true }).getByLabel('Value 4', { exact: true })).toHaveValue('Final training request');
    await expect(receivedDialog).toHaveAttribute('aria-busy', 'false');
    const transferred = JSON.parse((await exportPackage(receivedPage, receivedDialog)).toString());
    expect(transferred.package.revisions[0].information).toEqual(updatedRevision.information);
    expect(transferred.package.revisions[0].bindings).toEqual(updatedRevision.bindings);
  } finally { await receiver.close(); }
  await dialog.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath(`administrative-request-${theme}.png`) });
});
