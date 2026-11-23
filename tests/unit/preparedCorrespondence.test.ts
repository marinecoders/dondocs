import { sl3Fixture } from '../_helpers/sl3Fixture';
import { manualPacket } from '../_helpers/manualPacket';
import { expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderPreparedCorrespondence, type CorrespondenceRendererPorts, type ExportAssets } from '@/services/exports/correspondence';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { prepareExport, acknowledgePreparedExport, copyPreparedDocument, type ExportTarget, type ReadyExportJob } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
import { useDocumentStore } from '@/stores/documentStore';
import type { DocumentSnapshot } from '@/stores/historyStore';
import { docxImageFixture } from '../_helpers/docxImageFixture';

function ready(target: ExportTarget, patch: Partial<DocumentSnapshot> = {}, capturedAt = 1): ReadyExportJob {
  const base = useDocumentStore.getState().getSnapshot();
  const captured = captureDocumentRevision({ documentId: 'render', epoch: 1, editSequence: 1, capturedAt }, { ...base, ...patch, formData: { ...base.formData, ...patch.formData } });
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'top_secret_sci', allowedLevels: [...CLASSIFICATION_LEVELS] }, runtime: { status: 'absent' } });
  const result = prepareExport({ captured, policy, target, id: 'render', filename: `source.${target}` });
  if (result.status === 'ready') return result.job;
  if (result.status === 'needs-review') return acknowledgePreparedExport(result.job);
  throw new Error(JSON.stringify(result));
}
async function pdf(pages = 1): Promise<Uint8Array> { const d = await PDFDocument.create();for (let i = 0; i < pages; i++) d.addPage().drawText(`Content ${i + 1}`);return d.save(); }
const noAssets: ExportAssets = { withAssets: async (_ids, operation) => operation(() => { throw new Error('Unexpected asset read'); }) };
function ports(bytes: Uint8Array): CorrespondenceRendererPorts {
  return { compile: vi.fn(async () => bytes), convertDocx: vi.fn(async () => new Blob(['DOCX'])), assets: noAssets };
}

it('uses captured business image identities and holds media resources until conversion finishes', async () => {
  const images = await docxImageFixture();
  const imageRef = (id: string) => ({ id, name: `${id}.png`, size: 1, type: 'image/png' });
  const captured = ready('docx', { docType: 'business_letter', documentMode: 'custom',
    formData: { signatureType: 'image', signatureImage: { name: 'signature.png', size: images.signature.length, data: '', fileRef: imageRef('signature') } },
    paragraphs: [{ text: 'Captured figure', level: 0, figure: { name: 'figure.png', type: 'image/png', fileRef: imageRef('figure') } }] });
  let active = false;
  const adapters = ports(await pdf());
  adapters.assets = { withAssets: async (ids, operation) => {
    expect(ids).toEqual(['figure', 'signature']);
    active = true;
    try { return await operation(id => {
      expect(active).toBe(true);
      const data = id === 'figure' ? images.figure : images.signature;
      return { id, name: `${id}.png`, size: data.length, type: 'image/png', data: new Uint8Array(data).buffer };
    }); } finally { active = false; }
  } };
  adapters.convertDocx = vi.fn(async (latex, options) => {
    expect(active).toBe(true);
    expect(latex).toContain('Captured figure');
    expect(latex).not.toContain('Later live document');
    expect(options.mediaFiles?.['signature.png']).toEqual(new Uint8Array(images.signature));
    expect(Object.values(options.mediaFiles ?? {})).toHaveLength(2);
    await Promise.resolve();
    expect(active).toBe(true);
    return new Blob(['DOCX']);
  });
  useDocumentStore.getState().updateParagraph(0, { text: 'Later live document', figure: undefined });
  await renderPreparedCorrespondence(captured, adapters, new AbortController().signal);
  expect(active).toBe(false);
});

