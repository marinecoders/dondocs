import { describe, expect, it } from 'vitest';
import { ensureParagraphIds, freshParagraphs, paragraphIdSchema } from '@/lib/paragraphIdentity';
import { createBlankSession, useDocumentStore } from '@/stores/documentStore';
import { parseSavedSession } from '@/lib/savedSession';
import { createSharedPayload, parseSharedSession } from '@/lib/sharedSession';

describe('paragraph editing identities', () => {
  it('migrates identical legacy paragraphs deterministically without mutating input', () => {
    const original = [{ text: 'Same paragraph', level: 0 }, { text: 'Same paragraph', level: 0 }];
    const first = ensureParagraphIds(original);
    expect(first).toEqual(ensureParagraphIds(structuredClone(original)));
    expect(first.map(paragraph => paragraph.id)).toHaveLength(2);
    expect(new Set(first.map(paragraph => paragraph.id)).size).toBe(2);
    expect(first.every(paragraph => paragraphIdSchema.safeParse(paragraph.id).success)).toBe(true);
    expect(original).toEqual([{ text: 'Same paragraph', level: 0 }, { text: 'Same paragraph', level: 0 }]);
  });

  it('avoids IDs already held by explicit nodes or detached comments', () => {
    const legacy = { text: 'Legacy text', level: 0 };
    const candidate = ensureParagraphIds([legacy])[0].id!;
    const withExplicit = ensureParagraphIds([legacy, { id: candidate, text: 'Other node', level: 0 }]);
    expect(withExplicit[0].id).not.toBe(candidate);
    expect(withExplicit[1].id).toBe(candidate);
    const withDetached = ensureParagraphIds([legacy], [candidate]);
    expect(withDetached[0].id).not.toBe(candidate);
    expect(withDetached).toEqual(ensureParagraphIds([legacy], [candidate]));
  });

  it.each(['', '../paragraph', 'with spaces', 'x'.repeat(101)])('rejects malformed explicit ID %j', id => {
    expect(() => ensureParagraphIds([{ id, text: 'Text', level: 0 }])).toThrow('identities');
  });

  it('rejects duplicate explicit IDs instead of choosing an anchor target', () => {
    expect(() => ensureParagraphIds([{ id: 'same', text: 'One', level: 0 }, { id: 'same', text: 'Two', level: 0 }])).toThrow('duplicated');
  });

  it('creates fresh identities for a new document or duplicated content', () => {
    const source = [{ id: 'old-node', text: 'Text', level: 0, referenceId: 'publication.destination' }];
    const first = freshParagraphs(source);
    const second = freshParagraphs(source);
    expect(first[0].id).not.toBe(source[0].id);
    expect(first[0].id).not.toBe(second[0].id);
    expect(first[0].referenceId).toBe('publication.destination');
    expect(source[0].id).toBe('old-node');
    expect(createBlankSession().paragraphs.map(paragraph => paragraph.id)).not.toEqual(createBlankSession().paragraphs.map(paragraph => paragraph.id));
  });

  it('preserves IDs through editing, moving, insertion, removal and Undo snapshots', () => {
    const paragraphs = freshParagraphs([{ text: 'First', level: 0 }, { text: 'Second', level: 0 }]);
    useDocumentStore.setState({ paragraphs });
    const state = useDocumentStore.getState();
    state.updateParagraph(1, { text: 'Second edited', id: 'forged-replacement' });
    expect(useDocumentStore.getState().paragraphs[1].id).toBe(paragraphs[1].id);
    state.reorderParagraphs(1, 0);
    expect(useDocumentStore.getState().paragraphs[0].id).toBe(paragraphs[1].id);
    const before = useDocumentStore.getState().getSnapshot();
    state.insertParagraphs(0, ['Split continuation', 'Another paragraph'], 0);
    const after = useDocumentStore.getState().paragraphs;
    expect(new Set(after.map(paragraph => paragraph.id)).size).toBe(4);
    expect(after[0].id).toBe(paragraphs[1].id);
    state.removeParagraph(0);
    expect(useDocumentStore.getState().paragraphs.some(paragraph => paragraph.id === paragraphs[1].id)).toBe(false);
    state.applySnapshot(before);
    expect(useDocumentStore.getState().paragraphs.map(paragraph => paragraph.id)).toEqual([paragraphs[1].id, paragraphs[0].id]);
  });

  it('gives replacement templates new nodes even when they carry the former IDs', () => {
    const paragraphs = freshParagraphs([{ text: 'Original', level: 0 }]);
    useDocumentStore.setState({ paragraphs });
    useDocumentStore.getState().loadTemplate({ paragraphs });
    expect(useDocumentStore.getState().paragraphs[0].id).not.toBe(paragraphs[0].id);
  });

  it('retains IDs through saved and shared parsing, while legacy parsing is stable', () => {
    const session = createBlankSession();
    const original = session.paragraphs.map(paragraph => paragraph.id);
    expect(parseSavedSession(session).paragraphs.map(paragraph => paragraph.id)).toEqual(original);
    expect(parseSharedSession(createSharedPayload(session)).paragraphs.map(paragraph => paragraph.id)).toEqual(original);
    const legacy = { ...session, paragraphs: session.paragraphs.map(({ id: _id, ...paragraph }) => paragraph) };
    expect(parseSavedSession(legacy).paragraphs).toEqual(parseSavedSession(legacy).paragraphs);
    const duplicate = { ...session, paragraphs: [{ id: 'duplicate', text: 'One', level: 0 }, { id: 'duplicate', text: 'Two', level: 0 }] };
    expect(() => parseSavedSession(duplicate)).toThrow('duplicated');
    expect(() => parseSharedSession(duplicate)).toThrow('duplicated');
  });
});
