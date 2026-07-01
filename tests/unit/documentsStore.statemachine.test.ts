/**
 * documentsStore state machine — the registry behind the Recents list.
 *
 * These exercise the live store-driving actions (markBaseline, syncCurrent,
 * switchTo, remove) rather than the pure helpers covered in
 * documentsStore.test.ts. Under happy-dom `indexedDB` is undefined, so the
 * idb* mirror calls no-op synchronously and docs/currentId/baseline mutate
 * in-band — no fake-indexeddb needed. We call the actions directly; the 1500ms
 * debounce lives in a module subscription and is not relied on here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore, getSerializedSessionForShare } from '@/stores/documentStore';

// A clean correspondence live document: real default form data but a
// placeholder subject, so it is NOT meaningful until we write a subject/body.
function freshLiveDoc(): void {
  useDocumentStore.getState().resetForm();
  // resetForm leaves documentCategory untouched; force correspondence so the
  // forms early-return in syncCurrent never fires.
  useDocumentStore.setState({ documentCategory: 'correspondence' });
}

describe('documentsStore — registry state machine', () => {
  beforeEach(() => {
    // Reset both stores so each test is isolated.
    useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null });
    freshLiveDoc();
  });

  it('1. syncCurrent is a no-op when live content equals the baseline', () => {
    useDocumentsStore.setState({ currentId: 'doc-1' });
    // Baseline snapshots the live (placeholder) document; nothing has drifted.
    useDocumentsStore.getState().markBaseline();

    useDocumentsStore.getState().syncCurrent();

    expect(Object.keys(useDocumentsStore.getState().docs)).toHaveLength(0);
  });

  it('2. a meaningful subject promotes the doc; a letterhead-only change does not', () => {
    useDocumentsStore.setState({ currentId: 'doc-1' });
    useDocumentsStore.getState().markBaseline();

    // A non-meaningful drift: change only a letterhead field. It differs from
    // baseline but isMeaningful() is still false (placeholder subject, no body).
    useDocumentStore.getState().setFormData({ unitLine1: 'A DIFFERENT UNIT' });
    useDocumentsStore.getState().syncCurrent();
    expect(Object.keys(useDocumentsStore.getState().docs)).toHaveLength(0);

    // Now write a real subject: meaningful AND drifted -> enters Recents.
    useDocumentStore.getState().setFormData({ subject: 'REQUEST FOR SPECIAL LIBERTY' });
    useDocumentsStore.getState().syncCurrent();

    const docs = useDocumentsStore.getState().docs;
    expect(Object.keys(docs)).toHaveLength(1);
    expect(docs['doc-1']).toBeDefined();
    expect(docs['doc-1'].meta.title).toBe('REQUEST FOR SPECIAL LIBERTY');
  });

  it('2b. content other than subject/body (a recipient) promotes the doc', () => {
    useDocumentsStore.setState({ currentId: 'doc-1' });
    useDocumentsStore.getState().markBaseline();

    // No subject and no body yet, but a real recipient is content the user
    // entered — the case the old subject/body-only gate used to drop.
    useDocumentStore.getState().setFormData({ to: 'Commanding General, 2d MARDIV' });
    useDocumentsStore.getState().syncCurrent();

    expect(Object.keys(useDocumentsStore.getState().docs)).toHaveLength(1);
  });

  it('2c. "New" preserves the current letter into Recents instead of discarding it', () => {
    useDocumentsStore.setState({ currentId: 'doc-1' });
    useDocumentsStore.getState().markBaseline();
    // Real work with no subject/body — the exact case that used to vanish on New.
    useDocumentStore.getState().setFormData({ to: 'Commanding General, 2d MARDIV' });

    useDocumentsStore.getState().newDocument();

    const { docs, currentId } = useDocumentsStore.getState();
    // The prior letter is kept under its old id...
    expect(docs['doc-1']).toBeDefined();
    expect(docs['doc-1'].session.formData?.to).toBe('Commanding General, 2d MARDIV');
    // ...and a fresh, different document is now current.
    expect(currentId).toBeTruthy();
    expect(currentId).not.toBe('doc-1');
  });

  it('2d. "New" on a letterhead-only change leaves no phantom Recents entry', () => {
    useDocumentsStore.setState({ currentId: 'doc-1' });
    useDocumentsStore.getState().markBaseline();
    useDocumentStore.getState().setFormData({ unitLine1: 'A DIFFERENT UNIT' });

    useDocumentsStore.getState().newDocument();

    expect(useDocumentsStore.getState().docs['doc-1']).toBeUndefined();
  });

  it('2e. a classification change (security-marking work) promotes the doc', () => {
    useDocumentsStore.setState({ currentId: 'doc-1' });
    useDocumentsStore.getState().markBaseline();

    // Classifying a document is real work even with no subject/body yet.
    useDocumentStore.getState().setFormData({ classLevel: 'confidential' });
    useDocumentsStore.getState().syncCurrent();

    expect(Object.keys(useDocumentsStore.getState().docs)).toHaveLength(1);
  });

  it('3. a second identical syncCurrent does not duplicate or re-sort the entry', () => {
    useDocumentsStore.setState({ currentId: 'doc-1' });
    useDocumentsStore.getState().markBaseline();
    useDocumentStore.getState().setFormData({ subject: 'LETTER OF APPRECIATION' });
    useDocumentsStore.getState().syncCurrent();

    const first = useDocumentsStore.getState().docs['doc-1'];
    expect(Object.keys(useDocumentsStore.getState().docs)).toHaveLength(1);

    // No live change between calls; sameContent() short-circuits, so the entry
    // object is left untouched (not replaced with a new updatedAt).
    useDocumentsStore.getState().syncCurrent();

    const after = useDocumentsStore.getState().docs;
    expect(Object.keys(after)).toHaveLength(1);
    expect(after['doc-1']).toBe(first);
  });

  it('4. switchTo preserves the doc being left and loads the target', () => {
    // Seed an "other" document directly in the registry to switch into.
    const otherSession = getSerializedSessionForShare();
    otherSession.formData = { ...otherSession.formData, subject: 'INSPECTION RESULTS' };
    useDocumentsStore.setState({
      currentId: 'doc-1',
      docs: {
        'doc-2': {
          meta: { id: 'doc-2', title: 'INSPECTION RESULTS', docType: otherSession.docType, updatedAt: 1 },
          session: otherSession,
        },
      },
    });
    // Make the currently-open doc-1 meaningful and baseline-drifted so the
    // internal syncCurrent on switch preserves it.
    useDocumentsStore.getState().markBaseline();
    useDocumentStore.getState().setFormData({ subject: 'ANNUAL TRAINING PLAN' });

    useDocumentsStore.getState().switchTo('doc-2');

    const state = useDocumentsStore.getState();
    // Target is now current.
    expect(state.currentId).toBe('doc-2');
    // The doc we left was preserved into Recents.
    expect(state.docs['doc-1']).toBeDefined();
    expect(state.docs['doc-1'].meta.title).toBe('ANNUAL TRAINING PLAN');
    // The live store now reflects the target document.
    expect(useDocumentStore.getState().formData.subject).toBe('INSPECTION RESULTS');
    // Baseline was updated to the loaded target so it doesn't immediately drift.
    expect(state.baseline?.formData?.subject).toBe('INSPECTION RESULTS');
  });

  it('5a. remove(currentId) with two docs reopens the newer remaining one', () => {
    const mk = (subject: string, updatedAt: number) => {
      const s = getSerializedSessionForShare();
      s.formData = { ...s.formData, subject };
      return {
        meta: { id: '', title: subject, docType: s.docType, updatedAt },
        session: s,
      };
    };
    const older = mk('OLDER DRAFT', 100);
    older.meta.id = 'doc-old';
    const newer = mk('NEWER DRAFT', 200);
    newer.meta.id = 'doc-new';

    useDocumentsStore.setState({
      currentId: 'doc-current',
      baseline: getSerializedSessionForShare(),
      docs: { 'doc-old': older, 'doc-new': newer },
    });

    useDocumentsStore.getState().remove('doc-current');

    const state = useDocumentsStore.getState();
    // Falls back to the newest remaining doc by updatedAt.
    expect(state.currentId).toBe('doc-new');
    expect(useDocumentStore.getState().formData.subject).toBe('NEWER DRAFT');
    // Baseline tracks the reopened doc.
    expect(state.baseline?.formData?.subject).toBe('NEWER DRAFT');
  });

  it('5b. remove(currentId) with one doc resets to a fresh blank correspondence doc', () => {
    const onlySession = getSerializedSessionForShare();
    onlySession.formData = { ...onlySession.formData, subject: 'THE ONLY DRAFT' };
    useDocumentsStore.setState({
      currentId: 'doc-only',
      baseline: onlySession,
      docs: {
        'doc-only': {
          meta: { id: 'doc-only', title: 'THE ONLY DRAFT', docType: onlySession.docType, updatedAt: 50 },
          session: onlySession,
        },
      },
    });

    useDocumentsStore.getState().remove('doc-only');

    const state = useDocumentsStore.getState();
    // A new id was minted (not the removed one) and the registry is empty.
    expect(state.currentId).not.toBe('doc-only');
    expect(state.currentId).not.toBeNull();
    expect(Object.keys(state.docs)).toHaveLength(0);
    // The live document is a fresh blank correspondence doc (placeholder subject).
    expect(useDocumentStore.getState().documentCategory).toBe('correspondence');
    expect(useDocumentStore.getState().formData.subject).toBe('[SUBJECT]');
  });

  it('6. renameDocument overrides the auto title and survives a later autosave', () => {
    const s = getSerializedSessionForShare();
    s.formData = { ...s.formData, subject: 'AUTO SUBJECT' };
    useDocumentsStore.setState({
      currentId: 'd1',
      baseline: s,
      docs: { d1: { meta: { id: 'd1', title: 'AUTO SUBJECT', docType: s.docType, updatedAt: 1 }, session: s } },
    });
    useDocumentsStore.getState().renameDocument('d1', '  My Liberty Request  ');
    expect(useDocumentsStore.getState().docs.d1.meta.name).toBe('My Liberty Request');
    expect(useDocumentsStore.getState().docs.d1.meta.title).toBe('My Liberty Request');
    // A later autosave (Subject changed) must keep the user-set name.
    useDocumentStore.getState().setFormData({ subject: 'A DIFFERENT SUBJECT' });
    useDocumentStore.setState({ documentCategory: 'correspondence' });
    useDocumentsStore.getState().syncCurrent();
    expect(useDocumentsStore.getState().docs.d1.meta.title).toBe('My Liberty Request');
  });

  it('6b. renameDocument with blank input reverts to the auto title', () => {
    const s = getSerializedSessionForShare();
    s.formData = { ...s.formData, subject: 'AUTO SUBJECT' };
    useDocumentsStore.setState({
      currentId: null,
      docs: { d1: { meta: { id: 'd1', title: 'X', name: 'X', docType: s.docType, updatedAt: 1 }, session: s } },
    });
    useDocumentsStore.getState().renameDocument('d1', '   ');
    expect(useDocumentsStore.getState().docs.d1.meta.name).toBeUndefined();
    expect(useDocumentsStore.getState().docs.d1.meta.title).toBe('AUTO SUBJECT');
  });

  it('7. duplicateDocument clones into a "Copy of …" entry without switching', () => {
    const s = getSerializedSessionForShare();
    s.formData = { ...s.formData, subject: 'ORIGINAL' };
    useDocumentsStore.setState({
      currentId: 'd1',
      docs: { d1: { meta: { id: 'd1', title: 'ORIGINAL', docType: s.docType, updatedAt: 1 }, session: s } },
    });
    useDocumentsStore.getState().duplicateDocument('d1');
    const docs = useDocumentsStore.getState().docs;
    expect(Object.keys(docs)).toHaveLength(2);
    const copy = Object.values(docs).find((d) => d.meta.id !== 'd1');
    expect(copy?.meta.title).toBe('Copy of ORIGINAL');
    expect(useDocumentsStore.getState().currentId).toBe('d1'); // unchanged
  });

  it('8. remove() soft-deletes and restoreDeleted() brings it back', () => {
    const s = getSerializedSessionForShare();
    s.formData = { ...s.formData, subject: 'KEEP ME' };
    useDocumentsStore.setState({
      currentId: null,
      docs: { d1: { meta: { id: 'd1', title: 'KEEP ME', docType: s.docType, updatedAt: 1 }, session: s } },
    });
    useDocumentsStore.getState().remove('d1');
    expect(useDocumentsStore.getState().docs.d1).toBeUndefined();
    expect(useDocumentsStore.getState().pendingDelete?.ids).toEqual(['d1']);
    useDocumentsStore.getState().restoreDeleted();
    expect(useDocumentsStore.getState().docs.d1?.meta.title).toBe('KEEP ME');
    expect(useDocumentsStore.getState().pendingDelete).toBeNull();
  });

  it('9. removeMany() soft-deletes a batch and restoreDeleted() restores all', () => {
    const s = getSerializedSessionForShare();
    useDocumentsStore.setState({
      currentId: null,
      docs: {
        a: { meta: { id: 'a', title: 'A', docType: s.docType, updatedAt: 1 }, session: s },
        b: { meta: { id: 'b', title: 'B', docType: s.docType, updatedAt: 2 }, session: s },
        c: { meta: { id: 'c', title: 'C', docType: s.docType, updatedAt: 3 }, session: s },
      },
    });
    useDocumentsStore.getState().removeMany(['a', 'c']);
    expect(useDocumentsStore.getState().docs.a).toBeUndefined();
    expect(useDocumentsStore.getState().docs.c).toBeUndefined();
    expect(useDocumentsStore.getState().docs.b).toBeDefined();
    expect(useDocumentsStore.getState().pendingDelete?.ids).toEqual(['a', 'c']);
    expect(useDocumentsStore.getState().pendingDelete?.title).toBe('2 documents');
    useDocumentsStore.getState().restoreDeleted();
    expect(useDocumentsStore.getState().docs.a?.meta.title).toBe('A');
    expect(useDocumentsStore.getState().docs.c?.meta.title).toBe('C');
    expect(useDocumentsStore.getState().pendingDelete).toBeNull();
  });

  it('10. togglePin() flips the pinned flag and survives a content save', () => {
    const s = getSerializedSessionForShare();
    s.formData = { ...s.formData, subject: 'PIN ME' };
    useDocumentsStore.setState({
      currentId: 'p1',
      baseline: null,
      docs: { p1: { meta: { id: 'p1', title: 'PIN ME', docType: s.docType, updatedAt: 1 }, session: s } },
    });
    useDocumentsStore.getState().togglePin('p1');
    expect(useDocumentsStore.getState().docs.p1.meta.pinned).toBe(true);
    // A subsequent content sync rebuilds meta — the pin must persist.
    useDocumentStore.getState().setField('subject', 'PIN ME EDITED');
    useDocumentsStore.getState().syncCurrent();
    expect(useDocumentsStore.getState().docs.p1.meta.pinned).toBe(true);
    useDocumentsStore.getState().togglePin('p1');
    expect(useDocumentsStore.getState().docs.p1.meta.pinned).toBe(false);
  });

  it('11. an idle tab must not clobber another tab\'s newer save (stale-flush guard)', () => {
    useDocumentsStore.setState({ currentId: 'doc-1' });
    useDocumentsStore.getState().markBaseline();
    // This tab writes and persists its own content — baseline advances with it.
    useDocumentStore.getState().setFormData({ subject: 'ORIGINAL FROM THIS TAB' });
    useDocumentsStore.getState().syncCurrent();
    const mine = useDocumentsStore.getState().docs['doc-1'];
    expect(mine.meta.title).toBe('ORIGINAL FROM THIS TAB');

    // Another tab saves a NEWER version; the cross-tab broadcast mirrors it into
    // this tab's docs map (list only — the live editor is deliberately untouched).
    const theirs = {
      meta: { ...mine.meta, title: 'NEWER FROM OTHER TAB', updatedAt: mine.meta.updatedAt + 1000 },
      session: {
        ...mine.session,
        formData: { ...mine.session.formData, subject: 'NEWER FROM OTHER TAB' },
      },
    };
    useDocumentsStore.setState({ docs: { 'doc-1': theirs } });

    // This tab goes hidden → pagehide flush → syncCurrent. Its live document
    // still equals what it last persisted, so the flush must be a no-op instead
    // of overwriting the other tab's newer copy with a stale one.
    useDocumentsStore.getState().syncCurrent();
    expect(useDocumentsStore.getState().docs['doc-1'].meta.title).toBe('NEWER FROM OTHER TAB');

    // A REAL local edit still persists as before (last-writer-wins between two
    // genuinely-editing tabs is the accepted contract).
    useDocumentStore.getState().setFormData({ subject: 'REAL LOCAL EDIT' });
    useDocumentsStore.getState().syncCurrent();
    expect(useDocumentsStore.getState().docs['doc-1'].meta.title).toBe('REAL LOCAL EDIT');
  });
});
