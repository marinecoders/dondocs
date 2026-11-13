import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { useDocumentsStore, captureDocumentScope, captureDocumentTarget, changeDocumentHistory, recordDocumentHistory } from '@/stores/documentsStore';
import { freshParagraphs, ensureParagraphIds } from '@/lib/paragraphIdentity';
import { applyCommentMutation, reviewCommentMutation } from '@/lib/reviewCommentActions';
import { captureCommentAnchor, describeCommentAnchor, availableCommentParagraphs } from '@/lib/reviewCommentTargets';
import { reviewCommentsSchema } from '@/lib/reviewComments';
import { parseSavedSession } from '@/lib/savedSession';
import { createSharedPayload, parseSharedSession } from '@/lib/sharedSession';
import { buildDraftFile, parseDraftFile } from '@/lib/draftFile';
import { documentTextFields } from '@/lib/documentFields';
import { validateBackupSession } from '@/lib/backupValidation';
import { applyReferenceChange, reviewReferenceChange } from '@/lib/applyReferenceChange';
import { detectPII, detectSharedSessionPII, detectTextPII } from '@/services/pii/detector';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ paragraphs: freshParagraphs([{ text: 'Identical text 😀', level: 0 }, { text: 'Identical text 😀', level: 0 }]) });
});

function add(index = 1) {
  const paragraphId = useDocumentStore.getState().paragraphs[index].id!;
  expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', paragraphId, author: 'Chief', text: 'Please review this paragraph.' }))).toBe('applied');
  return useDocumentStore.getState().reviewComments!.threads.at(-1)!;
}

