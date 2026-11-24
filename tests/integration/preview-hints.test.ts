import { execFileSync } from 'node:child_process';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { getPreviewHints, previewExamples, previewHintKey, STARTER_EXAMPLE_SECTIONS, type StarterExampleSection } from '@/lib/previewHints';
import { createBlankSession } from '@/stores/documentStore';
import { emptyPublicationVolume } from '@/lib/publicationVolume';
import { emptyJointCommand } from '@/lib/jointLetterCommands';
import { isDirective } from '@/lib/directiveFormats';
import { DOC_TYPE_CATEGORIES, DOC_TYPE_CONFIG } from '@/types/document';
import { compileGeneratedFixture, formatFailure } from '../_helpers/compileLatex';
import { describeToolchainRequirement, hasPdfToolchain } from '../_helpers/pdfToolchain';

describeToolchainRequirement('live PDF preview hints');

const formats = DOC_TYPE_CATEGORIES.flatMap(group => group.types);
const modes = ['compliant', 'custom'] as const;
const previewDate = new Date(2026, 10, 23);

async function renderedHintKeys(docType: string, texFiles: Record<string, string>) {
  const result = await compileGeneratedFixture(texFiles, {}, docType);
  expect(result.ok, formatFailure(docType, result)).toBe(true);
  const pdf = await getDocument({ data: new Uint8Array(result.pdfBytes!), useSystemFonts: false }).promise;
  try {
    const keys = new Set<string>();
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      for (const { url } of await page.getAnnotations()) {
        const key = previewHintKey(url);
        if (key) keys.add(key);
      }
    }
    return [...keys].sort();
  } finally {
    await pdf.destroy();
  }
}

