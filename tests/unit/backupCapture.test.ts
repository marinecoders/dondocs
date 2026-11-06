import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { getSerializedSession } from '@/stores/documentStore';
import { buildBackup } from '@/lib/backup';
import * as db from '@/lib/documentsDb';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';
import { useUIStore } from '@/stores/uiStore';
import { useSnippetsStore } from '@/stores/snippetsStore';
afterEach(() => vi.restoreAllMocks());
it('captures account data before asynchronous history reads', async () => {
  const session = { docType: 'naval_letter', formData: { subject: 'Captured' }, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [] } as unknown as import('@/stores/documentStore').SerializedSession;
  useDocumentsStore.setState({ currentId: null, hydrated: true, docs: { captured: { meta: { id: 'captured', title: 'Captured', docType: 'naval_letter', updatedAt: 1 }, session } } });
  useUIStore.setState({ storageHealth: 'ok' });
  useFormStore.getState().setNavmc11811Field('remarksText', 'BEFORE');
  useSnippetsStore.setState({ snippets: [{ id: 'one', name: 'Name', text: 'BEFORE' }] });
  let release!: (ring: db.DocSnapshot[]) => void;
  let entered!: () => void; const reading = new Promise<void>(done => { entered = done; });
  vi.spyOn(db, 'idbGetSnapshots').mockImplementationOnce(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const saving = buildBackup(); await reading;
  useFormStore.getState().setNavmc11811Field('remarksText', 'AFTER');
  useSnippetsStore.setState({ snippets: [{ id: 'two', name: 'Other', text: 'AFTER' }] });
  release([]); const bundle = JSON.parse(await saving);
  expect(bundle.forms.navmc11811.remarksText).toBe('BEFORE');
  expect(bundle.snippets[0].text).toBe('BEFORE');
  expect(bundle.documents[0].session.formData.subject).toBe('Captured');
});

it('refuses a complete backup when a legacy enclosure claims bytes without a reference', async () => {
  const session = { ...getSerializedSession(), enclosures: [{ title: 'Missing legacy file', hasFile: true }] };
  useDocumentsStore.setState({ currentId: null, hydrated: true, docs: { legacy: { meta: { id: 'legacy', title: 'Legacy', docType: session.docType, updatedAt: 1 }, session } } });
  useUIStore.setState({ storageHealth: 'ok' });
  await expect(buildBackup()).rejects.toThrow('enclosure file is missing');
});
