import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
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
