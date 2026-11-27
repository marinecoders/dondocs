import 'fake-indexeddb/auto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { expect, it, vi } from 'vitest';
import { createBlankSession, prepareSessionState } from '@/stores/documentStore';
import { officialFormCompletionIssues, matchesExpectedForm } from '@/lib/packageFormCompletion';
import { packageFormFields } from '@/lib/packageFormFields';
import { supportsOfficialSigning } from '@/services/forms/nativeCatalog';
import { fillOfficialPdf, officialPdfProfile } from '@/services/forms/officialPdfProfiles';
import { createOfficialFormMember } from '@/lib/packageOfficialForms';
import { readPackageAsset } from '@/lib/actionPackageAssets';
import { renderPackageRecipientMember } from '@/lib/packageNativeDelivery';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';

vi.mock('react-pdf', async () => ({ pdfjs: await import('pdfjs-dist/legacy/build/pdf.mjs') }));
vi.mock('@/components/pdf/pdfConfig', async () => {
  const { GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  return { HARDENED_PDF_OPTIONS: { isEvalSupported: false } };
});

const profile = officialPdfProfile('navmc_10274', '2020-07')!;
const original = new Uint8Array(await readFile('public/templates/' + profile.source)).buffer;
const sample = () => {
  const forms = createBlankSession('navmc_10274').forms!;
  Object.assign(forms.navmc10274!, {
    actionNo: 'ACTION', ssicFileNo: 'FILE', date: '25 Nov 26', from: 'Sender', orgStation: 'Station',
    via: 'Via', to: 'Recipient', natureOfAction: 'Subject', copyTo: 'Copy', references: 'Reference',
    enclosures: 'Enclosure', supplementalInfo: Array.from({ length: 29 }, (_, i) => 'Line ' + (i+1)).join('\n'),
    proposedAction: 'Review the request', signatureBlocks: [{ name: 'Training Signer', statement: 'Reviewed' }],
  });
  return forms;
};
const fieldName = (name: string) => `form1[0].${name}[0]`;
const visibleText = (bytes: Uint8Array) => execFileSync('pdftotext', ['-layout', '-', '-'], { input: bytes, encoding: 'utf8' });

it('round-trips all thirteen official text fields, retains the cover, and prints the same continuation', async () => {
  const forms = sample();
  const field = await packageFormFields({ id: profile.formId, edition: profile.edition });
  expect(field('actionNo')).toBe(fieldName('ActNum'));
  expect(supportsOfficialSigning(profile.formId)).toBe(false);
  expect(forms.officialPdfEdition).toBe(profile.edition);
  const editable = await fillOfficialPdf(profile, forms, original);
  expect(Buffer.from(editable.subarray(0, original.byteLength)).equals(Buffer.from(original))).toBe(true);
  const doc = await PDFDocument.load(editable);
  expect(doc.getPageCount()).toBe(3);
  const value = (name: string) => doc.getForm().getTextField(fieldName(name)).getText();
  for (const [name, expected] of Object.entries({ ActNum: 'ACTION', FileNum: 'FILE', Date: '25 Nov 26',
    NameFrom: 'Sender', OrgStat: 'Station', Via1: 'Via', AddrTo: 'Recipient', NatOfAct: 'Subject',
    CopyTo: 'Copy', RefAuth: 'Reference', Encl1: 'Enclosure' })) expect(value(name)).toBe(expected);
  expect(value('SuppInfo')).toContain('Line 26');
  expect(value('ProcAct')).toContain('Line 29');
  expect(value('ProcAct')).toContain('Review the request');
  expect(value('ProcAct')).toContain('Training Signer');
  for (const includeCoverPage of [false, true]) {
    const printable = await fillOfficialPdf(profile, { ...forms, includeCoverPage }, original, 'printable');
    const print = await PDFDocument.load(printable);
    expect(print.getPageCount()).toBe(includeCoverPage ? 3 : 2);
    expect(print.getForm().getFields()).toHaveLength(0);
    const text = visibleText(printable);
    expect(text).toContain('Training Signer');
    expect(text).toContain('ACTION');
    for (let i = 1; i <= 29; i++) expect(text).toMatch(new RegExp('Line ' + i + '\\b'));
  }
  forms.navmc10274!.supplementalInfo = 'Line\n'.repeat(100);
  await expect(fillOfficialPdf(profile, forms, original)).rejects.toThrow('continuation page');
  await expect(fillOfficialPdf(profile, forms, original.slice(1))).rejects.toThrow('does not match');
});

it('keeps added signing fields on the continuation page and older drafts on their saved layout', async () => {
  const forms = sample();
  forms.navmc10274!.signatureBlocks[0].style = 'digital';
  const editable = await fillOfficialPdf(profile, forms, original);
  const doc = await PDFDocument.load(editable);
  const field = doc.getForm().getSignature('Training Signer signature 1');
  expect(field.acroField.getWidgets()[0].P()?.toString()).toBe(doc.getPage(2).ref.toString());
  expect(doc.getForm().getTextField(fieldName('ActNum')).getText()).toBe('ACTION');
  const bbox = execFileSync('pdftotext', ['-bbox', '-', '-'], { input: editable, encoding: 'utf8' });
  const signer = bbox.match(/yMin="([\d.]+)"[^>]*>Signer<\/word>/);
  expect(signer).toBeTruthy();
  const gap = field.acroField.getWidgets()[0].getRectangle().y - (792 - Number(signer![1]));
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(6);
  const old = createBlankSession('navmc_10274');
  delete old.forms!.officialPdfEdition;
  expect(prepareSessionState(old).forms?.officialPdfEdition).toBeUndefined();
});

it('preserves a Unicode addressee in the editable PDF and prevents an empty printed field', async () => {
  const forms = createBlankSession('navmc_10274').forms!;
  forms.navmc10274!.to = '李';
  const editable = await PDFDocument.load(await fillOfficialPdf(profile, forms, original));
  expect(editable.getForm().getTextField(fieldName('AddrTo')).getText()).toBe('李');
  await expect(fillOfficialPdf(profile, forms, original, 'printable')).rejects.toThrow('editable PDF');
});

it('keeps a signature-only field inside block 12', async () => {
  const forms = createBlankSession('navmc_10274').forms!;
  forms.navmc10274!.signatureBlocks = [{ name: 'Training Signer', statement: '', style: 'digital' }];
  const doc = await PDFDocument.load(await fillOfficialPdf(profile, forms, original));
  const form = doc.getForm();
  const box = form.getTextField(fieldName('SuppInfo')).acroField.getWidgets()[0].getRectangle();
  const signature = form.getSignature('Training Signer signature 1').acroField.getWidgets()[0].getRectangle();
  expect(signature.y).toBeGreaterThanOrEqual(box.y);
  expect(signature.y + signature.height).toBeLessThanOrEqual(box.y + box.height);
});

it('renders the scanned signature on the continuation in editable and print output', async () => {
  const forms = sample();
  Object.assign(forms.navmc10274!.signatureBlocks[0], { style: 'image', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC' });
  const directory = await mkdtemp(join(tmpdir(), 'dondocs-10274-'));
  const file = join(directory, 'form.pdf');
  try {
    for (const mode of ['editable', 'printable'] as const) {
      const bytes = await fillOfficialPdf(profile, forms, original, mode);
      const page = mode === 'editable' ? '3' : '2';
      await writeFile(file, bytes);
      const ppm = execFileSync('pdftoppm', ['-f', page, '-l', page, '-singlefile', '-r', '72', file], { maxBuffer: 4_000_000, timeout: 15000 });
      const header = ppm.indexOf('255\n') + 4;
      let redPixels = 0;
      for (let i = header; i < ppm.length; i += 3)
        if (ppm[i] > 240 && ppm[i + 1] < 15 && ppm[i + 2] < 15) redPixels++;
      expect(redPixels).toBeGreaterThan(100);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('captures one original for the package and renders it after portable transfer', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    expect(decodeURIComponent(url)).toContain(profile.source);
    return new Response(original.slice(0));
  });
  try {
    const member = await createOfficialFormMember('navmc_10274', 'basic-letter');
    expect(officialFormCompletionIssues(member)).toContain('The official form is still blank.');
    const filled = structuredClone(member);
    filled.session.forms!.navmc10274!.actionNo = 'PKG-10274';
    expect(officialFormCompletionIssues(filled)).toEqual([]);
    expect(await matchesExpectedForm(member, { id: profile.formId, edition: profile.edition })).toBe(true);
    expect(Object.keys(member.templates!)).toEqual(['official']);
    const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
    const record = await reviseActionPackage(await createActionPackage('Training'), [member]);
    const transfer = await parsePortableActionPackage(await buildPortableActionPackage(record));
    const restored = getPackageRevision(transfer.record).members[0];
    if (restored.kind !== 'native') throw new Error('Expected editable working form.');
    const pdf = await renderPackageRecipientMember(restored, policy, undefined, readPackageAsset, new AbortController().signal, undefined, 'editable');
    expect((await PDFDocument.load(pdf.bytes)).getForm().getTextField(fieldName('ActNum'))).toBeDefined();
  } finally { vi.unstubAllGlobals(); }
});
