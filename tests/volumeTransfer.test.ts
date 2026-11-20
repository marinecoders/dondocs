import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore, getSerializedSession, loadSharedSession } from '@/stores/documentStore';
import { useHistoryStore } from '@/stores/historyStore';
import { buildDraftFileFromSnapshot, parseDraftFile } from '@/lib/draftFile';
import { parseSavedSession } from '@/lib/savedSession';
import { createSharedPayload, parseSharedSession } from '@/lib/sharedSession';
import { validateBackupSession } from '@/lib/backupValidation';
import { captureDocumentRevision, copyCapturedDocument, copyCapturedSession } from '@/lib/capturedDocument';
import { documentTextFields } from '@/lib/documentFields';
import { templateSession } from '@/lib/templateSession';
import { publicationVolumeErrors, resolveVolumeReferences } from '@/lib/publicationVolume';
import { volumeFixture } from './_helpers/volumeFixture';
import type { DocumentSnapshot } from '@/stores/historyStore';

const snapshot = (): DocumentSnapshot => ({ ...volumeFixture(), documentMode: 'compliant', documentCategory: 'correspondence', formType: 'navmc_10274', endItems: [], publicationTables: {} });
beforeEach(() => {
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState(snapshot());
  useHistoryStore.getState().clearHistory();
});

describe('volume transfer and recovery', () => {
  it('preserves identities and references through saved sessions, portable drafts and shared links', async () => {
    const captured = snapshot();
    const portable = JSON.parse(JSON.stringify(await buildDraftFileFromSnapshot(captured, 123)));
    const reviewed = parseDraftFile(portable);
    expect(reviewed.session.formData.volume).toEqual(captured.formData.volume);
    expect(reviewed.session.paragraphs).toEqual(captured.paragraphs);
    const shared = parseSharedSession(createSharedPayload(reviewed.session));
    expect(shared.formData.volume).toEqual(captured.formData.volume);
    expect(shared.paragraphs).toEqual(captured.paragraphs);
    expect(parseSavedSession(shared).formData.volume).toEqual(captured.formData.volume);
    expect(() => validateBackupSession(shared)).not.toThrow();
    loadSharedSession(shared);
    expect(getSerializedSession().paragraphs).toEqual(captured.paragraphs);
    expect(publicationVolumeErrors(shared.formData.volume, shared.paragraphs)).toEqual([]);
  });
  it('keeps captured content independent from subsequent outline and body edits', () => {
    const original = snapshot();
    const captured = captureDocumentRevision({ documentId: 'volume', epoch: 1, editSequence: 2, capturedAt: 3 }, original);
    original.formData.volume!.chapters.reverse();
    original.paragraphs[0].text = 'Newer source work';
    const retained = copyCapturedDocument(captured).document;
    expect(retained.formData.volume!.chapters[0].id).toBe('chapter-intro');
    expect(retained.paragraphs[0].text).toContain('Original introduction');
    const session = copyCapturedSession(captured);
    expect(parseSavedSession(session).paragraphs[0].id).toBe('intro');
    retained.formData.volume!.chapters[0].title = 'Consumer-mutated copy';
    expect(copyCapturedSession(captured).formData.volume!.chapters[0].title).toBe('Introduction');
  });
  it('refuses corrupt outline membership without replacing the open draft', () => {
    const before = structuredClone(useDocumentStore.getState().getSnapshot());
    const invalid = structuredClone(getSerializedSession());
    invalid.paragraphs[0].volumeSectionId = 'deleted-section';
    expect(() => parseSavedSession(invalid)).toThrow('assigned');
    expect(() => parseSharedSession(invalid)).toThrow('assigned');
    expect(() => validateBackupSession(invalid)).toThrow('assigned');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
  });
  it('restores outline and body atomically through existing Undo and Redo snapshots', () => {
    const store = useDocumentStore.getState();
    useHistoryStore.getState().saveSnapshot(store.getSnapshot());
    const changed = { ...store.formData.volume!, chapters: [...store.formData.volume!.chapters].reverse() };
    store.setVolumeContent(changed, store.paragraphs.map(paragraph => paragraph.id === 'intro' ? { ...paragraph, text: 'Changed together' } : paragraph));
    useHistoryStore.getState().saveSnapshot(useDocumentStore.getState().getSnapshot());
    const undo = useHistoryStore.getState().undo()!;
    useDocumentStore.getState().applySnapshot(undo);
    expect(useDocumentStore.getState().formData.volume!.chapters[0].id).toBe('chapter-intro');
    expect(useDocumentStore.getState().paragraphs[0].text).toContain('Original introduction');
    const redo = useHistoryStore.getState().redo()!;
    useDocumentStore.getState().applySnapshot(redo);
    expect(useDocumentStore.getState().formData.volume!.chapters[0].id).toBe('chapter-maintenance');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Changed together');
  });
  it('includes volume-only metadata in output inspection and hides it on correspondence', () => {
    const volume = snapshot();
    const output = documentTextFields(volume, 'output').map(field => field.text);
    for (const value of ['Introduction', 'Daily checks', 'Controller', 'The portable example controller.', 'Initial synthetic qualification fixture.']) expect(output).toContain(value);
    expect(documentTextFields({ ...volume, docType: 'naval_letter' }, 'output').some(field => field.path[0] === 'formData' && field.path[1] === 'volume')).toBe(false);
  });
  it('creates new template identities and preserves all internal reference targets', () => {
    const source = snapshot();
    const store = useDocumentStore.getState();
    store.loadTemplate({ formData: source.formData, paragraphs: source.paragraphs });
    const copied = useDocumentStore.getState();
    expect(copied.paragraphs.every(paragraph => !source.paragraphs.some(original => original.id === paragraph.id))).toBe(true);
    expect(publicationVolumeErrors(copied.formData.volume, copied.paragraphs)).toEqual([]);
    expect(resolveVolumeReferences(copied.paragraphs[0].text, copied.formData.volume!, copied.paragraphs)).toContain('2.1.1');
    expect(source.paragraphs[0].text).toContain('{{VOLREF_checks}}');
    const fresh = templateSession({ id: 'volume-template', name: 'Volume', category: 'Technical', description: 'Synthetic', docType: 'technical_volume', subject: 'New volume', paragraphs: [{ text: 'New body', level: 0 }] });
    expect(publicationVolumeErrors(fresh.formData.volume, fresh.paragraphs)).toEqual([]);
    expect(parseSavedSession(fresh).formData.signatureType).toBe('none');
  });
});
