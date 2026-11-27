import JSZip from 'jszip';
import type { PackageDeliveryManifest } from '@/lib/packageDeliveryBundle';
import { receiveSignedAppealForms, sha256 } from './_helpers/njpSignedForms';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { expect, test, type Locator } from '@playwright/test';
import type { PackageRevision } from '@/lib/actionPackages';
import { choosePackage, downloadPackageExport, expandPackageTools, importPackage, newPackage, openPackageWorkspace, packageHeading, packageSection, packageTool } from './_helpers/packageWorkspace';

test.use({ serviceWorkers: 'block' });
async function openGuides(region: Locator) {
  await expect(region).toBeVisible({ timeout: 20_000 });
  const collapsed = region.locator('details:not([open]) > summary');
  if (await collapsed.count()) await collapsed.click();
}

test('starts an NJP action and edits its catalog forms inside the saved package', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  await expandPackageTools(workspace);
  const intake = workspace.getByRole('region', { name: 'Action intake' });
  await intake.getByRole('button', { name: 'Start NJP' }).click();
  const blanks = workspace.getByRole('region', { name: 'Blank forms and guides' });
  await openGuides(blanks);
  await expect(blanks.getByRole('button')).toHaveCount(7, { timeout: 20_000 });
  await expect(workspace.getByRole('heading', { name: '1. Unit Punishment Book' })).toBeVisible();
  await page.route('**/templates/**', route => route.abort());
  await page.reload();
  await openPackageWorkspace(page);
  await choosePackage(workspace, 'Nonjudicial punishment (NJP)');
  await packageSection(workspace, 'Documents');
  await openGuides(blanks);
  const files = [
    ['JAGMAN A-1-d - Rights notice and election.pdf', 'jagman/a-1-d/5800.7G-CH2/original.pdf'],
    ['JAGMAN A-1-f - Proceedings guide.pdf', 'jagman/a-1-f/5800.7G-CH2/original.pdf'],
    ['JAGMAN A-1-g - Appeal rights.pdf', 'jagman/a-1-g/5800.7G-CH2/original.pdf'],
    ['JAGMAN A-1-e - Education assistance reimbursement notice.pdf', 'jagman/a-1-e/5800.7G-CH2/original.pdf'],
    ['JAGMAN A-1-o - Suspect rights acknowledgment and statement.pdf', 'jagman/a-1-o/5800.7G-CH2/original.pdf'],
    ['JAGMAN A-1-h - Sample punitive letter of reprimand.pdf', 'jagman/a-1-h/5800.7G-CH2/original.pdf'],
    ['NAVMC 10274 - Administrative Action.pdf', 'NAVMC10274 - Administrative Action/2020-07/original.pdf'],
  ];
  for (const [name, file] of files) {
    await blanks.getByRole('button', { name, exact: true }).click();
    const reader = page.getByRole('dialog', { name, exact: true });
    const pending = page.waitForEvent('download');
    await reader.getByRole('button', { name: 'Download original' }).click();
    const download = await pending;
    await page.keyboard.press('Escape');
    expect(download.suggestedFilename()).toBe(name);
    expect(await readFile((await download.path())!)).toEqual(await readFile('public/templates/' + file));
  }
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).first().click();
  const initial = page.getByRole('dialog', { name: 'Nonjudicial punishment (NJP)', exact: true });
  await initial.getByLabel('18 Accused full name', { exact: true }).fill('RIVERA EXAMPLE');
  const switchForm = initial.getByRole('combobox', { name: 'Package document' });
  await switchForm.selectOption({ label: '2. Rights notice and election' });
  await initial.getByLabel('Marine name', { exact: false }).first().fill('RIVERA EXAMPLE');
  await initial.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(initial.getByText('Saved to package', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(initial.getByLabel('Marine name', { exact: false }).first()).toHaveValue('RIVERA EXAMPLE');
  await initial.getByRole('button', { name: 'Back to package' }).click();
  await packageSection(workspace, 'Overview');
  await intake.getByLabel('Package name', { exact: true }).fill('NJP training');
  await intake.getByLabel('Case reference', { exact: true }).fill('TRAINING-01');
  await intake.getByLabel('Unit', { exact: true }).fill('Training unit');
  await intake.getByLabel('Allegation summary', { exact: true }).fill('Synthetic case for package testing');
  await intake.getByLabel('Case stage').selectOption('preparing');
  await expect(intake.getByLabel('Is there an applicable Page 11 entry?')).toBeHidden();
  await intake.getByLabel('Case stage').selectOption('punishment-imposed');
  await intake.getByLabel('Is there an applicable Page 11 entry?').selectOption('true');
  const appealStatus = intake.getByLabel('Appeal status', { exact: true });
  for (const status of ['pending', 'closed']) {
    await appealStatus.selectOption(status);
    await expect(intake.getByLabel('Has the appeal authority issued its decision?')).toBeHidden();
  }
  await appealStatus.selectOption('filed');
  const grade = intake.getByLabel('Marine grade', { exact: true });
  const gradeQuestion = intake.getByLabel('Is the appeal for a corporal or below?');
  await expect(gradeQuestion).toBeVisible();
  await grade.fill('Sgt/E5');
  await expect(gradeQuestion).toBeHidden();
  await expect(intake.getByLabel('PDF for Record of Service', { exact: true })).toBeHidden();
  await grade.fill('Cpl/E4');
  await expect(gradeQuestion).toBeHidden();
  await expect(intake.getByLabel('PDF for Record of Service', { exact: true })).toBeVisible();
  await intake.getByLabel('Has the appeal authority issued its decision?').selectOption('false');
  const decision = intake.getByLabel('PDF for Signed appeal decision correspondence to the Marine', { exact: true });
  await expect(decision).toBeHidden();
  await intake.getByLabel('Has the appeal authority issued its decision?').selectOption('true');
  await intake.getByLabel('Appeal decision', { exact: true }).selectOption('original');
  await expect(decision).toBeVisible();
  const response = await PDFDocument.create();
  response.addPage().drawText('Synthetic appeal response for package testing');
  await decision.setInputFiles({ name: 'training-response.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await response.save()) });
  await expect(intake.getByRole('button', { name: 'Remove selected PDF for Signed appeal decision correspondence to the Marine', exact: true })).toBeVisible();
  for (const label of [ 'Are there suspension or vacation documents?', 'Is a finance or IPAC handoff needed?',
    'Does the command require a separate administrative action?', 'Does DD Form 2701 issuance need tracking?']) {
    const field = intake.getByLabel(label, { exact: true });
    if (!(await field.isVisible())) await intake.getByRole('button', { name: 'Next questions' }).click();
    await field.selectOption(label === 'Does the command require a separate administrative action?' ? 'true' : 'false');
  }
  const exhibits = new Map<string, { slot: string; bytes: Buffer }>();
  for (const [slot, label, names] of [
    ['additional-endorsements', 'Subsequent forwarding endorsements (newest first)', ['third-endorsement.pdf', 'second-endorsement.pdf']],
    ['record-of-service', 'Record of Service', ['service-record.pdf']],
    ['allied-papers', 'Supporting evidence and allied papers', ['roster.pdf', 'statement.pdf']],
    ['existing-page-11', 'Additional Page 11 entries for the appeal', ['first-entry.pdf', 'second-entry.pdf']],
  ] as const) {
    const input = intake.getByLabel('PDF for ' + label, { exact: true });
    for (const name of names) {
      const pdf = await PDFDocument.create();
      pdf.addPage().drawText(name);
      const bytes = Buffer.from(await pdf.save());
      exhibits.set(name, { slot, bytes });
      await input.setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
      const remove = name === names[0] ? 'Remove selected PDF for ' + label : 'Remove ' + name;
      await expect(intake.getByRole('button', { name: remove, exact: true })).toBeVisible();
    }
  }
  await intake.getByRole('button', { name: 'Review changes' }).click();
  const preview = intake.getByRole('region', { name: 'Action changes preview' });
  await expect(preview).toContainText('Rights notice and election', { timeout: 30_000 });
  await preview.getByRole('button', { name: 'Apply changes' }).click();
  await expect(intake.getByText('Changes saved as a new version.', { exact: true })).toBeVisible({ timeout: 30_000 });
  await packageSection(workspace, 'Documents');
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: 'NJP training' });
  const picker = editor.getByRole('combobox', { name: 'Package document', exact: true });
  await picker.selectOption({ label: '1. Unit Punishment Book' });
  await expect(editor.getByLabel('18 Accused full name', { exact: true })).toHaveValue('RIVERA EXAMPLE');
  await picker.selectOption({ value: await picker.getByRole('option', { name: /^\d+\. Page 11$/ }).getAttribute('value') ?? '' });
  await editor.getByLabel('Last Name', { exact: true }).fill('EXAMPLE');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(editor.getByLabel('Last Name', { exact: true })).toHaveValue('EXAMPLE');
  const adminAction = picker.getByRole('option', { name: /Administrative Action/i });
  await picker.selectOption({ value: (await adminAction.getAttribute('value'))! });
  await editor.locator('#actionNo').fill('NJP-10274');
  await editor.locator('#actionNo').blur();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(editor.locator('#actionNo')).toHaveValue('NJP-10274');
  await picker.selectOption({ label: '1. Unit Punishment Book' });
  await expect(editor.getByLabel('18 Accused full name', { exact: true })).toHaveValue('RIVERA EXAMPLE');
  await editor.getByRole('button', { name: 'Back to package' }).click();
  await packageSection(workspace, 'Overview');
  await intake.getByRole('button', { name: 'Edit details', exact: true }).click();
  await expect(intake.locator('p').filter({ hasText: /training-response\.pdf$/ })).toBeVisible();
  const exported = await downloadPackageExport(page, workspace, 'Export editable package', 'Download editable package');
  const bundle = JSON.parse(exported.toString());
  const revision: PackageRevision = bundle.package.revisions[0];
  const slots = new Map(revision.templateState!.instances.map(instance => [instance.memberId, instance.memberKey]));
  const filingOrder = revision.members.map(member => slots.get(member.id) ?? (member.kind === 'original' && member.evidenceSlotId ? slots.get(member.evidenceSlotId) : undefined));
  expect(filingOrder).toEqual([
    'upb', 'draft-proceedings', 'rights-notice', 'appeal-rights', 'draft-appeal', 'draft-endorsement', 'additional-endorsements', 'additional-endorsements',
    'page-11', 'existing-page-11', 'existing-page-11', 'record-of-service',
    'allied-papers', 'allied-papers', 'appeal-decision', 'admin-action',
  ]);
  for (const [name, { slot, bytes }] of exhibits) {
    const owner = revision.templateState?.instances.find(instance => instance.memberKey === slot)?.memberId;
    expect(owner).toBeTruthy();
    const matches = revision.members.filter(member => member.kind === 'original' && member.original.name === name
      && (member.id === owner || member.evidenceSlotId === owner));
    expect(matches).toHaveLength(1);
    const member = matches[0];
    if (member.kind !== 'original') throw new Error('Expected original ' + name);
    const resource = bundle.portableResources.entries.find((entry: { path: string }) => entry.path === 'assets/' + member.original.id);
    expect(Buffer.from(resource.data, 'base64')).toEqual(bytes);
  }
  await packageSection(workspace, 'Delivery', true);
  await workspace.getByRole('button', { name: 'Receive original files', exact: true }).click();
  const scope = workspace.getByLabel('Delivery scope');
  await scope.selectOption({ label: 'Command file' });
  const order = workspace.getByRole('list', { name: 'Documents in delivery order' }).getByRole('listitem');
  await expect(order.first()).toHaveText('Unit Punishment Book');
  await scope.selectOption({ label: 'Forward appeal' });
  await expect(order.first()).toHaveText('Subsequent forwarding endorsements (newest first)');
  await expect(order.nth(1)).toHaveText('second-endorsement.pdf');
  await expect(order.nth(2)).toHaveText('Forwarding endorsement on NJP appeal');
  await expect(order.nth(3)).toHaveText('Appeal of nonjudicial punishment');
  await expect(order.nth(4)).toHaveText('Unit Punishment Book');
  await expect(order.filter({ hasText: 'Signed appeal decision' })).toHaveCount(0);
});

