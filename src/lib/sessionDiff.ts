import type { SerializedSession } from '@/stores/documentStore';
import { describeCommentAnchor } from './reviewCommentTargets';
import { reviewCommentsSchema } from './reviewComments';

export interface SessionChange { field: string; before: string; after: string }
const names: Record<string, string> = { formData: 'Document fields', forms: 'Form fields', navmc10274: 'NAVMC 10274', navmc11811: 'NAVMC 118 (11)', fileRef: 'Attached file', basicLetterFileRef: 'Basic letter', signatureImage: 'Signature image' };
const label = (key: string) => names[key] ?? (/^\d+$/.test(key) ? `${Number(key) + 1}` : key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()));

function semanticComments(session: SerializedSession) {
  const parsed = reviewCommentsSchema.safeParse(session.reviewComments ?? { version: 1, threads: [] });
  if (!parsed.success) return null;
  return parsed.data.threads.map(thread => {
    const target = describeCommentAnchor(session, thread.anchor);
    return { target: target.label, status: target.status, context: target.context,
      resolved: thread.resolved, messages: thread.messages.map(message => ({ author: message.author, text: message.text })) };
  });
}
function commentText(comments: ReturnType<typeof semanticComments>): string {
  if (comments === null) return 'Update DonDocs to inspect these review comments.';
  return comments.length ? comments.map((thread, index) => [
    `Thread ${index + 1}: ${thread.target} (${thread.resolved ? 'Resolved' : 'Open'}${thread.status === 'current' ? '' : thread.status === 'changed' ? '; target changed' : '; target unavailable'})`,
    ...(thread.context === undefined ? [] : [`Captured context: ${thread.context || '(Empty)'}`]),
    ...thread.messages.map((message, messageIndex) => `${messageIndex ? 'Reply' : 'Comment'} by ${message.author}: ${message.text}`),
  ].join('\n')).join('\n\n') : 'No comments';
}
/** Show the first substantive difference even in a large discussion. Excerpts
 * are bounded and cut by Unicode code points, never by opaque record IDs. */
function commentExcerpts(before: string, after: string): { before: string; after: string } {
  const left = Array.from(before);const right = Array.from(after);
  let difference = 0;
  while (difference < left.length && difference < right.length && left[difference] === right[difference]) difference++;
  const excerpt = (text: string[]) => {
    const limit = 2_000;
    if (text.length <= limit) return text.join('');
    const start = Math.max(0, Math.min(difference - 400, text.length - limit));
    return `${start ? '…\n' : ''}${text.slice(start, start + limit).join('')}${start + limit < text.length ? '\n…' : ''}`;
  };
  return { before: excerpt(left), after: excerpt(right) };
}

/** Compare every persisted field, including ordered structure and asset handles. */
export function diffSessions(before: SerializedSession, after: SerializedSession): SessionChange[] {
  const changes: SessionChange[] = [];
  const leftComments = semanticComments(before);const rightComments = semanticComments(after);
  let reviewChange: SessionChange | undefined;
  if (JSON.stringify(leftComments) !== JSON.stringify(rightComments)
    || (leftComments === null || rightComments === null) && JSON.stringify(before.reviewComments) !== JSON.stringify(after.reviewComments)) {
    const excerpts = commentExcerpts(commentText(leftComments), commentText(rightComments));
    if (excerpts.before === excerpts.after) excerpts.after += '\nThe discussion changed. Inspect the comments for full details.';
    reviewChange = { field: 'Review comments', ...excerpts };
  }
  function walk(a: unknown, b: unknown, path: string[]) {
    if (path.length === 1 && path[0] === 'reviewComments') return;
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const key = path.at(-1);
    if (key === 'timestamp' || key === 'hasFile') return;
    if (key === 'signatureImage' || key === 'image') {
      changes.push({ field: path.map(label).join(' › '), before: a ? 'Image attached' : 'No image', after: b ? (a ? 'Different image attached' : 'Image attached') : 'No image' });
      return;
    }
    if (key === 'fileRef' || key === 'basicLetterFileRef') {
      const name = (v: unknown) => v && typeof v === 'object' && 'name' in v ? String(v.name) : 'No file';
      changes.push({ field: path.map(label).join(' › '), before: name(a), after: name(b) + (a && b ? ' (changed)' : '') });
      return;
    }
    if ((a && typeof a === 'object') || (b && typeof b === 'object')) {
      const left = (a ?? {}) as Record<string, unknown>;
      const right = (b ?? {}) as Record<string, unknown>;
      for (const k of new Set([...Object.keys(left), ...Object.keys(right)])) walk(left[k], right[k], [...path, k]);
      return;
    }
    const text = (v: unknown) => v === undefined || v === null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
    changes.push({ field: path.map(label).join(' › '), before: text(a), after: text(b) });
  }
  walk(before, after, []);
  if (reviewChange) changes.push(reviewChange);
  return changes;
}
