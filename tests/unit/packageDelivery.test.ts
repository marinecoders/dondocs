import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, renameActionPackage } from '@/lib/actionPackages';
import { preparePackageDelivery, buildPackageDeliveryFile, copyPreparedPackageDeliveryProjection, readPreparedPackageDeliveryAsset } from '@/lib/packageDelivery';
import { parsePortableActionPackage, importPortableActionPackage } from '@/lib/actionPackageTransfer';
import { updatePackageWork } from '@/lib/packageWork';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy); });
async function pdf(text: string) { const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica); document.addPage([612, 792]).drawText(text, { x: 54, y: 650, font, size: 12 }); return new Uint8Array(await document.save()).buffer; }
async function fixture() {
  const session = createBlankSession(); session.formData.subject = 'PUBLIC SELECTED SUBJECT'; session.paragraphs = [{ id: 'public-body', text: 'Public selected body.', level: 0 }];
  session.reviewComments = { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false, messages: [{ id: crypto.randomUUID(), author: 'Private reviewer', text: 'PRIVATE COMMENT NEVER DELIVER', createdAt: '2026-11-17T00:00:00Z' }] }] };
  const main = await capturePackageMember(captureDocumentRevision({ documentId: 'private-source', epoch: 0, editSequence: 12, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), 'Selected letter', 'basic-letter');
  const excluded = await captureOriginalPackageMember({ name: 'EXCLUDED-PERSON.pdf', data: await pdf('EXCLUDED PERSON CONTENT') }, 'enclosure', false);
  if (excluded.kind !== 'original') throw new Error('Expected captured original.');
  let record = await reviseActionPackage(await createActionPackage(`Private case ${crypto.randomUUID()}`), [main, excluded]);
  record = await updatePackageWork(record, { version: 1, tasks: [{ id: 'private-task', title: 'INTERNAL TASK NOTE', status: 'pending' }] }, policy);
  record = await startPackageReview(record);
  return { record, main, excluded };
}
it('projects only selected editable content and removes review, history, tasks, source pointers and excluded assets', async () => {
  const { record, main, excluded } = await fixture(), before = await listActionPackages();
  const prepared = await preparePackageDelivery(record, record.currentRevisionId, { label: 'Training recipient', purpose: 'editable', memberIds: [main.id] }, policy);
  const projection = copyPreparedPackageDeliveryProjection(prepared), revision = getPackageRevision(projection);
  expect(projection.id).not.toBe(record.id); expect(revision.members).toHaveLength(1); expect(prepared.excludedMembers).toBe(1);
  expect(Object.isFrozen(prepared.reviews)).toBe(true);
  const json = await buildPackageDeliveryFile(prepared, policy, true);
  const parsed = await parsePortableActionPackage(json), transferred = JSON.stringify(parsed.record);
  for (const text of ['PRIVATE COMMENT NEVER DELIVER', 'INTERNAL TASK NOTE', 'EXCLUDED-PERSON', excluded.id, record.id, record.name, 'private-source']) expect(transferred).not.toContain(text);
  expect(transferred).toContain('PUBLIC SELECTED SUBJECT'); expect(parsed.resources.size).toBe(1);
  if (revision.members[0].kind !== 'native') throw new Error('Expected selected native member.');
  const draft = JSON.parse(new TextDecoder().decode(await readPreparedPackageDeliveryAsset(prepared, revision.members[0].draft)));
  expect(draft.reviewComments).toBeUndefined(); expect(draft.formData.wordSource).toBeUndefined();
  await expect(readPreparedPackageDeliveryAsset(prepared, excluded.original)).rejects.toThrow(/outside/);
  revision.members[0].label = 'Mutated public copy'; expect(getPackageRevision(copyPreparedPackageDeliveryProjection(prepared)).members[0].label).toBe('Selected letter');
  expect(await listActionPackages()).toEqual(before);
  const imported = await importPortableActionPackage(json); expect(imported.id).not.toBe(record.id); expect(getPackageRevision(imported).members).toHaveLength(1);
});
it('copies selected original PDFs byte-for-byte while excluding every other member and original package metadata', async () => {
  const { record, main, excluded } = await fixture();
  const prepared = await preparePackageDelivery(record, record.currentRevisionId, { label: 'One original', purpose: 'recipient', memberIds: [excluded.id] }, policy);
  const projected = getPackageRevision(copyPreparedPackageDeliveryProjection(prepared)).members[0];
  if (projected.kind !== 'original') throw new Error('Expected original PDF.');
  expect(new Uint8Array(await readPreparedPackageDeliveryAsset(prepared, projected.original))).toEqual(new Uint8Array(await readPackageAsset(excluded.original)));
  expect(prepared.members[0].id).toBe(excluded.id); expect(JSON.stringify(copyPreparedPackageDeliveryProjection(prepared))).not.toContain(main.id);
});
it('renders a selected native recipient member through the PDF renderer and exposes only its derivative', async () => {
  const { record, main } = await fixture(), bytes = await pdf('Rendered selected recipient body');
  const ports = { compile: vi.fn(async () => new Uint8Array(bytes)), convertDocx: vi.fn(), waitForReady: async () => true };
  const prepared = await preparePackageDelivery(record, record.currentRevisionId, { label: 'Recipient rendering', purpose: 'recipient', memberIds: [main.id] }, policy, ports);
  expect(ports.compile).toHaveBeenCalledTimes(1);
  const member = getPackageRevision(copyPreparedPackageDeliveryProjection(prepared)).members[0];
  expect(member.kind).toBe('original'); expect('session' in member).toBe(false); expect('source' in member).toBe(false);
  expect(prepared.files).toHaveLength(1); expect(prepared.files[0].type).toBe('application/pdf');
});
it('requires acknowledgement and rejects stale source, foreign identities, cancellation and changed scope', async () => {
  const { record, main } = await fixture();
  await expect(preparePackageDelivery(record, record.currentRevisionId, { label: 'Duplicate', purpose: 'editable', memberIds: [main.id, main.id] }, policy)).rejects.toThrow(/once/);
  const prepared = await preparePackageDelivery(record, record.currentRevisionId, { label: 'Reviewed delivery', purpose: 'editable', memberIds: [main.id] }, policy);
  await expect(buildPackageDeliveryFile(prepared, policy, false)).rejects.toThrow(/Review every/);
  await expect(buildPackageDeliveryFile({ ...prepared }, policy, true)).rejects.toThrow(/Prepare this delivery/);
  const abort = new AbortController(); abort.abort(); await expect(buildPackageDeliveryFile(prepared, policy, true, abort.signal)).rejects.toThrow();
  await expect(buildPackageDeliveryFile(prepared, policy, true, undefined, () => false)).rejects.toThrow(/changed/);
  await renameActionPackage(record, 'Newer owning work'); await expect(buildPackageDeliveryFile(prepared, policy, true)).rejects.toThrow(/saved package changed/i);
});
it('rejects a changed deployment at the actual export boundary', async () => {
  const { record, main } = await fixture(), prepared = await preparePackageDelivery(record, record.currentRevisionId, { label: 'Policy delivery', purpose: 'editable', memberIds: [main.id] }, policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue({ status: 'error', message: 'Policy unavailable' });
  await expect(buildPackageDeliveryFile(prepared, policy, true)).rejects.toThrow(/Policy unavailable/);
});

for (const purpose of ['editable', 'recipient'] as const) it(`keeps pinned configured-form inputs inside the ${purpose} delivery scope`, async () => {
  const template = await fixturePage(), instance = fixtureInstance(); instance.definition.pages[0].sha256 = template.sha256;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(template.bytes))));
  const session = { ...createBlankSession(), documentCategory: 'forms' as const, formType: instance.definition.formId, genericForm: instance };
  const member = await capturePackageMember(captureDocumentRevision({ documentId: `configured_${crypto.randomUUID()}`, epoch: 0, editSequence: 1, capturedAt: 1 }, { ...session, endItems: [], publicationTables: {} }), 'Selected configured form', 'basic-letter');
  const record = await reviseActionPackage(await createActionPackage(`Configured delivery ${crypto.randomUUID()}`), [member]);
  const ports = { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true };
  const prepared = await preparePackageDelivery(record, record.currentRevisionId, { label: 'Configured recipient', purpose, memberIds: [member.id] }, policy, ports);
  const projection = copyPreparedPackageDeliveryProjection(prepared), selected = getPackageRevision(projection).members[0];
  expect(ports.compile).not.toHaveBeenCalled();
  if (purpose === 'editable') {
    if (selected.kind !== 'native') throw new Error('Expected editable form.');
    expect(selected.session.genericForm!.answers).toEqual(instance.answers); expect(selected.templates!['page1.pdf'].sha256).toBe(template.sha256);
  } else {
    if (selected.kind !== 'original') throw new Error('Expected rendered form.');
    expect(selected.original.sha256).not.toBe(template.sha256); expect((await PDFDocument.load(await readPreparedPackageDeliveryAsset(prepared, selected.original))).getPageCount()).toBe(1);
  }
  const parsed = await parsePortableActionPackage(await buildPackageDeliveryFile(prepared, policy, true)); expect(getPackageRevision(parsed.record).members).toHaveLength(1);
});
