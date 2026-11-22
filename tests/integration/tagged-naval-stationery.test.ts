import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { renderTaggedCorrespondence } from '@/services/pdf/accessibility/render';
import { validateGeneratedTaggedPdf } from '@/services/pdf/accessibility/validate';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { TAGGED_MAIN_FILE } from '@/services/latex/renderDocument';
import { compileGeneratedFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

describe.skipIf(!hasPdfToolchain)('tagged correspondence layouts', () => {
  it.each([
    { docType: 'naval_letter', letterheadMode: 'title-only', to: 'Training Office', distribute: false },
    { docType: 'naval_letter', letterheadMode: 'preprinted', to: 'Training Office', distribute: false },
    { docType: 'multiple_address_letter', letterheadMode: 'title-only', to: 'Training Office\nField Office', distribute: false },
    { docType: 'multiple_address_letter', letterheadMode: 'preprinted', to: '', distribute: true },
    { docType: 'multiple_address_letter', letterheadMode: 'full', to: 'Training Officers', distribute: true },
    { docType: 'plain_paper_memorandum', letterheadMode: 'preprinted', to: 'Training Officers', distribute: false },
    { docType: 'plain_paper_memorandum', letterheadMode: 'full', to: 'Training Officers', distribute: true },
    { docType: 'letterhead_memorandum', letterheadMode: 'full', to: 'Training Officers', distribute: false },
    { docType: 'letterhead_memorandum', letterheadMode: 'title-only', to: 'Training Officers', distribute: false },
    { docType: 'letterhead_memorandum', letterheadMode: 'preprinted', to: 'Training Officers', distribute: true },
  ] as const)('preserves printed content for $docType on $letterheadMode stock', async ({ docType, letterheadMode, to, distribute }) => {
    const plainMemo = docType === 'plain_paper_memorandum';
    const isMemo = plainMemo || docType === 'letterhead_memorandum';
    const sealRequired = letterheadMode === 'full' && !plainMemo;
    const source: Parameters<typeof renderTaggedCorrespondence>[0] = {
      docType,
      formData: { date: '21 Nov 26', subject: 'TAGGED STATIONERY', from: 'Training Staff', to,
        unitLine1: 'SYNTHETIC TITLE', unitAddress: 'UNIT ADDRESS', letterheadMode, signatureType: 'none',
        inReplyTo: true, ...(isMemo ? { ssic: '5216', serial: 'TEST', via: 'First Office\nSecond Office', showSubjectOnContinuation: true, pageNumbering: 'simple' } : {}), sigFirst: 'Alex', sigLast: 'Example', sigRank: 'Captain', sigTitle: 'Training Officer' },
      paragraphs: [
        { level: 0, text: 'Review the table below.' },
        { level: 0, text: 'Training table', bodyTable: { rows: [['Role', 'Activity'],
          ...Array.from({ length: 48 }, (_, index) => [`ROW${index}`, 'Training review'])], headerRows: 1 } },
      ],
      references: [], enclosures: [], distributions: distribute ? [{ text: 'Distribution Staff' }] : [], copyTos: [{ text: 'Training Copy' }],
    };
    const date = new Date('2026-11-21T12:00:00Z');
    const seal = sealRequired ? await readFile('public/attachments/dow-seal.png') : null;
    const assets: Record<string, Uint8Array> = seal ? { 'attachments/dow-seal.png': seal } : {};
    const normal = await compileGeneratedFixture(generateAllLatexFiles(source, undefined, date).texFiles, assets, source.docType);
    expect(normal.ok, normal.logTail).toBe(true);
    const tagged = await renderTaggedCorrespondence(source, {
      referenceDate: date,
      signal: new AbortController().signal,
      read: () => { throw new Error('Unexpected attachment read'); },
      loadSeal: async () => {
        if (!seal) throw new Error('Artless stationery must not load an image');
        return seal;
      },
      async compile(files) {
        const tex = Object.fromEntries(Object.entries(files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
        tex['main.tex'] = tex[TAGGED_MAIN_FILE];
        const result = await compileGeneratedFixture(tex, assets, source.docType);
        expect(result.ok, result.logTail).toBe(true);
        return result.pdfBytes!;
      },
    });
    expect((await validateGeneratedTaggedPdf(tagged)).associatedChunks).toBeGreaterThan(98);
    const taggedPath = join(normal.workDir, 'tagged.pdf');
    await writeFile(taggedPath, tagged);
    const measured = spawnSync('pdftotext', [taggedPath, '-'], { encoding: 'utf8' });
    expect(measured.status, measured.stderr).toBe(0);
    expect(measured.stdout.includes('SYNTHETIC TITLE')).toBe(!plainMemo && letterheadMode !== 'preprinted');
    expect(measured.stdout.includes('UNIT ADDRESS')).toBe(sealRequired);
    expect(measured.stdout.includes('Distribution Staff')).toBe(distribute);
    expect(measured.stdout.includes('To:')).toBe(!!to);
    if (isMemo) {
      expect(measured.stdout).toMatch(/MEMORANDUM[\s\S]+From:[\s\S]+To:[\s\S]+Via:[\s\S]+First Office[\s\S]+Second Office[\s\S]+Subj:/);
      expect(measured.stdout.includes('5216')).toBe(!plainMemo);
      const pdf = await PDFDocument.load(tagged);
      const headers = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter(object =>
        object instanceof PDFDict && object.get(PDFName.of('S')) === PDFName.of('TH'));
      expect(headers).toHaveLength(2);
    }
    for (const [file, prefix] of [['main.pdf', 'original'], ['tagged.pdf', 'tagged']]) {
      const rendered = spawnSync('pdftoppm', ['-r', '72', '-png', join(normal.workDir, file), join(normal.workDir, prefix)], { encoding: 'utf8' });
      expect(rendered.status, rendered.stderr).toBe(0);
    }
    const files = await readdir(normal.workDir);
    const originals = files.filter(file => /^original-\d+\.png$/.test(file));
    expect(files.filter(file => /^tagged-\d+\.png$/.test(file))).toHaveLength(originals.length);
    expect(originals.length).toBeGreaterThan(1);
    for (const original of originals) {
      expect(await readFile(join(normal.workDir, original.replace('original-', 'tagged-')))).toEqual(await readFile(join(normal.workDir, original)));
    }
  }, 60_000);
});
