import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
type Recognition = InstanceType<NonNullable<Window['SpeechRecognition']>>;

test('dictated browser results require transcript review before entering the pending letter', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    class BrowserSpeech implements Recognition {
      lang = ''; continuous = false; interimResults = false;
      onresult: Recognition['onresult'] = null;
      onerror: Recognition['onerror'] = null;
      onend: Recognition['onend'] = null;
      start() { window.addEventListener('test-dictation-result', this.result); }
      stop() { this.onend?.(); window.removeEventListener('test-dictation-result', this.result); }
      abort() { window.removeEventListener('test-dictation-result', this.result); }
      result = (event: Event) => {
        if (event instanceof CustomEvent) this.onresult?.({ results: [{ isFinal: true, 0: { transcript: String(event.detail) } }] });
      };
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: BrowserSpeech, configurable: true });
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('CURRENT DRAFT');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import letter…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a letter', exact: true });
  await dialog.getByRole('button', { name: 'Paste letter text', exact: true }).click();
  const pending = dialog.getByRole('textbox', { name: 'Paste letter text', exact: true });
  await expect(dialog.getByText(/may send microphone audio/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Start dictation', exact: true }).click();
  const dictated = 'From: Commanding Officer\nTo: Training Officer\nSubj: DICTATED LETTER\n\n1. This fictional letter tests reviewed dictation.';
  await page.evaluate(text => window.dispatchEvent(new CustomEvent('test-dictation-result', { detail: text })), dictated);
  await expect(pending).toHaveValue('');
  await dialog.getByRole('button', { name: 'Stop dictation', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Review dictated text', exact: true }).fill(dictated.replace('DICTATED LETTER', 'REVIEWED DICTATION'));
  await dialog.getByRole('button', { name: 'Add reviewed transcript to letter text', exact: true }).click();
  await expect(pending).toHaveValue(dictated.replace('DICTATED LETTER', 'REVIEWED DICTATION'));
  await dialog.getByRole('button', { name: 'Read letter', exact: true }).click();
  await expect(dialog.getByText('REVIEWED DICTATION', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Import into editor', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('REVIEWED DICTATION');
  await page.screenshot({ path: testInfo.outputPath('reviewed-dictation.png') });
});
