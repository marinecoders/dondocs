import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);
const REVIEW = 'Fictional formatting review';
const ORIGINAL_BODY = 'Training due 5 Nov 2026 and 06 Dec 2026; quote "1 Jan 2026".';
const CORRECTED_BODY = 'Training due 5 November 2026 and 6 December 2026; quote "1 Jan 2026".';
const AUTHOR = 'Example reviewer 123-45-6789';

async function action(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: typeof name === 'string' }).click();
}
async function reviews(page: Page) {
  await action(page, 'Review rounds…');return page.getByRole('dialog', { name: 'Review rounds', exact: true });
}
async function bytes(page: Page, start: () => Promise<unknown>) {
  const pending = page.waitForEvent('download');await start();
  const download = await pending;expect(await download.failure()).toBeNull();return readFile((await download.path())!);
}
async function draft(page: Page) {
  return JSON.parse((await bytes(page, () => action(page, 'Export draft (.json)'))).toString('utf8'));
}
async function history(page: Page, direction: 'Undo' | 'Redo') {
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${direction}`) }).click();
}
async function chooseRound(page: Page) {
  const modal = await reviews(page);
  await modal.getByRole('combobox', { name: 'Review for suggested edits', exact: true }).selectOption({ label: REVIEW });
  await expect(modal.getByRole('region', { name: 'Review suggestions', exact: true })).toBeVisible();return modal;
}
function expectDraft(value: Awaited<ReturnType<typeof draft>>, corrected: boolean) {
  expect(value.formData.subject).toBe('NEWER AUTHOR SUBJECT');
  expect(value.formData.date).toBe(corrected ? '13 Nov 26' : '13 November 2026');
  expect(value.formData.sigFirst).toBe(corrected ? 'A.' : ' A . ');
  expect(value.formData.sigMiddle).toBe(corrected ? 'B.' : ' B . ');
  expect(value.paragraphs.map((paragraph: { id: string }) => paragraph.id)).toEqual(['unrelated', 'reviewed']);
  expect(value.paragraphs.map((paragraph: { text: string }) => paragraph.text)).toEqual(['Newer unrelated author body.', corrected ? CORRECTED_BODY : ORIGINAL_BODY]);
  expect(value.references).toEqual([
    { letter: 'a', title: corrected ? 'Alpha (NOTAL)' : 'Alpha (notal)', url: 'https://example.com/a' },
    { letter: 'b', title: corrected ? 'Bravo (NOTAL)' : 'Bravo ( notal )', url: 'https://example.com/b' },
  ]);
  expect(JSON.stringify(value)).not.toContain('123-45-6789');
  expect(value.proposals).toBeUndefined();expect(value.reviewSuggestions).toBeUndefined();
}

for (const theme of ['light', 'dark', 'classic']) test(`existing formatting findings return as one guarded review group in ${theme}`, async ({ page, browser, baseURL }, info) => {
  const appearance = { theme, editorLayout: 'scroll' };
  const init = (value: typeof appearance) => {
    localStorage.setItem('browser-test-visitor', 'returning');localStorage.setItem('dondocs_ui', JSON.stringify({ state: value, version: 1 }));
  };
  await page.addInitScript(init, appearance);await page.goto('/');
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'FICTIONAL FORMATTING SOURCE', from: 'Training Office', to: 'Training Officer', date: '13 November 2026',
      sigFirst: ' A . ', sigMiddle: ' B . ', sigLast: 'EXAMPLE', classLevel: 'unclassified' },
    paragraphs: [{ id: 'reviewed', text: ORIGINAL_BODY, level: 0 }, { id: 'unrelated', text: 'Original unrelated author body.', level: 0 }],
    references: [{ letter: 'a', title: 'Alpha (notal)', url: 'https://example.com/a' }, { letter: 'b', title: 'Bravo ( notal )', url: 'https://example.com/b' }],
    enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'formatting-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  let modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill(REVIEW);
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Prepare reviewer copy', exact: true }).click();
  const reviewerFile = await bytes(page, () => modal.getByRole('button', { name: 'Download reviewer copy', exact: true }).click());await page.keyboard.press('Escape');
  const context = await browser.newContext({ viewport: page.viewportSize()!, userAgent: await page.evaluate(() => navigator.userAgent),
    deviceScaleFactor: info.project.use.deviceScaleFactor, serviceWorkers: 'block', isMobile: !!info.project.use.isMobile, hasTouch: !!info.project.use.hasTouch });
  try {
    await context.addInitScript(init, appearance);const reviewer = await context.newPage();await reviewer.goto(baseURL!);
    const copyModal = await reviews(reviewer);
    await copyModal.getByLabel('Import reviewer copy', { exact: true }).setInputFiles({ name: 'review-copy.json', mimeType: 'application/json', buffer: reviewerFile });
    await copyModal.getByRole('button', { name: 'Open as new review copy', exact: true }).click();await expect(copyModal).toBeHidden();
    const reviewing = await chooseRound(reviewer), formatting = reviewing.getByRole('region', { name: 'Formatting review proposals', exact: true });
    await formatting.getByRole('textbox', { name: 'Reviewer name for formatting corrections', exact: true }).fill(AUTHOR);
    await formatting.getByRole('combobox', { name: 'Body date audience for review', exact: true }).selectOption('military');
    await expect(formatting.getByText('Reference ordering and citation relabeling remain in the reference tools.', { exact: true })).toBeVisible();
    await formatting.getByRole('button', { name: 'Propose 7 corrections', exact: true }).click();
    await expect(formatting.getByRole('status', { name: 'Formatting proposal status', exact: true })).toContainText('Draft text is unchanged');
    await reviewing.getByRole('button', { name: 'Prepare feedback return', exact: true }).click();
    await expect(reviewing.getByText(/Possible sensitive information: Social Security Number/)).toBeVisible();
    const returned = await bytes(reviewer, () => reviewing.getByRole('button', { name: 'Download feedback return', exact: true }).click());
    const payload = JSON.parse(returned.toString('utf8'));
    expect(payload.version).toBe(2);expect(payload.proposals).toHaveLength(1);expect(payload.proposals[0].changes).toHaveLength(6);
    expect(payload.proposals[0].changes.filter((change: { target: { kind: string } }) => change.target.kind === 'reference-title')).toHaveLength(2);
    expect(payload.formData).toBeUndefined();expect(payload.baseline).toBeUndefined();

    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('NEWER AUTHOR SUBJECT');
    await page.getByRole('textbox', { name: 'Paragraph 2', exact: true }).fill('Newer unrelated author body.');
    await page.locator('[data-paragraph-id="unrelated"]').getByRole('button', { name: 'Move up (⌘↑)', exact: true }).click();
    await page.getByRole('textbox', { name: 'Reference (b) URL', exact: true }).fill('https://example.com/later');
    modal = await reviews(page);await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'feedback.json', mimeType: 'application/json', buffer: returned });
    await expect(modal.getByText(/Returned text may contain sensitive information: Social Security Number/)).toBeVisible();
    await modal.getByRole('button', { name: 'Import reviewed feedback', exact: true }).click();await expect(modal.getByText(/Feedback imported/)).toBeVisible();
    await modal.getByRole('combobox', { name: 'Review for suggested edits', exact: true }).selectOption({ label: REVIEW });
    let group = modal.getByRole('article', { name: 'Suggestion 1: Formatting corrections (7)', exact: true });
    await expect(group.getByRole('button', { name: 'Accept suggestion', exact: true })).toBeDisabled();
    await expect(group).toContainText('Current draft differs; acceptance is blocked');
    await group.scrollIntoViewIfNeeded();
    expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    const accessibility = await new AxeBuilder({ page }).analyze();
    await info.attach('formatting-group-axe', { body: JSON.stringify(accessibility, null, 2), contentType: 'application/json' });
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`formatting-group-${theme}.png`), scale: 'css' });
    await page.keyboard.press('Escape');
    await page.getByRole('textbox', { name: 'Reference (b) URL', exact: true }).fill('https://example.com/b');
    await page.getByRole('textbox', { name: 'Paragraph 2', exact: true }).fill(`${ORIGINAL_BODY} Newer overlapping sentence.`);
    modal = await chooseRound(page);group = modal.getByRole('article', { name: 'Suggestion 1: Formatting corrections (7)', exact: true });
    await expect(group.getByRole('button', { name: 'Accept suggestion', exact: true })).toBeDisabled();
    await expect(group).toContainText('Current draft differs; acceptance is blocked');
    await page.keyboard.press('Escape');await expect(modal).toBeHidden();
    const blocked = await draft(page);
    expect(blocked.formData.date).toBe('13 November 2026');expect(blocked.formData.sigFirst).toBe(' A . ');
    expect(blocked.references.map((item: { title: string }) => item.title)).toEqual(['Alpha (notal)', 'Bravo ( notal )']);
    expect(blocked.paragraphs[1].text).toBe(`${ORIGINAL_BODY} Newer overlapping sentence.`);
    await page.getByRole('textbox', { name: 'Paragraph 2', exact: true }).fill(ORIGINAL_BODY);
    modal = await chooseRound(page);group = modal.getByRole('article', { name: 'Suggestion 1: Formatting corrections (7)', exact: true });
    await group.getByRole('button', { name: 'Accept suggestion', exact: true }).click();await expect(group).toContainText('Accepted');
    // Accepted state is published before the owning write finishes; the modal
    // deliberately stays open while that write is pending.
    await expect(modal.getByText('Review change saved.', { exact: true })).toBeVisible();
    await expect(modal.getByRole('combobox', { name: 'Review for suggested edits', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');await expect(modal).toBeHidden();
    expectDraft(await draft(page), true);
    await history(page, 'Undo');expectDraft(await draft(page), false);
    await history(page, 'Redo');expectDraft(await draft(page), true);
    await page.reload();expectDraft(await draft(page), true);
    modal = await chooseRound(page);await expect(modal.getByRole('article', { name: 'Suggestion 1: Formatting corrections (7)', exact: true })).toContainText('Accepted');
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'same-feedback.json', mimeType: 'application/json', buffer: returned });
    await expect(modal.getByText(/This return has already been imported/)).toBeVisible();await page.keyboard.press('Escape');
    const clean = await draft(page);expectDraft(clean, true);expect(JSON.stringify(clean)).not.toContain(payload.proposals[0].id);

    // Renderer behavior is theme-independent; retain actual clean files once.
    if (theme === 'light' && info.project.name === 'chromium') {
      const word = await bytes(page, async () => {
        await page.getByRole('button', { name: 'Download', exact: true }).click();await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
      });
      const zip = await JSZip.loadAsync(word), xml = await zip.file('word/document.xml')!.async('string');
      expect(xml).toContain('5 November 2026');expect(xml).toContain('NOTAL');expect(xml).not.toContain('123-45-6789');expect(xml).not.toContain(payload.proposals[0].id);
      const pdfBytes = await bytes(page, async () => {
        await page.getByRole('button', { name: 'Download', exact: true }).click();await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
      });
      const pdf = await getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: false }).promise;
      try {
        const pages = [];
        for (let number = 1; number <= pdf.numPages; number++) pages.push((await (await pdf.getPage(number)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '));
        const text = pages.join(' ').replace(/\s+/g, ' ');expect(text).toContain('5 November 2026');expect(text).toContain('NOTAL');expect(text).not.toContain('123-45-6789');
      } finally { await pdf.destroy(); }
      await info.attach('clean-formatting-letter.docx', { body: word, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      await info.attach('clean-formatting-letter.pdf', { body: pdfBytes, contentType: 'application/pdf' });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      const backup = await bytes(page, () => settings.getByRole('button', { name: 'Download workspace backup', exact: true }).click());
      const bundle = JSON.parse(backup.toString('utf8'));
      expect(bundle.version).toBe(9);expect(bundle.reviewSuggestions).toHaveLength(1);
      expect(bundle.reviewSuggestions[0].state.decisions.map((item: { action: string }) => item.action)).toEqual(['accepted', 'reversed', 'restored']);
      await settings.getByRole('button', { name: 'Close', exact: true }).click();
      const fresh = await browser.newContext({ serviceWorkers: 'block' });
      try {
        await fresh.addInitScript(init, appearance);const restored = await fresh.newPage();await restored.goto(baseURL!);
        await restored.getByRole('button', { name: 'Settings', exact: true }).click();
        const restoredSettings = restored.getByRole('dialog', { name: 'Settings', exact: true });
        await restored.getByLabel('Backup file', { exact: true }).setInputFiles({ name: 'formatting-backup.json', mimeType: 'application/json', buffer: backup });
        await expect(restoredSettings.getByRole('status')).toContainText('Restored');
        await expect(restoredSettings.getByRole('alert')).toHaveCount(0);
        await restoredSettings.getByRole('button', { name: 'Close', exact: true }).click();await restored.reload();
        await restored.getByRole('button', { name: /^NEWER AUTHOR SUBJECT · LTR ·/ }).click();
        expectDraft(await draft(restored), true);
        const restoredReview = await chooseRound(restored);
        await expect(restoredReview.getByRole('article', { name: 'Suggestion 1: Formatting corrections (7)', exact: true })).toContainText('Accepted');
        await restoredReview.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'same-feedback.json', mimeType: 'application/json', buffer: returned });
        await expect(restoredReview.getByText(/This return has already been imported/)).toBeVisible();
        await info.attach('restored-formatting-review.png', { body: await restored.screenshot({ scale: 'css' }), contentType: 'image/png' });
      } finally { await fresh.close(); }
    }
  } finally { await context.close(); }
});

for (const scenario of ['advisory and target limit', 'oversized whole paragraph', 'unsupported joint letter']) test(`formatting proposals explain ${scenario} without truncating or applying text`, async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });await page.goto('/');
  const oversized = scenario === 'oversized whole paragraph', unsupported = scenario === 'unsupported joint letter';
  const text = oversized ? `Due 5 Nov 2026; ${'x'.repeat(20_000)}` : 'Due 5 Nov 2026; quote "1 Jan 2026".';
  const paragraphs = Array.from({ length: oversized || unsupported ? 1 : 21 }, (_, index) => ({ id: `limit-${index}`, text, level: 0 }));
  if (!oversized && !unsupported) paragraphs.push({ id: 'advisory', text: 'Ambiguous 5 Nov 26.', level: 0 });
  const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: unsupported ? 'joint_letter' : 'naval_letter',
    formData: { subject: 'FICTIONAL LIMIT REVIEW', date: oversized ? '13 Nov 26' : '03/04/26', classLevel: 'unclassified' },
    paragraphs, references: [], enclosures: [], copyTos: [], distributions: [] };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'formatting-limits.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill(REVIEW);
  await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
  await modal.getByRole('combobox', { name: 'Review for suggested edits', exact: true }).selectOption({ label: REVIEW });
  const formatting = modal.getByRole('region', { name: 'Formatting review proposals', exact: true });
  await formatting.getByRole('textbox', { name: 'Reviewer name for formatting corrections', exact: true }).fill('Example reviewer');
  await expect(formatting.getByRole('button', { name: 'Propose 0 corrections', exact: true })).toBeDisabled();
  await formatting.getByRole('combobox', { name: 'Body date audience for review', exact: true }).selectOption('military');
  if (unsupported) {
    await expect(formatting.getByText('No supported formatting corrections in this reviewed baseline.', { exact: true })).toBeVisible();
    await expect(formatting.getByRole('checkbox')).toHaveCount(0);
    await expect(formatting.getByRole('button', { name: 'Propose 0 corrections', exact: true })).toBeDisabled();
  } else {
    await formatting.getByRole('button', { name: `Propose ${oversized ? '1 correction' : '21 corrections'}`, exact: true }).click();
    await expect(formatting.getByRole('alert')).toContainText(oversized ? '20,000-character' : 'no more than 20');
  }
  await expect(modal.getByRole('article', { name: /^Suggestion \d+:/ })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).analyze();
  await info.attach('formatting-boundary-axe', { body: JSON.stringify(accessibility, null, 2), contentType: 'application/json' });
  expect(accessibility.violations).toEqual([]);
  if (!oversized && !unsupported) {
    await expect(formatting.getByText(/manual review required/)).toHaveCount(2);
    await expect(formatting.getByRole('checkbox')).toHaveCount(21);
    await formatting.getByRole('checkbox', { name: 'Paragraph 21, date 1', exact: true }).uncheck();
    await formatting.getByRole('button', { name: 'Propose 20 corrections', exact: true }).click();
    await expect(modal.getByText('Review change saved.', { exact: true })).toBeVisible();
    await expect(modal.getByRole('article', { name: 'Suggestion 1: Formatting corrections (20)', exact: true })).toContainText('Pending');
  }
  await expect(modal.getByRole('combobox', { name: 'Review for suggested edits', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath(`formatting-${unsupported ? 'unsupported' : oversized ? 'size' : 'advisory'}-limit.png`), scale: 'css' });
  await page.keyboard.press('Escape');await expect(modal).toBeHidden();
  const unchanged = await draft(page);expect(unchanged.paragraphs).toEqual(paragraphs);expect(unchanged.formData.date).toBe(source.formData.date);
});