it('releases Word image resources and never converts after cancellation during asset acquisition', async () => {
  const captured = ready('docx', { docType: 'business_letter', formData: { signatureType: 'none' }, paragraphs: [] });
  const abort = new AbortController();
  const adapters = ports(await pdf());
  let released = false;
  adapters.assets = { withAssets: async (_ids, operation) => {
    try { abort.abort(); return await operation(() => { throw new Error('Unexpected asset'); }); }
    finally { released = true; }
  } };
  await expect(renderPreparedCorrespondence(captured, adapters, abort.signal)).rejects.toThrow('cancelled');
  expect(adapters.convertDocx).not.toHaveBeenCalled();
  expect(released).toBe(true);
});
it('keeps captured enclosure bytes instead of replacing them with later storage contents', async () => {
  const own = await pdf(2);const later = await pdf(1);const main = await pdf();
  const captured = ready('pdf', { enclosures: [{ title: 'Owned enclosure', file: { name: 'owned.pdf', size: own.byteLength, data: new Uint8Array(own).buffer }, fileRef: { id: 'attachment', name: 'owned.pdf', size: own.byteLength, type: 'application/pdf' } }] });
  const adapters = ports(main);
  const read = vi.fn(() => ({ id: 'attachment', name: 'later.pdf', size: later.byteLength, type: 'application/pdf', data: new Uint8Array(later).buffer }));
  adapters.assets = { withAssets: async (_ids, operation) => operation(read) };
  const artifact = await renderPreparedCorrespondence(captured, adapters, new AbortController().signal);
  expect((await PDFDocument.load(await artifact.blob.arrayBuffer())).getPageCount()).toBe(3);
  expect(read).not.toHaveBeenCalled();
});
it('passes the prepared classification to DOCX headers and post-processing options', async () => {
  const adapters = ports(await pdf());
  await renderPreparedCorrespondence(ready('docx', { formData: { classLevel: 'cui' }, paragraphs: [{ text: 'Source body', level: 0, portionMarking: 'S' }] }), adapters, new AbortController().signal);
  expect(adapters.convertDocx).toHaveBeenCalledWith(expect.stringContaining('SECRET'), expect.objectContaining({ classLevel: 'secret' }), undefined);
  expect(adapters.compile).not.toHaveBeenCalled();
});
it('includes the entire generated TeX inventory, including distributions', async () => {
  const artifact = await renderPreparedCorrespondence(ready('tex', { distributions: [{ text: 'Resolved distribution' }] }), ports(await pdf()), new AbortController().signal);
  expect(await artifact.blob.text()).toContain('distribution-config.tex');
  expect(await artifact.blob.text()).toContain('Resolved distribution');
  expect(artifact.job.filename).toBe('source.tex');
});
it('keeps resources borrowed until a cancelled compiler settles', async () => {
  const main = await pdf();const adapters = ports(main);const abort = new AbortController();
  let active = false;let finish!: (value: Uint8Array) => void;
  adapters.assets = { withAssets: async (_ids, operation) => { active = true;try { return await operation(() => { throw new Error('Unexpected read'); }); } finally { active = false; } } };
  adapters.compile = vi.fn(() => new Promise<Uint8Array>(resolve => { finish = resolve; }));
  const rendering = renderPreparedCorrespondence(ready('pdf'), adapters, abort.signal);
  await vi.waitFor(() => expect(adapters.compile).toHaveBeenCalledTimes(1));
  abort.abort();expect(active).toBe(true);
  finish(main);
  await expect(rendering).rejects.toThrow('cancelled');
  expect(active).toBe(false);
});


it('renders the same prepared publication dates after the wall clock changes', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const capturedAt = Date.UTC(2026, 9, 1);
  try {
    vi.setSystemTime(capturedAt);
    const source = sl3Fixture(1);
    const job = ready('tex', { ...source, documentMode: 'compliant', documentCategory: 'correspondence' }, capturedAt);
    const adapters = ports(await pdf());
    const first = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
    vi.setSystemTime(Date.UTC(2090, 0, 1));
    const retried = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
    expect(await retried.blob.text()).toBe(await first.blob.text());
    expect(await retried.blob.text()).toContain('30 OCTOBER 2026');
  } finally { vi.useRealTimers(); }
});


