import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('previews, copies and downloads a complete formal email while retaining the current draft', async ({ page, context }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { previewVisible: false, editorLayout: 'scroll' } }));
  });
  await page.goto('/');
  const subject = page.getByRole('textbox', { name: 'Subject', exact: true });
  await expect(subject).toBeVisible();
  const currentSubject = await subject.inputValue();
  const tools = page.getByRole('button', { name: 'Document tools' });
  const dialog = page.getByRole('dialog', { name: 'Formal naval email' });
  const open = async () => {
    await tools.click();
    await page.getByRole('menuitem', { name: 'Draft a formal email…' }).click();
    await expect(dialog.getByRole('heading', { name: 'Formal naval email' })).toBeFocused();
  };

  await open();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(dialog.getByRole('link', { name: 'SECNAV M-5216.5, Chapter 4' })).toHaveAttribute('href', /#page=33$/);
  const copy = dialog.getByRole('button', { name: 'Copy email text' });
  await copy.click();
  await expect(dialog.getByRole('alert')).toContainText('Complete the highlighted fields');
  await expect(dialog.getByLabel('Typed letterhead')).toBeFocused();
  if (info.project.name === 'chromium') {
    expect((await new AxeBuilder({ page }).include('[data-slot="dialog-content"]').analyze()).violations).toEqual([]);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  }

  for (const [name, value] of [
    ['Typed letterhead', 'DEPARTMENT OF THE NAVY\nTRAINING COMMAND'], ['SSIC', '5216'], ['Serial number', 'N7/010'],
    ['Date', '31 Apr 26'], ['From', 'Commanding Officer, Training Command'], ['To', 'Commanding Officer, Support Activity'],
    ['Subject', 'Training schedule'], ['Body', '1. Please review the résumé.\n\n2. Confirm receipt by Friday.'],
    ['Complimentary closing', 'Respectfully,'], ['Signer name', 'A. B. Example'], ['Signature authority', 'By direction'],
  ]) {
    await dialog.getByLabel(name, { exact: true }).fill(value);
  }
  const download = dialog.getByRole('button', { name: 'Download text' });
  await download.click();
  await expect(dialog.getByLabel('Date', { exact: true })).toBeFocused();
  await dialog.getByLabel('Date', { exact: true }).fill('2026-11-23');
  const preview = dialog.getByLabel('Email preview');
  const expectedText = [
    'DEPARTMENT OF THE NAVY', 'TRAINING COMMAND', '', '5216', 'Ser N7/010', '23 Nov 26', '',
    'From:  Commanding Officer, Training Command', 'To:      Commanding Officer, Support Activity', '',
    'Subj:   TRAINING SCHEDULE', '', '1. Please review the résumé.', '', '2. Confirm receipt by Friday.', '',
    'Respectfully,', '', '/s/', 'A. B. EXAMPLE', 'By direction', '',
  ].join('\n');
  await expect(preview).toHaveValue(expectedText);
  await expect(dialog.getByRole('alert')).toHaveCount(0);

  if (info.project.name === 'chromium') {
    await copy.click();
    await expect(dialog.getByRole('status')).toHaveText('Email text copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expectedText);
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => { throw new Error('Clipboard denied'); } });
    });
    await copy.click();
    await expect(dialog.getByRole('status')).toContainText('Copy the selected text');
    await expect(preview).toBeFocused();
    expect(await preview.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([0, expectedText.length]);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(tools).toBeFocused();
  await open();
  await expect(preview).toHaveValue(expectedText);
  await context.setOffline(true);
  const downloading = page.waitForEvent('download');
  await download.click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe('formal-naval-email.txt');
  expect(await readFile(await file.path(), 'utf8')).toBe(expectedText);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(subject).toHaveValue(currentSubject);
});
