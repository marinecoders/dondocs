import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

test('Word exports retain safe reference targets after reordering with PDF links disabled', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme: 'light', editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  const title = 'Bravo H&S $5M {revision} _annex_ ~ ^ \\ source';
  const url = 'https://example.com/order_a?x=1&y=2#section';
  await page.getByLabel('Import draft file').setInputFiles({ name: 'word-reference-links.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'WORD REFERENCE LINKS', from: 'Commanding Officer', to: 'Training Officer', date: '13 Nov 26', sigLast: 'DOE', includeHyperlinks: false },
    references: [{ letter: 'a', title: 'Alpha source', url: 'https://example.com/alpha' }, { letter: 'b', title, url },
      { letter: 'c', title: 'Unsafe source', url: 'javascript:alert(1)' }, { letter: 'd', title: 'Plain source' }],
    paragraphs: [{ text: 'Follow reference (b), then reference (a).', level: 0 }], enclosures: [], copyTos: [], distributions: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Include hyperlinks in PDF', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Review first-citation order', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review reference changes' }).getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByLabel('Reference (a) title', { exact: true })).toHaveValue(title);
  const downloading = page.waitForEvent('download', { predicate: download => download.suggestedFilename().endsWith('.docx') });
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const xml = await zip.file('word/document.xml')!.async('string');
  const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
  const output = await page.evaluate(({ xml, rels }) => {
    const parser = new DOMParser();
    const document = parser.parseFromString(xml, 'application/xml');
    const relations = parser.parseFromString(rels, 'application/xml');
    const targets = new Map([...relations.getElementsByTagName('Relationship')]
      .filter(relation => relation.getAttribute('Type')?.endsWith('/hyperlink'))
      .map(relation => [relation.getAttribute('Id'), relation.getAttribute('Target')]));
    return { text: [...document.getElementsByTagName('w:t')].map(run => run.textContent).join(' '),
      links: [...document.getElementsByTagName('w:hyperlink')].map(link => ({
        text: [...link.getElementsByTagName('w:t')].map(run => run.textContent).join(''),
        url: targets.get(link.getAttribute('r:id')), paragraph: link.parentElement?.textContent,
      })) };
  }, { xml, rels });
  expect(output.links.map(({ text, url }) => ({ text, url }))).toEqual([{ text: title, url }, { text: 'Alpha source', url: 'https://example.com/alpha' }]);
  expect(output.links[0].paragraph).toContain('(a)');
  expect(output.links[1].paragraph).toContain('(b)');
  expect(output.text).toContain('Unsafe source');
  expect(output.text).toContain('Plain source');
  expect(output.text).toContain('Follow Reference (a), then Reference (b).');
  expect(rels).not.toContain('javascript:');
});