it('excludes retained publication figures from an ordinary letter export', async () => {
  const job = ready('pdf', { docType: 'standard_letter', formData: { classLevel: 'unclassified' }, paragraphs: [{
    text: 'Ordinary paragraph after a format switch', level: 0,
    figure: { name: 'Previous publication image', type: 'image/png', portionMarking: 'S', fileRef: { id: 'missing-inactive-figure', name: 'old.png', type: 'image/png', size: 1 } },
  }] });
  const adapters = ports(await pdf());
  adapters.assets = { withAssets: async (ids, operation) => {
    if (ids.length) throw new Error('The retained publication image is unavailable.');
    return operation(() => { throw new Error('Unexpected asset read'); });
  } };
  const artifact = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
  expect((await PDFDocument.load(await artifact.blob.arrayBuffer())).getPageCount()).toBe(1);
  expect(copyPreparedDocument(job).document.formData.classLevel).toBe('unclassified');
  expect(adapters.compile).toHaveBeenCalledWith(expect.objectContaining({ 'body.tex': expect.stringContaining('Ordinary paragraph after a format switch') }));
});

it.each(['information_memorandum', 'joint_letter'])('does not resolve retained inactive %s signature handles for PDF', async docType => {
  const job = ready('pdf', { docType, formData: { signatureType: 'image', signatureImage: {
    name: 'retained.png', size: 1, data: '', fileRef: { id: 'missing-inactive-signature', name: 'retained.png', size: 1, type: 'image/png' },
  } } });
  const adapters = ports(await pdf());
  const artifact = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
  expect((await PDFDocument.load(await artifact.blob.arrayBuffer())).getPageCount()).toBe(1);
  expect(copyPreparedDocument(job).document.formData.signatureImage?.fileRef?.id).toBe('missing-inactive-signature');
});

it('keeps prepared manual cover dates fixed when rendering after a century boundary', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const capturedAt = Date.UTC(2026, 9, 1);
  try {
    vi.setSystemTime(capturedAt);
    const job = ready('tex', { ...manualPacket(), documentMode: 'compliant', documentCategory: 'correspondence' }, capturedAt);
    const adapters = ports(await pdf());
    const first = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
    vi.setSystemTime(Date.UTC(2090, 0, 1));
    const retried = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
    expect(await retried.blob.text()).toBe(await first.blob.text());
    expect(await retried.blob.text()).toContain('OCTOBER 2026');
  } finally { vi.useRealTimers(); }
});
it.each(['pdf', 'docx'] as const)('does not enter the %s engine after a progress observer cancels', async target => {
  const adapters = ports(await pdf()); const abort = new AbortController();
  adapters.onProgress = () => abort.abort();
  await expect(renderPreparedCorrespondence(ready(target), adapters, abort.signal)).rejects.toThrow('cancelled');
  expect(adapters.compile).not.toHaveBeenCalled(); expect(adapters.convertDocx).not.toHaveBeenCalled();
});
it.each(['pdf', 'docx'] as const)('keeps %s rendering independent of synchronous progress observer errors', async target => {
  const adapters = ports(await pdf()); adapters.onProgress = () => { throw new Error('Progress observer failed'); };
  const artifact = await renderPreparedCorrespondence(ready(target), adapters, new AbortController().signal);
  expect(artifact.completeness).toBe('complete');
});
it('handles async progress observer rejection without leaking unhandled promises', async () => {
  const unhandled: unknown[] = []; const record = (error: unknown) => { unhandled.push(error); };
  process.on('unhandledRejection', record);
  try {
    const adapters = ports(await pdf()); adapters.onProgress = async () => { throw new Error('Async progress failed'); };
    const artifact = await renderPreparedCorrespondence(ready('pdf'), adapters, new AbortController().signal);
    expect(artifact.completeness).toBe('complete');
    await new Promise(resolve => setTimeout(resolve, 0)); expect(unhandled).toEqual([]);
  } finally { process.off('unhandledRejection', record); }
});
it('isolates converter progress observers while retaining their phase notifications', async () => {
  const adapters = ports(await pdf());
  adapters.convertDocx = vi.fn(async (_latex, _options, progress) => { progress?.({ kind: 'preparing' }); return new Blob(['DOCX']); });
  adapters.onDocxProgress = () => { throw new Error('Converter observer failed'); };
  const artifact = await renderPreparedCorrespondence(ready('docx'), adapters, new AbortController().signal);
  expect(artifact.completeness).toBe('complete');
});

