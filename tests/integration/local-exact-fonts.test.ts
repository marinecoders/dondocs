import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';
import { createNodeEngine, loadAssets } from '../../companion/nodeEngine';
import { readLocalOfficeFontAssets } from '../../scripts/localOfficeFontAssets';
import { createBlankSession, prepareSessionState } from '@/stores/documentStore';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { compileDocument, LatexCompileError, prepareEngine } from '@/services/latex/renderDocument';
import { finishCorrespondencePdf } from '@/services/pdf/finishCorrespondencePdf';
import { OfficeFontSource } from '@/services/officeFonts';

const output = process.env.DONDOCS_LOCAL_FONT_TEST_OUTPUT;
const sampleText = 'Verify the office file, résumé, café, naïve and “curly quotes”.';

function draft(type: string, count: number) {
  const session = createBlankSession(undefined, type);
  Object.assign(session.formData, {
    subject: 'Quarterly records test', from: 'Secretary of the Navy', sigLast: 'Example',
    officeCode: 'ADMIN', date: '22 Nov 26',
    directiveNumber: type === 'secnav_notice' ? '5215' : type === 'change_transmittal' ? 'SECNAVINST 5215.1E' : '5215.1E',
    directiveChangeNumber: '1', directiveCancellation: 'Canc: Jun 2027', fontSize: '12pt',
  });
  session.paragraphs = Array.from({ length: count }, (_, index) => ({
    text: `Record ${index + 1}. Compare the current and prior inventory lists. ${sampleText}`,
    header: index === 0 ? 'Purpose' : '', level: 0,
  }));
  return prepareSessionState(session);
}

async function save(name: string, bytes: Uint8Array) {
  if (output) await writeFile(join(output, name + '.pdf'), bytes);
}

function inspect(bytes: Uint8Array) {
  return {
    fonts: execFileSync('pdffonts', ['-'], { input: bytes, encoding: 'utf8' }),
    text: execFileSync('pdftotext', ['-layout', '-', '-'], { input: bytes, encoding: 'utf8' }),
  };
}

it.skipIf(process.env.DONDOCS_VERIFY_LOCAL_OFFICE_FONTS !== '1')('embeds both installed font families and enforces actual directive page limits', async () => {
  const engine = await createNodeEngine();
  try {
    const officeFonts = new OfficeFontSource(readLocalOfficeFontAssets());
    prepareEngine(engine, { ...await loadAssets(), officeFonts });
    const cases = [
      ['naval_letter', 'TimesNewRoman', 27],
      ['secnav_instruction', 'CourierNew', 40],
      ['secnav_notice', 'CourierNew', 3],
      ['change_transmittal', 'CourierNew', 3],
    ] as const;
    for (const [type, name, count] of cases) {
      const document = draft(type, count);
      const generated = generateAllLatexFiles(document);
      const styles = String.raw`\par\textit{Italic words.} \textbf{\textit{Bold-italic words.}}`;
      const pdf = await compileDocument(engine, { ...generated.texFiles, 'body.tex': generated.texFiles['body.tex'] + styles });
      const { fonts, text } = inspect(pdf);
      expect(fonts).toContain(name + 'PSMT');
      expect(fonts).toContain(name + 'PS-BoldMT');
      expect(fonts).toContain(name + 'PS-ItalicMT');
      expect(fonts).toContain(name + 'PS-BoldItalicMT');
      expect(fonts).not.toMatch(/Nimbus|\bCourier\b/);
      expect(fonts.split('\n').slice(2).filter(Boolean).every(line => /TrueType\s+WinAnsi\s+yes\s+yes\s+yes/.test(line))).toBe(true);
      expect(text.replace(/\s+/g, ' ')).toContain(sampleText);
      if (type === 'naval_letter') {
        const entry = (await PDFDocument.load(pdf)).context.enumerateIndirectObjects().find(([, object]) =>
          object instanceof PDFDict && object.get(PDFName.of('BaseFont'))?.toString().endsWith('+TimesNewRomanPS-BoldMT'),
        );
        const bold = entry?.[1];
        if (!(bold instanceof PDFDict)) throw new Error('Times New Roman Bold is missing.');
        const descriptor = bold.lookup(PDFName.of('FontDescriptor'), PDFDict);
        const stream = descriptor.lookup(PDFName.of('FontFile2'));
        if (!(stream instanceof PDFRawStream)) throw new Error('Times New Roman Bold has no font program.');
        const bytes = decodePDFRawStream(stream).decode();
        const outline = (fontBytes: Uint8Array) => fontkit.create(fontBytes).glyphForCodePoint(0x4e).path.toSVG();
        // Verify the painted N. A ToUnicode map can hide a wrong outline in copied text.
        expect(outline(bytes)).toBe(outline(officeFonts.readFace('times', 'bold')));
      }
      const reader = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
      try {
        const body = (await (await reader.getPage(1)).getTextContent()).items.find(item => 'str' in item && item.str.includes('Compare the current'));
        expect(body && 'transform' in body && Math.hypot(body.transform[0], body.transform[1])).toBeCloseTo(12, 2);
      } finally {
        await reader.destroy();
      }
      await save(type + '-exact', pdf);
    }

    const tested = new Set<number>();
    for (const count of [48, 54, 60, 66, 72, 78]) {
      const document = draft('secnav_instruction', count);
      const generated = generateAllLatexFiles(document);
      const pdf = await compileDocument(engine, generated.texFiles);
      const pages = (await PDFDocument.load(pdf)).getPageCount();
      if (tested.has(pages) || (pages !== 5 && pages !== 6)) continue;
      if (pages === 5) {
        const output = await finishCorrespondencePdf(pdf, document.docType, document.formData, generated);
        expect((await PDFDocument.load(output.pdfBytes)).getPageCount()).toBe(5);
        await save('directive-five-pages', output.pdfBytes);
      } else {
        await expect(finishCorrespondencePdf(pdf, document.docType, document.formData, generated)).rejects.toThrow('at most five pages');
      }
      tested.add(pages);
    }
    expect(tested).toEqual(new Set([5, 6]));
  } catch (error) {
    if (error instanceof LatexCompileError && output) await writeFile(join(output, 'qualification-compile.log'), error.log);
    throw error;
  } finally {
    await engine.dispose();
  }
}, 120_000);
