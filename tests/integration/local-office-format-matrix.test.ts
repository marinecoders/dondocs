import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createNodeEngine, loadAssets } from '../../companion/nodeEngine';
import { readLocalOfficeFontAssets } from '../../scripts/localOfficeFontAssets';
import { ALL_DOC_TYPES, buildBaseline, type DocType } from '../_helpers/compileMatrix';
import { instructionWordSource } from '../_helpers/publicationWordQualification';
import { sl3Fixture } from '../_helpers/sl3Fixture';
import { sl4Artwork, sl4Fixture } from '../_helpers/sl4Fixture';
import { volumeFixture } from '../_helpers/volumeFixture';
import { manualPacket } from '../_helpers/manualPacket';
import { DOC_TYPE_CONFIG, FORM_TYPE_LABELS, type BuiltinFormType, type DocumentMode } from '@/types/document';
import { createBlankSession, prepareSessionState } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { acknowledgePreparedExport, prepareExport } from '@/lib/preparedExport';
import { renderPreparedCorrespondence } from '@/services/exports/correspondence';
import { captureExportFormTemplates } from '@/services/exports/formTemplates';
import { renderPreparedBuiltinForm } from '@/services/exports/builtinForms';
import { compileDocument, LatexCompileError, prepareEngine } from '@/services/latex/renderDocument';
import { validateGeneratedTaggedPdf } from '@/services/pdf/accessibility/validate';
import { loadLocalOfficeFonts, OFFICE_FONT_URL, type OfficeFontAssets, type OfficeFontSource } from '@/services/officeFonts';
import { inspectPackageAttachment, renderPackageAttachment } from '@/lib/packageAttachmentCapabilities';
import { supportsDlaLetterhead } from '@/lib/dlaLetterhead';
import { computeNavmc11811Fit } from '@/services/pdf/navmc11811Generator';

const enabled = process.env.DONDOCS_VERIFY_LOCAL_OFFICE_FONTS === '1';
const output = process.env.DONDOCS_LOCAL_FONT_TEST_OUTPUT;
const date = Date.UTC(2026, 10, 22, 12);
const marker = 'Confirm the office file, résumé, café and naïve labels.';
const tagged = ['standard_letter', 'naval_letter', 'multiple_address_letter', 'plain_paper_memorandum', 'letterhead_memorandum'];
const fixtureTypes = new Set<string>(ALL_DOC_TYPES);
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
type Font = 'courier' | 'times';
type Instruction = Parameters<typeof instructionWordSource>[0];
type Manual = Parameters<typeof manualPacket>[1];
type Variant = Instruction | Manual | '5x7' | '7x9' | 'secnav' | 'hqmc' | 'dla-full' | 'dla-preprinted';
type FormatCase = { type: string; mode: DocumentMode; font?: Font; variant?: Variant };

function fixture(type: string, mode: DocumentMode, font?: Font, variant?: Variant) {
  const raw = createBlankSession(undefined, type);
  const source = type === 'i_type' ? instructionWordSource(variant as Instruction)
    : type === 'sl3' ? sl3Fixture()
    : type === 'sl4' ? sl4Fixture()
    : type === 'technical_volume' ? volumeFixture()
    : type === 'tm_ietm_front_matter' ? { ...manualPacket(1, variant as Manual), paragraphs: [] }
    : fixtureTypes.has(type) ? buildBaseline(type as DocType) : undefined;
  const document = prepareSessionState({
    ...raw, ...source, docType: type, documentMode: mode, references: [], enclosures: [], copyTos: [],
    formData: { ...raw.formData, ...source?.formData, docType: type,
      ...(font ? { fontFamily: font } : {}),
      ...(variant === '5x7' || variant === '7x9' ? { stationerySize: variant, letterheadMode: 'preprinted' } : {}),
      ...(variant === 'dla-full' || variant === 'dla-preprinted' ? {
        letterheadStandard: 'dla', letterheadMode: variant === 'dla-full' ? 'full' : 'preprinted',
      } : {}),
      ...(type === 'coordination_page' ? { coordinationLayout: variant === 'hqmc' ? 'hqmc' : 'secnav',
        coordinationEntries: [{ office: 'Operations', contact: 'Casey Résumé', phone: '555-0101', date: '22 Nov 26', position: 'Concur' }],
      } : {}),
      ...(!DOC_TYPE_CONFIG[type].publication ? {
        date: '22 Nov 26', from: 'Training Office', subject: 'Document font verification', officeCode: 'ADMIN',
        to: source?.formData.to || 'Training Staff', sigLast: 'Example', signatureType: 'none', preparedBy: 'Staff Reviewer',
        directiveNumber: type === 'secnav_notice' ? '5215' : type === 'change_transmittal' ? 'SECNAVINST 5215.1E' : '5215.1E',
        directiveChangeNumber: '1', directiveCancellation: 'Canc: Jun 2027',
      } : {}),
    },
  });
  if (!DOC_TYPE_CONFIG[type].publication) {
    document.paragraphs = [{ level: 0, text: marker }];
    if (type === 'multiple_address_letter') document.distributions = [{ text: 'DEPARTMENT TRAINING STAFF' }];
  }
  return document;
}

