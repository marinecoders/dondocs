import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { publicationWordFixtures } from '../_helpers/publicationWordQualification';
import AxeBuilder from '@axe-core/playwright';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { signingPdfDownload } from '../_helpers/signingBrowser';

test.use({ serviceWorkers: 'block' });
test.setTimeout(180_000);

for (const [theme, width] of [['light', 1440], ['dark', 390], ['classic', 1024]] as const) {
  test(`authors a portable technical volume with stable references in ${theme} at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: value, editorLayout: 'scroll' }, version: 1 }));
    }, theme);
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({ name: 'technical-volume.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      documentMode: 'custom', documentCategory: 'correspondence', docType: 'technical_volume',
      formData: { subject: 'SYNTHETIC VOLUME', shortTitle: 'TM SYNTHETIC', date: '20 Nov 26', classLevel: 'unclassified', signatureType: 'none', volume: { version: 1, chapters: [{ id: 'intro', title: 'Introduction', sections: [{ id: 'general', title: 'General' }] }, { id: 'maint', title: 'Maintenance', sections: [{ id: 'checks', title: 'Checks' }] }], appendices: [{ id: 'appendix', title: 'Data', sections: [{ id: 'limits', title: 'Limits' }] }], glossary: [], changes: [], includeContents: true } },
      paragraphs: [{ id: 'first', volumeSectionId: 'general', text: 'Original introduction prose.', level: 0 }, { id: 'second', volumeSectionId: 'checks', text: 'SYNTHETIC-MAINTENANCE-END', level: 0 }, { id: 'appendix-body', volumeSectionId: 'limits', text: 'SYNTHETIC-APPENDIX-END', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [],
    })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(page.getByLabel('Volume title', { exact: true })).toHaveValue('SYNTHETIC VOLUME');
    await page.getByLabel('Volume title', { exact: true }).fill('SYNTHETIC EDITED VOLUME');
    await page.getByRole('button', { name: 'Move chapter 2 up', exact: true }).click();
    await expect(page.getByLabel('Chapter 1 title', { exact: true })).toHaveValue('Maintenance');
    await page.getByLabel('Editing section', { exact: true }).selectOption('checks');
    await page.getByRole('button', { name: 'Insert reference in 1.1.1', exact: true }).click();
    await page.getByLabel('Reference target', { exact: true }).selectOption('intro');
    await page.getByRole('button', { name: 'Insert reference at end', exact: true }).click();
    await page.getByRole('button', { name: 'Add volume table', exact: true }).click();
    await page.getByLabel('Table 4, row 2, column 1', { exact: true }).fill('SYNTHETIC-TABLE-END');
    await page.getByRole('button', { name: 'Add volume figure', exact: true }).click();
    const png = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#ccddee' } }).png().toBuffer();
    await page.getByLabel('Image for Figure 1.1-1', { exact: true }).setInputFiles({ name: 'synthetic-diagram.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByText('Retained image: synthetic-diagram.png', { exact: true })).toBeVisible();
    await page.getByLabel('Alternative text for Figure 1.1-1', { exact: true }).fill('Synthetic blue rectangle.');
    await page.getByRole('button', { name: 'Add glossary entry', exact: true }).click();
    await page.getByLabel('Term 1', { exact: true }).fill('Synthetic term');
    await page.getByLabel('Definition 1', { exact: true }).fill('SYNTHETIC-GLOSSARY-END');
    await page.getByRole('button', { name: 'Add change record', exact: true }).click();
    await page.getByLabel('Change 1 number', { exact: true }).fill('1');
    await page.getByLabel('Change 1 date', { exact: true }).fill('2026-11-20');
    await page.getByLabel('Change 1 description', { exact: true }).fill('SYNTHETIC-CHANGE-END');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`technical-volume-${theme}-${width}.png`), fullPage: true });
    const draftDownload = page.waitForEvent('download', { predicate: download => download.suggestedFilename().endsWith('.json') });
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
    const portable = await draftDownload;
    const draft = JSON.parse((await readFile((await portable.path())!)).toString());
    expect(draft.formData.volume.chapters.map((chapter: { id: string }) => chapter.id)).toEqual(['maint', 'intro']);
    expect(draft.paragraphs.find((paragraph: { id: string }) => paragraph.id === 'second').text).toContain('{{VOLREF_intro}}');
    expect(draft.paragraphs.find((paragraph: { figure?: unknown }) => paragraph.figure).figure.data).toBeTruthy();
    await page.reload();
    await expect(page.getByLabel('Volume title', { exact: true })).toHaveValue('SYNTHETIC EDITED VOLUME');
    await expect(page.getByLabel('Chapter 1 title', { exact: true })).toHaveValue('Maintenance');
    const bytes = await signingPdfDownload(page, info.project.name, async () => {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Download PDF/ }).click();
    });
    await writeFile(info.outputPath('technical-volume.pdf'), bytes);
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      expect(pdf.numPages).toBeGreaterThan(3);
      let text = '';
      for (let number = 1; number <= pdf.numPages; number++) text += (await (await pdf.getPage(number)).getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []).join(' ') + '\n';
      for (const value of ['SYNTHETIC EDITED VOLUME', 'SYNTHETIC-MAINTENANCE-END', 'SYNTHETIC-APPENDIX-END', 'SYNTHETIC-TABLE-END', 'SYNTHETIC-GLOSSARY-END', 'SYNTHETIC-CHANGE-END', 'Chapter 2']) expect(text).toContain(value);
      expect(text).not.toContain('{{VOLREF_');
      expect(text).not.toContain('volume.node.');
      expect(text).not.toContain('??');
      let links = 0;
      for (let number = 1; number <= pdf.numPages; number++) for (const annotation of await (await pdf.getPage(number)).getAnnotations()) {
        if (typeof annotation.dest === 'string' && annotation.dest.startsWith('volume.')) {
          expect(await pdf.getDestination(annotation.dest)).toBeTruthy();
          links++;
        }
      }
      expect(links).toBeGreaterThanOrEqual(7);
    } finally { await task.destroy(); }
  });
}

const publicationWordCases = new Set(['manual-standard', 'instruction-ti', 'sl3-portrait', 'sl4-parts', 'volume-structured']);
const publicationContactFields: Partial<Record<string, string>> = { sl3: 'Form: pocEmail', sl4: 'Form: pocEmail', i_type: 'Paragraph 2' };
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

for (const fixture of publicationWordFixtures().filter(({ name }) => publicationWordCases.has(name))) {
  test(`downloads editable Word for the ${fixture.name} publication`, async ({ page }, info) => {
    await page.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
    await page.goto('/');
    const source = structuredClone(fixture.source);
    const expectedImages = new Map<string, Buffer>();
    const paragraphs = await Promise.all(source.paragraphs.map(async paragraph => {
      const ref = paragraph.figure?.fileRef;
      const path = ref && fixture.assetFiles?.[ref.id];
      if (!ref || !path) return paragraph;
      const bytes = await readFile(path);
      expectedImages.set(ref.name, bytes);
      return { ...paragraph, figure: { ...paragraph.figure, fileRef: undefined, name: ref.name, data: bytes.toString('base64') } };
    }));
    await page.getByLabel('Import draft file').setInputFiles({
      name: `${fixture.name}.json`, mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...source, paragraphs, references: [], enclosures: [], copyTos: [],
        documentCategory: 'correspondence', documentMode: 'compliant' })),
    });
    const open = page.getByRole('button', { name: 'Open as new document', exact: true });
    await expect(open).toBeVisible({ timeout: 10_000 });
    await open.click();
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const word = page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true });
    await expect(word).toBeEnabled();
    const pending = page.waitForEvent('download', { timeout: 30_000 });
    await word.click();
    const emailLocation = publicationContactFields[source.docType];
    if (emailLocation) {
      const privacy = page.getByRole('dialog', { name: 'Potential PII/PHI Detected', exact: true });
      await expect(privacy).toBeVisible();
      await expect(privacy).toContainText(emailLocation);
      await privacy.getByRole('button', { name: 'Download Anyway', exact: true }).click();
    }
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(/\.docx$/);
    expect(await download.failure()).toBeNull();
    const output = info.outputPath(`${fixture.name}.docx`);
    await download.saveAs(output);

    const zip = await JSZip.loadAsync(await readFile(output));
    const xml = await zip.file('word/document.xml')!.async('string');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const nodes = (name: string) => Array.from(document.getElementsByTagNameNS(wordNamespace, name));
    const visible = nodes('p').map(paragraph => Array.from(paragraph.getElementsByTagNameNS(wordNamespace, 't'),
      node => node.textContent).join('')).join(' ');
    for (const marker of fixture.markers) expect(visible).toContain(marker);
    expect(nodes('tbl').length).toBeGreaterThan(0);
    expect(visible).not.toMatch(/\{\{(?:PUBREF|VOLREF)_/);
    const destinations = new Set(nodes('bookmarkStart').map(bookmark => bookmark.getAttributeNS(wordNamespace, 'name')));
    for (const link of nodes('hyperlink')) {
      const anchor = link.getAttributeNS(wordNamespace, 'anchor');
      if (anchor) expect(destinations.has(anchor)).toBe(true);
    }
    if (fixture.name === 'volume-structured') {
      expect(destinations.size).toBeGreaterThanOrEqual(7);
      expect(nodes('tblHeader')).toHaveLength(1);
      expect(xml).toContain('descr="Training illustration with two outlines"');
    }
    if (expectedImages.size) {
      const images = await Promise.all(zip.file(/^word\/media\/.*\.(png|jpe?g)$/).map(file => file.async('nodebuffer')));
      for (const [name, bytes] of expectedImages) expect(images.some(image => image.equals(bytes)), name).toBe(true);
    }
  });
}
