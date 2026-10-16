import { describe, it, expect, beforeEach } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { useHistoryStore, type DocumentSnapshot } from '@/stores/historyStore';

// Undo/redo works on snapshots that list the document's parts one by one. The
// I-Type added two parts (end items, publication tables); a snapshot that
// forgot them would undo a paragraph edit and silently empty the cover table.

function snapshotOf(): DocumentSnapshot {
  const s = useDocumentStore.getState();
  return {
    documentMode: s.documentMode,
    docType: s.docType,
    formData: s.formData,
    references: s.references,
    enclosures: s.enclosures,
    paragraphs: s.paragraphs,
    copyTos: s.copyTos,
    distributions: s.distributions,
    endItems: s.endItems,
    publicationTables: s.publicationTables,
  };
}

describe('history snapshots carry the publication parts', () => {
  beforeEach(() => {
    useDocumentStore.getState().resetForm();
    useHistoryStore.getState().clearHistory();
  });

  it('undo returns the end items and table rows as they were, as copies', () => {
    const doc = useDocumentStore.getState();
    doc.setDocType('i_type');
    doc.addEndItem();
    doc.updateEndItem(0, { nsn: '5895-01-520-4360', model: 'M40A6' });
    doc.addTableRow('majorItems');
    doc.updateTableRow('majorItems', 0, { nomenclature: 'RIFLE, 7.62MM' });
    const before = snapshotOf();
    useHistoryStore.getState().saveSnapshot(before);

    useDocumentStore.getState().updateEndItem(0, { model: 'M40A7' });
    useDocumentStore.getState().updateTableRow('majorItems', 0, { nomenclature: 'CHANGED' });
    useHistoryStore.getState().saveSnapshot(snapshotOf());

    const back = useHistoryStore.getState().undo();
    expect(back).not.toBeNull();
    expect(back!.endItems[0]).toMatchObject({ nsn: '5895-01-520-4360', model: 'M40A6' });
    expect(back!.publicationTables.majorItems[0].values).toEqual({ nomenclature: 'RIFLE, 7.62MM' });
    // Snapshots are copies: mutating what came back must not reach the stack.
    expect(back!.endItems).not.toBe(before.endItems);
    expect(back!.publicationTables.majorItems[0].values).not.toBe(before.publicationTables.majorItems[0].values);

    useDocumentStore.getState().applySnapshot(back!);
    expect(useDocumentStore.getState().endItems[0].model).toBe('M40A6');
    expect(useDocumentStore.getState().publicationTables.majorItems[0].values.nomenclature).toBe('RIFLE, 7.62MM');
  });

  it('applies a snapshot from before the I-Type existed without the new parts', () => {
    useDocumentStore.getState().setDocType('i_type');
    useDocumentStore.getState().addEndItem();
    const legacy = { ...snapshotOf() } as Partial<DocumentSnapshot>;
    delete legacy.endItems;
    delete legacy.publicationTables;
    useDocumentStore.getState().applySnapshot(legacy as DocumentSnapshot);
    expect(useDocumentStore.getState().endItems).toEqual([]);
    expect(useDocumentStore.getState().publicationTables).toEqual({});
  });
});
