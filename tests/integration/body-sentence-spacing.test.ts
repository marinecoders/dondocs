import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileFixture, formatFailure, type TestStore } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { applyIndentMarkers } from '@/services/docx/pandoc-converter';
import { isTechnicalPublication } from '@/lib/publicationPreflight';
import { ALL_DOC_TYPES, buildBaseline } from '../_helpers/compileMatrix';
import { describeToolchainRequirement, hasPdfToolchain } from '../_helpers/pdfToolchain';

interface Word {
  page: number;
  text: string;
  x: number;
  right: number;
  y: number;
  bottom: number;
}

async function render(store: TestStore): Promise<Word[]> {
  const result = await compileFixture(store);
  expect(result.ok, formatFailure('body-sentence-spacing', result)).toBe(true);
  const xml = execFileSync('pdftotext', ['-bbox', join(result.workDir, 'main.pdf'), '-'], {
    encoding: 'utf8',
  });
  // Poppler's reading order can interleave adjacent lines into columns.
  // Measure visual neighbors, rather than relying on XML emission order.
  return [...xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)].flatMap((page, index) =>
    [...page[1].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
      .map((m) => ({ page: index, x: Number(m[1]), y: Number(m[2]), right: Number(m[3]), bottom: Number(m[4]), text: m[5] }))
  ).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}

function gaps(words: Word[], left: string, right: string): number[] {
  return words.filter((word) => word.text === left).flatMap((word) => {
    // Different font styles can have different ascenders on the same baseline.
    // Find the nearest visual neighbor with overlapping vertical bounds.
    const next = words.filter((candidate) => candidate.page === word.page && candidate.x >= word.right - 0.001 &&
      Math.min(candidate.bottom, word.bottom) - Math.max(candidate.y, word.y) >
        Math.min(candidate.bottom - candidate.y, word.bottom - word.y) / 2
    ).sort((a, b) => a.x - b.x)[0];
    return next?.text === right ? [next.x - word.right] : [];
  });
}

const cases = (['times', 'courier'] as const).flatMap((fontFamily) =>
  (['10pt', '12pt'] as const).map((fontSize) => ({ fontFamily, fontSize }))
);

function fixture(fontFamily: 'times' | 'courier', fontSize: '10pt' | '12pt') {
  const store = buildBaseline('standard_letter');
  Object.assign(store.formData, { fontFamily, fontSize, sealType: 'none' });
  return store;
}