it('does not issue an artifact when final PDF progress cancels rendering', async () => {
  const adapters = ports(await pdf()); const abort = new AbortController();
  adapters.onProgress = phase => { if (phase === 'pdf-saving') abort.abort(); };
  await expect(renderPreparedCorrespondence(ready('pdf'), adapters, abort.signal)).rejects.toThrow('cancelled');
  expect(adapters.compile).toHaveBeenCalledTimes(1);
});

it.each(['joint_letter', 'joint_memorandum'])('preserves both Acting designations in prepared %s PDF and DOCX output', async docType => {
  const patch = { docType, formData: {
    seniorActing: true, juniorActing: true,
    jointSeniorSigName: 'Senior Signer', jointJuniorSigName: 'Junior Signer',
    jointMemoSeniorSigName: 'Senior Signer', jointMemoJuniorSigName: 'Junior Signer',
    seniorCommandName: 'Retained MOA command', juniorSigName: 'Retained MOA signer',
  } };
  const adapters = ports(await pdf());
  const pdfJob = ready('pdf', patch);
  await renderPreparedCorrespondence(pdfJob, adapters, new AbortController().signal);
  expect(adapters.compile).toHaveBeenCalledWith(expect.objectContaining({
    'signatory.tex': expect.stringContaining('\\setByDirection{Acting}'),
  }));
  expect(adapters.compile).toHaveBeenCalledWith(expect.objectContaining({
    'signatory.tex': expect.stringContaining('\\renewcommand{\\JuniorByDirection}{Acting}'),
  }));
  const output = copyPreparedDocument(pdfJob).document.formData;
  expect(output.seniorCommandName).toBeUndefined();
  expect(output.juniorSigName).toBeUndefined();

  await renderPreparedCorrespondence(ready('docx', patch), adapters, new AbortController().signal);
  expect(adapters.convertDocx).toHaveBeenCalledWith(expect.stringContaining('Acting & Acting'), expect.any(Object), undefined);
});

it('blocks incomplete directives before PDF, Word and TeX output', () => {
  const source = useDocumentStore.getState().getSnapshot();
  const captured = captureDocumentRevision({ documentId: 'missing-directive', epoch: 1, editSequence: 1, capturedAt: 1 }, {
    ...source, docType: 'change_transmittal', documentCategory: 'correspondence',
    formData: { docType: 'change_transmittal', directiveNumber: 'SECNAVINST 5215.1E', directiveChangeNumber: '2.5' },
    paragraphs: [{ text: 'Replace the referenced material.', level: 0 }], enclosures: [], references: [],
  });
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  for (const target of ['pdf', 'docx', 'tex'] as const) {
    expect(prepareExport({ captured, policy, target, id: 'directive', filename: 'directive.' + target })).toMatchObject({
      status: 'error', issues: [expect.stringContaining('Enter a positive whole change number.')],
    });
  }
});

