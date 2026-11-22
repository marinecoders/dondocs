import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it } from 'vitest';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { compileFixture } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';
import { jointLetterFixture } from '../_helpers/jointLetterFixture';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

const libreOffice = process.env.DONDOCS_CORRESPONDENCE_PRINT_LIBREOFFICE;
const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;
const exec = (command: string, args: string[]) => execFileSync(command, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });

function measured(path: string, width: number, height: number, markers: string[], heightTolerance = 0.05) {
  const tree = new DOMParser().parseFromString(exec('pdftotext', ['-bbox-layout', path, '-']), 'application/xml');
  const pages = Array.from(tree.getElementsByTagName('page'));
  expect(pages.length).toBeGreaterThan(0);
  const paper = pages.map(page => {
    const actual = { width: Number(page.getAttribute('width')), height: Number(page.getAttribute('height')) };
    expect(Math.abs(actual.width - width)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(actual.height - height)).toBeLessThanOrEqual(heightTolerance);
    return actual;
  });
  const coordinate = (word: Element, attribute: string) => {
    const value = word.getAttribute(attribute)?.trim();
    return value ? Number(value) : Number.NaN;
  };
  const words = pages.flatMap((page, index) => Array.from(page.getElementsByTagName('word'), word => {
    const left = coordinate(word, 'xMin'), top = coordinate(word, 'yMin');
    const right = coordinate(word, 'xMax'), bottom = coordinate(word, 'yMax');
    const text = word.textContent, size = paper[index];
    expect([left, top, right, bottom].every(Number.isFinite) && left >= -1 && top >= -1
      && right >= left && bottom >= top && right <= size.width + 1 && bottom <= size.height + 1,
      `${path}, page ${index + 1}: ${text}`).toBe(true);
    return { text, page: index + 1, left, top, right, bottom };
  }));
  const positions = markers.map(marker => {
    const matches = words.filter(word => word.text === marker);
    expect(matches, `${path}: ${marker}`).toHaveLength(1);
    const point = matches[0];
    expect(point.left).toBeGreaterThanOrEqual(70);
    expect(point.right).toBeLessThanOrEqual(width - 70);
    return point;
  });
  return { pages: pages.length, paper, positions };
}

describe.skipIf(!libreOffice)('measured correspondence in native PDF and LibreOffice', () => {
  beforeAll(() => {
    expect(hasPdfToolchain && hasPandoc, 'Native PDF, Pandoc and Poppler are required for this opted-in renderer run.').toBe(true);
  });
  it.each(['5x7', '7x9', 'joint'] as const)('%s retains source paper dimensions and required content', async name => {
    const directory = process.env.DONDOCS_CORRESPONDENCE_PRINT_DIR ?? await mkdtemp(join(tmpdir(), 'dondocs-correspondence-print-'));
    await mkdir(directory, { recursive: true });
    const store = name === 'joint' ? jointLetterFixture(true) : buildBaseline('executive_correspondence');
    const width = name === '5x7' ? 360 : name === '7x9' ? 504 : 612;
    const height = name === '5x7' ? 504 : name === '7x9' ? 648 : 792;
    let markers: string[];
    if (name === 'joint') {
      Object.assign(store.formData, { jointJuniorSigName: 'JUNIORSIGN', jointSeniorSigName: 'SENIORSIGN' });
      store.formData.jointAdditionalCommands![0].signatureName = 'MIDDLESIGN';
      markers = ['JUNIORSIGN', 'MIDDLESIGN', 'SENIORSIGN'];
    } else {
      Object.assign(store.formData, { stationerySize: name, letterheadMode: 'preprinted', subject: '',
        date: '', to: '', signatureType: 'none', fontFamily: 'times', fontSize: '12pt' });
      markers = Array.from({ length: 16 }, (_, index) => `BODYPROBE${index}`);
      store.paragraphs = markers.map((marker, index) => ({ id: `body-${index}`, level: 0,
        text: `${marker} Retain the complete synthetic paragraph on the selected stationery.` }));
    }

    const native = await compileFixture(store);
    expect(native.ok, native.logTail).toBe(true);
    const docx = await compileDocxFixture(store);
    expect(docx.ok, docx.log).toBe(true);
    const supported = await postProcessDocx(new Blob([new Uint8Array(docx.docxBytes!)]), { ...store.formData, docType: store.docType });
    // Convert the just-generated file in its own directory so retained evidence
    // from another invocation cannot masquerade as a successful fresh print.
    const renderDir = await mkdtemp(join(directory, `${name}-`));
    const inputPath = join(renderDir, `${name}.docx`);
    const nativePath = join(renderDir, 'native.pdf');
    const printedPath = join(renderDir, `${name}.pdf`);
    const docxBytes = new Uint8Array(await supported.arrayBuffer());
    const xml = await (await JSZip.loadAsync(docxBytes)).file('word/document.xml')!.async('string');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const sections = Array.from(document.getElementsByTagName('w:pgSz'));
    expect(sections.length).toBeGreaterThan(0);
    for (const size of sections) {
      expect(Number(size.getAttribute('w:w'))).toBe(width * 20);
      expect(Number(size.getAttribute('w:h'))).toBe(height * 20);
    }
    await writeFile(inputPath, docxBytes);
    await writeFile(nativePath, native.pdfBytes!);
    const version = exec(libreOffice!, ['--version']).trim();
    expect(version).toMatch(/^LibreOffice/);
    const profile = pathToFileURL(join(renderDir, 'libreoffice-profile')).href;
    exec(libreOffice!, [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', renderDir, inputPath]);
    expect(exec('pdfinfo', [printedPath])).toMatch(/^Producer:\s+LibreOffice/m);
    const nativeMetrics = measured(nativePath, width, height, markers);
    // This LibreOffice build rounds 7×9 height to about 649.16 pt. The
    // DOCX and native PDF checks above still require the authored dimensions.
    const wordMetrics = measured(printedPath, width, height, markers, name === '7x9' ? 1.25 : 0.1);
    if (name === 'joint') {
      for (const metrics of [nativeMetrics, wordMetrics]) {
        const [junior, middle, senior] = metrics.positions;
        expect(middle.page).toBe(junior.page);
        expect(senior.page).toBe(junior.page);
        expect(junior.right).toBeLessThan(middle.left);
        expect(middle.right).toBeLessThan(senior.left);
        expect(Math.abs(middle.top - junior.top)).toBeLessThan(2);
        expect(Math.abs(senior.top - junior.top)).toBeLessThan(2);
      }
    } else {
      expect(nativeMetrics.pages).toBeGreaterThan(1);
      expect(wordMetrics.pages).toBeGreaterThan(1);
    }
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(renderDir, 'layout.json'), JSON.stringify({ name, version, width, height, nativeMetrics, wordMetrics,
      docxSha256: digest(docxBytes), nativeSha256: digest(native.pdfBytes!), printedSha256: digest(await readFile(printedPath)),
    }, null, 2));
  }, 120_000);
});