test('transfers an incomplete NJP to a fresh browser with its working forms and original guides', async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start writing', exact: true }).click();
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  await expandPackageTools(workspace);
  await workspace.getByRole('button', { name: 'Start NJP' }).click();
  await expect(workspace.getByRole('heading', { name: '1. Unit Punishment Book' })).toBeVisible({ timeout: 20_000 });
  const rightsHeading = '2. Rights notice and election';
  await expect(await packageHeading(workspace, rightsHeading)).toBeVisible();
  await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Nonjudicial punishment (NJP)', exact: true });
  await editor.getByLabel('Marine name', { exact: false }).first().fill('TRANSFER EXAMPLE');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible({ timeout: 30_000 });
  await editor.getByRole('button', { name: 'Back to package', exact: true }).click();
  const bytes = await downloadPackageExport(page, workspace, 'Export editable package', 'Download editable package');
  const fresh = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    const restored = await fresh.newPage();
    await restored.goto('/');
    await restored.getByRole('button', { name: 'Start writing', exact: true }).click();
    const copy = await openPackageWorkspace(restored);
    await importPackage(copy, { name: 'training.dondocs-package.json', mimeType: 'application/json', buffer: bytes });
    await packageSection(copy, 'Documents');
    await expect(await packageHeading(copy, rightsHeading)).toBeVisible();
    const guides = copy.getByRole('region', { name: 'Blank forms and guides' });
    await openGuides(guides);
    await expect(guides.getByRole('button')).toHaveCount(7);
    await copy.getByRole('button', { name: 'Edit form', exact: true }).click();
    const restoredEditor = restored.getByRole('dialog', { name: 'Nonjudicial punishment (NJP)', exact: true });
    await expect(restoredEditor.getByLabel('Marine name', { exact: false }).first()).toHaveValue('TRANSFER EXAMPLE');
  } finally { await fresh.close(); }
});

