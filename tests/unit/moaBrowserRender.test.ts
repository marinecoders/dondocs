import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { compileDocument, prepareEngine } from '@/services/latex/renderDocument';
import { finishCorrespondencePdf } from '@/services/pdf/finishCorrespondencePdf';
import { createNodeEngine, loadAssets } from '../../companion/nodeEngine';
import { moaFixture } from '../_helpers/moaFixture';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { acknowledgePreparedExport, prepareExport } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { createBlankSession, prepareSessionState } from '@/stores/documentStore';
import { renderPreparedCorrespondence } from '@/services/exports/correspondence';

// Runs in npm test with the browser's bundled engine; no system TeX or Poppler.
describe('MOA/MOU browser PDF output', () => {
  let engine: Awaited<ReturnType<typeof createNodeEngine>>;
  const previousBundleOnly = process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY;

  beforeAll(async () => {
    process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY = '1';
    engine = await createNodeEngine();
    prepareEngine(engine, await loadAssets());
  }, 60_000);

  afterAll(async () => {
    if (previousBundleOnly === undefined) delete process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY;
    else process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY = previousBundleOnly;
    await engine?.dispose();
  });

  it.each([
    ['moa', 'times', '10pt'], ['moa', 'times', '12pt'],
    ['mou', 'times', '12pt'], ['mou', 'times', '14pt'], ['mou', 'courier', '12pt'],
  ] as const)('%s in %s %s clears the seal and preserves both signers\' initials', async (docType, fontFamily, fontSize) => {
    const store = moaFixture(docType);
    Object.assign(store.formData, { fontFamily, fontSize });
    const { texFiles } = generateAllLatexFiles(store);
    const bytes = await compileDocument(engine, texFiles);
    const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
    try {
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const items = content.items.filter((item) => 'str' in item);
      const junior = items.find((item) => item.str === 'A. T. MORGAN');
      const senior = items.find((item) => item.str === 'J. M. RIVERA');
      // App C: a 72pt seal at 36pt from the top ends at 108pt. Both ID
      // blocks must start below it, with at least one line of clearance.
      const symbols = items.filter((item) => item.str === '5216');
      expect(symbols).toHaveLength(2);
      for (const item of symbols) {
        const top = page.getViewport({ scale: 1 }).height - item.transform[5]
          - content.styles[item.fontName].ascent * item.height;
        expect(top).toBeGreaterThanOrEqual(120);
      }
      const ops = await page.getOperatorList();
      expect(ops.fnArray.some((op) => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject)).toBe(true);
      expect(junior).toBeDefined();
      expect(senior).toBeDefined();
      expect(junior!.transform[4]).toBeLessThan(senior!.transform[4]);
    } finally {
      await pdf.destroy();
    }
  }, 120_000);

  it.each(['moa', 'mou'])('%s keeps both signature names on the final page of a longer agreement', async (docType) => {
    const store = moaFixture(docType);
    store.paragraphs = Array.from({ length: 24 }, () => ({ level: 0,
      text: 'Coordinate schedules and confirm responsibilities with both commands. '.repeat(4),
    }));
    const { texFiles } = generateAllLatexFiles(store);
    const pdf = await getDocument({ data: await compileDocument(engine, texFiles), useSystemFonts: false }).promise;
    try {
      expect(pdf.numPages).toBeGreaterThan(1);
      const content = await (await pdf.getPage(pdf.numPages)).getTextContent();
      const text = content.items.filter((item) => 'str' in item).map((item) => item.str).join(' ');
      expect(text).toContain('A. T. MORGAN');
      expect(text).toContain('J. M. RIVERA');
      const bodyLines = content.items.filter((item) => 'str' in item && /Coordinate|schedules|responsibilities|commands/.test(item.str))
        .map((item) => 'transform' in item ? Math.round(item.transform[5]) : 0);
      expect(new Set(bodyLines).size).toBeGreaterThanOrEqual(2);
    } finally {
      await pdf.destroy();
    }
  }, 120_000);

  it.each([
    ['moa', 7, 3, false], ['mou', 7, 3, false],
    ['moa', 9, 2, false], ['mou', 9, 2, false],
    ['moa', 18, 1, false], ['mou', 18, 1, false],
    ['moa', 18, 1, true], ['mou', 18, 1, true],
  ] as const)('%s keeps two body lines with signatures at the %s-paragraph boundary (%s sentences, blank closing rows: %s)', async (docType, count, repeats, blanks) => {
    const store = moaFixture(docType);
    store.paragraphs = Array.from({ length: count }, () => ({ level: 0,
      text: 'Coordinate schedules and confirm responsibilities with both commands. '.repeat(repeats),
    }));
    if (blanks) {
      store.paragraphs.splice(count - 1, 0, { level: 0, text: '' }, { level: 0, text: ' ' });
      store.paragraphs.push({ level: 0, text: '' }, { level: 0, text: ' ' });
    }
    const { texFiles } = generateAllLatexFiles(store);
    const pdf = await getDocument({ data: await compileDocument(engine, texFiles), useSystemFonts: false }).promise;
    try {
      expect(pdf.numPages).toBe(2);
      const content = await (await pdf.getPage(2)).getTextContent();
      const items = content.items.filter((item) => 'str' in item);
      const bodyLines = items.filter((item) => /Coordinate|schedules|responsibilities|commands/.test(item.str))
        .map((item) => Math.round(item.transform[5]));
      expect(new Set(bodyLines).size).toBeGreaterThanOrEqual(2);
      const text = items.map((item) => item.str).join(' ');
      expect(text).toContain('A. T. MORGAN');
      expect(text).toContain('J. M. RIVERA');
    } finally {
      await pdf.destroy();
    }
  }, 120_000);

  it.each(['joint_letter', 'joint_memorandum'])('%s retains the supplied signatory names', async (docType) => {
    const { texFiles } = generateAllLatexFiles(moaFixture(docType));
    const pdf = await getDocument({ data: await compileDocument(engine, texFiles), useSystemFonts: false }).promise;
    try {
      const content = await (await pdf.getPage(1)).getTextContent();
      const text = content.items.filter((item) => 'str' in item).map((item) => item.str).join(' ');
      expect(text).toContain('JORDAN M. RIVERA');
      expect(text).toContain('ALEX T. MORGAN');
    } finally {
      await pdf.destroy();
    }
  }, 120_000);

  it.each([['moa', false], ['mou', false], ['moa', true], ['mou', true]] as const)('%s anchors digital fields to final signers (family names: %s)', async (docType, familyNames) => {
    const store = moaFixture(docType);
    Object.assign(store.formData, { seniorSigName: familyNames ? 'J.M Rivera Jr.' : 'J.M. RIVERA',
      juniorSigName: familyNames ? 'A.T de la Cruz' : 'A.T. MORGAN', signatureType: 'digital' });
    store.paragraphs = Array.from({ length: 24 }, () => ({ level: 0,
      text: 'Coordinate schedules and confirm responsibilities with both commands. '.repeat(4),
    }));
    const generated = generateAllLatexFiles(store);
    const bytes = await compileDocument(engine, generated.texFiles);
    const parsed = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
    try {
      expect(parsed.numPages).toBeGreaterThan(1);
      const pageIndex = parsed.numPages - 1;
      const content = await (await parsed.getPage(pageIndex + 1)).getTextContent();
      const items = content.items.filter((item) => 'str' in item);
      const finished = await finishCorrespondencePdf(bytes, docType, store.formData, generated, store.paragraphs);
      expect(finished.errors).toEqual([]);
      const pdf = await PDFDocument.load(finished.pdfBytes);
      expect(pdf.getForm().getFields()).toHaveLength(2);
      for (const [fieldName, printedName] of [['JuniorSignature', familyNames ? 'A. T. DE LA CRUZ' : 'A. T. MORGAN'],
        ['SeniorSignature', familyNames ? 'J. M. RIVERA JR.' : 'J. M. RIVERA']]) {
        const printed = items.find((item) => item.str === printedName);
        expect(printed).toBeDefined();
        const widgets = pdf.getForm().getSignature(fieldName).acroField.getWidgets();
        expect(widgets).toHaveLength(1);
        expect(widgets[0].P()?.toString()).toBe(pdf.getPage(pageIndex).ref.toString());
        expect(widgets[0].getRectangle().x).toBeCloseTo(printed!.transform[4] - 2, 1);
        expect(widgets[0].getRectangle().y).toBeCloseTo(printed!.transform[5] + 9, 1);
      }
    } finally {
      await parsed.destroy();
    }
  }, 120_000);
  it.each([['moa', false], ['mou', false], ['moa', true], ['mou', true]] as const)('%s separates matching digital names (wrapped: %s)', async (docType, wrapped) => {
    const store = moaFixture(docType);
    const family = wrapped ? 'Rivera-Smith-Washington' : 'Rivera';
    Object.assign(store.formData, { juniorSigName: `Jamie M. ${family}`, seniorSigName: `Jordan M. ${family}`, signatureType: 'digital' });
    store.paragraphs.push({ level: 0, text: `Review J. M. ${family} and J. M. ${family} before signing.` });
    const generated = generateAllLatexFiles(store);
    const bytes = await compileDocument(engine, generated.texFiles);
    const parsed = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
    try {
      const content = await (await parsed.getPage(parsed.numPages)).getTextContent();
      const names = content.items.filter(item => 'str' in item && item.str === (wrapped ? 'J. M.' : 'J. M. RIVERA'))
        .sort((a, b) => 'transform' in a && 'transform' in b ? a.transform[4] - b.transform[4] : 0);
      expect(names).toHaveLength(2);
      const finished = await finishCorrespondencePdf(bytes, docType, store.formData, generated, store.paragraphs);
      const pdf = await PDFDocument.load(finished.pdfBytes);
      for (const [index, field] of ['JuniorSignature', 'SeniorSignature'].entries()) {
        const printed = names[index];
        if (!('transform' in printed)) throw new Error('Missing printed name');
        const widget = pdf.getForm().getSignature(field).acroField.getWidgets()[0];
        expect(widget.P()?.toString()).toBe(pdf.getPage(parsed.numPages - 1).ref.toString());
        expect(widget.getRectangle().x).toBeCloseTo(printed.transform[4] - 2, 1);
        expect(widget.getRectangle().y).toBeCloseTo(printed.transform[5] + 9, 1);
      }
    } finally {
      await parsed.destroy();
    }
  }, 120_000);

  it('anchors a prepared joint memorandum to its captured editor signers', async () => {
    const draft = prepareSessionState(createBlankSession(undefined, 'joint_memorandum'));
    Object.assign(draft, moaFixture('joint_memorandum'));
    Object.assign(draft.formData, {
      jointMemoSeniorSigName: 'SAM K. WOODS', jointMemoJuniorSigName: 'JAMIE L. LANE',
      signatureType: 'digital',
    });
    const captured = captureDocumentRevision({ documentId: 'joint', epoch: 1, editSequence: 1, capturedAt: 1 }, draft);
    const result = prepareExport({ id: 'joint', captured, target: 'pdf', filename: 'joint.pdf',
      policy: resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } }),
    });
    if (result.status !== 'ready' && result.status !== 'needs-review') throw new Error(JSON.stringify(result));
    const job = result.status === 'ready' ? result.job : acknowledgePreparedExport(result.job);
    draft.formData.jointMemoSeniorSigName = 'LATER EDIT';
    const artifact = await renderPreparedCorrespondence(job, {
      compile: files => compileDocument(engine, files),
      convertDocx: async () => { throw new Error('Unexpected Word conversion'); },
      assets: { withAssets: async (_ids, operation) => operation(() => { throw new Error('Unexpected asset read'); }) },
    }, new AbortController().signal);
    const bytes = new Uint8Array(await artifact.blob.arrayBuffer());
    const parsed = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
    try {
      const page = await parsed.getPage(parsed.numPages);
      const content = await page.getTextContent();
      const items = content.items.filter(item => 'str' in item);
      const text = items.map(item => item.str).join(' ');
      expect(text).not.toMatch(/LATER EDIT|JORDAN M. RIVERA|ALEX T. MORGAN/);
      const pdf = await PDFDocument.load(bytes);
      for (const [fieldName, name] of [['JuniorSignature', 'JAMIE L. LANE'], ['SeniorSignature', 'SAM K. WOODS']]) {
        const printed = items.find(item => item.str === name);
        expect(printed).toBeDefined();
        const widget = pdf.getForm().getSignature(fieldName).acroField.getWidgets()[0];
        expect(widget.P()?.toString()).toBe(pdf.getPage(parsed.numPages - 1).ref.toString());
        expect(widget.getRectangle().x).toBeCloseTo(printed!.transform[4] - 2, 1);
        expect(widget.getRectangle().y).toBeCloseTo(printed!.transform[5] + 9, 1);
      }
    } finally {
      await parsed.destroy();
    }
  }, 120_000);

  it.each([
    ['moa', 'trailing'], ['mou', 'trailing'], ['moa', 'between'], ['mou', 'between'],
  ] as const)('%s keeps signatures printable with many %s empty closing rows', async (docType, position) => {
    const store = moaFixture(docType);
    store.formData.signatureType = 'digital';
    store.paragraphs = Array.from({ length: 24 }, () => ({ level: 0,
      text: 'Coordinate schedules and confirm responsibilities with both commands. '.repeat(4),
    }));
    store.paragraphs.splice(1, 0, { level: 0, text: '' });
    store.paragraphs.splice(position === 'trailing' ? 25 : 24, 0,
      ...Array.from({ length: 40 }, () => ({ level: 0, text: '' })));
    const source = structuredClone(store.paragraphs);
    const generated = generateAllLatexFiles(store);
    expect(store.paragraphs).toEqual(source);
    const bytes = await compileDocument(engine, generated.texFiles);
    const finished = await finishCorrespondencePdf(bytes, docType, store.formData, generated, store.paragraphs);
    const parsed = await getDocument({ data: finished.pdfBytes.slice(), useSystemFonts: false }).promise;
    try {
      const pdf = await PDFDocument.load(finished.pdfBytes);
      const pageIndex = parsed.numPages - 1;
      const content = await (await parsed.getPage(parsed.numPages)).getTextContent();
      const items = content.items.filter(item => 'str' in item);
      const text = items.map(item => item.str).join(' ');
      let allText = text;
      for (let page = 1; page < parsed.numPages; page++) {
        const previous = await (await parsed.getPage(page)).getTextContent();
        allText += previous.items.filter(item => 'str' in item).map(item => item.str).join(' ');
      }
      // The earlier blank row remains paragraph 2; closing blanks add no labels.
      expect(allText).toContain('25.');
      expect(allText).not.toContain('65.');
      const bodyLines = items.filter(item => /Coordinate|schedules|responsibilities|commands/.test(item.str))
        .map(item => Math.round(item.transform[5]));
      expect(new Set(bodyLines).size).toBeGreaterThanOrEqual(2);
      for (const [fieldName, name] of [['JuniorSignature', 'A. T. MORGAN'], ['SeniorSignature', 'J. M. RIVERA']]) {
        const printed = items.find(item => item.str === name);
        expect(printed).toBeDefined();
        const widget = pdf.getForm().getSignature(fieldName).acroField.getWidgets()[0];
        const rect = widget.getRectangle();
        expect(widget.P()?.toString()).toBe(pdf.getPage(pageIndex).ref.toString());
        expect(rect.x).toBeCloseTo(printed!.transform[4] - 2, 1);
        expect(rect.y).toBeCloseTo(printed!.transform[5] + 9, 1);
        expect(rect.y).toBeGreaterThanOrEqual(72);
        expect(rect.y + rect.height).toBeLessThanOrEqual(pdf.getPage(pageIndex).getHeight() - 72);
      }
    } finally {
      await parsed.destroy();
    }
  }, 120_000);

  it.each(['moa', 'mou'])('%s retains a heading and a nontext callout in its closing tail', async docType => {
    const store = moaFixture(docType);
    store.paragraphs.push({ level: 0, text: '', header: 'Closing Authority' },
      { level: 0, text: '', callout: 'note' });
    const { texFiles } = generateAllLatexFiles(store);
    const pdf = await getDocument({ data: await compileDocument(engine, texFiles), useSystemFonts: false }).promise;
    try {
      const content = await (await pdf.getPage(pdf.numPages)).getTextContent();
      const text = content.items.filter(item => 'str' in item).map(item => item.str).join(' ');
      expect(text).toContain('Closing Authority');
      expect(text).toContain('NOTE');
      expect(text).toContain('A. T. MORGAN');
      expect(text).toContain('J. M. RIVERA');
    } finally {
      await pdf.destroy();
    }
  }, 120_000);

  it.each(['moa', 'mou'])('%s preserves an empty parent before a written closing subparagraph', async docType => {
    const store = moaFixture(docType);
    store.paragraphs.push({ level: 0, text: '' }, { level: 1, text: 'Confirm the closing responsibility.' });
    const { texFiles } = generateAllLatexFiles(store);
    const pdf = await getDocument({ data: await compileDocument(engine, texFiles), useSystemFonts: false }).promise;
    try {
      const content = await (await pdf.getPage(1)).getTextContent();
      const text = content.items.filter(item => 'str' in item).map(item => item.str).join(' ');
      expect(text).toContain('2.');
      expect(text).toContain('a.');
      expect(text).toContain('Confirm the closing responsibility.');
      expect(text).toContain('A. T. MORGAN');
      expect(text).toContain('J. M. RIVERA');
    } finally {
      await pdf.destroy();
    }
  }, 120_000);

});
