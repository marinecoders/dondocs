import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { businessLetterContinuation } from '@/services/latex/businessLetter';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';

const available = ['xelatex', 'pandoc'].every(command => spawnSync(command, ['--version']).status === 0);
const identifiers = ['5630', 'Ser N43/081', 'November 18, 2026'];

function businessLetter() {
  const store = buildBaseline('business_letter');
  store.documentMode = 'compliant';
  Object.assign(store.formData, {
    ssic: '5630', officeCode: 'N43', serial: '081', date: '2026-11-18', showSubjectOnContinuation: true,
    subject: 'LAYOUT FIXTURE SUBJECT', sigFirst: '', sigMiddle: '', sigLast: 'CLOSINGSIGNATURE',
    businessSeparateMailing: 'Separate course guide & agenda',
  });
  store.enclosures = [{ title: 'Training outline' }, { title: 'Room diagram' }];
  store.copyTos = [{ text: 'Training coordinator' }];
  return store;
}

async function wordParts(store: ReturnType<typeof businessLetter>) {
  const result = await compileDocxFixture(store);
  expect(result.ok, formatDocxFailure('Chapter 11 DOCX', result)).toBe(true);
  const word = await postProcessDocx(new Blob([new Uint8Array(result.docxBytes!)]), {
    docType: store.docType, fontSize: store.formData.fontSize,
    businessIdentification: businessLetterContinuation(store.docType, store.formData), pageNumbering: 'simple',
  });
  const zip = await JSZip.loadAsync(await word.arrayBuffer(), { checkCRC32: true });
  return (name: string) => zip.file(`word/${name}.xml`)!.async('string');
}

describe.skipIf(!available)('business letter Chapter 11 output', () => {
  it('repeats the sender block on every continuation and places closing notations after the signature', async () => {
    const store = businessLetter();
    store.paragraphs = Array.from({ length: 75 }, (_, index) => ({ level: 0,
      text: `BODYPROBE${String(index).padStart(2, '0')} contains a synthetic paragraph for testing continuation formatting and page positions.`,
    }));
    const native = await compileFixture(store);
    expect(native.ok, formatFailure('Chapter 11 PDF', native)).toBe(true);
    const { boxes } = await pdfTextLayout(native.pdfBytes!);
    const pages = [...new Set(boxes.map(box => box.page))];
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const page of pages) {
      const contents = boxes.filter(box => box.page === page);
      const identification = identifiers.map(line => contents.find(box => box.text === line)!);
      expect(identification.map(box => box?.text), `identification on page ${page}`).toEqual(identifiers);
      for (const box of identification) expect(box.left).toBeCloseTo(72, 0);
      expect(identification[0].bottom).toBeGreaterThan(identification[1].top);
      expect(identification[1].bottom).toBeGreaterThan(identification[2].top);
      const firstBody = contents.find(box => box.text.startsWith('BODYPROBE'));
      if (page > 1) {
        expect(contents.some(box => box.text.includes('LAYOUT FIXTURE SUBJECT'))).toBe(false);
        expect(identification[0].top).toBeGreaterThan(709);
        expect(identification[0].top).toBeLessThan(736);
        if (firstBody) expect(identification[2].bottom - firstBody.top).toBeGreaterThan(8);
        expect(contents.some(box => box.text === String(page) && box.bottom < 50 && Math.abs((box.left + box.right) / 2 - 306) < 2)).toBe(true);
      } else {
        expect(contents.some(box => box.text === '1' && box.bottom < 50)).toBe(false);
      }
    }
    const pdfText = boxes.map(box => box.text).join(' ');
    expect(pdfText).toMatch(/BODYPROBE74.*CLOSINGSIGNATURE.*Enclosures:.*1\.\s+Training outline.*2\.\s+Room diagram.*Separate Mailing:.*Separate course guide & agenda.*Copy to:/);

    const part = await wordParts(store);
    const body = await part('document');
    expect(body).toMatch(/BODYPROBE74.*CLOSINGSIGNATURE.*Enclosures:.*1\..*Training outline.*2\..*Room diagram.*Separate Mailing:.*Separate course guide &amp; agenda.*Copy to:/s);
    const header = await part('header2');
    expect(header).toMatch(/5630.*Ser N43\/081.*November 18, 2026/s);
    expect(header).not.toContain('LAYOUT FIXTURE SUBJECT');
    expect(await part('header1')).not.toContain('5630');
    expect(await part('footer1')).not.toContain(' PAGE ');
    expect(await part('footer2')).toContain(' PAGE ');
  });

  it.each(['single', 'count', 'empty'] as const)('renders a %s enclosure notation in both formats', async mode => {
    const store = businessLetter();
    if (mode === 'single') store.enclosures = [{ title: 'Training outline' }];
    if (mode === 'count') store.formData.businessEnclosuresCountOnly = true;
    if (mode === 'empty') {
      store.enclosures = [];
      store.formData.businessSeparateMailing = '';
      store.formData.businessEnclosuresCountOnly = true;
    }
    const native = await compileFixture(store);
    expect(native.ok, formatFailure('optional Chapter 11 PDF', native)).toBe(true);
    const pdf = (await pdfTextLayout(native.pdfBytes!)).boxes.map(box => box.text).join(' ');
    const docx = await (await wordParts(store))('document');
    const text = [pdf, docx];
    if (mode === 'single') for (const contents of text) {
      expect(contents).toMatch(/Enclosure:.*Training outline/s);
      expect(contents).not.toMatch(/Enclosures:.*Training outline/s);
    }
    if (mode === 'count') for (const contents of text) {
      expect(contents).toContain('Enclosures (2)');
      expect(contents).not.toContain('Training outline');
    }
    if (mode === 'empty') for (const contents of text) {
      expect(contents).not.toContain('Enclosures');
      expect(contents).not.toContain('Separate Mailing:');
    }
  });
});