describe.skipIf(!hasPdfToolchain)('compiled preview hints', () => {
  async function compile(docType: string, previewHints: boolean) {
    const source = {
      docType, documentMode: 'compliant' as const, formData: { sigLast: '', subject: '' },
      paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [],
    };
    const { texFiles } = generateAllLatexFiles(source, undefined, undefined, undefined, { previewHints });
    const result = await compileGeneratedFixture(texFiles, {}, docType);
    expect(result.ok, formatFailure(docType, result)).toBe(true);
    return result.pdfBytes!;
  }

  const text = (bytes: Uint8Array) => execFileSync('pdftotext', ['-layout', '-', '-'], { input: bytes, encoding: 'utf8' });
  it('renders real grey text and PDF hit areas only in the live preview', async () => {
    const preview = await compile('naval_letter', true);
    const exported = await compile('naval_letter', false);
    for (const example of [previewExamples.subject, previewExamples.signatory, previewExamples.body]) {
      expect(text(preview)).toContain(example);
      expect(text(exported)).not.toContain(example);
    }
    const reader = await getDocument({ data: new Uint8Array(preview), useSystemFonts: false }).promise;
    try {
      const page = await reader.getPage(1);
      const annotations: { url?: string; rect: number[] }[] = await page.getAnnotations();
      expect(annotations).toEqual(expect.arrayContaining([
        expect.objectContaining({ url: 'https://dondocs.invalid/preview-hint/subject' }),
        expect.objectContaining({ url: 'https://dondocs.invalid/preview-hint/body' }),
      ]));
      expect((await page.getOperatorList()).argsArray.flat()).toEqual(expect.arrayContaining([expect.stringMatching(/^#b[23]b[23]b[23]$/)]));
    } finally {
      await reader.destroy();
    }
  });

  it('prints the complete original first-run letter in the same layout', async () => {
    const date = new Date(2026, 10, 23);
    const blank = createBlankSession(undefined, 'naval_letter');
    // Original demo session after first-run profile selection.
    const original = {
      ...blank,
      formData: {
        ...blank.formData,
        unitLine1: 'MARINE INNOVATION UNIT', unitLine2: 'MARINE FORCES RESERVE',
        unitAddress: '10 MCDONALD STREET, NEWBURGH, NY 12550',
        ssic: '5216', officeCode: 'S-3', serial: '0123', date: '23 Nov 26',
        from: 'Commanding Officer, Marine Innovation Unit', to: '[RECIPIENT]', subject: '[SUBJECT]',
        sigFirst: 'John', sigMiddle: 'A', sigLast: 'DOE', sigRank: 'Lieutenant Colonel', sigTitle: 'Commanding Officer',
      },
      paragraphs: [{ level: 0, text: '[Your content here. Click "Templates" to load a pre-built letter format.]' }],
      copyTos: [{ text: 'G-3/5' }, { text: 'G-4' }, { text: 'Regimental S-3' }],
    };
    const originalOutput = generateAllLatexFiles(original, undefined, date);
    const previewOutput = generateAllLatexFiles(blank, undefined, date, undefined, { previewHints: true });
    const [oldPdf, livePdf] = await Promise.all(
      [originalOutput, previewOutput].map(output => compileGeneratedFixture(output.texFiles, {}, blank.docType)),
    );
    expect(oldPdf.ok, formatFailure(blank.docType, oldPdf)).toBe(true);
    expect(livePdf.ok, formatFailure(blank.docType, livePdf)).toBe(true);
    // The previous seed used two closing quotes around Templates.
    const normalizeQuotes = (value: string) => value.replace(/[“”]/g, '"');
    expect(normalizeQuotes(text(livePdf.pdfBytes!))).toBe(normalizeQuotes(text(oldPdf.pdfBytes!)));
    const pdf = await getDocument({ data: new Uint8Array(livePdf.pdfBytes!), useSystemFonts: false }).promise;
    try {
      const annotations: { url?: string }[] = await (await pdf.getPage(1)).getAnnotations();
      for (const key of ['unitline1', 'unitline2', 'unitaddress', 'addresslocality', 'officecode', 'serial',
        'sigfirst', 'sigmiddle', 'siglast', 'copytofirst', 'copytosecond', 'copytothird']) {
        expect(annotations).toContainEqual(expect.objectContaining({ url: `https://dondocs.invalid/preview-hint/${key}` }));
      }
    } finally {
      await pdf.destroy();
    }
  });

  it.each([
    ['business_letter', previewExamples.salutation],
    ['executive_memorandum', previewExamples.subject],
    ['joint_memorandum', previewExamples.seniorSignatory],
    ['moa', previewExamples.juniorSignatory],
    ['marine_corps_bulletin', 'Enter the cancellation date'],
    ['change_transmittal', 'Directive being amended'],
    ['information_paper', 'Name of preparer'],
    ['i_type', 'EQUIPMENT NOMENCLATURE'],
    ['sl3', 'COMPONENTS LIST FOR'],
    ['sl4', 'REPAIR PARTS LIST FOR'],
    ['tm_ietm_front_matter', 'EQUIPMENT NOMENCLATURE'],
  ])('renders a context-specific hint in %s', async (type, example) => {
    expect(text(await compile(type, true))).toContain(example);
  });

  it.concurrent.each(formats.flatMap(type => modes.map(mode => [type, mode] as const)))(
    'renders only the required hints after editing every category in %s (%s)',
    async (docType, documentMode) => {
      const draft = { ...createBlankSession(undefined, docType), documentMode };
      if (docType === 'technical_volume') {
        draft.formData.volume = emptyPublicationVolume();
        draft.paragraphs = [];
      }
      if (docType === 'coordination_page') draft.formData.coordinationLayout = 'hqmc';

      const initial = getPreviewHints(draft, previewDate);
      const config = DOC_TYPE_CONFIG[docType];
      const optionalByCategory: Record<StarterExampleSection, string[]> = {
        letterhead: [...(config.optionalLetterhead ? ['unitLine1'] : []), 'unitLine2', 'unitAddress', 'addressLocality'],
        senderSymbols: ['serial', ...(config.ssic && !isDirective(docType) ? ['officeCode'] : [])],
        addressing: config.uiMode === 'business' ? ['subject', ...(documentMode === 'custom' ? ['salutation'] : [])] : [],
        signature: ['sigFirst', 'sigMiddle', 'sigRank', ...(docType === 'tm_ietm_front_matter' ? [] : ['sigTitle']),
          ...(documentMode === 'custom' ? ['complimentaryClose'] : [])],
        basic: docType === 'same_page_endorsement' ? ['basicLetterId'] : [],
        copyTo: ['copyToFirst', 'copyToSecond', 'copyToThird'],
      };
      const keys = (omitted: readonly string[]) => Object.keys(initial).filter(key => !omitted.includes(key)).map(key => key.toLowerCase()).sort();
      for (const section of STARTER_EXAMPLE_SECTIONS) {
        expect(Object.keys(getPreviewHints(draft, previewDate, [section])).map(key => key.toLowerCase()).sort())
          .toEqual(keys(optionalByCategory[section]));
      }
      const render = (hiddenStarterSections?: readonly StarterExampleSection[]) =>
        generateAllLatexFiles(draft, undefined, previewDate, undefined, { previewHints: true, hiddenStarterSections }).texFiles;

      expect(await renderedHintKeys(docType, render())).toEqual(keys([]));
      expect(await renderedHintKeys(docType, render(STARTER_EXAMPLE_SECTIONS))).toEqual(keys(Object.values(optionalByCategory).flat()));
      if (docType === 'technical_volume') {
        expect(() => generateAllLatexFiles(draft)).toThrow('Add content to the volume');
        return;
      }
      const clean = generateAllLatexFiles(draft, undefined, previewDate);
      expect(Object.values(clean.texFiles).join('\n')).not.toMatch(/PreviewHint|dondocs\.invalid/);
    },
  );

  it('keeps missing signer hints in the three-command joint layout after a signer is entered', async () => {
    const draft = createBlankSession(undefined, 'joint_letter');
    draft.formData.jointAdditionalCommands = [emptyJointCommand()];
    draft.formData.jointSeniorSigName = 'SAM TRAINING';
    const { texFiles } = generateAllLatexFiles(draft, undefined, previewDate, undefined, { previewHints: true });
    const keys = await renderedHintKeys(draft.docType, texFiles);
    expect(keys).toContain('jointjuniorsigname');
    expect(keys).toContain('jointmiddlesigner');
    expect(keys).not.toContain('jointseniorsigname');
  });
});
