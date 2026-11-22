import 'fake-indexeddb/auto';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { TAGGED_MAIN_FILE } from '@/services/latex/renderDocument';
import { composeBasicLetterId } from '@/lib/endorsement';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { preparePackageAssembly, assemblePackage } from '@/lib/actionPackageAssembly';
import { updatePackageAssemblySettings } from '@/lib/packageAssemblySettings';
import { defaultPackageAssemblySettings } from '@/lib/packageAssemblyModel';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { compileGeneratedFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('react-pdf', async () => ({ pdfjs: await import('pdfjs-dist/legacy/build/pdf.mjs') }));
vi.mock('@/components/pdf/pdfConfig', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  return { HARDENED_PDF_OPTIONS: { isEvalSupported: false, useSystemFonts: true, disableFontFace: false } };
});
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
const restored: Array<() => void> = [];
beforeAll(() => {
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D }); vi.stubGlobal('__RUNTIME_BASE__', '');
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((name: string, options?: ElementCreationOptions) => name === 'canvas' ? createCanvas(612, 792) : original(name, options)) as typeof document.createElement);
});
afterEach(() => { restored.splice(0).forEach(restore => restore()); });
async function member(endorsement: boolean, paragraphs = 1, letterheadMode?: 'preprinted') {
  const session = createBlankSession(); session.docType = endorsement ? 'new_page_endorsement' : 'naval_letter';
  Object.assign(session.formData, { subject: 'SYNTHETIC PACKAGE ENDORSEMENT', from: 'Training Officer', to: 'Training Director', date: '17 Nov 26', ssic: '1500', serial: '001',
    sigFirst: endorsement ? 'Blair' : 'Alex', sigMiddle: '', sigLast: endorsement ? 'SAMPLE' : 'EXAMPLE', signatureType: 'none', classLevel: 'unclassified', pageNumbering: 'simple',
    endorsementOrdinal: 'FIRST', basicLetterId: 'Training Office ltr 1500 of 17 Nov 26', unitLine1: 'FICTIONAL TRAINING UNIT', unitLine2: 'FOR SOFTWARE QUALIFICATION', unitAddress: 'Training location', sealType: 'none' });
  if (letterheadMode) session.formData.letterheadMode = letterheadMode;
  if (endorsement) session.formData.basicLetterId = composeBasicLetterId({ docType: 'naval_letter', formData: session.formData });
  session.paragraphs = Array.from({ length: paragraphs }, (_, index) => ({ id: `body-${index}`, text: `${endorsement ? 'Endorsement' : 'Basic letter'} synthetic paragraph ${index + 1}. ${'This training example exercises preserved package content. '.repeat(paragraphs > 1 ? 5 : 1)}`, level: 0 }));
  return capturePackageMember(captureDocumentRevision({ documentId: `source_${crypto.randomUUID()}`, epoch: 0, editSequence: 1, capturedAt: 1 }, { ...session, endItems: [], publicationTables: {} }), endorsement ? 'Training endorsement' : 'Training letter', endorsement ? 'endorsement' : 'basic-letter');
}
async function compile(files: Record<string, string | Uint8Array>) {
  const text = Object.fromEntries(Object.entries(files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const binary = Object.fromEntries(Object.entries(files).filter((entry): entry is [string, Uint8Array] => entry[1] instanceof Uint8Array));
  if (text[TAGGED_MAIN_FILE]) text['main.tex'] = text[TAGGED_MAIN_FILE];
  const result = await compileGeneratedFixture(text, binary); expect(result.ok, result.logTail).toBe(true); return result.pdfBytes!;
}
describeToolchainRequirement('package same-page endorsement');
for (const paragraphs of [1, 30]) it.skipIf(!hasPdfToolchain)(`uses measured native placement for ${paragraphs} endorsement paragraphs`, async () => {
  let record = await reviseActionPackage(await createActionPackage(`Native package ${crypto.randomUUID()}`), [await member(false), await member(true, paragraphs)]);
  record = await updatePackageAssemblySettings(record, { ...defaultPackageAssemblySettings(), samePageEndorsements: true }, policy);
  const prepared = await preparePackageAssembly(record, record.currentRevisionId, policy);
  expect(prepared.readiness.findings.filter(finding => finding.severity === 'error')).toEqual([]);
  const result = await assemblePackage(prepared, { compile, convertDocx: vi.fn(), waitForReady: async () => true });
  const output = getPackageRevision(result).outputs[0], bytes = await readPackageAsset(output.asset), pdf = await PDFDocument.load(bytes);
  expect(output.assembly?.placements?.[0].placement, JSON.stringify(output.assembly?.placements)).toBe(paragraphs === 1 ? 'same-page' : 'new-page');
  expect(pdf.getPageCount()).toBe(paragraphs === 1 ? 1 : output.boundaries.reduce((sum, boundary) => sum + boundary.pageCount, 0));
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-package-native-')), path = join(dir, `endorsement-${paragraphs}.pdf`); await writeFile(path, new Uint8Array(bytes));
  const text = spawnSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
  expect(text.status).toBe(0); expect(text.stdout).toContain('A. EXAMPLE'); expect(text.stdout).toContain('B. SAMPLE'); expect(text.stdout).toContain('Endorsement synthetic paragraph 1');
  if (process.env.DONDOCS_PACKAGE_ASSEMBLY_EVIDENCE) await writeFile(join(process.env.DONDOCS_PACKAGE_ASSEMBLY_EVIDENCE, `endorsement-${paragraphs}.pdf`), new Uint8Array(bytes));
}, 120_000);

it.skipIf(!hasPdfToolchain)('renders a recipient delivery from only its selected native member', async () => {
  const { preparePackageDelivery, copyPreparedPackageDeliveryProjection, readPreparedPackageDeliveryAsset } = await import('@/lib/packageDelivery');
  const first = await member(false), excluded = await member(true);
  const source = await reviseActionPackage(await createActionPackage(`Native recipient ${crypto.randomUUID()}`), [first, excluded]);
  const prepared = await preparePackageDelivery(source, source.currentRevisionId, { label: 'Selected native recipient', purpose: 'recipient', memberIds: [first.id] }, policy,
    { compile, convertDocx: vi.fn(), waitForReady: async () => true });
  const selected = getPackageRevision(copyPreparedPackageDeliveryProjection(prepared)).members[0];
  if (selected.kind !== 'original') throw new Error('Expected rendered recipient PDF.');
  const bytes = await readPreparedPackageDeliveryAsset(prepared, selected.original), dir = await mkdtemp(join(tmpdir(), 'dondocs-recipient-')), path = join(dir, 'recipient.pdf');
  await writeFile(path, new Uint8Array(bytes));
  const text = spawnSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
  expect(text.status).toBe(0); expect(text.stdout).toContain('Basic letter synthetic paragraph 1'); expect(text.stdout).not.toContain('Endorsement synthetic');
  expect(JSON.stringify(copyPreparedPackageDeliveryProjection(prepared))).not.toContain(excluded.id);
  if (process.env.DONDOCS_PACKAGE_ASSEMBLY_EVIDENCE) {
    await writeFile(join(process.env.DONDOCS_PACKAGE_ASSEMBLY_EVIDENCE, 'recipient-selected-native.pdf'), new Uint8Array(bytes));
    const { buildPackageDeliveryBundle } = await import('@/lib/packageDeliveryBundle');
    const bundle = await buildPackageDeliveryBundle(prepared, policy, true);
    await writeFile(join(process.env.DONDOCS_PACKAGE_ASSEMBLY_EVIDENCE, 'recipient-native-delivery.zip'), bundle.bytes);
  }
}, 120_000);

it.skipIf(!hasPdfToolchain)('delivers separately tagged native letters alongside byte-exact originals', async () => {
  const { preparePackageDelivery } = await import('@/lib/packageDelivery');
  const { buildPackageDeliveryBundle } = await import('@/lib/packageDeliveryBundle');
  const { validateGeneratedTaggedPdf } = await import('@/services/pdf/accessibility/validate');
  const letter = await member(false, 1, 'preprinted');
  const originalPdf = await PDFDocument.create();
  originalPdf.addPage([612, 792]).drawText('Synthetic original enclosure');
  const signedSource = process.env.DONDOCS_PACKAGE_SIGNED_TEST_PDF;
  const originalBytes = new Uint8Array(signedSource ? await readFile(signedSource) : await originalPdf.save());
  const original = await captureOriginalPackageMember({ name: 'support-tagged.pdf', data: originalBytes.buffer }, 'enclosure', !!signedSource);
  const unsupported = await member(true);
  const record = await reviseActionPackage(await createActionPackage(`Tagged recipient ${crypto.randomUUID()}`), [letter, original, unsupported]);
  const ports = { compile, convertDocx: vi.fn(), waitForReady: async () => true };
  const selection = { label: 'Mixed recipient', purpose: 'recipient' as const, taggedNativePdfs: true, memberIds: [letter.id, original.id] };
  const prepared = await preparePackageDelivery(record, record.currentRevisionId, selection, policy, ports);
  const bundle = await buildPackageDeliveryBundle(prepared, policy, true);
  const { parsePackageDeliveryBundle } = await import('@/lib/packageDeliveryBundle');
  expect((await parsePackageDeliveryBundle(bundle.bytes)).manifest).toEqual(bundle.manifest);
  if (process.env.DONDOCS_PACKAGE_ASSEMBLY_EVIDENCE) {
    await writeFile(join(process.env.DONDOCS_PACKAGE_ASSEMBLY_EVIDENCE, 'tagged-mixed-delivery.zip'), bundle.bytes);
  }
  const zip = await JSZip.loadAsync(bundle.bytes);
  const tagged = bundle.manifest.files.find(file => file.name === 'document-1-tagged.pdf');
  const source = bundle.manifest.files.find(file => file.name === 'support-tagged.pdf');
  expect(tagged).toBeDefined();
  expect(source).toBeDefined();
  expect((await validateGeneratedTaggedPdf(await zip.file(tagged!.path)!.async('uint8array'))).associatedChunks).toBeGreaterThan(0);
  expect(await zip.file(source!.path)!.async('uint8array')).toEqual(originalBytes);
  const index = new DOMParser().parseFromString(await zip.file('index.html')!.async('string'), 'text/html');
  const links = Array.from(index.getElementsByTagName('a'));
  const taggedEntry = links.find(link => link.getAttribute('href') === tagged!.path)?.parentElement;
  const originalEntry = links.find(link => link.getAttribute('href') === source!.path)?.parentElement;
  expect(taggedEntry?.textContent).toContain('Experimental tagged letter PDF');
  expect(originalEntry?.textContent).not.toContain('Experimental tagged letter PDF');
  await expect(preparePackageDelivery(record, record.currentRevisionId, { ...selection, memberIds: [unsupported.id] }, policy, ports))
    .rejects.toThrow(/Training endorsement: Tagged PDF currently supports/);
}, 120_000);
