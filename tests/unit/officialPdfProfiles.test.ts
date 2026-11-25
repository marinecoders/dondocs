import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { expect, it, vi } from 'vitest';
import { capturePackageMember, preparePackageMember, readPackageAsset, readPackageMemberDraft } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { buildDraftFileFromSnapshot, parseDraftFile } from '@/lib/draftFile';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { portableResourceDigest } from '@/lib/portableResources';
import { acknowledgePreparedExport, prepareExport } from '@/lib/preparedExport';
import { renderPreparedBatchRow } from '@/services/exports/batchRows';
import { renderPreparedBuiltinForm } from '@/services/exports/builtinForms';
import { captureExportFormTemplates } from '@/services/exports/formTemplates';
import { fillOfficialPdf, officialPdfProfile } from '@/services/forms/officialPdfProfiles';
import { createBlankSession, prepareSessionState } from '@/stores/documentStore';

const formId = 'navmc_118_11';
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
const capture = (id: string, session: ReturnType<typeof createBlankSession>) =>
  captureDocumentRevision({ documentId: id, epoch: 1, editSequence: 0, capturedAt: session.timestamp }, prepareSessionState(session));

it('checks the downloaded printable background before using it for the official edition', async () => {
  const { loadNavmc11811Template } = await import('@/services/pdf/navmc11811Generator');
  vi.stubGlobal('fetch', async () => new Response('different template'));
  try {
    await expect(loadNavmc11811Template(true)).rejects.toThrow('does not match the official edition');
    expect(new TextDecoder().decode(await loadNavmc11811Template())).toBe('different template');
  } finally { vi.unstubAllGlobals(); }
});

