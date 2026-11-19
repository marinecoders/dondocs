/** Read the native editor's emphasis markers without changing saved text.
 * Keep this projection in step with variable-chip-editor-text and the output
 * adapters. Literal fill-in lines of three or more underscores stay intact.
 */
export function plainInlineText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/_{3,}|__([^_]+?)__/g, (run, inner: string | undefined) => inner ?? run)
    .replace(/\\(?:textbf|textit|underline)\{([^{}]*)\}/g, '$1');
}