it.each(['', '31 Feb 27'])('blocks directive exports with an invalid issue date (%s)', date => {
  const source = useDocumentStore.getState().getSnapshot();
  const captured = captureDocumentRevision({ documentId: 'directive-date', epoch: 1, editSequence: 1, capturedAt: 1 }, {
    ...source, docType: 'marine_corps_order', documentCategory: 'correspondence',
    formData: { docType: 'marine_corps_order', directiveNumber: '5215.1K', officeCode: 'AR', date,
      from: 'Commandant of the Marine Corps', subject: 'Directives' },
    paragraphs: [{ text: 'Document body.', level: 0 }], enclosures: [], references: [],
  });
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  for (const target of ['pdf', 'docx', 'tex'] as const) {
    expect(prepareExport({ captured, policy, target, id: 'directive', filename: 'directive.' + target })).toMatchObject({
      status: 'error', issues: ['Enter a valid directive issue date.'],
    });
  }
});

it('enforces the SECNAV text-page limit before replacement pages are assembled', async () => {
  const replacement = await PDFDocument.create();
  const originalPage = replacement.addPage([501, 731]);
  originalPage.drawText('Original replacement page 17');
  const bytes = new Uint8Array(await replacement.save());
  const patch: Partial<DocumentSnapshot> = {
    docType: 'change_transmittal', documentMode: 'compliant', documentCategory: 'correspondence',
    formData: { directiveNumber: 'SECNAVINST 5215.1E', directiveChangeNumber: '2', officeCode: 'ADMIN',
      date: '12 Sep 27', from: 'Secretary of the Navy', subject: 'Synthetic directive',
      classLevel: 'unclassified' },
    paragraphs: [{ level: 0, text: 'Replace original page 17.' }], references: [],
    enclosures: [{ title: 'Revised page 17', file: { name: 'page-17.pdf', size: bytes.byteLength, data: bytes.buffer } }],
    copyTos: [], distributions: [],
  };
  const job = ready('pdf', patch);
  const artifact = await renderPreparedCorrespondence(job, ports(await pdf(5)), new AbortController().signal);
  const combined = await PDFDocument.load(await artifact.blob.arrayBuffer());
  expect(combined.getPageCount()).toBe(6);
  expect(combined.getPage(5).getSize()).toEqual({ width: 501, height: 731 });
  await expect(renderPreparedCorrespondence(job, ports(await pdf(6)), new AbortController().signal))
    .rejects.toThrow('at most five pages');
  const invalid = new Uint8Array([0, 1, 2]);
  const broken = ready('pdf', { ...patch, enclosures: [{ title: 'Broken replacement', file: {
    name: 'broken.pdf', size: invalid.byteLength, data: invalid.buffer,
  } }] });
  await expect(renderPreparedCorrespondence(broken, ports(await pdf()), new AbortController().signal))
    .rejects.toThrow('could not be assembled');
});

it('requires compliant transmittal attachments and keeps editable SECNAV drafts in Custom mode', () => {
  const document = { ...useDocumentStore.getState().getSnapshot(), docType: 'change_transmittal',
    documentMode: 'compliant' as const, documentCategory: 'correspondence' as const,
    formData: { directiveNumber: 'SECNAVINST 5215.1E', directiveChangeNumber: '1', officeCode: 'ADMIN',
      date: '12 Sep 27', from: 'Secretary of the Navy', subject: 'Synthetic directive' },
    paragraphs: [{ level: 0, text: 'Replace the corresponding sheets.' }], enclosures: [], references: [],
  };
  const source = { documentId: 'directive-delivery', epoch: 0, editSequence: 0, capturedAt: 1 };
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  const captured = captureDocumentRevision(source, document);
  expect(prepareExport({ captured, policy, target: 'pdf', id: 'verify', filename: 'change.pdf' })).toMatchObject({
    status: 'error', issues: [expect.stringContaining('Attach the approved replacement pages')],
  });
  expect(prepareExport({ captured, policy, target: 'docx', id: 'verify', filename: 'change.docx' })).toMatchObject({
    status: 'error', issues: [expect.stringContaining('Use Custom mode for an editable draft')],
  });
  const custom = captureDocumentRevision(source, { ...document, documentMode: 'custom' });
  expect(prepareExport({ captured: custom, policy, target: 'docx', id: 'verify', filename: 'change.docx' }).status)
    .toMatch(/^(ready|needs-review)$/);
});

