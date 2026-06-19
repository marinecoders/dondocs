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