for (const refusedSignature of [false, true]) {
  test('writes the refusal into UPB item 2 with refusal to sign ' + refusedSignature, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await page.getByRole('button', { name: 'Start writing', exact: true }).click();
    const workspace = await openPackageWorkspace(page);
    await newPackage(workspace);
    await workspace.getByRole('button', { name: 'Start NJP', exact: true }).click();
    await packageSection(workspace, 'Overview');
    const intake = workspace.getByRole('region', { name: 'Action intake', exact: true });
    if (await intake.getByRole('button', { name: 'Edit details' }).isVisible())
      await intake.getByRole('button', { name: 'Edit details' }).click();
    for (const [label, value] of Object.entries({
      'Case reference': 'TRAINING-01', 'Marine name (last, first middle)': 'EXAMPLE, TEST',
      'Unit': 'Training unit', 'Allegation summary': 'Fictional review exercise',
    })) await intake.getByLabel(label, { exact: true }).fill(value);
    for (const [label, value] of Object.entries({
      'Case stage': 'refused', 'Did the Marine also refuse to sign the UPB?': String(refusedSignature),
      'Does the command require a separate administrative action?': 'false', 'Does DD Form 2701 issuance need tracking?': 'false',
    })) {
      const input = intake.getByLabel(label, { exact: true });
      if (!await input.isVisible()) await intake.getByRole('button', { name: 'Next questions' }).click();
      await input.selectOption(value);
    }
    await intake.getByRole('button', { name: 'Review changes' }).click();
    await intake.getByRole('button', { name: 'Apply changes' }).click();
    await expect(intake.getByText('Changes saved as a new version.', { exact: true })).toBeVisible();
    await packageSection(workspace, 'Documents');
    await expect(await packageHeading(workspace, '1. Unit Punishment Book')).toBeVisible();
    const layer = workspace.getByRole('region', { name: /Preview of Unit Punishment Book/ }).locator('[data-pdf-layer="active"]');
    await expect(layer.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
    const bytes = await layer.evaluate(async element => Array.from(new Uint8Array(
      await (await fetch(element.getAttribute('data-preview-blob')!)).arrayBuffer())));
    const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
    try {
      const fields = await pdf.getFieldObjects();
      expect(fields?.['2 DEMAND']?.[0]).toMatchObject({ value: 'I demand trial and refuse non-judicial punishment.' });
      expect(fields?.['2 ACC REFUSE TO SIGN']?.[0]).toMatchObject({ value: refusedSignature ? expect.stringMatching(/^(?!Off$).+/) : 'Off' });
    } finally { await pdf.destroy(); }
    if (refusedSignature) {
      await workspace.getByRole('button', { name: 'Sign official form', exact: true }).click();
      const signing = page.getByRole('dialog', { name: 'Signing workspace' });
      const consent = page.getByRole('button', { name: 'Continue to signing', exact: true });
      await expect(consent.or(signing)).toBeVisible();
      if (await consent.isVisible()) await consent.click();
      const location = signing.getByRole('combobox', { name: 'Signature field', exact: true });
      await expect(location).toHaveValue('');
      await location.selectOption({ label: 'CO signs item 2' });
      await expect(location).toHaveValue('2 ACC ELECTION AND RIGHTS SIGNATURE');
      await expect(signing.getByRole('status').filter({ hasText: /complete the Marine.*unit, name, rank\/grade and EDIPI/i })).toBeVisible();
      return;
    }
    await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Nonjudicial punishment (NJP)', exact: true });
    await editor.getByLabel('2 Demand', { exact: true }).selectOption({ label: 'I do not demand trial and will accept non-judicial punishment, subject to my right of appeal.' });
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible({ timeout: 30_000 });
    await editor.getByRole('button', { name: 'Back to package', exact: true }).click();
    await workspace.getByRole('button', { name: 'Sign official form', exact: true }).click();
    await expect(workspace.getByRole('alert').filter({ hasText: /select refusal of NJP in UPB item 2/i })).toBeVisible();
    await workspace.getByRole('navigation', { name: 'Package documents' }).getByRole('button', { name: /Rights notice and election/ }).click();
    await workspace.getByRole('button', { name: 'Edit form', exact: true }).click();
    await editor.getByLabel('NJP election', { exact: false }).selectOption('accept');
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(editor.getByText('Saved to package', { exact: true })).toBeVisible({ timeout: 30_000 });
    await editor.getByRole('button', { name: 'Back to package', exact: true }).click();
    await workspace.getByRole('button', { name: 'Sign official form', exact: true }).click();
    await expect(workspace.getByRole('alert').filter({ hasText: /review the NJP election on JAGMAN A-1-d/i })).toBeVisible();
  });
}

