import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { resolvePageNumbering } from '@/lib/pageNumbering';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { buildBaseline } from '../_helpers/compileMatrix';
import { compileFixture, type TestStore } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

function letter(count = 2): TestStore {
  const store = buildBaseline('naval_letter');
  store.documentMode = 'compliant';
  Object.assign(store.formData, {
    pageNumbering: 'none', appendEndorsement: true,
    endorsementBody: 'Acknowledged.', endorsementSigLast: 'FIRSTSIGNER',
    additionalEndorsements: [{ id: 'second', endorsementDate: '17 Jan 26', endorsementSerial: '0150',
      endorsementBody: Array.from({ length: count }, (_, i) => `Review line ${i + 1}. All information must remain visible in the final document.`).join('\n'),
      endorsementSigLast: 'SECONDSIGNER' }],
  });
  return store;
}

async function word(store: TestStore) {
  const result = await compileDocxFixture(store);
  expect(result.ok, result.log).toBe(true);
  const blob = new Blob([new Uint8Array(result.docxBytes!).buffer]);
  const processed = await postProcessDocx(blob, {
    docType: store.docType, fontFamily: store.formData.fontFamily, fontSize: store.formData.fontSize,
    classLevel: store.formData.classLevel, letterheadColor: store.formData.letterheadColor,
    startingPageNumber: store.formData.startingPageNumber,
    pageNumbering: resolvePageNumbering(store.docType, store.documentMode, store.formData.pageNumbering),
  });
  return new Uint8Array(await processed.arrayBuffer());
}

async function pdfPages(store: TestStore) {
  const result = await compileFixture(store);
  expect(result.ok, result.errors.join('\n')).toBe(true);
  if (store.formData.pageNumbering === 'xofy' && store.documentMode === 'custom') {
    const rerun = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'main.tex'], { cwd: result.workDir });
    expect(rerun.status).toBe(0);
    result.pdfBytes = await readFile(join(result.workDir, 'main.pdf'));
  }
  const file = join(result.workDir, 'review.pdf');
  await writeFile(file, result.pdfBytes!);
  return extractedPages(file);
}

