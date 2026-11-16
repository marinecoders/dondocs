import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { fixtureInstance } from '../_helpers/formFixture';
import { createBlankSession } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { actionPackageSchema, createActionPackage, listActionPackages, reviseActionPackage, type NativePackageMember } from '@/lib/actionPackages';
import { validatePackageDraft } from '@/lib/actionPackageDraft';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import * as assets from '@/lib/actionPackageAssets';
import * as encoding from '@/lib/encoding';
import { capturePackageTemplate, listPackageTemplates, MAX_PACKAGE_TEMPLATE_BYTES, packageTemplateFileSlots } from '@/lib/packageTemplateLibrary';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));

beforeEach(async () => {
  await listActionPackages();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dondocs');request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([...db.objectStoreNames], 'readwrite');
    for (const name of db.objectStoreNames) transaction.objectStore(name).clear();
    transaction.oncomplete = () => resolve();transaction.onerror = () => reject(transaction.error);
  });
  db.close();useUIStore.setState({ storageHealth: 'ok' });
});

async function pdfBytes(payload = 512 * 1024): Promise<ArrayBuffer> {
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(new Uint8Array(payload).fill(32))));
  return new Uint8Array(await pdf.save({ useObjectStreams: false })).buffer;
}
async function native(draft: Record<string, unknown>, id: string): Promise<NativePackageMember> {
  const reviewed = await validatePackageDraft(draft);
  return { kind: 'native', id, revisionId: `${id}_revision`, label: id, role: 'supporting-document', required: true, session: reviewed.session,
    draft: await assets.retainPackageAsset(`${id}.json`, 'application/json', new TextEncoder().encode(JSON.stringify(draft)).buffer) };
}
async function sharedPages(pageCount: number, memberCount: number) {
  const page = await assets.retainPackageAsset('shared.pdf', 'application/pdf', await pdfBytes());
  const form = fixtureInstance();
  form.definition.pages = Array.from({ length: pageCount }, (_, index) => ({ file: `page${index + 1}.pdf`, width: 612, height: 792, sha256: page.sha256 }));
  const session = createBlankSession();session.formData.signatureType = 'none';
  const member = await native({ ...session, timestamp: 0, documentCategory: 'forms', formType: 'fixture', genericForm: form }, 'shared_form');
  member.templates = Object.fromEntries(form.definition.pages.map(p => [p.file, page]));
  const members = Array.from({ length: memberCount }, (_, index) => ({ ...member, id: `shared_form_${index}`, revisionId: `shared_revision_${index}` }));
  return reviseActionPackage(await createActionPackage('Shared form source'), members);
}

it.each([[20, 1], [1, 20]])('rejects %i shared pages across %i members before reading or encoding assets', async (pages, members) => {
  const record = await sharedPages(pages, members);
  expect(actionPackageSchema.safeParse(record).success).toBe(true);
  const portable = await buildPortableActionPackage(record);
  expect((await parsePortableActionPackage(portable)).resources.size).toBe(2);
  expect(new TextEncoder().encode(portable).byteLength).toBeLessThan(1024 * 1024);
  const draft = vi.spyOn(assets, 'readPackageMemberDraft'), read = vi.spyOn(assets, 'readPackageAsset'), encode = vi.spyOn(encoding, 'uint8ArrayToBase64');
  try {
    await expect(capturePackageTemplate(record, record.currentRevisionId, 'Too large')).rejects.toThrow('Package templates are limited to 12 MB.');
    expect(draft).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(encode).not.toHaveBeenCalled();
  } finally { draft.mockRestore();read.mockRestore();encode.mockRestore(); }
  expect(await listPackageTemplates()).toEqual([]);
});

it('captures a near-limit form starter with sequential page reads', async () => {
  const record = await sharedPages(17, 1);
  const originalRead = assets.readPackageAsset;
  let activeReads = 0, peakReads = 0;
  const read = vi.spyOn(assets, 'readPackageAsset').mockImplementation(async asset => {
    activeReads++;
    peakReads = Math.max(peakReads, activeReads);
    try { return await originalRead(asset); }
    finally { activeReads--; }
  });
  try {
    const template = await capturePackageTemplate(record, record.currentRevisionId, 'Near-limit form');
    const size = new TextEncoder().encode(JSON.stringify(template)).byteLength;
    expect(size).toBeGreaterThan(MAX_PACKAGE_TEMPLATE_BYTES * 0.9);
    expect(size).toBeLessThanOrEqual(MAX_PACKAGE_TEMPLATE_BYTES);
    expect(read).toHaveBeenCalledTimes(17);
    expect(peakReads).toBe(1);
    const member = template.members[0];
    if (member.kind !== 'native') throw new Error('Expected a native form starter.');
    expect(Object.keys(member.pages)).toHaveLength(17);
    expect(await listPackageTemplates()).toEqual([template]);
  } finally { read.mockRestore(); }
});