it('pins the same official edition for standalone and package drafts with independent answers', async () => {
  const profile = officialPdfProfile(formId)!;
  const original = new Uint8Array(await readFile(`public/templates/${profile.source}`)).buffer;
  const printable = new Uint8Array(await readFile('public/templates/NAVMC11811 - Administrative Remarks/page1.pdf')).buffer;
  const fetchPdf = vi.fn(async (url: string) => {
    if (url.endsWith('/original.pdf')) return new Response(original.slice(0));
    if (url.endsWith('/page1.pdf')) return new Response(printable.slice(0));
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchPdf);

  try {
    const standalone = createBlankSession(formId);
    const packageDraft = createBlankSession(formId);
    Object.assign(standalone.forms!.navmc11811!, { lastName: 'Training', firstName: 'Example', edipi: '0012345678', remarksText: 'Standalone draft', entryDate: '23 Nov 26' });
    Object.assign(packageDraft.forms!.navmc11811!, { remarksText: 'Package draft' });
    const standaloneFile = await buildDraftFileFromSnapshot(prepareSessionState(standalone), standalone.timestamp);
    const reopened = (await parseDraftFile(standaloneFile)).session;
    const member = await capturePackageMember(capture('second-draft', packageDraft), 'Page 11', 'supporting-document');

    expect(reopened.forms?.officialPdfEdition).toBe(profile.edition);
    expect(reopened.forms?.navmc11811?.remarksText).toBe('Standalone draft');
    await expect(readPackageAsset(member.templates!.official)).resolves.toEqual(original);
    fetchPdf.mockImplementation(async () => { throw new Error('Offline'); });
    const packageReopened = await readPackageMemberDraft(member);
    expect(packageReopened.reviewed.session.forms?.officialPdfEdition).toBe(profile.edition);
    expect(packageReopened.reviewed.session.forms?.navmc11811?.remarksText).toBe('Package draft');
    packageReopened.reviewed.session.forms!.navmc11811!.remarksText = 'Revised package draft';
    const revised = await capturePackageMember(capture('second-draft', packageReopened.reviewed.session), 'Page 11', 'supporting-document', member);
    expect(revised.templates).toEqual(member.templates);
    expect((await readPackageMemberDraft(revised)).reviewed.session.forms?.navmc11811?.remarksText).toBe('Revised package draft');

    const record = await reviseActionPackage(await createActionPackage('Page 11 transfer'), [revised]);
    const transfer = await parsePortableActionPackage(await buildPortableActionPackage(record));
    const transferred = getPackageRevision(transfer.record).members[0];
    if (transferred.kind !== 'native') throw new Error('Expected an editable package member.');
    expect(transferred.session.forms?.officialPdfEdition).toBe(profile.edition);
    expect(transferred.templates?.official.sha256).toBe(profile.sha256);

    // Opening the package member makes both verified templates available to
    // the regular document downloader, including offline.
    const callsBeforeReopen = fetchPdf.mock.calls.length;
    const preparedMember = await preparePackageMember(revised);
    const captured = capture('standalone-draft', reopened);
    await expect(captureExportFormTemplates(captureDocumentRevision({
      documentId: 'package-working-copy', epoch: 1, editSequence: 0, capturedAt: 0,
    }, preparedMember.snapshot))).resolves.toBeDefined();

    const formTemplates = await captureExportFormTemplates(captured);
    expect(fetchPdf).toHaveBeenCalledTimes(callsBeforeReopen);
    const result = prepareExport({ id: 'page-11', filename: 'page-11.pdf', captured, formTemplates, policy, target: 'pdf' });
    if ('issues' in result) throw new Error(result.issues.join(', '));
    const ready = result.status === 'ready' ? result.job : acknowledgePreparedExport(result.job);
    const signal = new AbortController().signal;
    const editable = await renderPreparedBuiltinForm(ready, signal);
    const output = await editable.blob.arrayBuffer();
    expect(output.byteLength).toBeGreaterThan(original.byteLength);
    expect(await portableResourceDigest(output.slice(0, original.byteLength))).toBe(profile.sha256);
    const printCopy = await renderPreparedBuiltinForm(ready, signal, 'printable');
    expect((await PDFDocument.load(await printCopy.blob.arrayBuffer())).getPageCount()).toBe(1);
    const ports = { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: vi.fn() };
    const batchPreview = await renderPreparedBatchRow(ready, ports, signal, 'printable');
    expect((await PDFDocument.load(await batchPreview.blob.arrayBuffer())).getPageCount()).toBe(1);
    const batchDownload = await renderPreparedBatchRow(ready, ports, signal);
    expect(await portableResourceDigest((await batchDownload.blob.arrayBuffer()).slice(0, original.byteLength))).toBe(profile.sha256);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('keeps old sessions on the existing exporter and rejects unknown pinned editions', () => {
  const session = createBlankSession(formId);
  delete session.forms!.officialPdfEdition;
  expect(prepareSessionState(session).forms?.officialPdfEdition).toBeUndefined();
  expect(() => officialPdfProfile(formId, '9999-01')).toThrow('pinned official PDF edition is unavailable');
});

it('verifies the official source before dispatching to another PDF writer', async () => {
  const blank = await PDFDocument.create();
  const page = blank.addPage();
  blank.getForm().createTextField('NAME').addToPage(page);
  const original = new Uint8Array(await blank.save()).buffer;
  const fill = vi.fn(async (_answers, source: ArrayBuffer) => {
    const pdf = await PDFDocument.load(source);
    pdf.getForm().getTextField('NAME').setText('Sample');
    return new Uint8Array(await pdf.save());
  });
  const profile = {
    formId: 'sample-acroform', edition: '1', label: 'Sample AcroForm',
    source: 'sample.pdf', sha256: await portableResourceDigest(original), fill,
  };
  const answers = { includeCoverPage: false };
  await expect(fillOfficialPdf(profile, answers, new ArrayBuffer(1))).rejects.toThrow('does not match');
  expect(fill).not.toHaveBeenCalled();
  const output = await PDFDocument.load(await fillOfficialPdf(profile, answers, original));
  expect(output.getForm().getTextField('NAME').getText()).toBe('Sample');
});
