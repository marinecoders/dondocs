/**
 * Regression for the editor `.trim()` bug discovered during PR #65.
 *
 * Issue: https://github.com/marinecoders/dondocs/pull/65 (commit 6fb8667)
 *
 * Pre-fix failure mode: typing "    test" (4 spaces + "test") in NAVMC
 * Field 12 showed up in the editor against the left edge — the leading
 * spaces were silently deleted on every onUpdate. The user reported it
 * directly: "no i mean like for example in 12. if i want 4 spaces before
 * 'test' i would do `    test` but when i do this in 12, it is indented
 * all the way left, spaces dont show".
 *
 * Two layers were broken:
 *   1. `editorToText` ended with `.trim()` which stripped both leading
 *      AND trailing whitespace from the joined paragraph block on every
 *      keystroke. The fix replaced it with `.replace(/\s+$/, '')` —
 *      strip trailing only.
 *   2. ProseMirror's HTML parser collapsed runs of spaces inside `<p>...
 *      </p>` per HTML's "normal" whitespace rules. The fix added
 *      `parseOptions: { preserveWhitespace: 'full' }` to both the
 *      initial `useEditor({...})` and the value-sync `setContent` call.
 *
 * Both fixes are exercised by the round-trip property test in
 * `tests/unit/variable-chip-editor-text.property.test.ts`. This file
 * pins down the canonical user-reported repro as a permanent canary —
 * even if the property suite is later weakened or the editor pipeline
 * is refactored, this case must keep passing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  editorToText,
  textToEditorHtml,
} from '@/components/ui/variable-chip-editor-text';

const editorsToCleanup: Editor[] = [];

afterEach(() => {
  while (editorsToCleanup.length > 0) {
    const editor = editorsToCleanup.pop()!;
    editor.destroy();
  }
  document.body.innerHTML = '';
});

function roundTrip(input: string): string {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
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
    content: textToEditorHtml(input),
    parseOptions: { preserveWhitespace: 'full' },
  });
  editorsToCleanup.push(editor);
  return editorToText(editor);
}

describe('regression #65 — editor .trim() strips leading whitespace', () => {
  it('exact user report: "    test" round-trips with all 4 leading spaces intact', () => {
    expect(roundTrip('    test')).toBe('    test');
  });

  it('SECNAV sub-paragraph indent "   a. Pull-ups: 2" round-trips', () => {
    expect(roundTrip('   a. Pull-ups: 2 (minimum 4 required)')).toBe(
      '   a. Pull-ups: 2 (minimum 4 required)'
    );
  });

  it('tab-indented sub-paragraph (whitespace preserved literally)', () => {
    // The Tab key in the production editor inserts 4 spaces (not a tab
    // character) per `tabInsertsSpaces` in PR #65 commit adacac8. This
    // pins the post-Tab content shape.
    expect(roundTrip('    a. Sub-paragraph')).toBe('    a. Sub-paragraph');
  });
});
