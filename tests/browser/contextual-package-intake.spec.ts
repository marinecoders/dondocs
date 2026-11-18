import { expect, test, type Page, type Locator, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(240_000);
async function packages(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Documents', exact: true });
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open workspace', exact: true })
    .or(page.getByRole('button', { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole('dialog', { name: 'Action packages', exact: true });
}
const intake = (dialog: Locator) => dialog.getByRole('region', { name: 'Action intake', exact: true });
async function start(dialog: Locator, name: string) {
  const panel = intake(dialog), button = panel.getByRole('button', { name: `Start ${name}`, exact: true });
  const another = panel.locator('summary').filter({ hasText: /^Start another action$/ });
  await expect(button.or(another)).toBeVisible();
  if (!await button.isVisible()) await another.click();
  await button.click();
  await expect(panel.getByRole('button', { name: 'Save intake draft', exact: true })).toBeVisible();
  return panel;
}
async function continueIntake(dialog: Locator) {
  await expect(dialog).toHaveAttribute('aria-busy', 'false');
  const panel = intake(dialog);
  await expect(panel.getByRole('button', { name: 'Continue intake', exact: true }).or(panel.getByRole('button', { name: 'Collapse intake questions', exact: true }))).toBeVisible();
  if (await panel.getByRole('button', { name: 'Continue intake', exact: true }).isVisible()) await panel.getByRole('button', { name: 'Continue intake', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Intake questions', exact: true })).toBeVisible();
  return panel;
}
async function showAnswers(panel: Locator) {
  await expect(panel.getByRole('region', { name: 'Intake questions', exact: true })).toBeVisible();
  if (await panel.getByRole('button', { name: 'Show answered questions', exact: true }).isVisible()) await panel.getByRole('button', { name: 'Show answered questions', exact: true }).click();
}
async function fill(panel: Locator, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) await panel.getByRole('textbox', { name: label, exact: true }).fill(value);
}
async function apply(panel: Locator) {
  await panel.getByRole('button', { name: 'Preview action changes', exact: true }).click();
  await expect(panel).toHaveAttribute('aria-busy', 'false');
  const preview = panel.getByRole('region', { name: 'Action changes preview', exact: true });
  await expect(preview.getByRole('checkbox', { name: /^I reviewed the intake/ }), await panel.locator('xpath=ancestor::*[@role="dialog"]').innerText()).toBeEnabled();
  await preview.getByRole('checkbox', { name: /^I reviewed the intake/ }).check();
  await preview.getByRole('button', { name: 'Apply action changes', exact: true }).click();
  await expect(panel.getByText('Action changes applied as a new saved revision.', { exact: true })).toBeVisible();
}
async function download(page: Page, action: () => Promise<void>) {
  const pending = page.waitForEvent('download'); await action(); const result = await pending;
  expect(await result.failure()).toBeNull(); return readFile((await result.path())!);
}
async function portable(page: Page, dialog: Locator) {
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
  const bytes = await download(page, () => deliver.click());
  return { bytes, data: JSON.parse(bytes.toString()) };
}
async function finishPrintedName(page: Page, dialog: Locator, label: string, lastName: string) {
  const card = dialog.locator('li[id^="package-member-"]').filter({ has: page.getByRole('heading', { name: new RegExp(`^\\d+\\. ${label}$`) }) });
  await card.getByRole('button', { name: 'Edit working copy', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel('Document section', { exact: true }).selectOption('signature');
  await page.getByRole('textbox', { name: 'Last Name', exact: true }).fill(lastName);
  const reopened = await packages(page);
  const revision = reopened.getByRole('combobox', { name: 'Package revision', exact: true });
  const previousRevision = await revision.inputValue();
  await reopened.getByRole('button', { name: 'Save working copy as new revision', exact: true }).click();
  await expect(revision).not.toHaveValue(previousRevision);
  await expect(reopened).toHaveAttribute('aria-busy', 'false');
  return reopened;
}
async function output(page: Page, dialog: Locator, info: TestInfo, name: string) {
  await dialog.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Package readiness: ready', exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
  await dialog.getByRole('button', { name: 'Assemble and retain PDF', exact: true }).click();
  await expect(dialog.getByText(/^Assembled PDF retained\./)).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Download retained PDF', exact: true }).click();
  await dialog.getByRole('checkbox', { name: /^I reviewed every included member/ }).check();
  const bytes = await download(page, () => dialog.getByRole('button', { name: 'Download reviewed retained PDF', exact: true }).click());
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
  const pages: string[] = [];
  try { for (let index = 1; index <= pdf.numPages; index++) pages.push((await (await pdf.getPage(index)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')); }
  finally { await pdf.destroy(); }
  await writeFile(info.outputPath(`${name}.pdf`), bytes);
  await writeFile(info.outputPath(`${name}-text.json`), JSON.stringify(pages, null, 2));
  return pages;
}
async function screenshot(page: Page, dialog: Locator, info: TestInfo, name: string) {
  await intake(dialog).scrollIntoViewIfNeeded();
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
}

for (const theme of ['light', 'dark', 'classic']) test.describe(theme, () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'focused' } }));
    }, theme);
    await page.goto('/');
  });

  test(`administrative intake draft reload, fresh action and portable recovery in ${theme}`, async ({ page, browser, baseURL }, info) => {
    let dialog = await packages(page), panel = await start(dialog, 'administrative request');
    await expect(panel.getByRole('textbox', { name: 'Requester', exact: true })).toBeFocused();
    await fill(panel, { Requester: 'Alex Example' });
    await expect(panel.getByRole('combobox', { name: 'Include a supporting PDF?', exact: true })).toHaveValue('');
    await panel.getByRole('button', { name: 'Save intake draft', exact: true }).click();
    await expect(panel.getByText('Intake saved; document changes not applied.', { exact: true })).toBeVisible();
    const pending = await portable(page, dialog);
    const pendingRevision = pending.data.package.revisions[0];
    expect(pendingRevision.members).toHaveLength(0);
    expect(pendingRevision.templateState.pending).toBe(true);
    expect(pendingRevision.templateState.answers.values).toEqual({ requester: 'Alex Example' });
    const source = pendingRevision.templateState.source;
    expect(pending.data.portableResources.entries.some((entry: { path: string }) => entry.path === `assets/${source.id}`)).toBe(true);
    await page.reload(); dialog = await packages(page); panel = await continueIntake(dialog); await showAnswers(panel);
    await expect(panel.getByRole('textbox', { name: 'Requester', exact: true })).toHaveValue('Alex Example');
    await expect(panel.getByRole('combobox', { name: 'Include a supporting PDF?', exact: true })).toHaveValue('');
    await fill(panel, { Organization: 'Fictional Training Unit', Recipient: 'Training Office', 'Request subject': 'Attend local training', 'Request date': '2026-11-17', SSIC: '01500', 'Requested action and justification': 'Request participation in local training.' });
    await panel.getByRole('combobox', { name: 'Include a supporting PDF?', exact: true }).selectOption('false');
    await apply(panel);
    dialog = await finishPrintedName(page, dialog, 'Request letter', 'EXAMPLE');
    const pages = await output(page, dialog, info, 'administrative-intake');
    expect(pages).toHaveLength(2); expect(pages[0]).toContain('ATTEND LOCAL TRAINING'); expect(pages[0]).toContain('EXAMPLE');
    expect(pages[1]).toContain('Alex Example'); expect(pages[1]).toContain('01500');
    const completed = await portable(page, dialog);
    panel = await start(dialog, 'administrative request');
    await expect(panel.getByRole('textbox', { name: 'Requester', exact: true })).toHaveValue('');
    await fill(panel, { Requester: 'Blair Sample' });
    await panel.getByRole('button', { name: 'Save intake draft', exact: true }).click();
    const next = await portable(page, dialog);
    expect(next.data.package.id).not.toBe(completed.data.package.id);
    expect(JSON.stringify(next.data.package)).not.toContain('Alex Example');
    expect(JSON.stringify(next.data.package)).not.toContain('EXAMPLE');
    const receiver = await browser.newContext({ viewport: page.viewportSize()!, serviceWorkers: 'block' });
    try {
      await receiver.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
      const target = await receiver.newPage(); await target.goto(baseURL!); const received = await packages(target);
      await received.getByLabel('Import editable package', { exact: true }).setInputFiles({ name: 'pending-action.json', mimeType: 'application/json', buffer: pending.bytes });
      const resumed = await continueIntake(received); await showAnswers(resumed);
      await expect(resumed.getByRole('textbox', { name: 'Requester', exact: true })).toHaveValue('Alex Example');
      await expect(resumed.getByRole('combobox', { name: 'Include a supporting PDF?', exact: true })).toHaveValue('');
      const transfer = await portable(target, received);
      expect(transfer.data.package.revisions[0].templateState).toEqual(pendingRevision.templateState);
    } finally { await receiver.close(); }
    await screenshot(page, dialog, info, `admin-${theme}`);
  });

  test(`training intake repeated people, native edits and conditional document decisions in ${theme}`, async ({ page, browser, baseURL }, info) => {
    let dialog = await packages(page), panel = await start(dialog, 'training participation');
    await fill(panel, { 'Course or activity': 'Local leadership workshop', 'Training date': '2026-11-18', 'Activity purpose': 'Practice team coordination.' });
    const owner = 'Participants · person 1 · Participants 1';
    await fill(panel, { [`${owner} · Participant name`]: 'Alex Example', [`${owner} · Local participant reference`]: '0007' });
    await panel.getByRole('combobox', { name: `${owner} · Attendance`, exact: true }).selectOption('in-person');
    await fill(panel, { [`${owner} · In-person location`]: 'Building 7' });
    await panel.getByRole('combobox', { name: `${owner} · Include an estimated cost?`, exact: true }).selectOption('true');
    await fill(panel, { [`${owner} · Estimated amount (USD)`]: '125.50' });
    await panel.getByRole('button', { name: 'Add person to Participants', exact: true }).click();
    const second = 'Participants · person 2 · Participants 2';
    await fill(panel, { [`${second} · Participant name`]: 'Blair Sample', [`${second} · Local participant reference`]: '0008' });
    await panel.getByRole('combobox', { name: `${second} · Attendance`, exact: true }).selectOption('remote');
    await panel.getByRole('combobox', { name: `${second} · Include an estimated cost?`, exact: true }).selectOption('false');
    await apply(panel);
    const initial = await portable(page, dialog), revision = initial.data.package.revisions[0];
    expect(revision.members).toHaveLength(4);
    const people = revision.templateState.answers.groups.participants;
    expect(people[0].id).not.toBe(people[1].id);
    const inPerson = revision.members.find((member: { label: string }) => member.label.startsWith('In-person participation'));
    const card = dialog.locator('li[id^="package-member-"]').filter({ has: page.getByRole('heading', { name: new RegExp(`^\\d+\\. ${inPerson.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
    await card.getByRole('button', { name: 'Edit working copy', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('textbox', { name: 'In-person location', exact: true }).fill('Locally corrected room');
    dialog = await packages(page);
    const savedRevision = dialog.getByRole('combobox', { name: 'Package revision', exact: true });
    const beforeLocalEdit = await savedRevision.inputValue();
    await dialog.getByRole('button', { name: 'Save working copy as new revision', exact: true }).click();
    await expect(savedRevision).not.toHaveValue(beforeLocalEdit);
    panel = await continueIntake(dialog); await showAnswers(panel);
    await panel.getByRole('combobox', { name: `${owner} · Attendance`, exact: true }).selectOption('remote');
    await panel.getByRole('button', { name: 'Preview action changes', exact: true }).click();
    const decision = panel.getByRole('combobox', { name: /^Document decision/ });
    await expect(decision).toHaveCount(1);
    await decision.selectOption('keep');
    await panel.getByRole('button', { name: 'Preview action changes', exact: true }).click();
    await expect(panel).toHaveAttribute('aria-busy', 'false');
    await panel.getByRole('combobox', { name: /^Field decision.*In-person location/ }).selectOption('keep-local');
    await panel.getByRole('combobox', { name: /^Field decision.*In-person participation.*Attendance/ }).selectOption('keep-local');
    await apply(panel);
    panel = await continueIntake(dialog); await showAnswers(panel);
    await panel.getByRole('button', { name: `Move ${second} up`, exact: true }).click();
    await apply(panel);
    const information = dialog.getByRole('region', { name: 'Package information', exact: true });
    const courseIndex = revision.information.facts.findIndex((fact: { label: string }) => fact.label === 'Course or activity');
    await information.getByLabel(`Value ${courseIndex + 1}`, { exact: true }).fill('Updated by the package information editor');
    await information.getByRole('button', { name: 'Preview package changes', exact: true }).click();
    await information.getByRole('checkbox', { name: /^I reviewed the package values, linked field changes/ }).check();
    await information.getByRole('button', { name: 'Apply package changes', exact: true }).click();
    panel = await continueIntake(dialog); await showAnswers(panel);
    await expect(panel.getByRole('textbox', { name: 'Course or activity', exact: true })).toHaveValue('Updated by the package information editor');
    await fill(panel, { 'Activity purpose': 'Revised independently while preserving the newer course value.' });
    await apply(panel);
    const changed = await portable(page, dialog), result = changed.data.package.revisions[0];
    expect(result.templateState.answers.groups.participants.map((person: { id: string }) => person.id)).toEqual([people[1].id, people[0].id]);
    expect(result.members.find((member: { id: string }) => member.id === inPerson.id).session.genericForm.answers.location).toBe('Locally corrected room');
    const activeOwners = new Map(result.templateState.instances.filter((instance: { condition: boolean | string; participantId?: string }) => instance.condition === true && instance.participantId)
      .map((instance: { memberId: string; participantId: string }) => [instance.memberId, instance.participantId]));
    expect(result.members.filter((member: { id: string }) => activeOwners.has(member.id)).map((member: { id: string }) => activeOwners.get(member.id))).toEqual([people[1].id, people[0].id, people[0].id]);
    expect(result.members.findIndex((member: { id: string }) => member.id === inPerson.id)).toBe(revision.members.findIndex((member: { id: string }) => member.id === inPerson.id));
    const blairIndex = result.members.findIndex((member: { kind: string; session?: { genericForm?: { answers: { name?: string } } } }) => member.session?.genericForm?.answers.name === 'Blair Sample');
    expect(result.members[blairIndex].session.genericForm.answers.course).toBe('Updated by the package information editor');
    await page.reload(); dialog = await packages(page);
    const resumed = await portable(page, dialog);
    expect(resumed.data.package.revisions[0].templateState).toEqual(result.templateState);
    const receiver = await browser.newContext({ viewport: page.viewportSize()!, serviceWorkers: 'block' });
    try {
      await receiver.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
      const target = await receiver.newPage(); await target.goto(baseURL!); const received = await packages(target);
      await received.getByLabel('Import editable package', { exact: true }).setInputFiles({ name: 'training-action.json', mimeType: 'application/json', buffer: changed.bytes });
      const transferred = await portable(target, received);
      expect(transferred.data.package.revisions[0].templateState).toEqual(result.templateState);
      expect(transferred.data.package.revisions[0].members.find((member: { id: string }) => member.id === inPerson.id).session.genericForm.answers.location).toBe('Locally corrected room');
    } finally { await receiver.close(); }
    const pages = await output(page, dialog, info, 'training-intake');
    expect(pages).toHaveLength(5); expect(pages[blairIndex]).toContain('Blair Sample');
    expect(pages.join(' ')).toContain('Locally corrected room'); expect(pages.join(' ')).toContain('125.50');
    panel = await continueIntake(dialog); await showAnswers(panel);
    await panel.getByRole('button', { name: 'Remove Participants · person 1 · Participants 2', exact: true }).click();
    await panel.getByRole('button', { name: 'Preview action changes', exact: true }).click();
    const removalDecision = panel.getByRole('combobox', { name: /^Document decision.*Remote participation.*Participants 2/ });
    await expect(removalDecision).toHaveCount(1);
    await removalDecision.selectOption('remove');
    await apply(panel);
    const afterRemoval = (await portable(page, dialog)).data.package.revisions[0];
    expect(afterRemoval.templateState.answers.groups.participants.map((person: { id: string }) => person.id)).toEqual([people[0].id]);
    expect(afterRemoval.members.some((member: { id: string }) => member.id === result.members[blairIndex].id)).toBe(false);
    expect(afterRemoval.members.find((member: { id: string }) => member.id === inPerson.id).session.genericForm.answers.location).toBe('Locally corrected room');
    await screenshot(page, dialog, info, `training-${theme}`);
  });

  test(`evidence intake distinguishes PDF requirements from editable transfer in ${theme}`, async ({ page }, info) => {
    let dialog = await packages(page), panel = await start(dialog, 'evidence submission');
    await fill(panel, { Submitter: 'Casey Example', Organization: 'Fictional Records Office', Recipient: 'Review Office', 'Submission subject': 'Local supporting record', 'Submission date': '2026-11-19', SSIC: '05000', 'Record description': 'Synthetic supporting record for workflow testing.' });
    await panel.getByRole('combobox', { name: 'Supporting record category', exact: true }).selectOption('supporting-record');
    await apply(panel);
    const incomplete = await portable(page, dialog);
    expect(incomplete.data.package.revisions[0].members).toHaveLength(2);
    const requirements = dialog.getByRole('region', { name: 'Evidence and requirements', exact: true });
    await requirements.getByRole('button', { name: 'Check evidence requirements', exact: true }).click();
    await expect(requirements.getByText(/^PDF assembly requirement checks have unresolved items\./)).toBeVisible();
    await requirements.getByRole('combobox', { name: 'Requirement operation', exact: true }).selectOption('portable');
    await requirements.getByRole('button', { name: 'Check evidence requirements', exact: true }).click();
    await expect(requirements.getByText(/^Editable transfer requirement checks complete\./)).toBeVisible();
    await dialog.getByRole('button', { name: 'Check readiness and assemble', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Package readiness: incomplete', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Assemble and retain PDF', exact: true })).toBeDisabled();
    panel = await continueIntake(dialog);
    const original = await PDFDocument.create(), font = await original.embedFont(StandardFonts.Helvetica);
    original.addPage([612, 792]).drawText('SYNTHETIC ORIGINAL SUPPORTING RECORD', { x: 55, y: 720, size: 14, font });
    const originalBytes = Buffer.from(await original.save());
    await panel.getByLabel('PDF for Original supporting PDF', { exact: true }).setInputFiles({ name: 'supporting-record.pdf', mimeType: 'application/pdf', buffer: originalBytes });
    await expect(panel.getByText('Selected: supporting-record.pdf', { exact: true })).toBeVisible();
    await apply(panel);
    dialog = await finishPrintedName(page, dialog, 'Transmittal letter', 'EXAMPLE');
    const complete = await portable(page, dialog), revision = complete.data.package.revisions[0];
    const savedOriginal = revision.members.find((member: { kind: string }) => member.kind === 'original');
    const asset = complete.data.portableResources.entries.find((entry: { path: string }) => entry.path === `assets/${savedOriginal.original.id}`);
    expect(Buffer.from(asset.data, 'base64')).toEqual(originalBytes);
    const pages = await output(page, dialog, info, 'evidence-intake');
    expect(pages).toHaveLength(3); expect(pages[1]).toContain('DonDocs submission index');
    expect(pages[2]).toContain('SYNTHETIC ORIGINAL SUPPORTING RECORD');
    await screenshot(page, dialog, info, `evidence-${theme}`);
  });
  test(`intake remains usable at 320px with keyboard focus in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 740 });
    const dialog = await packages(page), panel = intake(dialog);
    const opener = panel.getByRole('button', { name: 'Start training participation', exact: true });
    await expect(opener).toBeEnabled(); await opener.focus(); await page.keyboard.press('Enter');
    await expect(panel.getByRole('textbox', { name: 'Course or activity', exact: true })).toBeFocused();
    await panel.getByRole('button', { name: 'Add person to Participants', exact: true }).click();
    await expect(panel.getByRole('textbox', { name: 'Participants person 2 label', exact: true })).toBeFocused();
    await panel.getByRole('button', { name: 'Remove Participants · person 2 · Participants 2', exact: true }).click();
    await expect(panel.getByRole('textbox', { name: 'Participants person 2 label', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Add person to Participants', exact: true })).toBeFocused();
    await panel.locator('summary').filter({ hasText: /^Document scope and requirements$/ }).click();
    await screenshot(page, dialog, info, `narrow-${theme}`);
    await panel.getByRole('button', { name: 'Discard intake changes', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Start from an action', exact: true })).toBeFocused();
    await expect(opener).toBeEnabled();
  });

});
