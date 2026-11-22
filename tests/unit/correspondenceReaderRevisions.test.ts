import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createBlankSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useProfileStore } from '@/stores/profileStore';
import { useUIStore } from '@/stores/uiStore';
import { correspondenceReaderRequirement } from '@/lib/documentReaderRequirements';
import { createSharedPayload, draftEnvelope, parseSharedSession } from '@/lib/sharedSession';
import { buildAssetSharePayload, parseSharedDocument } from '@/lib/assetShare';
import { buildDraftFileFromSnapshot, parseDraftFile } from '@/lib/draftFile';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { jointLetterFixture } from '../_helpers/jointLetterFixture';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useUIStore.setState({ storageHealth: 'ok', saveWarning: null });
});

for (const mode of ['title-only', 'preprinted'] as const) {
  it(`requires the letterhead release reader for ${mode} in every portable format`, async () => {
    const source = createBlankSession();
    Object.assign(source.formData, { letterheadMode: mode, signatureType: 'none' });
    const snapshot = { ...source, endItems: [], publicationTables: {} };
    expect(correspondenceReaderRequirement(source)).toEqual({ draft: 7, share: 11, assets: 12, backup: 19 });
    const draft = await buildDraftFileFromSnapshot(snapshot, 123);
    expect(draft).toMatchObject({ kind: 'dondocs-draft', version: 7 });
    expect(parseDraftFile(draft).session.formData.letterheadMode).toBe(mode);
    expect(() => parseDraftFile({ ...(draft as object), version: 6 })).toThrow('version 7 draft');
    const shared = createSharedPayload(source);
    expect(shared.version).toBe(11);
    expect(parseSharedSession(shared).formData.letterheadMode).toBe(mode);
    expect(() => parseSharedSession({ ...shared, version: 9 })).toThrow('version 11 share');
    const pdf = await PDFDocument.create(); pdf.addPage(); const data = new Uint8Array(await pdf.save()).buffer;
    const assets = await buildAssetSharePayload({ ...snapshot, enclosures: [{ title: 'Support', file: { name: 'support.pdf', size: data.byteLength, data } }] }, 123);
    expect(assets).toMatchObject({ version: 12 });
    expect((await parseSharedDocument(assets)).session.formData.letterheadMode).toBe(mode);
    await expect(parseSharedDocument({ ...assets, version: 10 })).rejects.toThrow('version 12 share');
    useDocumentsStore.setState({ docs: { capability: { meta: { id: 'capability', title: 'Letterhead', docType: 'naval_letter', updatedAt: 1 }, session: source } } });
    const backup = JSON.parse(await buildBackup());
    expect(backup.version).toBe(19);
    await expect(restoreBackup(JSON.stringify({ ...backup, version: 18 }))).rejects.toThrow('version 19');
    await expect(restoreBackup(JSON.stringify(backup))).resolves.toHaveProperty('documents');
  });
}

it('gives letterhead requirements priority over a retained third command', () => {
  const source = jointLetterFixture();
  Object.assign(source.formData, { letterheadMode: 'title-only' });
  expect(correspondenceReaderRequirement(source)).toEqual({ draft: 7, share: 11, assets: 12, backup: 19 });
  source.formData.letterheadMode = 'full';
  expect(correspondenceReaderRequirement(source)).toEqual({ draft: 6, share: 9, assets: 10, backup: 18 });
});

it('rejects future portable formats instead of accepting unknown renderer capabilities', async () => {
  const source = createBlankSession();
  const draft = { ...source, kind: 'dondocs-draft', documentKind: 'correspondence', version: 8 };
  expect(() => parseDraftFile(draft)).toThrow('unsupported');
  expect(() => parseSharedSession({ kind: 'dondocs-share', version: 13, documentKind: 'correspondence', session: source })).toThrow('unsupported');
  await expect(parseSharedDocument({ kind: 'dondocs-share', version: 14, documentKind: 'correspondence', draft: source })).rejects.toThrow('unsupported');
  await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-backup', version: 20, documents: [] }))).rejects.toThrow('Unsupported backup version');
  expect(draftEnvelope(source)).toEqual({ version: '1.1' });
});
