import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { createBlankSession } from '@/stores/documentStore';
import { updatePackageInformation } from '@/lib/packageInformation';
import { searchCapturedPackage } from '@/lib/packageSearch';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
async function member(label: string, text: string) {
  const session = createBlankSession(); session.formData.subject = label;
  session.paragraphs = [{ id: 'body', text, level: 0 }];
  return capturePackageMember(captureDocumentRevision({ documentId: `source_${crypto.randomUUID()}`, epoch: 0, editSequence: 1, capturedAt: 1 }, { ...session, endItems: [], publicationTables: {} }), label, 'basic-letter');
}
async function fixture() {
  const one = await member('Included letter', 'Visible captured training evidence'), two = await member('Excluded letter', 'EXCLUDED_PRIVATE_SENTINEL');
  return reviseActionPackage(await createActionPackage(`Search ${crypto.randomUUID()}`), [one, { ...two, role: 'supporting-document' }]);
}
it('searches the exact captured native revision and verified shared values without changing storage', async () => {
  const initial = await fixture(), record = await updatePackageInformation(initial, { version: 1, participants: [], facts: [{ id: 'control', label: 'Control', kind: 'identifier', value: '00042', source: { kind: 'entered' } }] });
  const report = await searchCapturedPackage(record, record.currentRevisionId, 'training evidence');
  expect(report.matches).toContainEqual(expect.objectContaining({ label: 'Included letter', snippet: expect.stringContaining('training evidence'), destination: expect.objectContaining({ memberId: getPackageRevision(record).members[0].id, revisionId: record.currentRevisionId }) }));
  const fact = await searchCapturedPackage(record, record.currentRevisionId, '00042');
  expect(fact.matches[0].destination).toMatchObject({ factId: 'control', revisionId: record.currentRevisionId });
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});
it('never searches another member or old revision through a recipient projection', async () => {
  const record = await fixture(), original = getPackageRevision(record), projection = { ...record, historyScope: 'selected-revision' as const, revisions: [{ ...original, members: [original.members[0]] }] };
  const report = await searchCapturedPackage(projection, original.id, 'EXCLUDED_PRIVATE_SENTINEL'); expect(report.matches).toEqual([]);
  const removed = await reviseActionPackage(record, [original.members[0]]);
  expect((await searchCapturedPackage(removed, removed.currentRevisionId, 'EXCLUDED_PRIVATE_SENTINEL')).matches).toEqual([]);
  expect((await searchCapturedPackage(removed, original.id, 'EXCLUDED_PRIVATE_SENTINEL')).matches).toHaveLength(1);
});
it('does not trust a custom reader supplying different bytes and reports missing sources truthfully', async () => {
  const record = await fixture();
  const wrong = await searchCapturedPackage(record, record.currentRevisionId, 'training evidence', { readAsset: async () => new TextEncoder().encode('{}').buffer });
  expect(wrong.matches).toEqual([]); expect(wrong.notices.join(' ')).toContain('saved digest');
  const unavailable = await searchCapturedPackage(record, record.currentRevisionId, 'training evidence', { readAsset: async () => { throw new Error('File unavailable'); } });
  expect(unavailable.notices.join(' ')).toContain('File unavailable');
});
it('owns the selected source before awaits and observes cancellation and query bounds', async () => {
  const record = await fixture(); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const pending = searchCapturedPackage(record, record.currentRevisionId, 'training evidence', { readAsset: async asset => { await held; return readPackageAsset(asset); } });
  record.revisions.at(-1)!.members[0].label = 'Changed later name'; release();
  expect((await pending).matches[0].label).toBe('Included letter');
  const controller = new AbortController(); controller.abort();
  await expect(searchCapturedPackage(record, record.currentRevisionId, 'training', { signal: controller.signal })).rejects.toThrow();
  await expect(searchCapturedPackage(record, record.currentRevisionId, 'x'.repeat(201))).rejects.toThrow('200');
});