function extractedPages(path: string) {
  const result = spawnSync('pdftotext', [path, '-'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.split('\f').filter((page) => page.trim());
}

async function wordPages(store: TestStore) {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-word-endorsement-'));
  const file = join(dir, 'review.docx');
  await writeFile(file, await word(store));
  const result = spawnSync(process.env.DONDOCS_SOFFICE!, [
    '--headless', `-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`,
    '--convert-to', 'pdf', '--outdir', dir, file,
  ], { encoding: 'utf8', timeout: 45_000, env: { ...process.env, TMPDIR: '/tmp' } });
  expect(result.status, result.stderr).toBe(0);
  return extractedPages(join(dir, 'review.pdf'));
}

describe.skipIf(!hasPdfToolchain)('original endorsement and page-number complaints', () => {
  it.each([28, 40])('keeps at least two body lines with the PDF signature at the %i-paragraph boundary', async (count) => {
    const pages = await pdfPages(letter(count));
    const last = pages.at(-1)!;
    expect(last).toContain('SECONDSIGNER');
    expect(last).toContain(`Review line ${count - 1}.`);
    expect(last).toContain(`Review line ${count}.`);
    expect(pages[1]).toContain('SECOND ENDORSEMENT');
    expect(pages[1]).toMatch(/\non\s+Commanding Officer/);
    expect(pages[1]).toContain('1000');
    expect(pages[1]).toContain('OPERATIONAL READINESS REPORT');
    expect(pages[0]).not.toMatch(/^\s*1\s*$/m);
    for (let i = 1; i < pages.length; i++) expect(pages[i]).toMatch(new RegExp(`^\\s*${i + 1}\\s*$`, 'm'));
  });

  it('keeps downloaded flat TeX compilable with both endorsements', async () => {
    const store = letter();
    store.paragraphs = [{ level: 0, text: 'Basic letter content.' }];
    const dir = await mkdtemp(join(tmpdir(), 'dondocs-flat-endorsement-'));
    await writeFile(join(dir, 'flat.tex'), generateFlatLatex(store));
    await copyFile(join(process.cwd(), 'public/attachments/dow-seal.png'), join(dir, 'dow-seal.png'));
    const result = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'flat.tex'], { cwd: dir, encoding: 'utf8', timeout: 45_000 });
    expect(result.status, result.stdout.slice(-2000)).toBe(0);
    const text = extractedPages(join(dir, 'flat.pdf')).join(' ');
    expect(text).toContain('FIRSTSIGNER');
    expect(text).toContain('SECONDSIGNER');
  });

  it('omits unused additional drafts from both exports', async () => {
    const store = letter();
    store.formData.additionalEndorsements = [{ id: 'empty' }];
    const pages = await pdfPages(store);
    expect(pages).toHaveLength(1);
    expect(pages.join('')).not.toContain('SECOND ENDORSEMENT');
    const zip = await JSZip.loadAsync(await word(store));
    expect(await zip.file('word/document.xml')!.async('string')).not.toContain('SECOND ENDORSEMENT');
  });

  it('honors custom numbering choices, including a resolved PDF total', async () => {
    const store = letter();
    store.documentMode = 'custom';
    expect((await pdfPages(store))[1]).not.toMatch(/^\s*2\s*$/m);
    store.formData.pageNumbering = 'xofy';
    const pages = await pdfPages(store);
    expect(pages[0]).toMatch(/1\s+of\s+2/);
    expect(pages[1]).toMatch(/2\s+of\s+2/);
    const zip = await JSZip.loadAsync(await word(store));
    expect(await zip.file('word/footer1.xml')!.async('string')).toContain('PAGEREF DonDocsLastPage');
  });

  it('retains the final two body paragraphs with the Word signature and valid first-page CUI footers', async () => {
    const store = letter(28);
    store.formData.classLevel = 'cui';
    const zip = await JSZip.loadAsync(await word(store));
    const xml = await zip.file('word/document.xml')!.async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
    const tail = paragraphs.findIndex((p) => p.textContent?.includes('Review line 27.'));
    const signer = paragraphs.findIndex((p) => p.textContent?.includes('SECONDSIGNER'));
    expect(tail).toBeGreaterThan(-1);
    expect(signer).toBeGreaterThan(tail);
    for (const p of paragraphs.slice(tail, signer)) expect(p.getElementsByTagName('w:keepNext')).toHaveLength(1);
    const first = await zip.file('word/footer1.xml')!.async('string');
    const later = await zip.file('word/footer2.xml')!.async('string');
    expect(first).toContain('CUI');
    expect(first).not.toContain(' PAGE ');
    expect(later).toContain(' PAGE ');
    expect(later.indexOf('CUI')).toBeLessThan(later.indexOf(' PAGE '));
  });

  it('numbers the opening page of a new-page endorsement in Word', async () => {
    const store = buildBaseline('new_page_endorsement');
    store.documentMode = 'compliant';
    const zip = await JSZip.loadAsync(await word(store));
    expect(await zip.file('word/footer1.xml')!.async('string')).toContain(' PAGE ');
  });

  it.skipIf(!process.env.DONDOCS_SOFFICE).each([28, 40])('renders the %i-paragraph Word boundary without a signature-only page', async (count) => {
    const pages = await wordPages(letter(count));
    expect(pages.at(-1)).toContain(`Review line ${count - 1}.`);
    expect(pages.at(-1)).toContain(`Review line ${count}.`);
    expect(pages.at(-1)).toContain('SECONDSIGNER');
  });

  it.skipIf(!process.env.DONDOCS_SOFFICE).each([3, 7])('keeps the complete first Word acknowledgement together after %i basic-letter paragraphs', async (count) => {
    const store = letter();
    Object.assign(store.formData, {
      additionalEndorsements: [], to: 'Sergeant J. A. DOE, USMC',
      subject: 'APPOINTMENT AS MARINE SECURITY GUARD REPRESENTATIVE',
      sigFirst: 'Robert', sigMiddle: 'L', sigLast: 'SMITH',
      endorsementBody: 'I have read and understand the references listed above.\nI hereby assume the duties and responsibilities as the MSG Representative.',
      endorsementSigFirst: 'John', endorsementSigMiddle: 'A', endorsementSigLast: 'DOE',
    });
    store.paragraphs = Array.from({ length: count }, (_, i) => ({ level: 0,
      text: `Appointment paragraph ${i + 1}. Per the references, you are hereby appointed as the MSG Representative.`,
    }));
    const pages = await wordPages(store);
    expect(pages).toHaveLength(count === 3 ? 1 : 2);
    const page = pages.find((text) => text.includes('FIRST ENDORSEMENT'))!;
    expect(page).toContain('I have read and understand');
    expect(page).toContain('I hereby assume the duties');
    expect(page).toContain('J. A. DOE');
    if (count === 7) expect(pages[0]).not.toContain('FIRST ENDORSEMENT');
  });

  it.skipIf(!process.env.DONDOCS_SOFFICE)('keeps an oversized first Word endorsement breakable and complete', async () => {
    const store = letter();
    store.formData.additionalEndorsements = [];
    store.formData.endorsementBody = Array.from({ length: 40 }, (_, i) => `Acknowledgement line ${i + 1}. All information must remain visible.`).join('\n');
    const pages = await wordPages(store);
    const text = pages.join(' ');
    for (let i = 1; i <= 40; i++) expect(text).toContain(`Acknowledgement line ${i}.`);
    expect(pages.at(-1)).toContain('Acknowledgement line 39.');
    expect(pages.at(-1)).toContain('Acknowledgement line 40.');
    expect(pages.at(-1)).toContain('FIRSTSIGNER');
  });

  it('preserves an acting basic-letter signature alongside both endorsement signers', async () => {
    const store = letter();
    Object.assign(store.formData, { acting: true, byDirection: true, sigTitle: 'Commanding Officer' });
    const pdf = (await pdfPages(store)).join(' ');
    const zip = await JSZip.loadAsync(await word(store));
    const doc = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
    const text = Array.from(doc.getElementsByTagName('w:t')).map((node) => node.textContent).join(' ');
    for (const output of [pdf, text]) {
      expect(output.match(/\bActing\b/g)).toHaveLength(1);
      expect(output).not.toContain('By direction');
      expect(output).toContain('FIRSTSIGNER');
      expect(output).toContain('SECONDSIGNER');
    }
  });

  it.skipIf(!process.env.DONDOCS_SOFFICE)('resolves continued Word totals and retains an unnumbered CUI opening sheet', async () => {
    const store = buildBaseline('new_page_endorsement');
    store.documentMode = 'custom';
    Object.assign(store.formData, { pageNumbering: 'xofy', startingPageNumber: 4 });
    expect((await wordPages(store))[0]).toMatch(/4\s+of\s+4/);
    const marked = letter();
    marked.formData.classLevel = 'cui';
    const pages = await wordPages(marked);
    expect(pages[0]).toContain('CUI');
    expect(pages[0]).not.toMatch(/^\s*1\s*$/m);
    expect(pages[1]).toMatch(/^\s*2\s*$/m);
  });
});