const publications: Record<string, string> = {
  i_type: 'SUPPORT BRACKET',
  sl3: 'Training tool kit',
  sl4: 'TRAIN-RES',
  tm_ietm_front_matter: 'PORTABLE TEST EQUIPMENT',
  technical_volume: 'Original introduction.',
};

describe.skipIf(!enabled)('local Office font PDF format matrix', () => {
  let engine: Awaited<ReturnType<typeof createNodeEngine>>;
  let assets: Awaited<ReturnType<typeof loadAssets>>;
  let artwork: Uint8Array;
  let replacement: ArrayBuffer;
  let officeFonts: OfficeFontSource;

  async function startEngine() {
    engine = await createNodeEngine();
    prepareEngine(engine, { ...assets, officeFonts });
  }

  beforeAll(async () => {
    const fontAssets = readLocalOfficeFontAssets();
    const fetchOther = globalThis.fetch.bind(globalThis);
    vi.stubEnv('VITE_LOCAL_OFFICE_FONTS', '1');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
      const path = decodeURI(String(input));
      if (path.startsWith(OFFICE_FONT_URL)) {
        const name = path.slice(OFFICE_FONT_URL.length);
        return new Response(new Uint8Array(fontAssets[name as keyof OfficeFontAssets]));
      }
      if (path.startsWith('/templates/') || path.startsWith('/attachments/')) {
        return new Response(new Uint8Array(await readFile('public' + path)));
      }
      return fetchOther(input, options);
    });
    const loaded = await loadLocalOfficeFonts();
    if (!loaded) throw new Error('The local Office font source must be enabled for this matrix.');
    officeFonts = loaded;
    assets = await loadAssets();
    artwork = Object.values(await sl4Artwork())[0];
    const pdf = await PDFDocument.create();
    pdf.addPage([501, 731]).drawRectangle({ x: 40, y: 80, width: 80, height: 40 });
    replacement = new Uint8Array(await pdf.save()).buffer;
    await startEngine();
  }, 60_000);

  afterAll(async () => {
    await engine?.dispose();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const formats = Object.keys(DOC_TYPE_CONFIG);
  const selected = process.env.DONDOCS_LOCAL_FONT_MATRIX_FORMAT;
  const cases = formats.filter(type => !selected || type === selected).flatMap<FormatCase>(type => {
    if (type === 'i_type') return (['MI', 'TI', 'SI', 'LI'] as const).map(variant => ({ type, mode: 'compliant' as const, font: undefined, variant }));
    if (type === 'tm_ietm_front_matter') return (['tm', 'cots', 'qrg', 'rpstl', 'supplement', 'tm_rpstl', 'user', 'ietm'] as const)
      .map(variant => ({ type, mode: 'compliant' as const, font: undefined, variant }));
    if (DOC_TYPE_CONFIG[type].publication) return [{ type, mode: 'compliant' as const, font: undefined, variant: undefined }];
    const ordinary: FormatCase[] = [
      { type, mode: 'compliant' as const, font: undefined, variant: undefined },
      { type, mode: 'custom' as const, font: 'times' as const, variant: undefined },
      { type, mode: 'custom' as const, font: 'courier' as const, variant: undefined },
    ];
    if (type === 'coordination_page') return ordinary.flatMap(row =>
      (['secnav', 'hqmc'] as const).map(variant => ({ ...row, variant })));
    return [
      ...ordinary,
      ...(supportsDlaLetterhead(type) ? [
        { type, mode: 'compliant' as const, variant: 'dla-preprinted' as const },
        ...(['times', 'courier'] as const).map(font => ({ type, mode: 'custom' as const, font, variant: 'dla-full' as const })),
      ] : []),
      ...(type === 'executive_correspondence' ? (['5x7', '7x9'] as const)
        .map(variant => ({ type, mode: 'compliant' as const, font: undefined, variant })) : []),
    ];
  });
  const jobs = [
    ...cases.map(row => ({ ...row, profile: undefined })),
    ...tagged.filter(type => !selected || type === selected).flatMap(type =>
      (['times', 'courier'] as const).map(font => ({ type, mode: 'custom' as const, font, variant: undefined, profile: 'tagged' as const }))),
  ].map(row => ({ ...row, name: [row.type, row.variant, row.mode, row.font ?? 'default', row.profile ?? 'ordinary'].filter(Boolean).join('-') }));

  it.each(jobs)('$name', async ({ type, mode, font, profile, variant, name }) => {
    const document = fixture(type, mode, font, variant);
    if (type === 'change_transmittal') document.enclosures = [{ title: 'Replacement sheet', file: { name: 'replacement.pdf', size: replacement.byteLength, data: replacement } }];
    if (type === 'i_type') document.enclosures.push({ title: 'Training illustration', file: { name: 'illustration.pdf', size: replacement.byteLength, data: replacement } });
    if (profile) document.formData.letterheadMode = 'preprinted';
    const captured = captureDocumentRevision({ documentId: name, epoch: 1, editSequence: 1, capturedAt: date }, document);
    const preparation = prepareExport({ captured, policy, target: 'pdf', id: name, filename: name + '.pdf', ...(profile ? { pdfAccessibility: profile } : {}) });
    if (!('job' in preparation)) throw new Error(preparation.issues.join('; '));
    const job = preparation.status === 'ready' ? preparation.job : acknowledgePreparedExport(preparation.job);
    let result;
    try {
      result = await renderPreparedCorrespondence(job, {
        compile: (files, compileProfile) => compileDocument(engine, files, compileProfile),
        convertDocx: async () => { throw new Error('Unexpected Word conversion'); },
        assets: { withAssets: async (_ids, operation) => operation(id => {
          if (id !== 'sl4-artwork') throw new Error('Unexpected asset ' + id);
          return { id, data: new Uint8Array(artwork).buffer, name: 'training-box.pdf', type: 'application/pdf', size: artwork.byteLength };
        }) },
      }, new AbortController().signal);
    } catch (error) {
      if (error instanceof LatexCompileError) {
        if (output) await writeFile(join(output, name + '.log'), error.log);
        await engine.dispose();
        await startEngine();
        throw new Error(error.log.split('\n').filter(line => line.startsWith('!')).join('\n'), { cause: error });
      }
      throw error;
    }
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    if (output) await writeFile(join(output, name + '.pdf'), bytes);
    const fonts = execFileSync('pdffonts', ['-'], { input: bytes, encoding: 'utf8' });
    const actual = execFileSync('pdftotext', ['-layout', '-', '-'], { input: bytes, encoding: 'utf8' }).replace(/\s+/g, ' ');
    const expected = font ?? document.formData.fontFamily ?? 'times';
    expect(fonts, name).toContain(expected === 'courier' ? 'CourierNewPSMT' : 'TimesNewRomanPSMT');
    expect(fonts, name).not.toMatch(/Nimbus|\bCourier\b|\bTimes-Roman\b/);
    expect(actual, name).toContain(type === 'coordination_page' ? 'Casey Résumé' : publications[type] ?? marker);
    if (variant === 'dla-full') {
      expect(actual).toContain('DEFENSE LOGISTICS AGENCY');
      expect(fonts).toContain('TimesNewRomanPS-BoldMT');
    }
    if (variant === 'dla-preprinted') expect(actual).not.toContain('DEFENSE LOGISTICS AGENCY');
    if (type === 'executive_correspondence' && !variant) {
      const bounds = execFileSync('pdftotext', ['-bbox', '-', '-'], { input: bytes, encoding: 'utf8' });
      const dateTop = bounds.match(/<word xMin="[^"]+" yMin="([^"]+)"[^>]*>22<\/word>/)?.[1];
      expect(Number(dateTop), 'Full letterhead date must clear the seal at 108 PDF points').toBeGreaterThan(110);
    }
    if (profile) expect((await validateGeneratedTaggedPdf(bytes)).associatedChunks).toBeGreaterThan(0);
    if (type === 'change_transmittal') expect((await PDFDocument.load(bytes)).getPages().at(-1)?.getSize()).toEqual({ width: 501, height: 731 });
  }, 45_000);

  it.each((Object.keys(FORM_TYPE_LABELS) as BuiltinFormType[]).filter(type => !selected || selected === type))('writes real Times New Roman onto %s', async type => {
    async function renderRemarks(text: string) {
      const session = createBlankSession(type);
      if (session.forms?.navmc10274) Object.assign(session.forms.navmc10274, { natureOfAction: 'Training request', supplementalInfo: text, signatureBlocks: [] });
      if (session.forms?.navmc11811) Object.assign(session.forms.navmc11811, { lastName: 'Example', firstName: 'Alex', remarksText: text, signatureBlocks: [] });
      const captured = captureDocumentRevision({ documentId: type, epoch: 1, editSequence: 1, capturedAt: date }, prepareSessionState(session));
      const formTemplates = await captureExportFormTemplates(captured);
      const preparation = prepareExport({ captured, policy, formTemplates, target: 'pdf', id: type, filename: type + '.pdf' });
      if (!('job' in preparation)) throw new Error(preparation.issues.join('; '));
      const job = preparation.status === 'ready' ? preparation.job : acknowledgePreparedExport(preparation.job);
      return renderPreparedBuiltinForm(job, new AbortController().signal);
    }
    const artifact = await renderRemarks(marker);
    const bytes = new Uint8Array(await artifact.blob.arrayBuffer());
    if (output) await writeFile(join(output, type + '.pdf'), bytes);
    const fonts = execFileSync('pdffonts', ['-'], { input: bytes, encoding: 'utf8' });
    expect(fonts).toMatch(/TimesNewRomanPSMT[^\n]*TrueType[^\n]*yes/);
    expect(execFileSync('pdftotext', ['-layout', '-', '-'], { input: bytes, encoding: 'utf8' }).replace(/\s+/g, ' ')).toContain(marker);
    await expect(renderRemarks('Missing glyph: 日本語')).rejects.toThrow('The selected PDF font cannot print U+65E5.');
  }, 45_000);

  it.skipIf(Boolean(selected && selected !== 'navmc_118_11'))('recovers the Page 11 measurement font after initialization fails', async () => {
    const data = createBlankSession('navmc_118_11').forms?.navmc11811;
    if (!data) throw new Error('The Page 11 fixture is missing.');
    const draft = { ...data, remarksText: marker };
    const create = vi.spyOn(PDFDocument, 'create').mockRejectedValueOnce(new Error('Font setup interrupted'));
    try {
      await expect(computeNavmc11811Fit(draft)).rejects.toThrow('Font setup interrupted');
    } finally {
      create.mockRestore();
    }
    await expect(computeNavmc11811Fit(draft)).resolves.toMatchObject({ left: { lines: 1 } });
  });

  it.skipIf(Boolean(selected))('uses Courier New for text attachments and refuses missing glyphs', async () => {
    const file = { name: 'evidence.txt', type: 'text/plain', data: new TextEncoder().encode(marker).buffer };
    expect((await inspectPackageAttachment(file)).canRenderPdf).toBe(true);
    const original = { name: file.name, type: file.type, id: 'text-evidence', size: file.data.byteLength, sha256: '0'.repeat(64) };
    const bytes = new Uint8Array(await renderPackageAttachment(original, file.data));
    if (output) await writeFile(join(output, 'text-attachment.pdf'), bytes);
    expect(execFileSync('pdffonts', ['-'], { input: bytes, encoding: 'utf8' })).toMatch(/CourierNewPSMT[^\n]*TrueType[^\n]*yes/);
    expect(execFileSync('pdftotext', ['-', '-'], { input: bytes, encoding: 'utf8' })).toContain(marker);

    const unsupported = { ...file, data: new TextEncoder().encode('Missing glyph: 日本語').buffer };
    expect((await inspectPackageAttachment(unsupported)).canRenderPdf).toBe(false);
    await expect(renderPackageAttachment(original, unsupported.data)).rejects.toThrow('no qualified combined-PDF conversion');
  });
});
