import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { prepareTaggedCorrespondence, type TaggedCorrespondenceSource } from '@/services/pdf/accessibility/correspondence';
import { finishTaggedPdf } from '@/services/pdf/accessibility/taggedPdf';
import { validateGeneratedTaggedPdf } from '@/services/pdf/accessibility/validate';
import { TAGGED_MAIN_FILE } from '@/services/latex/renderDocument';
import { compileGeneratedFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

const name = PDFName.of;
describe.skipIf(!hasPdfToolchain)('native tagged reference link output', () => {
  it.each([1, 6])('compiles actual wrapped URI annotations and preserves page rendering (%i references)', async referenceCount => {
    const source: TaggedCorrespondenceSource = {
      docType: 'standard_letter', formData: { subject: 'TAGGED REFERENCE TRAINING', date: '21 Nov 26', from: 'Training Marine', to: 'Training Office', signatureType: 'none', includeHyperlinks: true },
      paragraphs: [{ id: 'purpose', level: 0, text: 'Follow reference (a) for the training source.' }],
      references: Array.from({ length: referenceCount }, (_, index) => ({ letter: String.fromCharCode(97 + index), title: Array(referenceCount === 1 ? 14 : 36).fill('Training reference with a deliberately wrapped title').join(' '), url: `https://example.test/reference?chapter=${index + 1}&section=2` })),
      enclosures: [], copyTos: [], distributions: [],
    };
    const prepared = prepareTaggedCorrespondence(source);
    const files = Object.fromEntries(Object.entries(prepared.files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    files['main.tex'] = files[TAGGED_MAIN_FILE];
    const compiled = await compileGeneratedFixture(files, {}, source.docType);
    expect(compiled.ok, compiled.logTail).toBe(true);
    const result = await finishTaggedPdf(compiled.pdfBytes!, prepared.plan);
    const validation = await validateGeneratedTaggedPdf(result.bytes);
    expect(validation.associatedChunks).toBeGreaterThan(0);
    const pdf = await PDFDocument.load(result.bytes);
    const annotations = pdf.getPages().flatMap(page => page.node.Annots()?.asArray() ?? []);
    expect(annotations.length).toBeGreaterThan(1);
    const elements = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object): object is PDFDict => object instanceof PDFDict && object.get(name('S')) === name('Link'));
    expect(elements).toHaveLength(referenceCount);
    if (referenceCount > 1) {
      expect(pdf.getPageCount()).toBeGreaterThan(1);
      expect(elements.some(element => new Set(element.lookup(name('K'), PDFArray).asArray().map(child => pdf.context.lookup(child, PDFDict).get(name('Pg'))?.toString())).size > 1)).toBe(true);
    }
    expect(elements.flatMap(element => element.lookup(name('K'), PDFArray).asArray().filter(child => pdf.context.lookup(child, PDFDict).get(name('Type')) === name('OBJR')))).toHaveLength(annotations.length);
    const inputPath = join(compiled.workDir, 'main.pdf'); const outputPath = join(compiled.workDir, 'tagged.pdf');
    await writeFile(outputPath, result.bytes);
    for (const [path, prefix] of [[inputPath, 'before'], [outputPath, 'after']]) {
      const rendered = spawnSync('pdftoppm', ['-r', '72', '-png', path, join(compiled.workDir, prefix)], { encoding: 'utf8' });
      expect(rendered.status, rendered.stderr).toBe(0);
    }
    for (let page = 1; page <= pdf.getPageCount(); page++) expect(await readFile(join(compiled.workDir, `after-${page}.png`))).toEqual(await readFile(join(compiled.workDir, `before-${page}.png`)));
  }, 60_000);
});
