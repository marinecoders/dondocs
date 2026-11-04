/**
 * Shared open/closed state for the `@`-variable suggestion popups.
 *
 * Lives in its own module (not `variable-chip-editor.tsx`) so the block editor's
 * Enter handler can ask "is the variable menu open?" without importing a React
 * component file — and without growing that file's `react-refresh` export cluster.
 *
 * The count is global across all editor instances: any open popup means Enter
 * should pick the highlighted variable rather than create a new paragraph block.
 */
import type { EditorState } from '@tiptap/pm/state';

let openCount = 0;

export function markVariableSuggestionOpen(): void {
  openCount += 1;
}

export function markVariableSuggestionClosed(): void {
  openCount = Math.max(0, openCount - 1);
}

export function isVariableSuggestionOpen(): boolean {
  return openCount > 0;
}

/**
 * The menu adds a space after what it inserts, so a Space pressed straight after
 * is already done; printing both would show a double gap. A later edit replaces
 * the document, so comparing it to the one the menu left is all the expiry needed.
 */
let menuSpace: { doc: EditorState['doc']; pos: number } | null = null;

export function rememberMenuSpace(state: EditorState): void {
  menuSpace = { doc: state.doc, pos: state.selection.from };
}

/** True once, for a Space pressed with the caret still after the menu's space. */
export function takeMenuSpace(state: EditorState): boolean {
  if (menuSpace?.doc !== state.doc || menuSpace.pos !== state.selection.from || !state.selection.empty) return false;
  menuSpace = null;
  return true;
}
