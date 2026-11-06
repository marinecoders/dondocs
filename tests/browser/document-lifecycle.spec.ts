import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
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

async function documentAction(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  return page.getByRole('menuitem', { name });
}

test('import, Undo and navigation keep both drafts intact after reload', async ({ page }) => {
  await page.goto('/');
  const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
  await subject.fill('LIFECYCLE OUTGOING');
  await expect.poll(() => savedSubjects(page)).toContain('LIFECYCLE OUTGOING');
  await subject.fill('LIFECYCLE OUTGOING LATEST');
  const incoming = {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formType: 'navmc_10274', formData: { subject: 'LIFECYCLE IMPORTED' },
    paragraphs: [{ text: 'Imported body', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'lifecycle.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
  await expect(page.getByRole('dialog', { name: 'Review draft' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true, includeHidden: true })).toHaveValue('LIFECYCLE OUTGOING LATEST');
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(subject).toHaveValue('LIFECYCLE IMPORTED');
  const initialUndo = await documentAction(page, /^Undo/);
  await expect(initialUndo).toBeDisabled();
  await page.keyboard.press('Escape');
  await subject.fill('LIFECYCLE IMPORTED EDIT');
  const undo = await documentAction(page, /^Undo/);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(subject).toHaveValue('LIFECYCLE IMPORTED');
  const redo = await documentAction(page, /^Redo/);
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(subject).toHaveValue('LIFECYCLE IMPORTED EDIT');
  await expect.poll(() => savedSubjects(page)).toContain('LIFECYCLE IMPORTED EDIT');
  await openRecent(page, 'LIFECYCLE OUTGOING LATEST');
  await expect(subject).toHaveValue('LIFECYCLE OUTGOING LATEST');
  await expect.poll(() => savedSubjects(page)).toEqual(expect.arrayContaining(['LIFECYCLE OUTGOING LATEST', 'LIFECYCLE IMPORTED EDIT']));
  await expect.poll(async () => (await savedState(page)).currentSubject).toBe('LIFECYCLE OUTGOING LATEST');
  await page.reload();
  await expect(subject).toHaveValue('LIFECYCLE OUTGOING LATEST');
  await openRecent(page, 'LIFECYCLE IMPORTED EDIT');
  await expect(subject).toHaveValue('LIFECYCLE IMPORTED EDIT');
  await expect(await documentAction(page, /^Undo/)).toBeDisabled();
});
