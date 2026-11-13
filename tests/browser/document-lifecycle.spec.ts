import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { documentIdentity } from './documentIdentity';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
});

test('document identity ignores clock jitter and history changes but detects a real reload', async ({ page }) => {
  await page.route('https://document-identity.test/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Document identity</title>',
  }));
  await page.goto('https://document-identity.test/');
  await page.evaluate(() => {
    let origin = performance.timeOrigin;
    Object.defineProperty(performance, 'timeOrigin', { get: () => origin++ });
  });
  const original = await documentIdentity(page);
  expect(await documentIdentity(page)).toBe(original);
  await page.evaluate(() => history.replaceState(null, '', '#same-document'));
  expect(await documentIdentity(page)).toBe(original);
  await page.reload();
  expect(await documentIdentity(page)).not.toBe(original);
});

async function savedState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dondocs');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction(['documents', 'app'], 'readonly');
      const documents = new Promise<Array<{ id: string; session: { formData: { subject?: string } } }>>((resolve, reject) => {
        const request = transaction.objectStore('documents').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const pointer = new Promise<string | null>((resolve, reject) => {
        const request = transaction.objectStore('app').get('currentId');
        request.onsuccess = () => resolve(request.result?.value ?? null);
        request.onerror = () => reject(request.error);
      });
      const [records, id] = await Promise.all([documents, pointer]);
      return { subjects: records.map(record => record.session.formData.subject), currentSubject: records.find(record => record.id === id)?.session.formData.subject };
    } finally { db.close(); }
  });
}

async function savedSubjects(page: Page) { return (await savedState(page)).subjects; }

async function openRecent(page: Page, title: string) {
  const workspace = page.getByRole('button', { name: 'Open workspace', exact: true });
  if (await workspace.isVisible()) await workspace.click();
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).first().click();
}

async function historyAction(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  return page.getByRole('menu').getByRole('menuitem', { name });
}

