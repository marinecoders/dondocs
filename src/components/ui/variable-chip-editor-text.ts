/**
 * Pure text/HTML converters for `VariableChipEditor`.
 *
 * Extracted from `variable-chip-editor.tsx` so:
 *
 *   1. The bidirectional text → HTML → editor → text pipeline can be
 *      property-tested in isolation (the round-trip property catches
 *      the `.trim()` regression class from PR #65, where leading
 *      whitespace silently disappeared on every editor onUpdate).
 *
 *   2. `variable-chip-editor.tsx` stays focused on the React + TipTap
 *      integration and doesn't grow more `react-refresh/only-export-
 *      components` lint warnings each time we expose a helper.
 *
 * Three functions:
 *
 *   - `editorToText(editor)`  — walk a TipTap editor's ProseMirror doc,
 *                                emit the persisted text format
 *                                (variables as `{{NAME}}`, marks as
 *                                **bold** / *italic* / __underline__,
 *                                paragraphs joined by `\n`). Strips
 *                                only TRAILING whitespace.
 *
 *   - `textToEditorHtml(text)` — invert: split on `\n`, escape, return
 *                                a TipTap-friendly `<p>...</p>` block.
 *
 *   - `lineToHtml(line, deps)`  — single-line escape + variable +
 *                                rich-text → HTML. Variable lookups
 *                                resolve labels via the optional
 *                                `deps` callbacks (the production
 *                                callers wire these up to the custom-
 *                                variables store; tests can omit them
 *                                and fall back to "label === name").
 */

import type { useEditor } from '@tiptap/react';
import { BATCH_PLACEHOLDERS } from '@/lib/constants';

/**
 * Variable-store callbacks injected by the production caller.
 * Tests can omit these to get a pure-function flavor.
 */
export interface VariableLookupDeps {
  /** Returns custom variables registered in the document so far. */
  getCustomVariables?: () => Array<{ name: string; label: string }>;
  /** Side-effect: register a variable name as in-use. */
  addCustomVariable?: (name: string) => void;
}

/**
 * Convert a single line of text to HTML (escaping, LaTeX formatting,
 * variables). The caller is responsible for wrapping in `<p>...</p>`
 * if a paragraph break is desired.
 *
 * The underline pattern uses `[^_]+?` (not `.+?`) so a run of 3+ raw
 * underscores doesn't accidentally match as `__<empty>__`-with-tail
 * and corrupt the user's input. Real fill-in-the-blank lines like
 * `Signature: __________` show up in the editor as literal text
 * instead of being silently shortened by the inline `<u>` rewrite.
 *
 * Round-trip caveat: TipTap's Underline mark imposes no character
 * restriction, so technically a user could underline text that
 * contains an underscore — `editorToText` then emits `__foo_bar__`,
 * and this pattern won't re-detect it. The underline is lost on
 * save+reload for that one rare case. The fill-in-the-blank case
 * is far more common in naval correspondence, so we accept the
 * trade. The matching change is mirrored in
 * `services/latex/escaper.ts` and `services/latex/flat-generator.ts`
 * so the PDF and DOCX export paths get the same fix. Issue #14.
 */
export function lineToHtml(line: string, deps: VariableLookupDeps = {}): string {
  let html = line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/__([^_]+?)__/g, '<u>$1</u>');

  // Legacy LaTeX formatting for backward compatibility with content
  // saved before the markdown-marker switchover.
  html = html.replace(/\\textbf\{([^{}]*)\}/g, '<strong>$1</strong>');
  html = html.replace(/\\textit\{([^{}]*)\}/g, '<em>$1</em>');
  html = html.replace(/\\underline\{([^{}]*)\}/g, '<u>$1</u>');

  html = html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, name) => {
    const placeholder = BATCH_PLACEHOLDERS.find((p) => p.name === name);
    const customVars = deps.getCustomVariables?.() ?? [];
    const customVar = customVars.find((p) => p.name === name);
    const label = placeholder?.label || customVar?.label || name;
    deps.addCustomVariable?.(name);
    return `<span data-type="variable" data-name="${name}" data-label="${label}">@${label}</span>`;
  });

  return html;
}

/**
 * Convert `{{VARIABLE}}` text with rich-text markers to TipTap-ready
 * HTML. Each `\n` becomes a separate `<p>` so TipTap preserves the
 * paragraph structure.
 *
 * Empty input is special-cased to `<p><br></p>` because TipTap won't
 * accept a fully-empty document (the editor stays in an "empty" state
 * until at least one paragraph node exists).
 */
export function textToEditorHtml(text: string, deps: VariableLookupDeps = {}): string {
  if (!text) return '<p><br></p>';

  const lines = text.split('\n');
  return lines
    .map((line) => `<p>${lineToHtml(line, deps) || '<br>'}</p>`)
    .join('');
}

/**
 * Walk a TipTap editor's ProseMirror document and emit the persisted
 * text format used by the form store.
 *
 * Strips ONLY trailing whitespace. Leading whitespace is meaningful
 * for SECNAV-style sub-paragraph indents (e.g. "   a. Sub-paragraph")
 * and a blanket `.trim()` would silently delete it on every onUpdate
 * — the bug fixed in PR #65 commit 6fb8667.
 */
export function editorToText(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return '';
  const paragraphs: string[] = [];

  editor.state.doc.forEach((paragraphNode) => {
    let paraText = '';

    paragraphNode.forEach((child) => {
      if (child.type.name === 'variable') {
        paraText += `{{${child.attrs.name}}}`;
      } else if (child.type.name === 'hardBreak') {
        paraText += '\n';
      } else if (child.isText && child.text) {
        let text = child.text;
        // processBodyText() expects markdown-style markers and converts
        // them to LaTeX downstream.
        const marks = child.marks;
        const hasBold = marks.some((m) => m.type.name === 'bold');
        const hasItalic = marks.some((m) => m.type.name === 'italic');
        const hasUnderline = marks.some((m) => m.type.name === 'underline');

        if (hasBold) text = `**${text}**`;
        if (hasItalic) text = `*${text}*`;
        if (hasUnderline) text = `__${text}__`;

        paraText += text;
      }
    });

    paragraphs.push(paraText);
  });

  // Strip TRAILING whitespace only. NEVER `.trim()` here — see PR #65.
  return paragraphs.join('\n').replace(/\s+$/, '');
}
