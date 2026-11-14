import { describe, expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { diffSessions } from '@/lib/sessionDiff';
import type { CommentThread, ReviewComments } from '@/lib/reviewComments';

function thread(text = 'Please check this subject.'): CommentThread {
  return { id: crypto.randomUUID(), anchor: { kind: 'field', field: 'subject', context: 'Subject', docType: 'naval_letter' }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Chief', text, createdAt: '2026-11-13T00:00:00Z' }] };
}
function session(threads: CommentThread[]) {
  const result = createBlankSession();result.formData.subject = 'Subject';
  if (threads.length) result.reviewComments = { version: 1, threads };
  return result;
}

describe('readable review comment comparisons', () => {
  it('summarizes targets, status, author and message text rather than internal paths', () => {
    const added = thread();
    const changes = diffSessions(session([]), session([added]));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: 'Review comments', before: 'No comments' });
    expect(changes[0].after).toContain('Subject (Open)');
    expect(changes[0].after).toContain('Comment by Chief: Please check this subject.');
    expect(changes[0].after).not.toContain(added.id);
    expect(changes[0].after).not.toContain(added.messages[0].id);
    expect(changes[0].after).not.toContain('2026-11-13T00:00:00Z');
  });
  it('ignores generated IDs, timestamps and empty review containers', () => {
    const first = thread();const changed = structuredClone(first);
    changed.id = crypto.randomUUID();changed.messages[0].id = crypto.randomUUID();
    changed.messages[0].createdAt = '2026-11-14T00:00:00Z';changed.messages[0].editedAt = '2026-11-15T00:00:00Z';
    expect(diffSessions(session([first]), session([changed]))).toEqual([]);
    const empty = session([]);empty.reviewComments = { version: 1, threads: [] };
    expect(diffSessions(session([]), empty)).toEqual([]);
  });
  it('keeps reply, author, resolution and edited-message changes visible', () => {
    const first = thread();const changed = structuredClone(first);
    changed.resolved = true;changed.messages[0].text = 'Use the revised subject.';
    changed.messages.push({ id: crypto.randomUUID(), author: 'Drafter', text: 'Updated.', createdAt: '2026-11-13T01:00:00Z' });
    const changes = diffSessions(session([first]), session([changed]));
    expect(changes[0].before).toContain('Subject (Open)');
    expect(changes[0].after).toContain('Subject (Resolved)');
    expect(changes[0].after).toContain('Comment by Chief: Use the revised subject.');
    expect(changes[0].after).toContain('Reply by Drafter: Updated.');
    changed.messages[0].author = 'Different reviewer';
    expect(diffSessions(session([first]), session([changed]))[0].after).toContain('Different reviewer');
  });
  it('shows unavailable and changed field targets without exposing field metadata', () => {
    const first = thread();const changed = structuredClone(first);
    changed.anchor = { kind: 'field', field: 'removedField', context: 'Old field value', docType: 'naval_letter' };
    const changes = diffSessions(session([first]), session([changed]));
    expect(changes[0].after).toContain('target unavailable');
    expect(changes[0].after).toContain('Captured context: Old field value');
  });
  it('reports a changed target even when the stored comment is unchanged', () => {
    const before = session([thread()]);const after = structuredClone(before);
    after.formData.subject = 'Revised subject';
    const change = diffSessions(before, after).find(item => item.field === 'Review comments');
    expect(change?.before).toContain('Subject (Open)');expect(change?.after).toContain('target changed');
    expect(after.reviewComments).toEqual(before.reviewComments);
  });
  it('bounds large discussions around the actual changed text, preserving Unicode', () => {
    const first = thread(`${'A'.repeat(8_000)}😀Original ending`);const changed = structuredClone(first);
    changed.messages[0].text = `${'A'.repeat(8_000)}😀Changed ending`;
    const change = diffSessions(session([first]), session([changed]))[0];
    expect(change.before.length).toBeLessThan(2_010);expect(change.after.length).toBeLessThan(2_010);
    expect(change.before).toContain('😀Original ending');expect(change.after).toContain('😀Changed ending');
  });
  it('does not crash on unsupported historical reviews or print their opaque data', () => {
    const after = session([]);after.reviewComments = { version: 99, threads: [{ id: 'opaque' }] } as unknown as ReviewComments;
    const changes = diffSessions(session([]), after);
    expect(changes[0].after).toContain('Update DonDocs');expect(changes[0].after).not.toContain('opaque');
  });
});
