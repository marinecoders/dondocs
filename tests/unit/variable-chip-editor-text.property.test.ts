/**
 * Round-trip property tests for the VariableChipEditor text/HTML pipeline.
 *
 * The bug class this catches is exactly the one that hit users in PR #65:
 * `editorToText` originally ended with `.trim()`, which silently deleted
 * leading whitespace on every onUpdate. Sub-paragraph indents like
 * "   a. Pull-ups..." reaching the form store as "a. Pull-ups..." with
 * no leading spaces — invisible until the PDF rendered against the wrong
 * indent column. The fix replaced `.trim()` with `.replace(/\s+$/, '')`.
 *
 * The round-trip property here pins down both halves of that fix:
 *
 *   - text → HTML (`textToEditorHtml`) preserves the literal whitespace
 *     in `<p>...</p>` so ProseMirror has something to parse.
 *
 *   - HTML → editor → text (`textToEditorHtml` → real TipTap setContent
 *     with `parseOptions: { preserveWhitespace: 'full' }` → editorToText)
 *     produces the original input modulo trailing whitespace.
 *
 * We use `@tiptap/core`'s `Editor` directly (not the React `useEditor`
 * hook) so the test runs in plain happy-dom without spinning up
 * @testing-library/react. The extension list mirrors what
 * variable-chip-editor.tsx wires up at runtime — minus the variable
 * suggestion plugin, which is irrelevant to the text round-trip and
 * pulls in tippy.js.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  editorToText,
  textToEditorHtml,
  lineToHtml,
} from '@/components/ui/variable-chip-editor-text';

/**
 * Minimal TipTap editor mirroring VariableChipEditor's parsing config.
 *
 * Out of scope here:
 *   - the `Variable` chip ProseMirror node (would need to copy the
 *     extension definition + suggestion plugin out of the React file —
 *     a heavier follow-up). Without it, `{{NAME}}` round-trips as the
 *     rendered "@Label" text rather than back to `{{NAME}}` syntax.
 *   - blank-line paragraphs in the middle of multi-paragraph input
 *     (TipTap parses `<p><br></p>` as a paragraph containing a
 *     hardBreak, which `editorToText` emits as an extra `\n`. This
 *     accumulates on save/load round trips — a real edge case but
 *     orthogonal to the `.trim()` regression we're protecting against
 *     and worth its own focused fix.)
 *
 * Underline is already in StarterKit, so we don't add it again
 * (avoids the "Duplicate extension names" warning).
 */
function makeEditor(initialContent: string): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
      }),
    ],
    content: initialContent,
    parseOptions: { preserveWhitespace: 'full' },
  });
}

const editorsToCleanup: Editor[] = [];

afterEach(() => {
  while (editorsToCleanup.length > 0) {
    const editor = editorsToCleanup.pop()!;
    editor.destroy();
  }
  document.body.innerHTML = '';
});

function runRoundTrip(input: string): string {
  const html = textToEditorHtml(input);
  const editor = makeEditor(html);
  editorsToCleanup.push(editor);
  return editorToText(editor);
}