describe('natural document sentence spacing', () => {
  describeToolchainRequirement('body-sentence-spacing');

  it.skipIf(!hasPdfToolchain).each(cases)(
    '$fontFamily $fontSize: natural spacing covers addresses, headings, reference/enclosure titles and recipient lists',
    async ({ fontFamily, fontSize }) => {
      const store = fixture(fontFamily, fontSize);
      const sample = 'Alpha Bravo. Execution. Approval.';
      const continuation = ' This description is deliberately long enough to wrap onto another line without stretching its word spaces.';
      Object.assign(store.formData, {
        from: `From ${sample}`, to: `To ${sample}`, via: `Via ${sample}`,
      });
      store.references = [{ letter: 'a', title: `Reference ${sample}${continuation}` }];
      store.enclosures = [{ title: `Enclosure ${sample}${continuation}` }];
      store.copyTos = [{ text: `Copy ${sample}${continuation}` }];
      store.distributions = [{ text: `Distribution ${sample}${continuation}` }];
      store.paragraphs = [{ level: 0, header: 'Alpha Bravo. Execution. Approval', text: `Body ${sample}` }];
      const words = await render(store);
      const normal = gaps(words, 'Alpha', 'Bravo.');
      const sentences = gaps(words, 'Execution.', 'Approval.');
      expect(normal).toHaveLength(9);
      expect(sentences).toHaveLength(9);
      const expectedPoints = (fontFamily === 'times' ? 0.25 : 0.6) * parseInt(fontSize) * 72 / 72.27;
      for (let i = 0; i < normal.length; i++) {
        // TeX can slightly shrink font glue at a wrapped line's right edge;
        // PDF text positioning also rounds individual glyph advances. Keep
        // that tolerance below 0.05pt, far below automatic sentence expansion.
        expect(normal[i]).toBeCloseTo(expectedPoints, 1);
        expect(sentences[i]).toBeCloseTo(normal[i], 1);
      }
    }
  );

  it.skipIf(!hasPdfToolchain)(
    'executive subject, addressees, coordination and preparer text use natural spacing',
    async () => {
      const store = buildBaseline('information_memorandum');
      const sample = 'Alpha Bravo. Execution. Approval.';
      Object.assign(store.formData, {
        subject: sample, from: sample, memorandumFor: sample,
        coordination: sample, preparedBy: sample, sealType: 'none',
      });
      store.paragraphs = [{ level: 0, text: sample }];
      const words = await render(store);
      const normal = gaps(words, 'Alpha', 'Bravo.');
      const sentences = gaps(words, 'Execution.', 'Approval.');
      expect(normal).toHaveLength(6);
      expect(sentences).toHaveLength(6);
      for (let i = 0; i < normal.length; i++) expect(sentences[i]).toBeCloseTo(normal[i], 2);
    }
  );

  it.skipIf(!hasPdfToolchain).each(['times', 'courier'] as const)(
    '%s: letterhead, signature titles and CUI text retain natural spacing at their own font sizes',
    async (fontFamily) => {
      const store = buildBaseline('business_letter');
      // Keep both measured pairs on one line even in the narrow signature.
      const sample = 'Al Be. Ex. Ap.';
      Object.assign(store.formData, {
        fontFamily, unitLine1: sample, unitLine2: sample, unitAddress: sample,
        sigRank: sample, sigTitle: sample, classLevel: 'cui', cuiDistStatement: sample,
      });
      store.paragraphs = [{ level: 0, text: sample }];
      const words = await render(store);
      const normal = gaps(words, 'Al', 'Be.');
      const sentences = gaps(words, 'Ex.', 'Ap.');
      expect(normal).toHaveLength(7);
      expect(sentences).toHaveLength(7);
      for (let i = 0; i < normal.length; i++) expect(sentences[i]).toBeCloseTo(normal[i], 2);
      // Letterhead is 8pt, independently of the document's 12pt text.
      expect(normal[0]).toBeCloseTo((fontFamily === 'times' ? 0.25 : 0.6) * 8 * 72 / 72.27, 2);
      expect(normal.at(-1)).toBeCloseTo((fontFamily === 'times' ? 0.25 : 0.6) * 12 * 72 / 72.27, 2);
    }
  );

  it.skipIf(!hasPdfToolchain).each(
    (['times', 'courier'] as const).flatMap((fontFamily) =>
      (['business_letter', 'executive_correspondence'] as const).map((docType) => ({ fontFamily, docType }))
    )
  )(
    '$fontFamily $docType: salutations and executive recipient addresses retain natural abbreviation spaces',
    async ({ fontFamily, docType }) => {
      const store = buildBaseline(docType);
      Object.assign(store.formData, {
        fontFamily, sealType: 'none', to: 'Mr. Smith\n123 Sample Street', salutation: 'Dear Mr. Smith:',
      });
      store.paragraphs = [{ level: 0, text: 'Alpha Bravo. Execution. Approval.' }];
      const words = await render(store);
      const normal = gaps(words, 'Alpha', 'Bravo.')[0];
      const recipient = gaps(words, 'Mr.', 'Smith');
      const salutation = gaps(words, 'Mr.', 'Smith:');
      expect(salutation).toHaveLength(1);
      if (docType === 'executive_correspondence') {
        expect(recipient).toHaveLength(1);
        expect(recipient[0]).toBeCloseTo(normal, 2);
      }
      expect(salutation[0]).toBeCloseTo(normal, 2);
    }
  );

  it.skipIf(!hasPdfToolchain).each(ALL_DOC_TYPES.filter((docType) => !isTechnicalPublication(docType)))(
    '%s applies natural spacing through its real document layout',
    async (docType) => {
      const store = buildBaseline(docType);
      store.formData.sealType = 'none';
      store.paragraphs = [{ level: 0, text: 'Alpha Bravo. Execution. Approval.' }];
      const words = await render(store);
      const wordGaps = gaps(words, 'Alpha', 'Bravo.');
      const sentenceGaps = gaps(words, 'Execution.', 'Approval.');
      expect(wordGaps).toHaveLength(1);
      expect(sentenceGaps).toHaveLength(1);
      expect(sentenceGaps[0]).toBeCloseTo(wordGaps[0], 2);
    }
  );

  it.skipIf(!hasPdfToolchain).each(cases)(
    '$fontFamily $fontSize: sentence gaps equal that font’s word spaces across formatting and line breaks',
    async ({ fontFamily, fontSize }) => {
      const store = fixture(fontFamily, fontSize);
      store.paragraphs = [
        { level: 0, text: 'Zulu Alpha Bravo. Execution. Approval.' },
        { level: 1, header: 'Purpose', text: 'Zulu **Alpha Bravo. Execution. Approval.**' },
        { level: 0, text: 'Zulu *Alpha Bravo. Execution. Approval.*' },
        { level: 0, text: 'Zulu __Alpha Bravo. Execution. Approval.__' },
        { level: 0, text: 'Alpha Bravo. Ready? Continue. Done! Proceed.' },
        { level: 0, text: 'Alpha Bravo.\nExecution. Approval.' },
      ];
      const words = await render(store);
      const wordGaps = gaps(words, 'Alpha', 'Bravo.');
      const sentenceGaps = gaps(words, 'Execution.', 'Approval.');
      expect(wordGaps).toHaveLength(6);
      expect(sentenceGaps).toHaveLength(5);
      // Match each formatted sentence with the word space in the same style.
      for (let i = 0; i < 4; i++) expect(sentenceGaps[i]).toBeCloseTo(wordGaps[i], 2);
      expect(sentenceGaps[4]).toBeCloseTo(wordGaps[5], 2);
      for (const [left, right] of [['Ready?', 'Continue.'], ['Done!', 'Proceed.']]) {
        const measured = gaps(words, left, right);
        expect(measured).toHaveLength(1);
        expect(measured[0]).toBeCloseTo(wordGaps[4], 2);
      }
      // Font-relative space widths: do not force Courier to use a Times-sized gap.
      const expectedPoints = (fontFamily === 'times' ? 0.25 : 0.6) * parseInt(fontSize) * 72 / 72.27;
      expect(wordGaps[0]).toBeCloseTo(expectedPoints, 2);
    }
  );

  it.skipIf(!hasPdfToolchain).each(['times', 'courier'] as const)(
    '%s: a run counts as one across mark edges, tabs and non-breaking spaces',
    async (fontFamily) => {
      const store = fixture(fontFamily, '12pt');
      store.paragraphs = [
        '**Aone. ** bone', '**Atwo.  ** btwo', '**Athree.   **   bthree', 'Afour. **  bfour**', '*Afive. * bfive',
        '__Asix. __ bsix', 'Aseven.   bseven', 'Aeight.  \tbeight', 'Anine. ** **bnine',
      ].map((text) => ({ level: 0, text }));
      store.paragraphs.push({ level: 0, text: 'Aten.\tbten' });
      const words = await render(store);
      const one = (fontFamily === 'times' ? 0.25 : 0.6) * 12 * 72 / 72.27;
      for (const [left, right] of [['Aone.', 'bone'], ['Atwo.', 'btwo'], ['Athree.', 'bthree'], ['Afour.', 'bfour'],
        ['Afive.', 'bfive'], ['Asix.', 'bsix'], ['Aseven.', 'bseven'], ['Aeight.', 'beight'], ['Anine.', 'bnine']]) {
        expect(gaps(words, left, right)[0], `${left} ${right}`).toBeCloseTo(2 * one, 1);
      }
      expect(gaps(words, 'Aten.', 'bten')[0]).toBeCloseTo(one, 1);
    }
  );

  it.skipIf(!hasPdfToolchain).each(
    (['times', 'courier'] as const).flatMap((fontFamily) =>
      (['compliant', 'custom'] as const).map((documentMode) => ({ fontFamily, documentMode })))
  )(
    '$fontFamily $documentMode: one typed space prints as one, two as two, and more as two',
    async ({ fontFamily, documentMode }) => {
      const store = { ...fixture(fontFamily, '12pt'), documentMode };
      store.paragraphs = [1, 2, 6].map((count) => ({
        level: 0,
        text: `Alpha${' '.repeat(count)}Bravo. Execution.${' '.repeat(count)}Approval.`,
      }));
      store.paragraphs.push({ level: 0, text: 'Mr. Smith. (Execution.) Approval.' });
      const words = await render(store);
      const one = (fontFamily === 'times' ? 0.25 : 0.6) * 12 * 72 / 72.27;
      const typed = [one, 2 * one, 2 * one];
      const wordGaps = gaps(words, 'Alpha', 'Bravo.');
      const sentenceGaps = gaps(words, 'Execution.', 'Approval.');
      expect(wordGaps).toHaveLength(3);
      expect(sentenceGaps).toHaveLength(3);
      typed.forEach((gap, i) => {
        expect(wordGaps[i]).toBeCloseTo(gap, 1);
        expect(sentenceGaps[i]).toBeCloseTo(gap, 1);
      });
      expect(gaps(words, 'Mr.', 'Smith.')[0]).toBeCloseTo(one, 1);
      expect(gaps(words, '(Execution.)', 'Approval.')[0]).toBeCloseTo(one, 1);
    }
  );

  it.skipIf(!hasPdfToolchain).each(['times', 'courier'] as const)(
    '%s endorsements print typed spaces the same way',
    async (fontFamily) => {
      const store = fixture(fontFamily, '12pt');
      store.paragraphs = [{ level: 0, text: 'Basic letter.' }];
      Object.assign(store.formData, {
        appendEndorsement: true, endorsementSigFirst: 'Jane', endorsementSigLast: 'Doe',
        endorsementBody: 'Aone bone. Atwo  btwo. Asix      bsix.',
        additionalEndorsements: [{ endorsementSigFirst: 'Sam', endorsementSigLast: 'Roe', endorsementBody: 'Ctwo  dtwo.' }],
      });
      const words = await render(store);
      const one = (fontFamily === 'times' ? 0.25 : 0.6) * 12 * 72 / 72.27;
      expect(gaps(words, 'Aone', 'bone.')[0]).toBeCloseTo(one, 1);
      expect(gaps(words, 'Atwo', 'btwo.')[0]).toBeCloseTo(2 * one, 1);
      expect(gaps(words, 'Asix', 'bsix.')[0]).toBeCloseTo(2 * one, 1);
      expect(gaps(words, 'Ctwo', 'dtwo.')[0]).toBeCloseTo(2 * one, 1);
    }
  );

  it.skipIf(!hasPdfToolchain).each(['times', 'courier'] as const)(
    '%s preserves font changes, variables and reference links within natural body typography',
    async (fontFamily) => {
      const store = fixture(fontFamily, '12pt');
      store.formData.includeHyperlinks = true;
      store.references = [{ letter: 'a', title: 'Typography test reference' }];
      store.paragraphs = [
        { level: 0, text: 'Alpha Bravo. **Execution.** Approval.' },
        { level: 0, text: 'Reference (a) identifies {{NAME}}.' },
      ];
      const words = await render(store);
      expect(gaps(words, 'Execution.', 'Approval.')[0]).toBeCloseTo(gaps(words, 'Alpha', 'Bravo.')[0], 2);
      expect(words.some((word) => word.text === 'NAME')).toBe(true);
      // The reference macro displays a lowercase "reference", independently
      // of the capitalization in the editor's input.
      expect(gaps(words, 'reference', '(a)')).toHaveLength(1);
    }
  );

  it.skipIf(!hasPdfToolchain).each(['times', 'courier'] as const)(
    '%s: body typography and label/header positions match between modes',
    async (fontFamily) => {
      const base = fixture(fontFamily, '12pt');
      base.paragraphs = [
        { level: 0, text: 'Zulu Alpha Bravo. Execution. Approval.' },
        { level: 1, header: 'Purpose', text: 'Zulu Alpha Bravo. Execution. Approval.' },
      ];
      const custom = await render({ ...base, documentMode: 'custom' });
      const compliant = await render({ ...base, documentMode: 'compliant' });
      const starts = (words: Word[]) => words.filter((w) => ['Zulu', 'Purpose.', '1.', 'a.'].includes(w.text))
        .map(({ text, x }) => ({ text, x }));
      expect(starts(compliant)).toEqual(starts(custom));
      for (const words of [custom, compliant]) {
        expect(gaps(words, 'Execution.', 'Approval.')[0]).toBeCloseTo(gaps(words, 'Alpha', 'Bravo.')[0], 2);
      }
    }
  );

  it.skipIf(!hasPdfToolchain).each(cases)(
    '$fontFamily $fontSize: wrapped appended endorsements retain natural spacing and left alignment',
    async ({ fontFamily, fontSize }) => {
      const store = fixture(fontFamily, fontSize);
      store.paragraphs = [{ level: 0, text: 'Zulu basic letter.' }];
      Object.assign(store.formData, {
        appendEndorsement: true,
        endorsementBody: 'Zulu acknowledgement. Alpha Bravo. Execution. Approval. Ready? Continue. Done! Proceed. ' +
          'This continuation verifies that the endorsement wraps naturally without justifying its word spaces.',
        endorsementSigFirst: 'Jane', endorsementSigLast: 'Doe',
      });
      const words = await render(store);
      const wordGaps = gaps(words, 'Alpha', 'Bravo.');
      expect(wordGaps).toHaveLength(1);
      const expectedPoints = (fontFamily === 'times' ? 0.25 : 0.6) * parseInt(fontSize) * 72 / 72.27;
      expect(wordGaps[0]).toBeCloseTo(expectedPoints, 2);
      const sentenceGaps = gaps(words, 'Execution.', 'Approval.');
      expect(sentenceGaps).toHaveLength(1);
      expect(sentenceGaps[0]).toBeCloseTo(wordGaps[0], 2);
      const starts = words.filter((w) => w.text === 'Zulu');
      expect(starts).toHaveLength(2);
      // Separate PDF text runs can round glyph advances by 0.001em.
      expect(starts[1].x).toBeCloseTo(starts[0].x, 1);
      const continuation = words.find((w) => w.text === 'continuation');
      expect(continuation).toBeDefined();
    }
  );

  const pandocAvailable = (() => {
    try { execFileSync('pandoc', ['--version'], { stdio: 'ignore' }); return true; }
    catch { return false; }
  })();
  it.skipIf(!pandocAvailable).each(['times', 'courier'] as const)(
    '%s: Word export keeps typed spaces, up to two, and structural label spaces',
    async (fontFamily) => {
      const store = fixture(fontFamily, '12pt');
      store.paragraphs = [
        { level: 0, text: 'Alpha Bravo. Execution. Approval.' },
        { level: 0, text: 'Delta echo.  Foxtrot golf.      Hotel india.' },
      ];
      const result = await compileDocxFixture(store);
      expect(result.ok, result.log).toBe(true);
      const xml = execFileSync('unzip', ['-p', join(result.workDir, 'out.docx'), 'word/document.xml'], { encoding: 'utf8' });
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      expect(document.querySelector('parsererror')).toBeNull();
      const text = Array.from(document.getElementsByTagName('w:t'), (node) => node.textContent ?? '').join('');
      expect(text).toContain('Alpha Bravo. Execution. Approval.');
      expect(text).toContain('Delta echo.\u00a0 Foxtrot golf.\u00a0 Hotel india.');
      // Typed spaces stay spaces: no run gets a fixed character width.
      const runProperties = Array.from(document.getElementsByTagName('w:rPr'));
      expect(runProperties.some((rPr) => rPr.getElementsByTagName('w:spacing').length > 0)).toBe(false);
      expect(readFileSync(join(result.workDir, 'flat.tex'), 'utf8')).toContain('\\mbox{1.}~~');
    }
  );

  it.skipIf(!pandocAvailable)('Word export keeps a gap after a mark or a variable, and indents nothing', async () => {
    const store = fixture('times', '12pt');
    store.paragraphs = [
      '**Aone.**  bone', '**Atwo. ** btwo', '**Athree.   **   bthree', 'Afour. **  bfour**', '__Afive.__  bfive',
      '*Asix.*  bsix', '{{ABC}}  bseven', 'Reference (a)  beight', 'Anine.\u00a0\u00a0\u00a0bnine', 'Aten. \u00a0 bten',
    ].map((text) => ({ level: 0, text }));
    store.references = [{ letter: 'a', title: 'Typography test reference' }];
    const result = await compileDocxFixture(store);
    expect(result.ok, result.log).toBe(true);
    // The compile harness stops short of the post-pass that used to eat these gaps.
    const xml = applyIndentMarkers(execFileSync('unzip', ['-p', join(result.workDir, 'out.docx'), 'word/document.xml'], { encoding: 'utf8' }));
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const paragraphs = Array.from(document.getElementsByTagName('w:p'), (paragraph) => ({
      text: Array.from(paragraph.getElementsByTagName('w:t'), (node) => node.textContent ?? '').join(''),
      indented: paragraph.getElementsByTagName('w:ind').length > 0,
    }));
    for (const [left, right] of [['Aone.', 'bone'], ['Atwo.', 'btwo'], ['Athree.', 'bthree'], ['Afour.', 'bfour'], ['Afive.', 'bfive'],
      ['Asix.', 'bsix'], ['{{ABC}}', 'bseven'], ['(a)', 'beight'], ['Anine.', 'bnine'], ['Aten.', 'bten']]) {
      const paragraph = paragraphs.find((candidate) => candidate.text.includes(right));
      expect(paragraph?.text, right).toContain(`${left}\u00a0 ${right}`);
      expect(paragraph?.indented, right).toBe(false);
    }
  });
});
