import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { sl4Fixture, sl4Artwork } from '../_helpers/sl4Fixture';
import { useDocumentStore, getSerializedSession, loadSharedSession } from '@/stores/documentStore';
import { useHistoryStore } from '@/stores/historyStore';
import { buildDraftFile, parseDraftFile } from '@/lib/draftFile';
import { parseSharedSession } from '@/lib/sharedSession';
import { validateBackupSession } from '@/lib/backupValidation';
import { persistAttachment } from '@/lib/attachments';
import { DOC_TYPE_CONFIG, DOC_TYPE_CATEGORIES } from '@/types/document';
import { getEditorSections } from '@/lib/editorSections';
import { publicationExportErrors } from '@/lib/publicationPreflight';
import { sl4ExportErrors } from '@/lib/sl4Preflight';
import { sl4Schema, newSl4Part } from '@/data/techpub/sl4';
import { moveSl4Group, assignSl4Parent, deleteSl4Group, mapSl4Text } from '@/lib/sl4Editing';
import { sessionSearchFields, findSearchMatch } from '@/lib/workspaceSearch';

beforeEach(() => {
  useDocumentStore.getState().resetForm();
  useHistoryStore.getState().clearHistory();
  useDocumentStore.setState({ ...sl4Fixture(), documentCategory: 'correspondence' });
});
describe('SL-4 complete publication integration', () => {
  it('registers every dedicated section and PDF-only export', () => {
    expect(DOC_TYPE_CATEGORIES.find((entry) => entry.category === 'Technical Publications')!.types).toContain('sl4');
    expect(DOC_TYPE_CONFIG.sl4.pdfOnly).toBe(true);
    expect(getEditorSections(DOC_TYPE_CONFIG.sl4, 'sl4').map((section) => section.id)).toEqual(['sl4-cover', 'classification', 'sl4-preface', 'sl4-cages', 'sl4-parts', 'sl4-figures', 'sl4-indexes', 'sl4-revisions', 'signature']);
    expect(publicationExportErrors(sl4Fixture())).toEqual([]);
  });
  it('rejects incompatible metadata, dates, captions and incomplete artwork review', () => {
    const store = sl4Fixture();
    store.formData.shortTitle = 'SL-3-12345A';
    store.formData.signatureType = 'none';
    store.formData.sl4!.cutoffDate = '2026-10-31';
    store.formData.sl4!.artwork = [];
    store.paragraphs[0].text = 'Wrong end item';
    const errors = sl4ExportErrors(store).join('\n');
    for (const expected of ['SL-4 short title', 'digital signature', 'cut-off date', 'lettering', 'nomenclature']) expect(errors).toContain(expected);
  });
  it('keeps correspondence attachments and address lists out of SL-4 after switching formats', () => {
    const store = { ...sl4Fixture(), enclosures: [{ title: 'LEGACY ENCLOSURE' }], references: [{ letter: 'a', title: 'LEGACY REFERENCE', url: 'https://example.com/legacy' }], copyTos: [{ text: 'LEGACY COPY' }], distributions: [{ text: 'LEGACY DISTRIBUTION' }] };
    store.paragraphs.push({ text: 'LEGACY BODY', level: 0 });
    const generated = generateAllLatexFiles(store);
    expect(generated.enclosures).toEqual([]);
    expect(generated.referenceUrls).toEqual([]);
    expect(Object.values(generated.texFiles).join(' ')).not.toMatch(/LEGACY/);
    expect(store.enclosures).toHaveLength(1);
    expect(sl4ExportErrors(store)).toEqual([]);
  });
  it('preserves partial relationships in drafts while refusing incomplete export', () => {
    const store = useDocumentStore.getState();
    const data = structuredClone(store.formData.sl4!);
    const part = data.rows.find((row) => row.kind === 'part')!;
    if (part.kind === 'part') part.relationship = { kind: 'assembled_from', itemIds: [] };
    store.setField('sl4', data);
    const draft = parseSharedSession(JSON.parse(JSON.stringify(getSerializedSession())));
    expect(sl4Schema.safeParse(draft.formData.sl4).success).toBe(true);
    expect(sl4ExportErrors(useDocumentStore.getState()).join(' ')).toContain('Choose the related');
  });
  it('roundtrips nested data through save, sharing, backup and independent history', () => {
    const original = getSerializedSession();
    validateBackupSession(original);
    const shared = parseSharedSession(JSON.parse(JSON.stringify(original)));
    useDocumentStore.getState().clearFieldsExceptLetterhead();
    loadSharedSession(shared);
    expect(useDocumentStore.getState().formData.sl4).toEqual(original.formData.sl4);
    useHistoryStore.getState().saveSnapshot(useDocumentStore.getState());
    const changed = structuredClone(original.formData.sl4!);
    changed.notes[0].text = 'Changed note';
    useDocumentStore.getState().setField('sl4', changed);
    useHistoryStore.getState().saveSnapshot(useDocumentStore.getState());
    expect(useHistoryStore.getState().undo()!.formData.sl4!.notes[0].text).toBe(original.formData.sl4!.notes[0].text);
  });
  it('rejects malformed backups without changing the current draft', () => {
    const original = getSerializedSession();
    const bad = { ...original, formData: { ...original.formData, sl4: { rows: [{ kind: 'invalid' }] } } };
    expect(() => validateBackupSession(bad)).toThrow();
    expect(() => parseSharedSession(bad)).toThrow();
    expect(getSerializedSession()).toEqual({ ...original, timestamp: expect.any(Number) });
  });
  it('includes actual illustration bytes in portable drafts with stable row associations', async () => {
    const bytes = Object.values(await sl4Artwork())[0];
    const fileRef = await persistAttachment({ name: 'training-box.pdf', type: 'application/pdf', size: bytes.byteLength }, bytes.slice().buffer);
    const paragraphs = structuredClone(useDocumentStore.getState().paragraphs);
    paragraphs[0].figure!.fileRef = fileRef;
    useDocumentStore.setState({ paragraphs });
    const parsed = parseDraftFile(JSON.parse(JSON.stringify(await buildDraftFile())));
    expect(parsed.session.formData.sl4!.endItemFigureId).toBe(paragraphs[0].referenceId);
    expect(new Uint8Array(parsed.figures[0]!.data)).toEqual(bytes);
  });
  it('routes parts and CAGE content to their visible editor sections', () => {
    const fields = sessionSearchFields(getSerializedSession());
    expect(findSearchMatch(fields, 'TRAIN-RES')?.field.sectionId).toBe('sl4-parts');
    expect(findSearchMatch(fields, 'Fictional Training Equipment')?.field.sectionId).toBe('sl4-cages');
  });
});