describe('paragraph comment targets', () => {
  it('follows one actual paragraph through insertion and moves among identical text', () => {
    const thread = add();
    expect(useDocumentStore.getState().reviewComments?.version).toBe(2);
    const state = useDocumentStore.getState();
    state.addParagraph('Inserted', 0, 0);
    expect(describeCommentAnchor(useDocumentStore.getState(), thread.anchor)).toMatchObject({ label: 'Paragraph 3', status: 'current' });
    state.reorderParagraphs(2, 0);
    expect(describeCommentAnchor(useDocumentStore.getState(), thread.anchor)).toMatchObject({ label: 'Paragraph 1', status: 'current' });
    state.setDocType('business_letter');
    expect(describeCommentAnchor(useDocumentStore.getState(), thread.anchor).status).toBe('current');
  });

  it('keeps a deleted target detached when identical text is inserted at its index', () => {
    const thread = add();
    const state = useDocumentStore.getState();
    state.removeParagraph(1);
    state.addParagraph('Identical text 😀', 0, 0);
    expect(describeCommentAnchor(useDocumentStore.getState(), thread.anchor)).toMatchObject({ status: 'unavailable', context: 'Identical text 😀' });
    expect(useDocumentStore.getState().reviewComments?.threads[0]).toEqual(thread);
  });

  it('does not reuse the deleted last paragraph when the remaining blank row is filled again', () => {
    useDocumentStore.setState({ paragraphs: freshParagraphs([{ text: 'Only paragraph', level: 0 }]) });
    const thread = add(0);
    useDocumentStore.getState().clearParagraphs();
    useDocumentStore.getState().updateParagraph(0, { text: 'Only paragraph' });
    expect(describeCommentAnchor(useDocumentStore.getState(), thread.anchor).status).toBe('unavailable');
  });

  it('retains the receiver identity during split and merge, and Undo recovers deleted anchors', () => {
    const first = add(0);
    const second = add(1);
    const state = useDocumentStore.getState();
    const scope = captureDocumentScope();
    recordDocumentHistory(scope);
    state.updateParagraph(0, { text: 'Combined paragraphs' });
    state.removeParagraph(1);
    recordDocumentHistory(scope);
    expect(describeCommentAnchor(useDocumentStore.getState(), first.anchor).status).toBe('changed');
    expect(describeCommentAnchor(useDocumentStore.getState(), second.anchor).status).toBe('unavailable');
    expect(changeDocumentHistory('undo', scope)).toBe('applied');
    expect(describeCommentAnchor(useDocumentStore.getState(), second.anchor).status).toBe('current');
    expect(changeDocumentHistory('redo', scope)).toBe('applied');
    expect(describeCommentAnchor(useDocumentStore.getState(), second.anchor).status).toBe('unavailable');
    state.insertParagraphs(0, ['Split continuation'], 0);
    expect(describeCommentAnchor(useDocumentStore.getState(), first.anchor).label).toBe('Paragraph 1');
    expect(describeCommentAnchor(useDocumentStore.getState(), second.anchor).status).toBe('unavailable');
  });

  it('retains detached threads for same-owner replacement but clears them for a new document', () => {
    const thread = add();
    useDocumentStore.getState().loadTemplate({ paragraphs: [{ text: 'Replacement content', level: 0 }] });
    expect(useDocumentStore.getState().reviewComments?.threads[0]).toEqual(thread);
    expect(describeCommentAnchor(useDocumentStore.getState(), thread.anchor).status).toBe('unavailable');
    useDocumentsStore.getState().newDocument();
    expect(useDocumentStore.getState().reviewComments).toBeUndefined();
  });

  it('captures headings and Unicode text; refuses ambiguous IDs and oversized context', () => {
    useDocumentStore.getState().updateParagraph(0, { header: 'Purpose é', text: 'Text 😀\nSecond line.' });
    const state = useDocumentStore.getState();
    const id = state.paragraphs[0].id!;
    expect(captureCommentAnchor(state, undefined, id)).toMatchObject({ context: 'Purpose é\n\nText 😀\nSecond line.' });
    expect(captureCommentAnchor(state, 'subject', id)).toBeNull();
    expect(captureCommentAnchor({ ...state, paragraphs: [state.paragraphs[0], state.paragraphs[0]] }, undefined, id)).toBeNull();
    state.updateParagraph(0, { text: 'x'.repeat(20_001) });
    expect(availableCommentParagraphs(useDocumentStore.getState()).some(item => item.paragraphId === id)).toBe(false);
  });

  it('retains explicit paragraph and figure markings when the target is removed', () => {
    const state = useDocumentStore.getState();
    state.updateParagraph(0, { header: 'Purpose', text: 'Marked caption.', portionMarking: 'S', figure: { portionMarking: 'TS' } });
    const anchor = captureCommentAnchor(useDocumentStore.getState(), undefined, state.paragraphs[0].id!)!;
    expect(anchor).toMatchObject({ context: '(S)\nFigure marking: (TS)\nPurpose\n\nMarked caption.' });
    state.updateParagraph(0, { portionMarking: 'U' });
    expect(describeCommentAnchor(useDocumentStore.getState(), anchor).status).toBe('changed');
    state.removeParagraph(0);
    expect(describeCommentAnchor(useDocumentStore.getState(), anchor)).toMatchObject({ status: 'unavailable', context: '(S)\nFigure marking: (TS)\nPurpose\n\nMarked caption.' });
  });

  it('rejects stale, missing and forged actions without changing paragraphs or comments', () => {
    const state = useDocumentStore.getState();
    const id = state.paragraphs[1].id!;
    const mutation = { kind: 'add' as const, paragraphId: id, author: 'Chief', text: 'Review.' };
    const proposal = reviewCommentMutation(mutation, captureDocumentTarget());
    state.reorderParagraphs(1, 0);
    const before = useDocumentStore.getState().getSnapshot();
    expect(applyCommentMutation(proposal)).toBe('stale');
    expect(applyCommentMutation({ ...reviewCommentMutation(mutation) })).toBe('stale');
    expect(applyCommentMutation(reviewCommentMutation({ ...mutation, paragraphId: 'absent' }))).toBe('invalid');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
  });

  it('preserves paragraph identity while live citations change and leaves captured comment context intact', () => {
    useDocumentStore.setState({ paragraphs: freshParagraphs([{ text: 'Use reference (b).', level: 0 }]),
      references: [{ letter: 'a', title: 'Alpha' }, { letter: 'b', title: 'Bravo' }] });
    const thread = add(0);
    const id = useDocumentStore.getState().paragraphs[0].id;
    expect(applyReferenceChange(reviewReferenceChange([1, 0]))).toBe(true);
    expect(useDocumentStore.getState().paragraphs[0]).toMatchObject({ id, text: 'Use reference (a).' });
    expect(useDocumentStore.getState().reviewComments!.threads[0]).toEqual(thread);
    expect(describeCommentAnchor(useDocumentStore.getState(), thread.anchor).status).toBe('changed');
  });
});

