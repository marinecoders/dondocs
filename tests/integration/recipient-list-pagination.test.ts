import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { compileFixture } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';
import { postProcessDocx } from '@/services/docx/pandoc-converter';

const cases = ['distribution', 'copy'].flatMap(kind => [3, 110].map(count => ({ kind, count })));
describe('recipient list completeness and pagination', () => {
  describeToolchainRequirement('recipient pagination');
  it.skipIf(!hasPdfToolchain).each(cases)('$kind preserves $count recipients in PDF and final Word paragraphs', async ({ kind, count }) => {
    const store = buildBaseline('naval_letter');
    store.formData.subject = 'RECIPIENT LIST PAGINATION';store.formData.signatureType = 'none';
    store.references = [];store.enclosures = [];store.copyTos = [];store.distributions = [];
    store.paragraphs = [{ level: 0, text: 'Preserve every recipient through the exported document.' }];
    const start = (i: number) => `${kind.toUpperCase()}START${String(i).padStart(3, '0')}`;
    const end = (i: number) => `${kind.toUpperCase()}END${String(i).padStart(3, '0')}`;
    const entries = Array.from({ length: count }, (_, i) => ({ text: `${start(i)} Office receiving this correspondence for action and retention in the official unit record. Additional routing details remain with this recipient. ${end(i)}` }));
    if (kind === 'distribution') store.distributions = entries;else store.copyTos = entries;
    const pdf = await compileFixture(store);expect(pdf.ok, pdf.logTail).toBe(true);
    expect(await readFile(join(pdf.workDir, 'main.log'), 'utf8')).not.toMatch(/Overfull \\vbox/);
    const layout = await pdfTextLayout(pdf.pdfBytes!);
    expect(layout.collisions).toEqual([]);
    const markers = layout.boxes.filter(box => box.text.includes(`${kind.toUpperCase()}START`) || box.text.includes(`${kind.toUpperCase()}END`));
    for (let i = 0; i < count; i++) for (const marker of [start(i), end(i)]) {
      const found = markers.filter(box => box.text.includes(marker));expect(found, marker).toHaveLength(1);
      expect(found[0].left, marker).toBeGreaterThanOrEqual(71);
      expect(found[0].right, marker).toBeLessThanOrEqual(541);
      expect(found[0].bottom, marker).toBeGreaterThanOrEqual(71);
      expect(found[0].top, marker).toBeLessThanOrEqual(721);
    }
    if (count === 110) expect(markers.find(box => box.text.includes(end(count - 1)))!.page).toBeGreaterThan(1);
    const converted = await compileDocxFixture(store);expect(converted.ok, converted.log).toBe(true);
    const word = await postProcessDocx(new Blob([new Uint8Array(converted.docxBytes!)]), { docType: 'naval_letter', fontFamily: 'times', fontSize: '12pt' });
    const zip = await JSZip.loadAsync(await word.arrayBuffer());const xml = await zip.file('word/document.xml')!.async('string');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    expect(document.documentElement.getAttribute('xmlns:w')).toBe(wordNamespace);
    const paragraphs = Array.from(document.getElementsByTagName('w:p'));
    const textOf = (paragraph: Element) => Array.from(paragraph.getElementsByTagName('w:t'), node => node.textContent ?? '').join('');
    const styleDocument = new DOMParser().parseFromString(await zip.file('word/styles.xml')!.async('string'), 'application/xml');
    expect(styleDocument.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(styleDocument.documentElement.getAttribute('xmlns:w')).toBe(wordNamespace);
    const styles = new Map(Array.from(styleDocument.getElementsByTagName('w:style'), style => [style.getAttribute('w:styleId'), style] as const));
    const defaultStyle = [...styles.values()].find(style => style.getAttribute('w:type') === 'paragraph' && style.getAttribute('w:default') === '1')?.getAttribute('w:styleId') ?? 'Normal';
    const expectBreakable = (element: Element) => {
      for (const name of ['keepNext', 'keepLines', 'ind']) expect(element.getElementsByTagName(`w:${name}`)).toHaveLength(0);
    };
    for (const defaults of styleDocument.getElementsByTagName('w:pPrDefault')) expectBreakable(defaults);
    for (let i = 0; i < count; i++) {
      const matching = paragraphs.filter(p => textOf(p).includes(start(i)));expect(matching, start(i)).toHaveLength(1);
      const paragraph = matching[0];
      expect(textOf(paragraph)).toBe(entries[i].text);
      expect(paragraph.parentElement?.tagName).toBe('w:body');
      expectBreakable(paragraph);
      let styleId = paragraph.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? defaultStyle;
      const seen = new Set<string>();
      while (styleId) {
        expect(seen.has(styleId), 'paragraph style inheritance must not cycle').toBe(false);
        seen.add(styleId);
        const style = styles.get(styleId);
        expect(style, `paragraph style ${styleId} must exist`).toBeDefined();
        expectBreakable(style!);
        styleId = style!.getElementsByTagName('w:basedOn')[0]?.getAttribute('w:val') ?? '';
      }
    }
    const proofs = join(tmpdir(), 'dondocs-recipient-proofs');await mkdir(proofs, { recursive: true });
    await writeFile(join(proofs, `${kind}-${count}.pdf`), pdf.pdfBytes!);
    await writeFile(join(proofs, `${kind}-${count}.docx`), new Uint8Array(await word.arrayBuffer()));
  }, 180_000);
});
