import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({ serviceWorkers: 'block' });

test('validates, previews and downloads an AMHS draft without replacing the active letter', async ({ page, context }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { previewVisible: false } }));
  });
  await page.goto('/');
  const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
  await expect(subject).toBeVisible();
  const existingSubject = await subject.inputValue();
  const tools = page.getByRole('button', { name: 'Document tools' });
  const open = async () => {
    await tools.click();
    await page.getByRole('menuitem', { name: 'Draft an AMHS message…' }).click();
  };
  await open();
  const dialog = page.getByRole('dialog', { name: 'AMHS message draft' });
  await expect(dialog.getByRole('heading', { name: 'AMHS message draft' })).toBeFocused();
  await expect(dialog.getByRole('link', { name: 'Navy GENADMIN format example' })).toHaveAttribute('href', /^https:\/\/www\.netc\.navy\.mil/);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const download = dialog.getByRole('button', { name: 'Download text' });
  await download.click();
  await expect(dialog.getByRole('alert')).toContainText('Review the highlighted fields');
  await expect(dialog.getByLabel('From address')).toBeFocused();
  if (testInfo.project.name === 'chromium') {
    expect((await new AxeBuilder({ page }).include('[data-slot="dialog-content"]').analyze()).violations).toEqual([]);
  }

  for (const [label, value] of [
    ['From address', 'Training Office Quantico VA'],
    ['To addresses', 'Admin Office Quantico VA\nRecords Office Quantico VA'],
    ['SSIC', '05420'],
    ['Message month', 'apr'],
    ['Message originator', 'Training Office'],
    ['Originator office code', 'N7'],
    ['Subject', 'Training schedule'],
    ['Name', 'Pat Example'],
    ['Rank or title', 'LT'],
    ['Contact office', 'Training Office'],
    ['Commercial phone', '202-555-0100'],
    ['Remarks', '1. Please review the April schedule.\n\n2. Send corrections by Friday.'],
  ]) {
    await dialog.getByLabel(label, { exact: true }).fill(value);
  }
  const contact = dialog.getByLabel('Commercial phone', { exact: true });
  await contact.fill('ABC123XYZ');
  const attemptedDownloads: string[] = [];
  page.on('download', event => attemptedDownloads.push(event.suggestedFilename()));
  await download.click();
  await expect(contact).toBeFocused();
  await expect(dialog.getByText('Enter a complete commercial phone number.', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Message preview')).toHaveValue('');
  for (const [value, printed] of [
    ['(202) 555-0100', '(202) 555-0100'], ['TEL: 202-555-0100', 'TEL: 202-555-0100'],
    ['COMM: (202) 555-0100', 'COMM: (202) 555-0100'],
  ]) {
    await contact.fill(value);
    expect(await dialog.getByLabel('Message preview').inputValue()).toContain(`TRAINING OFFICE/${printed}//`);
  }
  expect(attemptedDownloads).toEqual([]);
  await contact.fill('COMM: (202) 555-0100');
  await dialog.getByLabel('DSN number', { exact: true }).fill('555-0101');
  await dialog.getByLabel('Email address', { exact: true }).fill('pat@example.invalid');

  await dialog.getByText('Office routing and references (optional)', { exact: true }).click();
  const references = dialog.getByLabel('Document references');
  await references.fill('Training guide | 31APR2026');
  await dialog.getByText('Office routing and references (optional)', { exact: true }).click();
  await download.click();
  await expect(references).toBeFocused();
  await references.fill('Training guide | 30APR2026');
  const preview = await dialog.getByLabel('Message preview').inputValue();
  expect(preview).toContain('POC/PAT EXAMPLE/LT/TRAINING OFFICE/COMM: (202) 555-0100/DSN 555-0101/PAT(AT)EXAMPLE.INVALID//');
  expect(preview).toContain('MSGID/GENADMIN/TRAINING OFFICE/N7/APR//');
  expect(preview).toContain('REF/A/DOC/TRAINING GUIDE/\n30APR2026//\nAMPN/REF A IS TRAINING GUIDE.//');
  expect(preview).toContain('RMKS/1. Please review the April schedule.\n\n2. Send corrections by Friday.//');
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved in this browser');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(tools).toBeFocused();

  await open();
  await expect(dialog.getByLabel('Message preview')).toHaveValue(preview);
  await context.setOffline(true);
  const downloadEvent = page.waitForEvent('download');
  await download.click();
  const file = await downloadEvent;
  expect(file.suggestedFilename()).toBe('genadmin-draft.txt');
  expect(await readFile(await file.path(), 'utf8')).toBe(preview);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(subject).toHaveValue(existingSubject);
});

