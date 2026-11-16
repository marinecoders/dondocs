import type { EditorState } from '@tiptap/pm/state';
import { isTextRangeBoundary } from './reviewTextRanges';

export interface PlainEditorSelection { context: string; start: number; end: number }
/** ProseMirror positions include the opening paragraph token; persisted text does not.
 * Refuse rich/atomic/structural content instead of flattening it into guessed offsets. */
export function getPlainEditorRange(state: EditorState, expected: string, options: { allowCaret?: boolean } = {}): PlainEditorSelection | null {
  const { doc, selection } = state;
  if (doc.childCount !== 1 || doc.firstChild?.type.name !== 'paragraph' || doc.firstChild.textContent !== expected) return null;
  let plain = true;
  doc.firstChild.forEach(child => { if (!child.isText || child.marks.length) plain = false; });
  const start = selection.from - 1, end = selection.to - 1;
  return plain && (options.allowCaret || start !== end) && isTextRangeBoundary(expected, start) && isTextRangeBoundary(expected, end)
    ? { context: expected, start, end } : null;
}
