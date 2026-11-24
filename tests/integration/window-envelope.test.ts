import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import type { WindowEnvelopeLayout } from '@/lib/windowEnvelope';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { compileFixture } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;
const artifacts = process.env.DONDOCS_WINDOW_ENVELOPE_ARTIFACTS;
const wordRenderer = process.env.DONDOCS_WINDOW_ENVELOPE_WORD_RENDERER;

function textLocations(path: string) {
  const xml = execFileSync('pdftotext', ['-bbox-layout', path, '-'], { encoding: 'utf8' });
  const root = new DOMParser().parseFromString(xml, 'application/xml');
  const page = root.getElementsByTagName('page')[0];
  expect(Number(page.getAttribute('width'))).toBeCloseTo(612, 0);
  expect(Number(page.getAttribute('height'))).toBeCloseTo(792, 0);
  return Array.from(page.getElementsByTagName('word'), word => ({
    text: word.textContent, top: Number(word.getAttribute('yMin')), bottom: Number(word.getAttribute('yMax')),
    left: Number(word.getAttribute('xMin')), right: Number(word.getAttribute('xMax')),
  }));
}

describe.skipIf(!hasPdfToolchain || !hasPandoc)('window-envelope PDF and editable Word output', () => {
  it.each(['standard', 'salutation', 'subject', 'preprinted'] as const)('prints the %s opening with five address lines and the selected heading', async variant => {
    const layout: WindowEnvelopeLayout = variant === 'preprinted' ? 'salutation' : variant;
    const store = buildBaseline(layout === 'standard' ? 'naval_letter' : 'business_letter');
    Object.assign(store.formData, {
      windowEnvelope: layout,
      date: layout === 'standard' ? 'November 23, 2026' : '23 Nov 2026',
      to: 'ADDRESSONE\nADDRESSTWO\nADDRESSTHREE\nADDRESSFOUR\nADDRESSFIVE',
      subject: 'SUBJECTPROBE', salutation: 'SALUTATIONPROBE:', from: 'SOURCECOMMAND',
      via: '', unitLine1: 'SYNTHETIC TRAINING COMMAND', fontFamily: 'times', fontSize: '12pt',
      ...(variant === 'preprinted' ? { letterheadMode: 'preprinted' } : {}),
    });
    store.paragraphs = [{ id: 'window-body', level: 0, text: 'BODYPROBE keeps the letter readable after the window block.' }];
    const native = await compileFixture(store);
    expect(native.ok, native.logTail).toBe(true);
    const locations = textLocations(join(native.workDir, 'main.pdf'));
    const words = locations.map(word => word.text);
    const expectedDate = layout === 'standard' ? '23 Nov 26' : 'November 23, 2026';
    expect(words.join(' ')).toContain(expectedDate);
    if (variant === 'preprinted') expect(words).not.toContain('SYNTHETIC');
    expect(words).not.toContain('SOURCECOMMAND');
    expect(words).not.toContain('To:');
    expect(words).not.toContain('Via:');
    expect(words).toContain(layout === 'salutation' ? 'SALUTATIONPROBE:' : 'SUBJECTPROBE');
    expect(words).not.toContain(layout === 'salutation' ? 'SUBJECTPROBE' : 'SALUTATIONPROBE:');
    const symbol = locations.find(word => word.text === store.formData.ssic)!;
    expect(locations.find(word => word.text === 'Ser')!.left).toBeCloseTo(symbol.left, 1);
    const first = locations.find(word => word.text === 'ADDRESSONE')!;
    const last = locations.find(word => word.text === 'ADDRESSFIVE')!;
    const heading = locations.find(word => word.text === (layout === 'salutation' ? 'SALUTATIONPROBE:' : 'SUBJECTPROBE'))!;
    expect(first.left).toBeCloseTo(72, 0);
    expect(first.right).toBeLessThan(306);
    expect(first.top).toBeGreaterThanOrEqual(layout === 'standard' ? 191 : 179);
    expect(first.top).toBeLessThan(layout === 'standard' ? 201 : 189);
    expect(last.top - first.top).toBeCloseTo(48, 0);
    expect(heading.top).toBeGreaterThanOrEqual(287);
    expect(heading.top).toBeLessThan(297);
    expect(locations.find(word => word.text === 'BODYPROBE')!.top).toBeGreaterThan(heading.bottom);

    const raw = await compileDocxFixture(store);
    expect(raw.ok, raw.log).toBe(true);
    const word = await postProcessDocx(new Blob([new Uint8Array(raw.docxBytes!)]), { ...store.formData, docType: store.docType });
    const bytes = new Uint8Array(await word.arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    const document = await zip.file('word/document.xml')!.async('string');
    expect(document).not.toContain('DonDocsWindowRow');
    expect(document).toContain(expectedDate);
    expect(document).not.toContain('SOURCECOMMAND');
    expect(document).toContain('ADDRESSFIVE');
    expect(document).toContain(layout === 'salutation' ? 'SALUTATIONPROBE:' : 'SUBJECTPROBE');
    expect(document).not.toContain(layout === 'salutation' ? 'SUBJECTPROBE' : 'SALUTATIONPROBE:');
    expect(document).toMatch(/<w:spacing[^>]*w:line="240" w:lineRule="exact"[^>]*\/>/);
    if (artifacts || wordRenderer) {
      if (artifacts) await mkdir(artifacts, { recursive: true });
      const directory = await mkdtemp(join(artifacts ?? tmpdir(), `dondocs-window-${variant}-`));
      const docx = join(directory, `${variant}.docx`);
      await writeFile(join(directory, `${variant}-pdf.pdf`), native.pdfBytes!);
      await writeFile(docx, bytes);
      if (wordRenderer) {
        const profile = pathToFileURL(join(directory, 'writer-profile')).href;
        execFileSync(wordRenderer, [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', directory, docx], { timeout: 25_000 });
        const rendered = textLocations(join(directory, `${variant}.pdf`));
        const renderedFirst = rendered.find(word => word.text === first.text)!;
        const renderedLast = rendered.find(word => word.text === last.text)!;
        const renderedHeading = rendered.find(word => word.text === heading.text)!;
        expect(Math.abs(renderedFirst.left - first.left)).toBeLessThan(0.5);
        expect(Math.abs(renderedFirst.top - first.top)).toBeLessThan(5);
        expect(Math.abs(renderedHeading.top - heading.top)).toBeLessThan(5);
        expect(renderedLast.top - renderedFirst.top).toBeCloseTo(48, 0);
        expect(renderedLast.right).toBeLessThan(306);
        const renderedSymbol = rendered.find(word => word.text === symbol.text)!;
        expect(rendered.find(word => word.text === 'Ser')!.left).toBeCloseTo(renderedSymbol.left, 1);
        expect(rendered.find(word => word.text === 'BODYPROBE')!.top).toBeGreaterThan(renderedHeading.bottom);
      }
    }
  }, 45_000);
});