describe('SL-4 group editing', () => {
  it('moves complete subtrees and rejects cycles in parent changes', () => {
    const data = sl4Fixture().formData.sl4!;
    const original = structuredClone(data);
    const moved = moveSl4Group(data, 'kit', 1);
    expect(moved.map((row) => row.id)).toEqual(['control-heading', 'resistor', 'kit', 'board', 'screw', 'resistor-repeat']);
    expect(data).toEqual(original);
    expect(assignSl4Parent(data, 'kit', 'board')).toBe(data.rows);
    const detached = assignSl4Parent(data, 'board', '');
    expect(detached.find((row) => row.id === 'board')).toHaveProperty('parentId', '');
  });
  it('deletes a subtree and clears related references to its items', () => {
    const data = sl4Fixture().formData.sl4!;
    data.rows.push({ ...newSl4Part('derived'), relationship: { kind: 'assembled_from', itemIds: ['board', 'resistor'] } });
    const rows = deleteSl4Group(data, 'kit');
    expect(rows.map((row) => row.id)).not.toContain('board');
    expect(rows.find((row) => row.id === 'derived')).toHaveProperty('relationship.itemIds', ['resistor']);
  });
  it('substitutes authored batch content while preserving IDs and relationship targets', () => {
    const data = sl4Fixture().formData.sl4!;
    data.notes[0].text = '{{NAME}}';
    const changed = mapSl4Text(data, (value) => value.replace('{{NAME}}', 'Training'));
    expect(changed.notes[0].text).toBe('Training');
    expect(changed.rows.at(-1)).toHaveProperty('relationship.itemIds', ['resistor']);
    expect(data.notes[0].text).toBe('{{NAME}}');
  });
});
