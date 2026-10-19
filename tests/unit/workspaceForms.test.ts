import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentsStore } from '@/stores/documentsStore';
import { getSerializedSession, loadSharedSession, useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { idbGetAllDocuments, idbGetSnapshots } from '@/lib/documentsDb';

describe('independent NAVMC documents', () => {
  beforeEach(() => {
    useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null });
    useDocumentsStore.getState().newDocument();
  });

  it.each(['navmc_10274', 'navmc_118_11'] as const)('saves, duplicates and switches separate %s instances', async (kind) => {
    const registry = useDocumentsStore.getState();
    registry.newDocument(kind);
    const first = useDocumentsStore.getState().currentId!;
    if (kind === 'navmc_10274') useFormStore.getState().setNavmc10274Field('natureOfAction', 'First form');
    else useFormStore.getState().setNavmc11811Field('lastName', 'FIRST');
    registry.syncCurrent();
    const session = getSerializedSession();
    registry.renameDocument(first, 'Original');
    registry.duplicateDocument(first);
    const copy = Object.values(useDocumentsStore.getState().docs).find((d) => d.meta.id !== first)!;
    registry.switchTo(copy.meta.id);
    if (kind === 'navmc_10274') useFormStore.getState().setNavmc10274Field('natureOfAction', 'Second form');
    else useFormStore.getState().setNavmc11811Field('lastName', 'SECOND');
    registry.switchTo(first);
    expect(getSerializedSession().forms).toEqual(session.forms);
    expect(useDocumentsStore.getState().docs[first].meta.title).toBe('Original');
    const stored = (await idbGetAllDocuments())!.find((d) => d.id === first)!;
    loadSharedSession(stored.session);
    expect(getSerializedSession().forms).toEqual(session.forms);
    expect((await idbGetSnapshots(first)).length).toBeGreaterThan(0);
  });

  it('preserves correspondence when moving to forms and back', () => {
    const registry = useDocumentsStore.getState();
    useDocumentStore.getState().setFormData({ subject: 'Keep this letter' });
    registry.selectKind('forms', 'navmc_10274');
    useFormStore.getState().setNavmc10274Field('supplementalInfo', 'Keep this form');
    registry.selectKind('correspondence');
    expect(useDocumentStore.getState().formData.subject).toBe('Keep this letter');
    registry.selectKind('forms', 'navmc_10274');
    expect(useFormStore.getState().navmc10274.supplementalInfo).toBe('Keep this form');
  });

});