for (const theme of ['light', 'dark', 'classic']) {
  test(`pasted letter text (${theme}) is reviewed, corrected and opened as a separate editable draft`, async ({ page }, testInfo) => {
    await page.addInitScript((appearance) => {
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: appearance } }));
    }, theme);
    const text = [
      '5216', 'Ser 1000/001', '12 Nov 26',
      'From: Example sender', 'To: Example recipient', 'Subj: PASTED SAMPLE LETTER',
      'Ref: (a) Sample reference', 'Encl: (1) Sample enclosure', '',
      '1. First sample paragraph.', '   a. Sample subparagraph.', '2. Second sample paragraph.',
      '', 'A. B. EXAMPLE',
    ].join('\n');
    await page.goto('/');
    const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
    await subject.fill('ORIGINAL SAMPLE DRAFT');
    await expect.poll(() => savedSubjects(page), { timeout: 15_000 }).toContain('ORIGINAL SAMPLE DRAFT');
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Import letter…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import a letter', exact: true });
    await dialog.getByRole('button', { name: 'Paste letter text', exact: true }).click();
    const input = dialog.getByRole('textbox', { name: 'Paste letter text', exact: true });
    await expect(input).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Read letter' })).toBeDisabled();
    // fill supplies plain text, just as a normal textarea paste does, without a clipboard permission.
    await input.fill(text);
    await expect(input).toHaveValue(text);
    await input.scrollIntoViewIfNeeded();
    await expect(input).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('paste-letter-text.png') });

    // Escape discards the cancelled draft. Reopening starts a separate import session.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Import letter…', exact: true }).click();
    await dialog.getByRole('button', { name: 'Paste letter text', exact: true }).click();
    await expect(input).toHaveValue('');
    const unnumbered = 'From: Example sender\nTo: Example recipient\nSubj: SAMPLE LETTER\n\nThis body has no paragraph numbers.';
    await input.fill(unnumbered);
    await dialog.getByRole('button', { name: 'Read letter' }).click();
    await expect(dialog.getByRole('alert')).toContainText('No body paragraphs were recognized.');
    await dialog.getByRole('button', { name: 'Edit pasted text' }).click();
    await expect(input).toHaveValue(unnumbered);
    await input.fill(text);
    await dialog.getByRole('button', { name: 'Read letter' }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    for (const value of ['Example sender', 'Example recipient', 'PASTED SAMPLE LETTER', '5216', '1000/001', '12 Nov 26', 'A. B. EXAMPLE']) {
      await expect(dialog.getByText(value, { exact: true })).toBeVisible();
    }
    await expect(dialog.getByText('Paragraphs', { exact: true }).locator('..')).toHaveText('Paragraphs3');
    await expect(page.locator('#subject')).toHaveValue('ORIGINAL SAMPLE DRAFT');
    await dialog.getByRole('button', { name: 'Edit pasted text' }).click();
    await expect(input).toHaveValue(text);
    await input.fill(text.replace('PASTED SAMPLE LETTER', 'CORRECTED SAMPLE LETTER'));
    await dialog.getByRole('button', { name: 'Read letter' }).click();
    await expect(dialog.getByText('CORRECTED SAMPLE LETTER', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('paste-letter-review.png') });
    await dialog.getByRole('button', { name: 'Import into editor' }).click();
    await expect(dialog).toBeHidden();
    await expect(subject).toHaveValue('CORRECTED SAMPLE LETTER');
    await expect.poll(() => savedSubjects(page), { timeout: 15_000 })
      .toEqual(expect.arrayContaining(['ORIGINAL SAMPLE DRAFT', 'CORRECTED SAMPLE LETTER']));
    await expect(await historyAction(page, /^Undo/)).toBeDisabled();
    await page.keyboard.press('Escape');
    await subject.fill('EDITED SAMPLE LETTER');
    await expect.poll(async () => (await savedState(page)).currentSubject, { timeout: 15_000 }).toBe('EDITED SAMPLE LETTER');
    await page.reload();
    await expect(subject).toHaveValue('EDITED SAMPLE LETTER');
    await openRecent(page, 'ORIGINAL SAMPLE DRAFT');
    await expect(subject).toHaveValue('ORIGINAL SAMPLE DRAFT');
  });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 320, height: 568 }, { width: 568, height: 320 }]) {
  test.describe(`Import feedback at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('keeps controls and an open tools menu fixed when import feedback appears and expires', async ({ page }) => {
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.goto('/');
      // WebKit can clear :active while the pointer is held. Measure layout
      // independently of the button's cosmetic press scale.
      await page.addStyleTag({ content: `
        button[aria-label="Document tools"] { scale: 1 !important; }
        [role="menu"] { animation: none !important; transition: none !important; }
      ` });
      const tools = page.getByRole('button', { name: 'Document tools', exact: true, includeHidden: true });
      await expect(tools).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('FEEDBACK OUTGOING');
      await expect.poll(async () => (await savedState(page)).currentSubject, { timeout: 15_000 }).toBe('FEEDBACK OUTGOING');
      await page.locator('.workspace-shell').evaluate(shell => { shell.scrollTop = 0; });
      await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
      const controls = [tools, ...['Document actions', 'Download'].map(name => page.getByRole('button', { name, exact: true, includeHidden: true }))];
      const controlBounds = () => Promise.all(controls.map(control => control.boundingBox()));
      const before = await controlBounds();
      expect(before.every(Boolean)).toBe(true);

      const incoming = {
        documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
        formType: 'navmc_10274', formData: { subject: 'IMPORT FEEDBACK' },
        paragraphs: [{ text: 'Imported body', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [],
      };
      await page.getByLabel('Import draft file').setInputFiles({ name: 'feedback.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
      await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
      const status = page.getByRole('status', { includeHidden: true }).filter({ hasText: 'Imported!' });
      await expect(status).toBeVisible();
      await expect(status).toBeInViewport({ ratio: 1 });
      await page.clock.runFor(250);
      await expect(page.getByRole('dialog', { name: 'Review draft', includeHidden: true })).toHaveCount(0);
      expect(await controlBounds()).toEqual(before);

      const box = (await tools.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await page.clock.runFor(50);
      // Floating UI initially mounts offscreen before it positions the portal.
      // Compare settled geometry across the feedback timeout, not its entry frame.
      await expect(menu).toBeInViewport({ ratio: 1 });
      const menuBefore = await menu.boundingBox();
      expect(menuBefore).not.toBeNull();
      // Hold the pointer over the trigger through the real feedback timeout.
      // A header shift would move the first menuitem underneath that pointer.
      await page.clock.fastForward(2_001);
      await expect(status).toHaveCount(0);
      expect(await controlBounds()).toEqual(before);
      expect(await menu.boundingBox()).toEqual(menuBefore);
      await page.mouse.up();
      await expect.poll(controlBounds).toEqual(before);
      await expect(menu.getByRole('menuitem', { name: /^Undo/ })).toBeDisabled();
      await expect(page.getByRole('dialog', { name: 'Document formatting' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    });
  });
}

test('import, Undo and navigation keep both drafts intact after reload', async ({ page }) => {
  await page.goto('/');
  const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
  await subject.fill('LIFECYCLE OUTGOING');
  await expect.poll(() => savedSubjects(page), { timeout: 15_000 }).toContain('LIFECYCLE OUTGOING');
  await subject.fill('LIFECYCLE OUTGOING LATEST');
  const incoming = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formType: 'navmc_10274', formData: { subject: 'LIFECYCLE IMPORTED' },
    paragraphs: [{ text: 'Imported body', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'lifecycle.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
  await expect(page.getByRole('dialog', { name: 'Review draft' })).toBeVisible();
  // The review dialog hides both bound editor inputs from the accessibility tree.
  await expect(page.locator('#subject')).toHaveValue('LIFECYCLE OUTGOING LATEST');
  await expect(page.locator('#body-subject')).toHaveValue('LIFECYCLE OUTGOING LATEST');
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(subject).toHaveValue('LIFECYCLE IMPORTED');
  const initialUndo = await historyAction(page, /^Undo/);
  await expect(initialUndo).toBeDisabled();
  await page.keyboard.press('Escape');
  await subject.fill('LIFECYCLE IMPORTED EDIT');
  const undo = await historyAction(page, /^Undo/);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(subject).toHaveValue('LIFECYCLE IMPORTED');
  const redo = await historyAction(page, /^Redo/);
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(subject).toHaveValue('LIFECYCLE IMPORTED EDIT');
  await expect.poll(() => savedSubjects(page), { timeout: 15_000 }).toContain('LIFECYCLE IMPORTED EDIT');
  await openRecent(page, 'LIFECYCLE OUTGOING LATEST');
  await expect(subject).toHaveValue('LIFECYCLE OUTGOING LATEST');
  await expect.poll(() => savedSubjects(page), { timeout: 15_000 }).toEqual(expect.arrayContaining(['LIFECYCLE OUTGOING LATEST', 'LIFECYCLE IMPORTED EDIT']));
  await expect.poll(async () => (await savedState(page)).currentSubject, { timeout: 15_000 }).toBe('LIFECYCLE OUTGOING LATEST');
  await page.reload();
  await expect(subject).toHaveValue('LIFECYCLE OUTGOING LATEST');
  await openRecent(page, 'LIFECYCLE IMPORTED EDIT');
  await expect(subject).toHaveValue('LIFECYCLE IMPORTED EDIT');
  await expect(await historyAction(page, /^Undo/)).toBeDisabled();
});

test('Redo survives attachment hydration after reopening an imported draft', async ({ page }) => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = await pdf.save();
  const incoming = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formType: 'navmc_10274', formData: { subject: 'ATTACHMENT HISTORY' },
    paragraphs: [{ text: 'Imported body', level: 0 }], references: [], copyTos: [], distributions: [],
    enclosures: [{ title: 'Attachment', file: { name: 'attachment.pdf', size: bytes.byteLength, data: Buffer.from(bytes).toString('base64') } }],
  };
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'attachment.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect.poll(async () => (await savedState(page)).currentSubject, { timeout: 15_000 }).toBe('ATTACHMENT HISTORY');
  await page.reload();
  const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
  await expect(subject).toHaveValue('ATTACHMENT HISTORY');
  await subject.click();
  await expect(subject).toBeFocused();
  await subject.fill('ATTACHMENT HISTORY EDIT');
  await expect(subject).toHaveValue('ATTACHMENT HISTORY EDIT');
  const undo = await historyAction(page, /^Undo/);
  await expect(undo).toBeEnabled(); await undo.click();
  await expect(subject).toHaveValue('ATTACHMENT HISTORY');
  const redo = await historyAction(page, /^Redo/);
  await expect(redo).toBeEnabled(); await redo.click();
  await expect(subject).toHaveValue('ATTACHMENT HISTORY EDIT');
});

test('a reset built-in form keeps its signature defaults through Undo and Redo', async ({ page }) => {
  const incoming = {
    documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: 'navmc_10274',
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [],
    forms: { navmc10274: { natureOfAction: 'Before reset', signatureBlocks: [] }, includeCoverPage: false },
  };
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'form.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review draft', exact: true, includeHidden: true })).toHaveCount(0);
  const subject = page.getByRole('textbox', { name: '8. Nature of Action/Subject', exact: true });
  await expect(subject).toHaveValue('Before reset');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reset form to sample values…', exact: true }).click();
  await page.getByRole('button', { name: 'Reset to sample values', exact: true }).click();
  // Wait for dialog focus restoration before WebKit inserts the next edit.
  await expect(page.getByRole('alertdialog', { name: 'Reset form to sample values?', exact: true, includeHidden: true })).toHaveCount(0);
  const sample = await subject.inputValue();
  expect(sample).not.toBe('');
  expect(sample).not.toBe('Before reset');
  await subject.fill('FORM HISTORY EDIT');
  await expect(subject).toHaveValue('FORM HISTORY EDIT');
  const undo = await historyAction(page, /^Undo/);
  await expect(undo).toBeEnabled(); await undo.click();
  await expect(subject).toHaveValue(sample);
  const redo = await historyAction(page, /^Redo/);
  await expect(redo).toBeEnabled(); await redo.click();
  await expect(subject).toHaveValue('FORM HISTORY EDIT');
});
