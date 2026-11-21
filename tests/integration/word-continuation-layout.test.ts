import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { wordContinuationFixtures } from '../_helpers/wordContinuationFixtures';

const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const renderedDirectory = process.env.DONDOCS_WORD_CONTINUATION_PRINTS;

describe('continued Word letters', () => {
  it('requires Pandoc in CI instead of silently skipping layout coverage', () => {
    if (process.env.CI) expect(hasPandoc).toBe(true);
  });

  it.skipIf(!hasPandoc || !!renderedDirectory).each(wordContinuationFixtures())('$name retains readable subject and all body text', async fixture => {
    const compiled = await compileDocxFixture(fixture.store);
    expect(compiled.ok, compiled.log).toBe(true);
    const blob = await postProcessDocx(new Blob([new Uint8Array(compiled.docxBytes!)]), {
      ...fixture.store.formData, docType: fixture.store.docType,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
    const header = parse(await zip.file('word/header2.xml')!.async('string'));
    const headerText = [...Array.from(header.getElementsByTagName('w:t'))].map(node => node.textContent).join('');
    expect(headerText).toBe(`Subj:  ${fixture.store.formData.subject}`);
    const firstHeader = await zip.file('word/header1.xml')!.async('string');
    expect(firstHeader).not.toContain('TRAINING');
    const bodyXml = await zip.file('word/document.xml')!.async('string');
    const bodyText = Array.from(parse(bodyXml).getElementsByTagName('w:t')).map(node => node.textContent).join(' ');
    for (const marker of fixture.markers) expect(bodyText.match(new RegExp(`\\b${marker}\\b`, 'g')), marker).toHaveLength(1);
    expect(await zip.file('word/footer2.xml')!.async('string')).toContain('PAGE');
    const directory = process.env.DONDOCS_WORD_CONTINUATION_ARTIFACTS;
    if (directory) {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `${fixture.name}.docx`), bytes);
      await writeFile(join(directory, `${fixture.name}.json`), JSON.stringify({ name: fixture.name,
        pipeline: 'native-pandoc', sha256: digest(bytes), subject: fixture.store.formData.subject,
        fontFamily: fixture.store.formData.fontFamily, fontSize: fixture.store.formData.fontSize,
        markers: fixture.markers, nativeWordQualification: 'pending' }, null, 2));
    }
  });
});

describe.skipIf(!renderedDirectory)('externally rendered Word continuation fixtures', () => {
  it.each(wordContinuationFixtures())('$name retains content on every printed page', async fixture => {
    const directory = process.env.DONDOCS_WORD_CONTINUATION_ARTIFACTS;
    if (!directory) throw new Error('Provide DONDOCS_WORD_CONTINUATION_ARTIFACTS with the exact retained DOCX sources.');
    const receipt = JSON.parse(await readFile(join(directory, `${fixture.name}.json`), 'utf8'));
    expect(receipt.sha256).toBe(digest(await readFile(join(directory, `${fixture.name}.docx`))));
    expect(receipt.subject).toBe(fixture.store.formData.subject);
    expect(receipt.markers).toEqual(fixture.markers);
    const pdf = join(renderedDirectory!, `${fixture.name}.pdf`);
    const metadata = spawnSync('pdfinfo', [pdf], { encoding: 'utf8' });
    expect(metadata.status, metadata.stderr).toBe(0);
    // Record the renderer honestly: LibreOffice printing is useful additional
    // coverage and never substitutes for native Microsoft Word qualification.
    expect(metadata.stdout).toMatch(/Creator:\s+(?:Writer|Word)\b/);
    const printed = spawnSync('pdftotext', ['-bbox-layout', pdf, '-'], { encoding: 'utf8' });
    expect(printed.status, printed.stderr).toBe(0);
    const xml = new DOMParser().parseFromString(printed.stdout, 'application/xml');
    const pages = Array.from(xml.getElementsByTagName('page'));
    expect(pages.length).toBeGreaterThan(1);
    const words = Array.from(xml.getElementsByTagName('word'));
    for (const marker of fixture.markers) expect(words.filter(word => word.textContent === marker), marker).toHaveLength(1);
    for (const [index, page] of pages.entries()) {
      expect(Number(page.getAttribute('width'))).toBeCloseTo(612, 0);
      expect(Number(page.getAttribute('height'))).toBeCloseTo(792, 0);
      const pageWords = Array.from(page.getElementsByTagName('word'));
      const text = pageWords.map(word => word.textContent).join(' ');
      expect(text, `Subject missing or corrupted on page ${index + 1}`).toContain(fixture.store.formData.subject);
      for (const word of pageWords) {
        expect(Number(word.getAttribute('xMin')), word.textContent ?? '').toBeGreaterThanOrEqual(70);
        expect(Number(word.getAttribute('xMax')), word.textContent ?? '').toBeLessThanOrEqual(542);
        expect(Number(word.getAttribute('yMin'))).toBeGreaterThanOrEqual(25);
        expect(Number(word.getAttribute('yMax'))).toBeLessThanOrEqual(768);
      }
    }
  });
});