it('requires authority fields for the classification derived from directive portions', () => {
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test',
    environment: { maxLevel: 'top_secret_sci', allowedLevels: [...CLASSIFICATION_LEVELS] }, runtime: { status: 'absent' } });
  const source = { documentId: 'directive-markings', epoch: 1, editSequence: 1, capturedAt: 1 };
  const document: DocumentSnapshot = {
    ...useDocumentStore.getState().getSnapshot(), documentCategory: 'correspondence', documentMode: 'compliant', docType: 'secnav_instruction',
    formData: { directiveNumber: '5215.1E', officeCode: 'ADMIN', from: 'Secretary of the Navy',
      date: '12 Sep 27', subject: 'Synthetic directive', classLevel: 'unclassified' },
    paragraphs: [{ level: 0, text: 'Synthetic marked content.', portionMarking: 'S' }], enclosures: [],
  };
  const prepare = (formData: DocumentSnapshot['formData']) => prepareExport({
    captured: captureDocumentRevision(source, { ...document, formData }), policy, target: 'pdf', id: 'markings', filename: 'directive.pdf',
  });
  expect(prepare(document.formData)).toMatchObject({ status: 'error', issues: expect.arrayContaining([
    'Select the classification basis.', 'Enter the classification authority.',
  ]) });
  const formData: DocumentSnapshot['formData'] = {
    ...document.formData, classificationBasis: 'derivative', classifiedBy: 'Synthetic Authority',
    derivedFrom: 'Synthetic record', declassifyOn: '20500230',
  };
  expect(prepare(formData)).toMatchObject({ status: 'error', issues: ['Enter a valid declassification date.'] });
  expect(prepare({ ...formData, declassifyOn: '20500228' }).status).toMatch(/^(ready|needs-review)$/);
});

it('blocks incomplete staff forms and drops retained signature assets during export', async () => {
  const source = useDocumentStore.getState().getSnapshot();
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  const correspondence = { ...source, documentCategory: 'correspondence' as const, paragraphs: [], enclosures: [], references: [] };
  const capture = (docType: string, formData: DocumentSnapshot['formData']) =>
    captureDocumentRevision({ documentId: docType, epoch: 1, editSequence: 1, capturedAt: 1 }, { ...correspondence, docType, formData });
  const missingOffice = capture('coordination_page', {
    coordinationEntries: [{ office: '', contact: 'Casey Example', date: '', phone: '', position: '' }],
  });
  expect(prepareExport({ captured: missingOffice, policy, target: 'docx', id: 'coordination', filename: 'coordination.docx' })).toMatchObject({
    status: 'error', issues: [expect.stringContaining('Enter an office name')],
  });
  const missingChoice = capture('position_decision_paper', {
    officeCode: 'OPS', date: '12 Sep 27', subject: 'Staffing', preparedBy: 'Casey Example', staffDecisionStyle: 'choose_one',
    staffDecisionOptions: 'A single choice',
  });
  expect(prepareExport({ captured: missingChoice, policy, target: 'pdf', id: 'decision', filename: 'decision.pdf' })).toMatchObject({
    status: 'error', issues: [expect.stringContaining('Enter at least two choices')],
  });

  const staff = ready('docx', { ...correspondence, docType: 'information_paper', formData: {
    officeCode: 'OPS', date: '12 Sep 27', subject: 'Staff update', preparedBy: 'Casey Example', signatureType: 'image',
    signatureImage: { name: 'retained.png', size: 1, data: '', fileRef: { id: 'stale', name: 'retained.png', type: 'image/png', size: 1 } },
  } });
  const adapters = ports(await pdf());
  adapters.assets = { withAssets: async (ids, operation) => {
    expect(ids).toEqual([]);
    return operation(() => { throw new Error('No signature asset belongs to this staff paper.'); });
  } };
  await renderPreparedCorrespondence(staff, adapters, new AbortController().signal);
  expect(adapters.convertDocx).toHaveBeenCalledOnce();
});