describe('text round-trip — preserves leading whitespace (the #65 bug class)', () => {
  it('exact regression case: "    test" survives the round trip', () => {
    // The original user report: "if i want 4 spaces before "test" i would
    // do `    test` but when i do this in 12, it is indented all the way
    // left, spaces dont show". Caused by .trim() in editorToText.
    expect(runRoundTrip('    test')).toBe('    test');
  });

  it('SECNAV sub-paragraph indent "   a. Pull-ups: 2" survives', () => {
    expect(runRoundTrip('   a. Pull-ups: 2 (minimum 4 required)')).toBe(
      '   a. Pull-ups: 2 (minimum 4 required)'
    );
  });

  it('multi-paragraph block with adjacent indents survives (no blank line in middle)', () => {
    // Blank-line-in-middle behavior is a separate bug class (TipTap's
    // hardBreak handling). This test pins the case that's most common
    // for SECNAV documents: consecutive sub-paragraphs with no blank.
    const input = [
      '1. On 15 January 2025, you failed to achieve the minimum standards.',
      '   a. Pull-ups: 2 (minimum 4 required)',
      '   b. Crunches: 85',
      '   c. Total Score: 195 (3rd Class, failing)',
    ].join('\n');
    expect(runRoundTrip(input)).toBe(input);
  });

  it('plain text without leading whitespace round-trips', () => {
    expect(runRoundTrip('Hello world')).toBe('Hello world');
  });

  it('empty input round-trips to empty string', () => {
    expect(runRoundTrip('')).toBe('');
  });

  it('trailing whitespace IS stripped (intentional)', () => {
    // The replace is `.replace(/\s+$/, '')` — strips trailing only.
    expect(runRoundTrip('hello   ')).toBe('hello');
  });

  it('any input with no trailing whitespace round-trips losslessly (property)', () => {
    // numRuns capped at 30 — each iteration spins up a real TipTap
    // editor (~50ms with happy-dom), so a higher count blows past
    // vitest's 15s default. The property is highly redundant per call;
    // 30 random inputs is plenty to flag a regression in the round-
    // trip path. The `runs-without-throw` claim is much cheaper to
    // verify and is covered by the focused regression tests above.
    fc.assert(
      fc.property(
        fc
          .stringMatching(/^[A-Za-z0-9 .,;:!?'"()-]{0,80}$/)
          // Forbid trailing whitespace (intentionally stripped) and
          // any HTML-special chars that would tangle with `<p>...</p>`
          // emission. The property is asymptotic: under realistic
          // SECNAV input shapes, what you typed is what you get.
          .filter((s) => !/\s$/.test(s))
          .filter((s) => !/[<>&]/.test(s)),
        (input) => {
          expect(runRoundTrip(input)).toBe(input);
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('text round-trip — rich text marks', () => {
  it('**bold** survives the round trip', () => {
    expect(runRoundTrip('Hello **world**')).toBe('Hello **world**');
  });

  it('*italic* survives', () => {
    expect(runRoundTrip('Hello *world*')).toBe('Hello *world*');
  });

  it('__underline__ survives', () => {
    expect(runRoundTrip('Hello __world__')).toBe('Hello __world__');
  });

  it('mixed marks survive', () => {
    expect(runRoundTrip('**bold** *italic* __under__')).toBe('**bold** *italic* __under__');
  });
});

// Variable-chip round-trip lives in a follow-up: it requires copying
// the `VariableNode` ProseMirror extension definition out of the React
// file (or refactoring the extension into its own module) so the test
// editor can register it. The `.trim()` regression we're chasing here
// is captured by the leading-whitespace tests above; the chip behavior
// is orthogonal.

describe('lineToHtml — pure', () => {
  it('escapes HTML specials', () => {
    expect(lineToHtml('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
  });

  it('preserves underscore runs (fill-in-the-blank lines)', () => {
    // Per issue #14 — the underline pattern uses [^_]+? so a run of
    // raw underscores doesn't get partially consumed.
    expect(lineToHtml('Signature: __________')).toBe('Signature: __________');
  });

  it('converts placeholder name to a span without deps (label === name fallback)', () => {
    const out = lineToHtml('Hello {{UNKNOWN}}');
    expect(out).toContain('data-type="variable"');
    expect(out).toContain('data-name="UNKNOWN"');
    expect(out).toContain('@UNKNOWN');
  });
});

describe('textToEditorHtml — pure', () => {
  it('empty input → "<p><br></p>" (TipTap-friendly empty)', () => {
    expect(textToEditorHtml('')).toBe('<p><br></p>');
  });

  it('single line wraps in <p>', () => {
    expect(textToEditorHtml('hello')).toBe('<p>hello</p>');
  });

  it('newline becomes paragraph break', () => {
    expect(textToEditorHtml('a\nb')).toBe('<p>a</p><p>b</p>');
  });

  it('blank line becomes <p><br></p>', () => {
    expect(textToEditorHtml('a\n\nb')).toBe('<p>a</p><p><br></p><p>b</p>');
  });
});