describe('paragraph review persistence and compatibility', () => {
  it('preserves IDs and comments through saved, shared, draft and backup readers', async () => {
    add();
    const session = getSerializedSession();
    expect(parseSavedSession(session)).toMatchObject({ paragraphs: session.paragraphs, reviewComments: session.reviewComments });
    expect(parseSharedSession(createSharedPayload(session))).toMatchObject({ paragraphs: session.paragraphs, reviewComments: session.reviewComments });
    const draft = parseDraftFile(await buildDraftFile()).session;
    expect(draft).toMatchObject({ paragraphs: session.paragraphs, reviewComments: session.reviewComments });
    expect(() => validateBackupSession(session)).not.toThrow();
    const legacyVersion = { ...session, reviewComments: { ...session.reviewComments, version: 1 } };
    expect(reviewCommentsSchema.safeParse(legacyVersion.reviewComments).success).toBe(false);
    expect(() => parseSavedSession(legacyVersion)).toThrow();
    expect(() => parseSharedSession(legacyVersion)).toThrow();
    expect(() => validateBackupSession(legacyVersion)).toThrow();
  });

  it('never assigns an orphan anchor ID while migrating a legacy node', () => {
    const thread = add();
    const paragraphs = [{ text: 'Legacy text', level: 0 }];
    const id = ensureParagraphIds(paragraphs)[0].id!;
    const session = { ...getSerializedSession(), paragraphs, reviewComments: { version: 2 as const, threads: [{ ...thread,
      anchor: { kind: 'paragraph' as const, paragraphId: id, context: 'Legacy text', docType: 'naval_letter' } }] } };
    const parsed = parseSavedSession(session);
    expect(parsed.paragraphs[0].id).not.toBe(id);
    expect(describeCommentAnchor(parsed, parsed.reviewComments!.threads[0].anchor).status).toBe('unavailable');
  });

  it('rejects duplicate IDs even through the full backup validator', () => {
    const session = getSerializedSession();
    session.paragraphs[1] = { ...session.paragraphs[1], id: session.paragraphs[0].id };
    expect(() => validateBackupSession(session)).toThrow('duplicated');
  });

  it('returns to the field-compatible model after the last paragraph discussion is deleted', () => {
    const paragraph = add();
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', field: 'subject', author: 'Chief', text: 'Check the subject.' }))).toBe('applied');
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'delete', threadId: paragraph.id }))).toBe('applied');
    expect(useDocumentStore.getState().reviewComments?.version).toBe(1);
    expect(useDocumentStore.getState().reviewComments?.threads[0].anchor.kind).toBe('field');
  });

  it('does not send an unnecessary new review model in a comment-free legacy share', () => {
    const session = { ...getSerializedSession(), reviewComments: { version: 2 as const, threads: [] } };
    expect(parseSavedSession(session).reviewComments).toBeUndefined();
    const payload = createSharedPayload(session);
    expect(payload.version).toBe(1);
    expect(payload.reviewComments).toBeUndefined();
  });

  it('scans retained paragraph context, reviewer names and messages after the node is deleted', () => {
    const state = useDocumentStore.getState();
    state.updateParagraph(1, { text: 'SSN 123-45-6789', portionMarking: 'S', figure: { portionMarking: 'TS' } });
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', paragraphId: state.paragraphs[1].id!, author: 'reviewer@example.com', text: 'Call 555-234-5678.' }))).toBe('applied');
    state.removeParagraph(1);
    const session = getSerializedSession();
    for (const inspect of [detectPII, detectSharedSessionPII]) {
      expect(inspect(session).summary).toMatchObject({ ssn: 1, emailAddresses: 1, phone: 1 });
    }
    for (const projection of ['draft', 'share', 'backup'] as const) {
      const fields = documentTextFields(session, projection).filter(field => field.path[0] === 'reviewComments');
      expect(detectTextPII(fields.map(field => ({ field: field.label, value: field.text }))).summary).toMatchObject({ ssn: 1, emailAddresses: 1, phone: 1 });
      expect(fields.map(field => field.text).join(' ')).toContain('(S)\nFigure marking: (TS)');
    }
  });

  it('keeps comment text and captured context in transfer scans, outside clean output and substitution', () => {
    add();
    useDocumentStore.getState().removeParagraph(1);
    const state = useDocumentStore.getState();
    for (const projection of ['draft', 'share', 'backup', 'search'] as const) {
      expect(documentTextFields(state, projection).filter(field => field.path[0] === 'reviewComments').map(field => field.text).join(' ')).toContain('Please review this paragraph.');
    }
    for (const projection of ['output', 'substitution'] as const) {
      expect(documentTextFields(state, projection).some(field => field.path[0] === 'reviewComments')).toBe(false);
      expect(documentTextFields(state, projection).some(field => field.path[0] === 'paragraphs' && field.path[2] === 'id')).toBe(false);
    }
  });
});
