import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { closeReviewRounds } from '../_helpers/closeReviewRounds';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const libreOffice = process.env.DONDOCS_WORD_REVIEW_LIBREOFFICE;
const nativeWordDirectory = process.env.DONDOCS_NATIVE_WORD_REVIEW_DIR;
const nativeWordVersion = process.env.DONDOCS_NATIVE_WORD_REVIEW_VERSION;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function awaitNativeWordReturn(original: Buffer) {
  if (!nativeWordVersion?.trim()) throw new Error('Set DONDOCS_NATIVE_WORD_REVIEW_VERSION to the tested Word version.');
  const root = resolve(nativeWordDirectory!);
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'review-'));
  const issuedPath = join(directory, 'issued.docx');
  const returnedPath = join(directory, 'returned.docx');
  await writeFile(issuedPath, original, { flag: 'wx' });
  console.log(`Open ${issuedPath} in Microsoft Word. Save and reopen a copy, then move the closed file to ${returnedPath}.`);
  let returned: Buffer | undefined;
  await expect.poll(async () => {
    try {
      returned = await readFile(returnedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return returned !== undefined;
  }, { timeout: 600_000, intervals: [1000], message: 'The Word operator has not provided a saved return.' }).toBe(true);
  expect(digest(await readFile(issuedPath))).toBe(digest(original));
  expect(digest(returned!)).not.toBe(digest(original));
  return returned!;
}
const body = 'Review this old word and keep the suffix.';
test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(240_000);
async function actions(page: Page, name: string) {
  const history = name === 'Undo' || name === 'Redo';
  await page.getByRole('button', { name: history ? 'Document tools' : 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: history ? new RegExp(`^${name}`) : name, exact: true }).click();
}
async function reviews(page: Page) { await actions(page, 'Review rounds…');return page.getByRole('dialog', { name: 'Review rounds', exact: true }); }
async function download(page: Page, action: () => Promise<unknown>) {
  const pending = page.waitForEvent('download', { timeout: 120_000 });await action();const result = await pending;
  expect(await result.failure()).toBeNull();return readFile((await result.path())!);
}
async function reviewerChanges(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes), xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  const marker = Array.from(xml.getElementsByTagNameNS(W, 'bookmarkStart')).find(element => element.getAttributeNS(W, 'name') === 'DDReview_0');
  if (!marker?.parentNode || marker.parentNode.nodeType !== 1) throw new Error('The actual export has no direct review bookmark.');
  const paragraph = marker.parentNode;
  const text = Array.from(xml.getElementsByTagNameNS(W, 't')).find(element => element.textContent?.includes(body));
  if (!text?.parentNode || text.parentNode.parentNode !== paragraph) throw new Error('The actual Word paragraph is not an expected single plain run.');
  const [before, after] = text.textContent!.split('old');text.textContent = before;
  const make = (name: string, value?: string) => { const element = xml.createElementNS(W, `w:${name}`);if (value) element.setAttributeNS(W, 'w:id', value);return element; };
  const run = (value: string, deleted = false) => { const element = make('r'), word = make(deleted ? 'delText' : 't');word.setAttribute('xml:space', 'preserve');word.textContent = value;element.appendChild(word);return element; };
  const deletion = make('del', '70');deletion.setAttributeNS(W, 'w:author', 'Synthetic Reviewer');deletion.appendChild(run('old', true));
  const insertion = make('ins', '71');insertion.setAttributeNS(W, 'w:author', 'Synthetic Reviewer');insertion.appendChild(run('reviewed'));
  const next = text.parentNode.nextSibling;
  for (const element of [make('commentRangeStart', '72'), deletion, make('commentRangeEnd', '72'), insertion, run(after)]) paragraph.insertBefore(element, next);
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
  // An editor can move a custom XML part and retarget its relationship.
  const issuedPart = 'customXml/dondocs-word-review.xml';
  const savedPart = 'customXml/item12.xml';
  const identity = zip.file(issuedPart);
  if (!identity || zip.file(savedPart)) throw new Error('The issued fixture has unexpected review XML parts.');
  zip.file(savedPart, await identity.async('uint8array'));
  zip.remove(issuedPart);
  const R = 'http://schemas.openxmlformats.org/package/2006/relationships', C = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const rels = new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels')!.async('string'), 'application/xml');
  const reviewRelation = Array.from(rels.getElementsByTagNameNS(R, 'Relationship')).find(element =>
    element.getAttribute('Target') === `../${issuedPart}`);
  if (!reviewRelation) throw new Error('The issued fixture has no review XML relationship.');
  reviewRelation.setAttribute('Target', `../${savedPart}`);
  const commentRelations = Array.from(rels.getElementsByTagNameNS(R, 'Relationship')).filter(element => element.getAttribute('Type')?.endsWith('/comments'));
  if (commentRelations.length > 1) throw new Error('The issued fixture already has ambiguous comments relationships.');
  const commentsPath = commentRelations.length ? new URL(commentRelations[0].getAttribute('Target')!, 'https://fixture.invalid/word/document.xml').pathname.slice(1) : 'word/comments.xml';
  if (!commentRelations.length) {
    const relation = rels.createElementNS(R, 'Relationship');relation.setAttribute('Id', 'wordReviewComments');
    relation.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments');relation.setAttribute('Target', 'comments.xml');rels.documentElement.appendChild(relation);
  }
  const existing = zip.file(commentsPath), comments = new DOMParser().parseFromString(existing ? await existing.async('string') : `<w:comments xmlns:w="${W}"/>`, 'application/xml');
  if (Array.from(comments.getElementsByTagNameNS(W, 'comment')).some(element => element.getAttributeNS(W, 'id') === '72')) throw new Error('The synthetic comment identity is already in use.');
  const comment = comments.createElementNS(W, 'w:comment');comment.setAttributeNS(W, 'w:id', '72');comment.setAttributeNS(W, 'w:author', 'Synthetic Reviewer');
  const content = comments.createElementNS(W, 'w:p'), commentRun = comments.createElementNS(W, 'w:r'), commentText = comments.createElementNS(W, 'w:t');
  commentText.textContent = 'Please check this exact word.';commentRun.appendChild(commentText);content.appendChild(commentRun);comment.appendChild(content);comments.documentElement.appendChild(comment);
  zip.file(commentsPath, new XMLSerializer().serializeToString(comments));zip.file('word/_rels/document.xml.rels', new XMLSerializer().serializeToString(rels));
  const types = new DOMParser().parseFromString(await zip.file('[Content_Types].xml')!.async('string'), 'application/xml');
  const reviewOverride = Array.from(types.getElementsByTagNameNS(C, 'Override')).find(element =>
    element.getAttribute('PartName') === `/${issuedPart}`);
  if (!reviewOverride) throw new Error('The issued fixture has no review XML content type.');
  reviewOverride.setAttribute('PartName', `/${savedPart}`);
  if (!Array.from(types.getElementsByTagNameNS(C, 'Override')).some(element => element.getAttribute('PartName') === `/${commentsPath}`)) {
    const type = types.createElementNS(C, 'Override');type.setAttribute('PartName', `/${commentsPath}`);type.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml');types.documentElement.appendChild(type);
  }
  zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(types));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