test('saves an unfinished GENADMIN locally, restores it after reload and supports deliberate discard', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { previewVisible: false } }));
  });
  await page.goto('/');
  const letterSubject = page.getByRole('textbox', { name: 'Subject', exact: true });
  await letterSubject.fill('KEEP THIS CORRESPONDENCE');
  await expect(page.locator('[title^="Saved "]')).toBeVisible({ timeout: 15_000 });

  const dialog = page.getByRole('dialog', { name: 'AMHS message draft' });
  const subject = dialog.getByLabel('Subject', { exact: true });
  const remarks = dialog.getByLabel('Remarks', { exact: true });
  const open = async () => {
    await page.getByRole('button', { name: 'Document tools' }).click();
    await page.getByRole('menuitem', { name: 'Draft an AMHS message…' }).click();
  };

  await open();
  await subject.fill('Saved GENADMIN');
  await remarks.fill('An unfinished message.');
  await dialog.getByLabel('DSN number', { exact: true }).fill('555-0163');
  await dialog.getByLabel('Email address', { exact: true }).fill('persisted@example.invalid');
  await expect(dialog.getByRole('status')).toHaveText('Unsaved changes');
  await page.keyboard.press('Escape');
  const confirmClose = page.getByRole('alertdialog', { name: 'Save this draft before closing?' });
  await expect(confirmClose).toBeVisible();
  await confirmClose.getByRole('button', { name: 'Keep editing' }).click();
  await expect(remarks).toHaveValue('An unfinished message.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await confirmClose.getByRole('button', { name: 'Save and close', exact: true }).click();
  // The confirmation hides the editor from accessibility queries while the write is pending.
  await expect(confirmClose).toBeHidden();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(letterSubject).toHaveValue('KEEP THIS CORRESPONDENCE');
  await open();
  await expect(subject).toHaveValue('Saved GENADMIN');
  await expect(remarks).toHaveValue('An unfinished message.');
  await expect(dialog.getByRole('status')).toHaveText('Saved in this browser');
  await expect(dialog.getByLabel('DSN number', { exact: true })).toHaveValue('555-0163');
  await expect(dialog.getByLabel('Email address', { exact: true })).toHaveValue('persisted@example.invalid');

  await subject.fill('Discard this edit');
  await page.keyboard.press('Escape');
  await confirmClose.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  await open();
  await expect(subject).toHaveValue('Saved GENADMIN');

  await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click();
  const confirmDiscard = page.getByRole('alertdialog', { name: 'Discard this message draft?' });
  await confirmDiscard.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(subject).toHaveValue('');
  await expect(remarks).toHaveValue('');
  await expect(dialog.getByRole('status')).toHaveText('No local draft saved');

  await page.reload();
  await expect(letterSubject).toHaveValue('KEEP THIS CORRESPONDENCE');
  await open();
  await expect(subject).toHaveValue('');
  await expect(remarks).toHaveValue('');
});

test('reopens the latest saved GENADMIN and protects edits from another tab', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { previewVisible: false } }));
  });
  await page.goto('/');
  const other = await context.newPage();
  const local = async (target: typeof page) => {
    await target.getByRole('button', { name: 'Document tools' }).click();
    await target.getByRole('menuitem', { name: 'Draft an AMHS message…' }).click();
    return target.getByRole('dialog', { name: 'AMHS message draft' });
  };
  let dialog = await local(page);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await other.goto('/');
  const otherDialog = await local(other);
  const otherSubject = otherDialog.getByLabel('Subject', { exact: true });
  const otherSave = otherDialog.getByRole('button', { name: 'Save draft', exact: true });
  await otherSubject.fill('Draft saved in second tab');
  await otherSave.click();
  await expect(otherDialog.getByRole('status')).toHaveText('Saved in this browser');

  dialog = await local(page);
  const subject = dialog.getByLabel('Subject', { exact: true });
  await expect(subject).toHaveValue('Draft saved in second tab');
  await subject.fill('Unsaved edits in first tab');
  await otherSubject.fill('Newer saved message');
  await otherSave.click();
  await expect(otherDialog.getByRole('status')).toHaveText('Saved in this browser');
  await expect(subject).toHaveValue('Unsaved edits in first tab');
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed in another tab');
  await expect(subject).toHaveValue('Unsaved edits in first tab');
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  dialog = await local(page);
  await expect(dialog.getByLabel('Subject', { exact: true })).toHaveValue('Newer saved message');
});

test('preserves an unreadable saved copy until deliberate discard and retains new editor text', async ({ page }) => {
  const newer = JSON.stringify({ version: 3, draft: { subject: 'Created by a later app version' } });
  await page.addInitScript(raw => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs.genadminDraft', raw);
  }, newer);
  await page.goto('/');
  await page.getByRole('button', { name: 'Document tools' }).click();
  await page.getByRole('menuitem', { name: 'Draft an AMHS message…' }).click();
  const dialog = page.getByRole('dialog', { name: 'AMHS message draft' });
  const subject = dialog.getByLabel('Subject', { exact: true });
  const save = dialog.getByRole('button', { name: 'Save draft', exact: true });
  await expect(dialog.getByRole('status')).toHaveText('Saved draft could not be read');
  await subject.fill('New editor text');
  await save.click();
  await expect(dialog.getByRole('alert')).toContainText('Discard the saved copy');
  expect(await page.evaluate(() => localStorage.getItem('dondocs.genadminDraft'))).toBe(newer);
  await dialog.getByRole('button', { name: 'Discard saved copy', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Discard the unreadable saved copy?' });
  await confirm.getByRole('button', { name: 'Discard saved copy', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(subject).toHaveValue('New editor text');
  await save.click();
  await expect(dialog.getByRole('status')).toHaveText('Saved in this browser');
});
