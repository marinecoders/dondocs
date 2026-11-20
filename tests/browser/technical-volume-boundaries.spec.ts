import { expect, test } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { volumeFixture } from '../_helpers/volumeFixture';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { signingPdfDownload } from '../_helpers/signingBrowser';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });
test.setTimeout(180_000);

for (const frontMatter of [false, true]) {
  test(`renders bounded volume metadata and heading references with front matter=${frontMatter}`, async ({ page }, info) => {
    const source = volumeFixture();
    const volume = source.formData.volume!;
    volume.includeContents = frontMatter;
    volume.changes = frontMatter ? volume.changes : [];
    volume.glossary = [];
    volume.chapters[0].title = 'Continue with {{VOLREF_checks}}';
    Object.assign(source.formData, {
      subject: 'VolumeTitle'.repeat(25), shortTitle: 'SHORTTITLE'.repeat(20),
      controllingOffice: 'ControllingOffice'.repeat(15),
      ...(frontMatter ? { classLevel: 'cui', cuiControlledBy: 'ControlledBy'.repeat(20), cuiCategory: 'PRVCY', cuiDissemination: 'Dissemination'.repeat(20), pocEmail: 'a'.repeat(60) + '@training.mil' } : {}),
    });
    source.paragraphs.find(paragraph => paragraph.bodyTable)!.bodyTable = { rows: [['ID', 'Detail'], ['012345678901234567', 'Retained adjacent table cell.']], headerRows: 1, columnWidths: [5, 95], fontSize: 10 };
    await page.addInitScript(() => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll', previewVisible: false }, version: 1 }));
    });
    await page.route('**/classification.config.json?deployment-policy=runtime*', route => route.fulfill({ json: { maxLevel: 'cui', allowedLevels: ['unclassified', 'cui'] } }));
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({ name: 'volume-boundaries.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...source, documentCategory: 'correspondence' })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await expect(page.getByLabel('Volume title', { exact: true })).toHaveValue(source.formData.subject!);
    const bytes = await signingPdfDownload(page, info.project.name, async () => {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Download PDF/ }).click();
      if (frontMatter) await page.getByRole('button', { name: 'Download Anyway', exact: true }).click();
    });
    const { boxes, collisions } = await pdfTextLayout(bytes);
    expect(boxes.filter(box => box.left < 70 || box.right > 542)).toEqual([]);
    expect(collisions).toEqual([]);
    expect(boxes.map(box => box.text).join('').replace(/\s/g, '')).toContain('012345678901234567');
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      const outline = (await pdf.getOutline())!.map(item => item.title).join(' ');
      expect(outline).toContain('Continue with 2.1.1');
      expect(outline).not.toContain('VOLREF');
      if (!frontMatter) expect((await pdf.getPageLabels())!.slice(0, 2)).toEqual(['Cover', '1']);
    } finally { await task.destroy(); }
  });
}
