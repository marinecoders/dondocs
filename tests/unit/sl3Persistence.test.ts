import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { sl3Fixture } from '../_helpers/sl3Fixture';
import {
  getSerializedSession,
  loadSharedSession,
  useDocumentStore,
} from '@/stores/documentStore';
import { useHistoryStore } from '@/stores/historyStore';
import { parseSharedSession } from '@/lib/sharedSession';
import { validateBackupSession } from '@/lib/backupValidation';
import { buildDraftFile, parseDraftFile } from '@/lib/draftFile';
import { persistAttachment } from '@/lib/attachments';
import { sessionSearchFields, findSearchMatch } from '@/lib/workspaceSearch';
import {
  moveSl3Group,
  assignSl3Parent,
  canAssignSl3Parent,
} from '@/data/techpub/sl3';

beforeEach(() => {
  useDocumentStore.getState().resetForm();
  useHistoryStore.getState().clearHistory();
  useDocumentStore.setState({
    ...sl3Fixture(),
    documentCategory: 'correspondence',
  });
});

describe('SL-3 saved content', () => {
  it('round-trips inventory through saved sessions, shared text and backup validation', () => {
    const state = useDocumentStore.getState();
    state.setField('sl3', {
      ...state.formData.sl3!,
      definitions: [
        {
          id: 'definition',
          term: 'ZED',
          meaning: 'Synthetic custom term',
          portionMarking: 'U',
        },
      ],
      artwork: [
        {
          figureId: 'drawing',
          lettering: 'labels',
          labels: [{ id: 'label', text: 'VALVE INLET', x: 50, y: 50 }],
        },
      ],
    });
    const original = getSerializedSession();
    const saved = JSON.parse(JSON.stringify(original));
    expect(() => validateBackupSession(saved)).not.toThrow();
    const shared = parseSharedSession(saved);
    useDocumentStore.getState().clearFieldsExceptLetterhead();
    expect(useDocumentStore.getState().formData.sl3).toBeUndefined();
    loadSharedSession(shared);
    expect(useDocumentStore.getState().formData.sl3).toEqual(
      original.formData.sl3,
    );
    expect(useDocumentStore.getState().endItems).toEqual(original.endItems);
  });
  it('rejects malformed imported inventory before replacing the open document', () => {
    const original = getSerializedSession();
    const bad = {
      ...original,
      formData: {
        ...original.formData,
        sl3: { components: [{ id: 'bad', category: 'unrecognized' }] },
      },
    };
    expect(() => parseSharedSession(bad)).toThrow();
    expect(() => validateBackupSession(bad)).toThrow();
    expect(getSerializedSession().formData.sl3).toEqual(original.formData.sl3);
  });
  it('keeps nested inventory independent in undo history', () => {
    const original = useDocumentStore.getState();
    useHistoryStore.getState().saveSnapshot(original);
    const sl3 = structuredClone(original.formData.sl3!);
    sl3.components[0].nomenclature = 'CHANGED';
    original.setField('sl3', sl3);
    useHistoryStore.getState().saveSnapshot(useDocumentStore.getState());
    const previous = useHistoryStore.getState().undo()!;
    expect(previous.formData.sl3!.components[0].nomenclature).not.toBe(
      'CHANGED',
    );
    useDocumentStore.getState().applySnapshot(previous);
    expect(
      useDocumentStore.getState().formData.sl3!.components[0].nomenclature,
    ).not.toBe('CHANGED');
  });
  it('packs illustration bytes into a portable draft with stable item associations', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fileRef = await persistAttachment(
      { name: 'drawing.png', size: 4, type: 'image/png' },
      bytes,
    );
    const s = useDocumentStore.getState();
    s.setField('sl3', { ...s.formData.sl3!, endItemFigureId: 'drawing' });
    useDocumentStore.setState({
      paragraphs: [
        {
          referenceId: 'drawing',
          text: 'Training kit',
          level: 0,
          figure: { fileRef, name: 'drawing.png', type: 'image/png' },
        },
      ],
    });
    const parsed = parseDraftFile(
      JSON.parse(JSON.stringify(await buildDraftFile())),
    );
    expect(parsed.session.formData.sl3!.endItemFigureId).toBe('drawing');
    expect(parsed.session.paragraphs[0].referenceId).toBe('drawing');
    expect(parsed.figures[0]!.data).toEqual(bytes);
  });
  it('finds components and technical data at their visible editor sections', () => {
    const fields = sessionSearchFields(getSerializedSession());
    expect(findSearchMatch(fields, 'Training 001')?.field.sectionId).toBe(
      'sl3-inventory',
    );
    expect(findSearchMatch(fields, 'Weight')?.field.sectionId).toBe(
      'sl3-details',
    );
  });
  it('moves a parent and its complete subtree together', () => {
    const data = sl3Fixture().formData.sl3!;
    data.components[1].parentId = data.components[0].id;
    const moved = moveSl3Group(data, data.components[0].id, 1);
    expect(moved.map((p) => p.id)).toEqual([
      'component-2',
      'component-0',
      'component-1',
    ]);
  });
  it('prevents a parent assignment that would move its descendants beyond two nesting levels', () => {
    const data = sl3Fixture(5).formData.sl3!;
    data.components[1].parentId = data.components[0].id;
    data.components[2].parentId = data.components[1].id;
    data.components[4].parentId = data.components[3].id;
    expect(
      canAssignSl3Parent(data, data.components[3].id, data.components[1].id),
    ).toBe(false);
    expect(
      assignSl3Parent(data, data.components[3].id, data.components[1].id),
    ).toEqual(data.components);
    expect(
      canAssignSl3Parent(data, data.components[3].id, data.components[0].id),
    ).toBe(true);
  });
  it('restores defaults for an older saved inventory without new optional fields', () => {
    const saved = JSON.parse(JSON.stringify(getSerializedSession()));
    delete saved.formData.sl3.sequencingPortion;
    validateBackupSession(saved);
    loadSharedSession(saved);
    expect(useDocumentStore.getState().formData.sl3!.sequencingPortion).toBe(
      'U',
    );
  });
});