it('stops reading later members when cleaned drafts exceed the remaining capture budget', async () => {
  const session = createBlankSession();
  session.formData.signatureType = 'none';
  const large = await native({ ...session, timestamp: 0, formData: {
    ...session.formData, retainedNotes: 'x'.repeat(7 * 1024 * 1024),
  } }, 'large');
  const later = await native({ ...session, timestamp: 0 }, 'later');
  const record = await reviseActionPackage(await createActionPackage('Retained text source'), [large,
    { ...large, id: 'large_again', revisionId: 'large_again_revision' }, later]);
  const draft = vi.spyOn(assets, 'readPackageMemberDraft');
  const clone = vi.spyOn(globalThis, 'structuredClone');
  try {
    await expect(capturePackageTemplate(record, record.currentRevisionId, 'Oversized retained text'))
      .rejects.toThrow('Package templates are limited to 12 MB.');
    expect(draft.mock.calls.map(([member]) => member.id)).toEqual(['large', 'large_again']);
    expect(clone.mock.calls.some(([value]) => value && typeof value === 'object'
      && 'id' in value && value.id === record.currentRevisionId && 'members' in value)).toBe(false);
  } finally { draft.mockRestore(); clone.mockRestore(); }
  expect(await listPackageTemplates()).toEqual([]);
  expect((await listActionPackages()).find(value => value.id === record.id)).toEqual(record);
});

it('allows a large raw draft when removed attachments leave a small unsigned starter', async () => {
  const data = await pdfBytes(9 * 1024 * 1024);
  const session = createBlankSession();
  session.formData.signatureType = 'digital';
  const member = await native({ ...session, timestamp: 0, enclosures: [{ title: 'Required enclosure', hasFile: true,
    file: { name: 'previous.pdf', size: data.byteLength, data: encoding.uint8ArrayToBase64(new Uint8Array(data)) } }] }, 'large_attachment');
  expect(member.draft.size).toBeGreaterThan(MAX_PACKAGE_TEMPLATE_BYTES);
  const record = await reviseActionPackage(await createActionPackage('Large removable original'), [member]);
  const template = await capturePackageTemplate(record, record.currentRevisionId, 'Small reusable starter');
  expect(new TextEncoder().encode(JSON.stringify(template)).byteLength).toBeLessThan(32 * 1024);
  expect(packageTemplateFileSlots(template)).toEqual([{ key: '0:enclosure:0', label: 'large_attachment: Enclosure 1: Required enclosure', required: true, native: true }]);
  const starter = template.members[0];
  if (starter.kind !== 'native') throw new Error('Expected a native letter starter.');
  expect(starter.draft.formData).toMatchObject({ signatureType: 'none' });
  expect(starter.draft.enclosures).toEqual([{ title: 'Required enclosure', hasFile: false }]);
  expect(JSON.stringify(template)).not.toContain('previous.pdf');
  const source = await assets.readPackageMemberDraft(member);
  expect(source.reviewed.session.formData.signatureType).toBe('digital');
  expect(source.reviewed.files[0]?.name).toBe('previous.pdf');
  expect(source.reviewed.files[0]?.data.byteLength).toBe(data.byteLength);
  expect(await listPackageTemplates()).toEqual([template]);
});

it('does not encode or read further pages after cancellation during a page read', async () => {
  const record = await sharedPages(3, 1);
  const controller = new AbortController();
  const originalRead = assets.readPackageAsset;
  const read = vi.spyOn(assets, 'readPackageAsset').mockImplementation(async asset => {
    const data = await originalRead(asset);
    controller.abort();
    return data;
  });
  const encode = vi.spyOn(encoding, 'uint8ArrayToBase64');
  try {
    await expect(capturePackageTemplate(record, record.currentRevisionId, 'Cancelled starter', controller.signal))
      .rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
    expect(encode).not.toHaveBeenCalled();
  } finally { read.mockRestore(); encode.mockRestore(); }
  expect(await listPackageTemplates()).toEqual([]);
});

it('stops before copying or encoding pages when cancellation completes with a draft read', async () => {
  const record = await sharedPages(1, 1);
  const controller = new AbortController();
  const originalRead = assets.readPackageMemberDraft;
  const draft = vi.spyOn(assets, 'readPackageMemberDraft').mockImplementation(async member => {
    const reviewed = await originalRead(member);
    controller.abort();
    return reviewed;
  });
  const read = vi.spyOn(assets, 'readPackageAsset'), encode = vi.spyOn(encoding, 'uint8ArrayToBase64');
  try {
    await expect(capturePackageTemplate(record, record.currentRevisionId, 'Cancelled draft read', controller.signal))
      .rejects.toThrow();
    expect(draft).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
  } finally { draft.mockRestore(); read.mockRestore(); encode.mockRestore(); }
  expect(await listPackageTemplates()).toEqual([]);
});

it('preserves the unavailable-revision error without publishing a template', async () => {
  const record = await createActionPackage('Unavailable source revision');
  await expect(capturePackageTemplate(record, 'missing_revision', 'Unavailable starter'))
    .rejects.toThrow('This package revision is unavailable.');
  expect(await listPackageTemplates()).toEqual([]);
});