for (const theme of ['light', 'dark', 'classic']) {
  test(`issued Word return preserves newer work and native review history in ${theme}`, async ({ page, context }, info) => {
    const native = Boolean(nativeWordDirectory) && theme === 'light';
    if (native) test.setTimeout(780_000);
    await context.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'scroll' } }));
    }, theme);
    await page.goto('/');
    const source = { documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
      formData: { subject: 'SYNTHETIC WORD HANDOFF', from: 'Training Office', to: 'Training Officer', date: '16 Nov 26', sigLast: 'EXAMPLE', classLevel: 'unclassified' },
      paragraphs: [{ id: 'word-return-body', text: body, level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Review draft', exact: true, includeHidden: true })).toHaveCount(0, { timeout: 30_000 });
    let modal = await reviews(page);await modal.getByLabel('Review name', { exact: true }).fill(`Word exact baseline ${theme}`);
    await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
    await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.', { exact: true })).toBeVisible();
    const original = await download(page, () => modal.getByRole('button', { name: 'Download Word review copy', exact: true }).click());
    await expect(modal.getByText(/Word review copy sent to browser downloads/)).toBeVisible({ timeout: 120_000 });
    const zip = await JSZip.loadAsync(original);expect(zip.file('customXml/dondocs-word-review.xml')).not.toBeNull();
    const returned = native ? await awaitNativeWordReturn(original) : await reviewerChanges(original);
    await writeFile(info.outputPath(`issued-${theme}.docx`), original);await writeFile(info.outputPath(`returned-${theme}.docx`), returned);
    await closeReviewRounds(modal);
    await replaceParagraphText(page.getByRole('textbox', { name: 'Paragraph 1', exact: true }), body.replace('suffix.', 'newer suffix.'));
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('NEWER WORD SUBJECT');
    modal = await reviews(page);
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'returned.docx', mimeType: TYPE, buffer: returned });
    await expect(modal.getByText(/Word source: returned.docx/)).toBeVisible({ timeout: 30_000 });
    await modal.getByText('Returned suggested replacements (1)', { exact: true }).click();
    await expect(modal.getByRole('region', { name: 'Returned suggested replacements', exact: true })).toContainText('reviewed');
    await modal.getByRole('button', { name: 'Import reviewed feedback', exact: true }).click();
    await expect(modal.getByText(/^Feedback imported\./)).toBeVisible({ timeout: 30_000 });
    await modal.getByText('Saved Word returns (1)', { exact: true }).click();
    expect(await download(page, () => modal.getByRole('button', { name: 'Download original Word return', exact: true }).click())).toEqual(returned);
    await modal.getByLabel('Review for suggested edits', { exact: true }).selectOption({ label: `Word exact baseline ${theme}` });
    await modal.getByRole('button', { name: 'Accept suggestion', exact: true }).click();
    await expect(modal.getByText('Review change saved.', { exact: true })).toBeVisible({ timeout: 30_000 });
    await closeReviewRounds(modal);
    const paragraph = page.getByRole('textbox', { name: 'Paragraph 1', exact: true });
    await expect(paragraph).toHaveText('Review this reviewed word and keep the newer suffix.');
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('NEWER WORD SUBJECT');
    await actions(page, 'Undo');await expect(paragraph).toHaveText(body.replace('suffix.', 'newer suffix.'));
    await actions(page, 'Redo');await expect(paragraph).toHaveText('Review this reviewed word and keep the newer suffix.');
    const draft = JSON.parse((await download(page, () => actions(page, 'Export draft (.json)'))).toString('utf8'));
    expect(draft.reviewComments.threads[0].anchor).toMatchObject({ kind: 'range', paragraphId: 'word-return-body' });
    expect(draft.reviewComments.threads[0].messages[0].text).toContain('Please check this exact word.');
    await writeFile(info.outputPath(`native-result-${theme}.json`), JSON.stringify(draft, null, 2));
    await page.reload();
    modal = await reviews(page);
    await modal.getByText('Saved Word returns (1)', { exact: true }).click();
    expect(await download(page, () => modal.getByRole('button', { name: 'Download original Word return', exact: true }).click())).toEqual(returned);
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'same.docx', mimeType: TYPE, buffer: returned });
    await expect(modal.getByText(/This return has already been imported/)).toBeVisible({ timeout: 30_000 });
    if (native) {
      await info.attach('microsoft-word-review-return', { body: JSON.stringify({
        operatorReportedVersion: nativeWordVersion,
        platform: process.platform,
        issuedSha256: digest(original),
        returnedSha256: digest(returned),
        reconciledNewerDraft: true,
      }, null, 2), contentType: 'application/json' });
    }
    if (libreOffice && theme === 'light' && !native) {
      const output = info.outputPath('libreoffice');
      await mkdir(output, { recursive: true });
      const path = info.outputPath(`returned-${theme}.docx`);
      const run = promisify(execFile);
      const version = (await run(libreOffice, ['--version'], { timeout: 30_000 })).stdout.trim();
      const profile = pathToFileURL(info.outputPath('libreoffice-profile')).href;
      await run(libreOffice, [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'docx:Office Open XML Text', '--outdir', output, path], { timeout: 60_000 });
      const resaved = await readFile(join(output, `returned-${theme}.docx`));
      const resavedZip = await JSZip.loadAsync(resaved);
      expect(version).toMatch(/^LibreOffice/);
      expect(resaved).not.toEqual(returned);
      expect(await resavedZip.file('word/document.xml')!.async('string')).toContain('reviewed');
      const customParts = resavedZip.file(/^customXml\/[^/]+\.xml$/i);
      const customXml = await Promise.all(customParts.map(part => part.async('string')));
      expect(customXml.join('\n'), 'The selected renderer kept review identity and requires its own return qualification.').not.toContain('urn:dondocs:word-review:1');
      const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
      await info.attach('word-resave-evidence.json', { body: JSON.stringify({
        version, issuedSha256: digest(original), originalReturnSha256: digest(returned), resavedSha256: digest(resaved),
      }, null, 2), contentType: 'application/json' });
      await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'libreoffice-resaved.docx', mimeType: TYPE, buffer: resaved });
      await expect(modal.getByRole('alert')).toContainText('no single intact DonDocs review identity');
      await expect(modal.getByText('Saved Word returns (1)', { exact: true })).toBeVisible();
      expect(await download(page, () => modal.getByRole('button', { name: 'Download original Word return', exact: true }).click())).toEqual(returned);
    }
    // The issued copy has a known identity part. A real Word return can rename it.
    const unmarked = await JSZip.loadAsync(original);
    unmarked.remove('customXml/dondocs-word-review.xml');
    await modal.getByLabel('Import feedback return', { exact: true }).setInputFiles({ name: 'missing-identity.docx', mimeType: TYPE, buffer: await unmarked.generateAsync({ type: 'nodebuffer' }) });
    await expect(modal.getByRole('alert')).toContainText('no single intact DonDocs review identity', { timeout: 30_000 });
    await page.screenshot({ path: info.outputPath(`word-return-${theme}.png`), fullPage: true });
    await closeReviewRounds(modal);await expect(paragraph).toHaveText('Review this reviewed word and keep the newer suffix.');
  });
}

