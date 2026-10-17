import { expect, it } from 'vitest';
import { diffSessions } from '@/lib/sessionDiff';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';
import { useHistoryStore } from '@/stores/historyStore';

it('compares structured fields beyond body text, including assets and forms', () => {
  useDocumentsStore.getState().newDocument();
  const before = getSerializedSession();
  const after = structuredClone(before);
  after.timestamp++;
  after.paragraphs[0].header = 'New heading';
  after.references = [{ letter: 'a', title: 'Reference', url: 'https://example.com' }];
  after.formData.signatureImage = { name: 'Signature', size: 1, data: 'new' };
  const changes = diffSessions(before, after);
  expect(changes.some((d) => d.field.includes('Header'))).toBe(true);
  expect(changes.some((d) => d.after === 'https://example.com')).toBe(true);
  expect(changes.some((d) => d.field.includes('Signature image'))).toBe(true);
  expect(changes.some((d) => d.field.includes('Timestamp'))).toBe(false);
  useDocumentsStore.getState().newDocument('navmc_118_11');
  const formBefore = getSerializedSession();
  useFormStore.getState().setNavmc11811Field('remarksTextRight', 'Right column change');
  expect(diffSessions(formBefore, getSerializedSession()).some((d) => d.after === 'Right column change')).toBe(true);
});

it('undo restores removed attachment bytes and complete form content', () => {
  useDocumentsStore.getState().newDocument();
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  useDocumentStore.setState({ enclosures: [{ title: 'Attachment', file: { name: 'one.pdf', size: 3, data: bytes } }] });
  const history = useHistoryStore.getState();
  history.clearHistory();
  history.saveSnapshot(useDocumentStore.getState().getSnapshot());
  useDocumentStore.setState({ enclosures: [] });
  history.saveSnapshot(useDocumentStore.getState().getSnapshot());
  useDocumentStore.getState().applySnapshot(history.undo()!);
  expect(useDocumentStore.getState().enclosures[0].file?.data).toBe(bytes);
  useDocumentsStore.getState().newDocument('navmc_118_11');
  history.clearHistory();
  useFormStore.getState().setNavmc11811Field('remarksTextRight', 'Earlier');
  history.saveSnapshot(useDocumentStore.getState().getSnapshot());
  useFormStore.getState().setNavmc11811Field('remarksTextRight', 'Later');
  history.saveSnapshot(useDocumentStore.getState().getSnapshot());
  useDocumentStore.getState().applySnapshot(history.undo()!);
  expect(useFormStore.getState().navmc11811.remarksTextRight).toBe('Earlier');
});