test('downloads the Forward appeal ZIP in filing order with the exact signed UPB', async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
  await page.goto('/');
  const workspace = await openPackageWorkspace(page);
  await newPackage(workspace);
  await workspace.getByRole('button', { name: 'Start NJP', exact: true }).click();
  await packageSection(workspace, 'Overview');
  const intake = workspace.getByRole('region', { name: 'Action intake' });
  if (await intake.getByRole('button', { name: 'Edit details' }).isVisible()) await intake.getByRole('button', { name: 'Edit details' }).click();
  for (const [label, value] of Object.entries({
    'Case reference': 'TRAINING-APPEAL', Unit: 'Training unit', 'Allegation summary': 'Synthetic allegation',
    'Marine name (last, first middle)': 'EXAMPLE, TEST', 'Marine grade': 'Cpl/E4',
  })) await intake.getByLabel(label, { exact: true }).fill(value);
  for (const [label, value] of Object.entries({
    'Case stage': 'punishment-imposed', 'Is there an applicable Page 11 entry?': 'false',
    'Appeal status': 'filed', 'Has the appeal authority issued its decision?': 'true',
    'Are there suspension or vacation documents?': 'false', 'Is a finance or IPAC handoff needed?': 'false',
    'Hearing record': 'original', 'Appeal and forwarding endorsement': 'original', 'Appeal decision': 'original',
    'Does the command require a separate administrative action?': 'false', 'Does DD Form 2701 issuance need tracking?': 'false',
  })) {
    const input = intake.getByLabel(label, { exact: true });
    if (!await input.isVisible()) await intake.getByRole('button', { name: 'Next questions' }).click();
    await input.selectOption(value);
  }
  const evidence = new Map<string, Buffer>();
  for (const label of ['Summary of proceedings', 'Appeal letter and endorsements', 'Record of Service',
    'Supporting evidence and allied papers', 'Signed appeal decision correspondence to the Marine']) {
    const doc = await PDFDocument.create();
    doc.addPage().drawText(label);
    const bytes = Buffer.from(await doc.save());
    evidence.set(label, bytes);
    await intake.getByLabel('PDF for ' + label, { exact: true }).setInputFiles({ name: label + '.pdf', mimeType: 'application/pdf', buffer: bytes });
    await expect(intake.getByRole('button', { name: 'Remove selected PDF for ' + label })).toBeVisible();
  }
  await intake.getByRole('button', { name: 'Review changes' }).click();
  await intake.getByRole('button', { name: 'Apply changes' }).click();
  await expect(intake.getByText('Changes saved as a new version.', { exact: true })).toBeVisible({ timeout: 30_000 });
  const exported = await downloadPackageExport(page, workspace, 'Export editable package', 'Download editable package');
  const recipient = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    const receiver = await recipient.newPage();
    await receiver.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    const { packet, signedForms } = await receiveSignedAppealForms(exported, receiver);
    await receiver.goto('/');
    const dialog = await openPackageWorkspace(receiver);
    await importPackage(dialog, { name: 'appeal.dondocs-package.json', mimeType: 'application/json', buffer: packet });
    await packageSection(dialog, 'Documents');
    const signing = receiver.getByRole('dialog', { name: 'Signing workspace' });
    await receiver.addLocatorHandler(receiver.getByRole('button', { name: /^(Continue to signing|Inspect reviewed PDF)$/ }), b => b.click());
    for (const label of ['Unit Punishment Book', 'Rights notice and election', 'Acknowledgment of appeal rights']) {
      await dialog.getByRole('navigation', { name: 'Package documents' }).getByRole('button', { name: new RegExp(label) }).click();
      await dialog.getByRole('button', { name: 'Open signed form', exact: true }).click();
      await signing.getByRole('button', { name: /^(Connect CAC|Review for signing)$/ }).click();
      await expect(signing.getByText(/Signature status \(/)).toBeVisible({ timeout: 20_000 });
      await receiver.keyboard.press('Escape');
      await expect(signing).toBeHidden();
    }
    const delivery = await packageTool(dialog, 'Recipient delivery');
    await delivery.getByLabel('Delivery scope').selectOption({ label: 'Forward appeal' });
    await delivery.getByRole('button', { name: 'Prepare selected delivery' }).click();
    const contents = delivery.getByRole('region', { name: 'Captured delivery contents' });
    await expect(contents).toBeVisible({ timeout: 30_000 });
    const review = contents.getByRole('checkbox');
    if (await review.count()) await review.check();
    const download = receiver.waitForEvent('download');
    await contents.getByRole('button', { name: 'Download reviewed delivery bundle' }).click();
    const archive = await JSZip.loadAsync(await readFile((await (await download).path())!));
    const manifest: PackageDeliveryManifest = JSON.parse(await archive.file('manifest.json')!.async('text'));
    const order = manifest.members.map(member => member.label);
    expect(order).toEqual(['Appeal letter and endorsements', 'Unit Punishment Book', 'Summary of proceedings',
      'Record of Service', 'Rights notice and election', 'Acknowledgment of appeal rights', 'Supporting evidence and allied papers']);
    const files = manifest.files.filter(file => file.path.startsWith('files/'));
    expect(files).toHaveLength(order.length);
    const expected = new Map(evidence);
    for (const [id, label] of [['navmc10132', 'Unit Punishment Book'], ['jagman_a1d', 'Rights notice and election'],
      ['jagman_a1g', 'Acknowledgment of appeal rights']]) expected.set(label, signedForms.get(id)!);
    const fileHashes = [];
    for (const [index, file] of files.entries()) {
      const bytes = await archive.file(file.path)!.async('nodebuffer');
      expect(file.path).toMatch(new RegExp('^files/' + String(index + 1).padStart(3, '0') + '-'));
      expect(sha256(bytes)).toBe(file.sha256);
      expect(bytes.equals(expected.get(order[index])!)).toBe(true);
      fileHashes.push(file.sha256);
    }
    const excluded = sha256(evidence.get('Signed appeal decision correspondence to the Marine')!);
    expect(fileHashes).not.toContain(excluded);
    const portable = await archive.file(manifest.packagePath)!.async('text');
    expect(portable).not.toContain(excluded);
    expect(Object.keys(archive.files).filter(name => name.startsWith('files/')).sort()).toEqual(files.map(file => file.path));
  } finally { await recipient.close(); }
});
