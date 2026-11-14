import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { applyCommentMutation, reviewCommentMutation } from '@/lib/reviewCommentActions';
import { detectCapturedPII, detectPII, detectSharedSessionPII } from '@/services/pii/detector';
import { captureDocumentRevision } from '@/lib/capturedDocument';

const values = ['111-22-3333', '222-33-4444', '333-44-5555', 'chief@example.com'];

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', '333-44-5555');
  expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', field: 'subject', author: 'chief@example.com', text: 'Check 111-22-3333.' }))).toBe('applied');
  const thread = useDocumentStore.getState().reviewComments!.threads[0];
  expect(applyCommentMutation(reviewCommentMutation({ kind: 'reply', threadId: thread.id, author: 'Drafter', text: 'Also check 222-33-4444.' }))).toBe('applied');
  useDocumentStore.getState().setField('subject', 'PUBLIC SUBJECT');
});

describe('actual privacy checks include retained discussion text', () => {
  it('scans comment text, replies, author labels and retained field context in the draft detector', () => {
    const result = detectPII(useDocumentStore.getState());
    for (const value of values) expect(result.findings.some(finding => finding.value === value && finding.field.startsWith('Comment '))).toBe(true);
    expect(useDocumentStore.getState().formData.subject).toBe('PUBLIC SUBJECT');
  });
  it('scans the same private data in the serialized share detector', () => {
    const result = detectSharedSessionPII(getSerializedSession());
    for (const value of values) expect(result.findings.some(finding => finding.value === value && finding.field.startsWith('Comment '))).toBe(true);
  });
  it('includes review text for captured sharing while excluding it from clean output review', () => {
    const captured = captureDocumentRevision({ documentId: 'privacy-fixture', epoch: 0, editSequence: 0, capturedAt: 0 }, useDocumentStore.getState().getSnapshot());
    const shared = detectCapturedPII(captured, 'share');
    const clean = detectCapturedPII(captured, 'output');
    for (const value of values) {
      expect(shared.findings.some(finding => finding.value === value)).toBe(true);
      expect(clean.findings.some(finding => finding.value === value)).toBe(false);
    }
  });
});
