import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentsStore, searchableText } from '@/stores/documentsStore';
import { getSerializedSession, getSerializedSessionForShare, loadSharedSession, useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { idbGetAllDocuments, idbGetSnapshots } from '@/lib/documentsDb';
import { parseSharedSession } from '@/lib/sharedSession';
import { encryptSharePayload, decryptSharePayload } from '@/lib/shareCrypto';

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
    expect(searchableText(useDocumentsStore.getState().docs[copy.meta.id])).toContain('second');
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

  it('shares only the active form, without other draft content or images', async () => {
    useDocumentStore.getState().setFormData({ subject: 'Unrelated private letter' });
    useDocumentsStore.getState().newDocument('navmc_10274');
    useFormStore.getState().setNavmc10274Field('natureOfAction', 'Recipient content');
    useFormStore.getState().setNavmc10274Field('signatureBlocks', [{ name: 'Signer', statement: '', style: 'image', image: 'data:image/png;base64,abc' }]);
    useFormStore.getState().setNavmc11811Field('remarksText', 'Unrelated private form');
    const local = getSerializedSession();
    const shared = getSerializedSessionForShare();
    expect(JSON.stringify(shared)).not.toContain('Unrelated');
    expect(shared.forms?.navmc10274?.signatureBlocks[0].image).toBeUndefined();
    expect(local.forms?.navmc10274?.signatureBlocks[0].image).toBeDefined();
    const encrypted = await encryptSharePayload(shared, 'test password');
    await expect(decryptSharePayload(encrypted, 'wrong password')).rejects.toThrow();
    const incoming = parseSharedSession(await decryptSharePayload(encrypted, 'test password'));
    useDocumentsStore.getState().newDocument('navmc_10274');
    loadSharedSession(incoming);
    expect(useFormStore.getState().navmc10274.natureOfAction).toBe('Recipient content');
  });

  it('rejects incomplete form links before replacing any live fields', () => {
    const invalid = { ...getSerializedSession(), documentCategory: 'forms', forms: undefined };
    expect(() => parseSharedSession(invalid)).toThrow('missing the filled form');
    expect(() => parseSharedSession({ paragraphs: 'bad' })).toThrow('supported DonDocs');
  });
});
