import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { wordLayoutFixtures } from '../_helpers/wordLayoutQualification';
import { wordContinuationFixtures } from '../_helpers/wordContinuationFixtures';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

for (const fixture of wordContinuationFixtures().filter(item => ['continuation-times-12pt', 'continuation-courier-10pt'].includes(item.name))) {
  test(`preserves escaped continuation subjects through browser Word export: ${fixture.name}`, async ({ page }, info) => {
    await page.addInitScript(() => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
    });
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({ name: `${fixture.name}.json`, mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...fixture.store, documentCategory: 'correspondence', documentMode: 'compliant' })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const saving = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
    const download = await saving;
    expect(await download.failure()).toBeNull();
    const path = info.outputPath(`${fixture.name}.docx`);
    await download.saveAs(path);
    const zip = await JSZip.loadAsync(await readFile(path));
    const header = await zip.file('word/header2.xml')!.async('string');
    const text = await page.evaluate(xml => {
      const dom = new DOMParser().parseFromString(xml, 'application/xml');
      if (dom.querySelector('parsererror')) throw new Error('Invalid continuation header XML');
      return [...dom.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't')].map(node => node.textContent).join('');
    }, header);
    expect(text).toBe(`Subj:  ${fixture.store.formData.subject}`);
    const body = await zip.file('word/document.xml')!.async('string');
    for (const marker of fixture.markers) expect(body.match(new RegExp(`\\b${marker}\\b`, 'g')), marker).toHaveLength(1);
  });
}

test('exports the deep layout fixture through the browser Word pipeline', async ({ page }, info) => {
  const fixture = (await wordLayoutFixtures()).find(item => item.name === 'naval-deep')!;
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const draft = { ...fixture.store, documentCategory: 'correspondence', documentMode: fixture.store.documentMode ?? 'compliant' };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'naval-deep.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const saving = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const structure = page.getByRole('dialog', { name: 'Check paragraph structure', exact: true });
  await expect(structure).toBeVisible();
  await structure.getByRole('button', { name: 'Download anyway', exact: true }).click();
  const download = await saving;
  expect(await download.failure()).toBeNull();
  const path = info.outputPath('naval-deep-browser.docx');
  await download.saveAs(path);
  const bytes = await readFile(path);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  const text = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join(' ');
  for (const marker of fixture.markers) expect(text.match(new RegExp(`\\b${marker}\\b`, 'g')), marker).toHaveLength(1);
  const continuation = await zip.file('word/header2.xml')!.async('string');
  expect(continuation).toContain('WORD LAYOUT QUALIFICATION');
  expect(continuation).toContain('w:before="480"');
  const directory = process.env.DONDOCS_BROWSER_WORD_LAYOUT_ARTIFACTS;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'naval-deep-browser.docx'), bytes);
    await writeFile(join(directory, 'browser-source.json'), JSON.stringify({
      pipeline: 'browser-wasm', docxSha256: createHash('sha256').update(bytes).digest('hex'),
      project: info.project.name, draft, markers: fixture.markers,
    }, null, 2));
  }
});

test('keeps figure blocks out of browser Word paragraph numbering', async ({ page }, info) => {
  const fixture = (await wordLayoutFixtures()).find(item => item.name === 'business-figure')!;
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const draft = { ...fixture.store, documentCategory: 'correspondence',
    paragraphs: fixture.store.paragraphs.map(paragraph => paragraph.figure ? {
      ...paragraph, figure: { name: paragraph.figure.name, type: paragraph.figure.type,
        data: Buffer.from(fixture.figure!).toString('base64') },
    } : paragraph) };
  await page.getByLabel('Import draft file').setInputFiles({ name: 'business-figure.json',
    mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const saving = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const download = await saving;
  expect(await download.failure()).toBeNull();
  const path = info.outputPath('business-figure-browser.docx');
  await download.saveAs(path);
  const bytes = await readFile(path);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
  for (let index = 0; index < 8; index++) {
    const marker = `BUSINESS${index}`;
    const paragraph = paragraphs.find(value => value.includes(marker))!;
    expect(paragraph, marker).toBeDefined();
    const text = [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('');
    expect(text).toMatch(new RegExp(`^${index + 1}\\.\\s+${marker}\\b`));
  }
  expect(xml.match(/descr="Handwritten signature image"/g)).toHaveLength(1);
  const directory = process.env.DONDOCS_BROWSER_WORD_LAYOUT_ARTIFACTS;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'business-figure-browser.docx'), bytes);
    await writeFile(join(directory, 'business-figure-browser-source.json'), JSON.stringify({
      pipeline: 'browser-wasm', docxSha256: createHash('sha256').update(bytes).digest('hex'),
      project: info.project.name, draft, markers: fixture.markers,
    }, null, 2));
  }
});