for (const theme of ['light', 'dark', 'classic']) {
  test(`Word review actions reflow at 320 pixels in ${theme}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await context.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { theme: value, editorLayout: 'scroll' } }));
    }, theme);
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({ name: 'word-reflow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
      formData: { subject: 'WORD REVIEW REFLOW', from: 'Training Office', to: 'Training Officer', date: '16 Nov 26', sigLast: 'EXAMPLE', classLevel: 'unclassified' },
      paragraphs: [{ id: 'word-reflow-body', level: 0, text: 'Fictional SSN 123-45-6789 requires an explicit Word export review.' }],
      references: [], enclosures: [], copyTos: [], distributions: [],
    })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Review draft', exact: true, includeHidden: true })).toHaveCount(0);
    const modal = await reviews(page);
    await modal.getByLabel('Review name', { exact: true }).fill(`Word reflow ${theme}`);
    await modal.getByRole('button', { name: 'Start review from current draft', exact: true }).click();
    const handoff = modal.getByRole('region', { name: 'Word review handoff', exact: true });
    await handoff.getByRole('button', { name: 'Download Word review copy', exact: true }).click();
    const approve = handoff.getByRole('button', { name: 'Approve privacy for Word review', exact: true });
    await expect(approve).toBeVisible();await approve.focus();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => modal.evaluate(element => getComputedStyle(element).opacity === '1'
      && !element.getAnimations().some(animation => animation.playState === 'running'))).toBe(true);
    const bounds = await handoff.evaluate(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { left: box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth),
        right: box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth),
        buttons: [...element.querySelectorAll('button')].map(button => ({ label: button.textContent,
          left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right,
          height: button.getBoundingClientRect().height, whiteSpace: getComputedStyle(button).whiteSpace })) };
    });
    for (const button of bounds.buttons) {
      expect(button.left, button.label ?? '').toBeGreaterThanOrEqual(bounds.left - 1);
      expect(button.right, button.label ?? '').toBeLessThanOrEqual(bounds.right + 1);
      expect(button.height).toBeGreaterThanOrEqual(36);expect(button.whiteSpace).toBe('normal');
    }
    await page.screenshot({ path: info.outputPath(`word-actions-${theme}-320.png`), fullPage: true, animations: 'disabled' });
    await handoff.getByRole('button', { name: 'Cancel Word review export', exact: true }).click();
    await expect(approve).toBeHidden();await closeReviewRounds(modal);
  });
}
