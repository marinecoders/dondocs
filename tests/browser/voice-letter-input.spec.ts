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
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const dialogBounds = await dialog.boundingBox();
    expect(dialogBounds).not.toBeNull();
    const controls = [
      pending,
      dialog.getByRole('button', { name: 'Start dictation', exact: true }),
      dialog.getByRole('button', { name: 'Stop dictation', exact: true }),
      dialog.getByRole('button', { name: 'Add reviewed transcript to letter text', exact: true }),
    ];
    for (const control of controls) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(dialogBounds!.x);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(dialogBounds!.x + dialogBounds!.width);
    }
  }
  await dialog.getByRole('button', { name: 'Start dictation', exact: true }).click();
  const dictated = 'From: Commanding Officer\nTo: Training Officer\nSubj: DICTATED LETTER\n\n1. This fictional letter tests reviewed dictation.';
  await page.evaluate(text => window.dispatchEvent(new CustomEvent('test-dictation-result', { detail: text })), dictated);
  await expect(pending).toHaveValue('');
  await dialog.getByRole('button', { name: 'Stop dictation', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Review dictated text', exact: true }).fill(dictated.replace('DICTATED LETTER', 'REVIEWED DICTATION'));
  await pending.fill('Subj: EXISTING PENDING LETTER\n\n1. Existing pending body.');
  await dialog.getByRole('button', { name: 'Read letter', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit pasted text', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Review dictated text', exact: true })).toHaveValue(dictated.replace('DICTATED LETTER', 'REVIEWED DICTATION'));
  await pending.fill('');
  await dialog.getByRole('button', { name: 'Add reviewed transcript to letter text', exact: true }).click();
  await expect(pending).toHaveValue(dictated.replace('DICTATED LETTER', 'REVIEWED DICTATION'));
  await dialog.getByRole('button', { name: 'Read letter', exact: true }).click();
  await expect(dialog.getByText('REVIEWED DICTATION', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Import into editor', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('REVIEWED DICTATION');
  await page.screenshot({ path: testInfo.outputPath('reviewed-dictation.png') });
});

test('reviewed paragraph dictation preserves existing prose and applies commands in one undo step', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused', previewVisible: false } }));
    class BrowserSpeech implements Recognition {
      lang = ''; continuous = false; interimResults = false;
      onresult: Recognition['onresult'] = null;
      onerror: Recognition['onerror'] = null;
      onend: Recognition['onend'] = null;
      start() { window.addEventListener('test-paragraph-dictation', this.receive); }
      stop() { this.abort(); this.onend?.(); }
      abort() { window.removeEventListener('test-paragraph-dictation', this.receive); }
      receive = (event: Event) => {
        if (event instanceof CustomEvent) this.onresult?.({ results: [{ isFinal: true, 0: { transcript: String(event.detail) } }] });
      };
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: BrowserSpeech, configurable: true });
  });
  await page.goto('/');
  const draft = {
    documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter', formType: 'navmc_10274',
    formData: { subject: 'DICTATION EXAMPLE' },
    paragraphs: [{ id: 'first', level: 0, text: 'Prior prose.' }, { id: 'child', level: 1, text: 'Prior child.' },
      { id: 'next', level: 0, text: 'Next section.' }], references: [], enclosures: [], copyTos: [], distributions: [],
  };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'paragraph-dictation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('combobox', { name: 'Document section' }).selectOption({ label: 'Paragraphs' });
  const first = page.locator('[data-paragraph-id="first"] [contenteditable="true"]');
  await first.focus();
  await page.getByRole('button', { name: 'Dictate into paragraph 1' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dictate into paragraph 1' });
  await expect(dialog.getByText(/may send microphone audio/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Start dictation' }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-paragraph-dictation', {
    detail: 'command new line New training prose command period command new paragraph command indent Another example command period',
  })));
  await dialog.getByRole('button', { name: 'Stop dictation' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Review dictated text' })).toHaveValue(/command period/);
  await expect(first).toHaveText('Prior prose.');
  const transcript = dialog.getByRole('textbox', { name: 'Review dictated text' });
  await transcript.fill((await transcript.inputValue()).replace('training', 'reviewed'));
  await dialog.getByRole('checkbox', { name: 'Interpret spoken commands' }).check();
  await expect(dialog.getByLabel('Interpreted text')).toContainText('New indented paragraph: Another example.');
  await dialog.getByRole('button', { name: 'Apply reviewed dictation' }).click();
  await expect(first.locator('p')).toHaveText(['Prior prose.', 'New reviewed prose.']);
  await expect(page.locator('[data-paragraph-id]:not([data-paragraph-id="first"]) [contenteditable="true"]')).toHaveText([
    'Prior child.', 'Another example.', 'Next section.',
  ]);
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Undo/ }).click();
  await expect(page.locator('[data-paragraph-id] [contenteditable="true"]')).toHaveText(['Prior prose.', 'Prior child.', 'Next section.']);
});
