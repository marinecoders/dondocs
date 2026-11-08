import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { copyCapturedDocument, copyCapturedSession, captureDocumentRevision } from '@/lib/capturedDocument';
import { captureCurrentDocumentRevision } from '@/stores/captureDocument';
import { useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';
import { fixtureInstance } from '../_helpers/formFixture';
beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true });
  useDocumentsStore.getState().newDocument();
});
afterEach(async () => { await flushDocumentWrites(); });
it('detaches nested content and attachment buffers without transferring editor bytes', () => {
  const bytes = new Uint8Array([7]);
  useDocumentStore.setState({ enclosures: [{ title: 'Captured PDF', file: { name: 'file.pdf', size: 1, data: bytes.buffer } }], paragraphs: [{ text: 'Captured paragraph', level: 0 }] });
  const captured = captureCurrentDocumentRevision();
  useDocumentStore.getState().updateParagraph(0, { text: 'Edited' }); bytes[0] = 9;
  const first = copyCapturedDocument(captured); expect(first.document.paragraphs[0].text).toBe('Captured paragraph');
  expect(new Uint8Array(first.document.enclosures[0].file!.data)[0]).toBe(7);
  first.document.paragraphs[0].text = 'Consumer edit'; new Uint8Array(first.document.enclosures[0].file!.data)[0] = 4;
  expect(copyCapturedDocument(captured).document.paragraphs[0].text).toBe('Captured paragraph');
  expect(bytes.byteLength).toBe(1); expect(bytes[0]).toBe(9);
  expect(copyCapturedSession(captured).enclosures[0]).not.toHaveProperty('file');
});
it.each(['navmc_10274', 'navmc_118_11'] as const)('captures %s values, signature blocks, and output options', type => {
  useDocumentsStore.getState().newDocument(type);
  if (type === 'navmc_10274') useFormStore.getState().setNavmc10274Field('supplementalInfo', 'CAPTURED');
  else useFormStore.getState().setNavmc11811Field('remarksText', 'CAPTURED');
  const blocks = [{ name: 'Captured signer', statement: 'Acknowledged', style: 'image' as const, image: 'CAPTURED_SIGNATURE' }];
  if (type === 'navmc_10274') useFormStore.getState().setNavmc10274Field('signatureBlocks', blocks);
  else useFormStore.getState().setNavmc11811Field('signatureBlocks', blocks);
  useFormStore.getState().setIncludeCoverPage(true);
  const captured = captureCurrentDocumentRevision(); useFormStore.getState().setIncludeCoverPage(false); blocks[0].image = 'CHANGED';
  const content = copyCapturedDocument(captured); expect(content.kind).toBe('builtin-form');
  const forms = copyCapturedSession(captured).forms!;
  expect(forms.includeCoverPage).toBe(true);
  expect(type === 'navmc_10274' ? forms.navmc10274!.supplementalInfo : forms.navmc11811!.remarksText).toBe('CAPTURED');
  expect((type === 'navmc_10274' ? forms.navmc10274!.signatureBlocks : forms.navmc11811!.signatureBlocks)[0].image).toBe('CAPTURED_SIGNATURE');
});
it('captures configured answers, repeated rows, and the selected definition', () => {
  const form = fixtureInstance(); form.rows.roster = [{ id: 'row', answers: { grade: 'e1', date: '2026-11-06' } }];
  useDocumentStore.setState({ documentCategory: 'forms', formType: 'fixture', genericForm: form });
  const captured = captureCurrentDocumentRevision();
  form.rows.roster[0].answers.grade = 'e2'; form.answers.name = 'CHANGED';
  const content = copyCapturedDocument(captured);
  expect(content.kind).toBe('configured-form');
  expect(content.document.genericForm!.rows.roster[0].answers.grade).toBe('e1');
  expect(content.document.genericForm!.answers.name).toBe('000123');
});
it('rejects copied capabilities and mismatched form definitions', () => {
  const captured = captureCurrentDocumentRevision();
  expect(() => copyCapturedSession({ ...captured })).toThrow('not issued');
  const snapshot = useDocumentStore.getState().getSnapshot();
  expect(() => captureDocumentRevision(captured.source, { ...snapshot, documentCategory: 'forms', formType: 'wrong', genericForm: fixtureInstance() })).toThrow('does not match');
});
it('keeps projected content and source identity stable after navigation', () => {
  useDocumentStore.getState().setField('subject', 'DOCUMENT A');
  useDocumentStore.setState({ paragraphs: [{ text: 'ORIGINAL', level: 0 }] });
  const captured = captureCurrentDocumentRevision(), originalId = captured.source.documentId;
  const projected = copyCapturedSession(captured); projected.paragraphs[0].text = 'Consumer change';
  const originalText = copyCapturedDocument(captured).document.paragraphs[0].text;
  useDocumentsStore.getState().newDocument(); useDocumentStore.getState().setField('subject', 'DOCUMENT B');
  expect(copyCapturedSession(captured).formData.subject).toBe('DOCUMENT A');
  expect(copyCapturedSession(captured).paragraphs[0].text).toBe(originalText);
  expect(captured.source.documentId).toBe(originalId);
  expect(captured.source.documentId).not.toBe(useDocumentsStore.getState().currentId);
  expect(copyCapturedSession(captured).timestamp).toBe(captured.source.capturedAt);
});
