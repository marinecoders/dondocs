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
    ['Phone or email', 'pat@example.invalid'],
    ['Remarks', '1. Please review the April schedule.\n\n2. Send corrections by Friday.'],
  ]) {
    await dialog.getByLabel(label, { exact: true }).fill(value);
  }
  await dialog.getByText('Office routing and references (optional)', { exact: true }).click();
  const references = dialog.getByLabel('Document references');
  await references.fill('Training guide | 31APR2026');
  await dialog.getByText('Office routing and references (optional)', { exact: true }).click();
  await download.click();
  await expect(references).toBeFocused();
  await references.fill('Training guide | 30APR2026');
  const preview = await dialog.getByLabel('Message preview').inputValue();
  expect(preview).toContain('MSGID/GENADMIN/TRAINING OFFICE/N7/APR//');
  expect(preview).toContain('REF/A/DOC/TRAINING GUIDE/\n30APR2026//\nAMPN/REF A IS TRAINING GUIDE.//');
  expect(preview).toContain('RMKS/1. Please review the April schedule.\n\n2. Send corrections by Friday.//');
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
