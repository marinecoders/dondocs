import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { Node, mergeAttributes } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { Bold, Italic, Underline as UnderlineIcon, Plus } from 'lucide-react';
import { BATCH_PLACEHOLDERS } from '@/lib/constants';
import { splitPastedParagraphs } from '@/lib/paragraphUtils';
import {
  isVariableSuggestionOpen,
  markVariableSuggestionClosed,
  markVariableSuggestionOpen,
} from './variable-suggestion-state';
import { useDocumentStore } from '@/stores/documentStore';

// Store for custom variables discovered in documents
// This tracks all variables currently in use across the document
const customVariablesStore = new Set<string>();

// Callbacks to notify when we need to rescan document
const documentScanCallbacks: Array<() => string[]> = [];

// Register a callback that returns all text content from a field
export function registerDocumentScanner(callback: () => string[]) {
  documentScanCallbacks.push(callback);
  return () => {
    const index = documentScanCallbacks.indexOf(callback);
    if (index > -1) documentScanCallbacks.splice(index, 1);
  };
}

// Rescan all document content and rebuild custom variables
export function rescanDocumentVariables() {
  const defaultNames: Set<string> = new Set(BATCH_PLACEHOLDERS.map(p => p.name));
  const allTexts = documentScanCallbacks.flatMap(cb => cb());
  const usedVars = new Set<string>();

  allTexts.forEach(text => {
    extractVariablesFromText(text).forEach(v => {
      if (!defaultNames.has(v)) {
        usedVars.add(v);
      }
    });
  });

  // Update the store to only include used variables
  customVariablesStore.clear();
  usedVars.forEach(v => customVariablesStore.add(v));
}

// Add a custom variable to the store (for immediate suggestion)
export function addCustomVariable(name: string) {
  const upperName = name.toUpperCase();
  const defaultNames: Set<string> = new Set(BATCH_PLACEHOLDERS.map(p => p.name));
  if (!defaultNames.has(upperName)) {
    customVariablesStore.add(upperName);
  }
}

// Get all custom variables as VariableItems
function getCustomVariables(): VariableItem[] {
  return Array.from(customVariablesStore).map(name => ({
    name,
    label: name.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
    category: 'Custom',
    example: `Your ${name.toLowerCase().replace(/_/g, ' ')}`,
  }));
}

// Cross-references to the current document's references and enclosures. Selecting
// one inserts the literal "reference (a)" / "enclosure (1)" text the letter uses
// — no token, no pipeline change. Empty in forms mode (those live in formStore),
// so the @ menu naturally scopes these to correspondence.
function getCrossReferenceItems(): VariableItem[] {
  const items: VariableItem[] = [];
  try {
    const { references, enclosures } = useDocumentStore.getState();
    references.forEach((r, i) => {
      const letter = r.letter || String.fromCharCode(97 + i);
      items.push({
        name: `REF_${letter}`,
        label: `Reference (${letter})`,
        category: 'Cross-reference',
        example: (r.title || '').slice(0, 36),
        insertText: `reference (${letter})`,
      });
    });
    enclosures.forEach((e, i) => {
      items.push({
        name: `ENCL_${i + 1}`,
        label: `Enclosure (${i + 1})`,
        category: 'Cross-reference',
        example: (e.title || '').slice(0, 36),
        insertText: `enclosure (${i + 1})`,
      });
    });
  } catch {
    // Store not ready (e.g. SSR) — no cross-refs to offer.
  }
  return items;
}

// Document-field shortcuts for the @ menu: insert the current doc's Date, Unit
// name, Signer, or Subject as literal text. Listed FIRST (matching the design's
// insert list), above cross-references and batch placeholders. Empty fields are
// omitted so the menu only offers what's actually filled in.
function getDocFieldItems(): VariableItem[] {
  const items: VariableItem[] = [];
  try {
    const { formData } = useDocumentStore.getState();
    const signer = [formData.sigFirst, formData.sigMiddle, formData.sigLast]
      .filter(Boolean)
      .join(' ');
    const fields = [
      { name: 'DOC_DATE', label: 'Date', value: formData.date || '' },
      { name: 'DOC_UNIT', label: 'Unit name', value: formData.unitLine1 || '' },
      { name: 'DOC_SIGNER', label: 'Signer', value: signer },
      { name: 'DOC_SUBJECT', label: 'Subject', value: formData.subject || '' },
    ];
    fields.forEach(({ name, label, value }) => {
      if (value.trim()) {
        items.push({
          name,
          label,
          category: 'Document',
          example: value.slice(0, 36),
          insertText: value,
        });
      }
    });
  } catch {
    // Store not ready — no doc fields to offer.
  }
  return items;
}

// Extract variables from text ({{VAR}} or @VAR patterns)
export function extractVariablesFromText(text: string): string[] {
  const vars: string[] = [];
  // Match {{VARIABLE}}
  const braceRegex = /\{\{([A-Za-z0-9_]+)\}\}/g;
  let match;
  while ((match = braceRegex.exec(text)) !== null) {
    vars.push(match[1].toUpperCase());
  }
  return [...new Set(vars)];
}

// Register variables from document text
export function registerVariablesFromDocument(text: string) {
  const defaultNames: Set<string> = new Set(BATCH_PLACEHOLDERS.map(p => p.name));
  const vars = extractVariablesFromText(text);
  vars.forEach(v => {
    if (!defaultNames.has(v)) {
      customVariablesStore.add(v);
    }
  });
}
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Hash, Building2, PenLine, FileText, User, BookOpen, Paperclip, Sparkles,
  Braces, type LucideIcon,
} from 'lucide-react';

// Types
interface VariableItem {
  name: string;
  label: string;
  category: string;
  example: string;
  /** When set, picking this item inserts this literal text instead of a
   *  resolving variable chip (used for reference/enclosure cross-refs). */
  insertText?: string;
}

// Per-item icon for the @ insert menu — gives each row a glyph (icon + name +
// value), matching the design's clean insert list.
function iconForItem(item: VariableItem): LucideIcon {
  if (item.insertText?.startsWith('reference')) return BookOpen;
  if (item.insertText?.startsWith('enclosure')) return Paperclip;
  const n = item.name.toUpperCase();
  if (n.includes('DATE')) return Hash;
  if (n.includes('UNIT') || n.includes('COMMAND')) return Building2;
  if (n.includes('SIGN')) return PenLine;
  if (n.includes('SUBJECT')) return FileText;
  if (n.includes('NAME') || n.includes('RANK') || n.includes('TITLE') || n.includes('POC')) return User;
  if (item.category === 'Custom') return Sparkles;
  return Braces;
}

// Custom Variable Node Extension
const VariableNode = Node.create({
  name: 'variable',
  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: element => element.getAttribute('data-name'),
        renderHTML: attributes => ({
          'data-name': attributes.name,
        }),
      },
      label: {
        default: null,
        parseHTML: element => element.getAttribute('data-label'),
        renderHTML: attributes => ({
          'data-label': attributes.label,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="variable"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'variable',
        class: 'variable-chip',
      }),
      `@${node.attrs.label || node.attrs.name}`,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      // Build the chip via DOM APIs rather than innerHTML. node.attrs.label and
      // node.attrs.name are user-controlled (custom variable names and labels
      // flow through here), so interpolating them into an HTML string was an
      // XSS sink — e.g. a variable label of `<img src=x onerror=...>` would
      // execute. textContent escapes automatically. Closes GH #16.
      const span = document.createElement('span');
      span.className = 'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-sm font-medium';
      span.contentEditable = 'false';
      span.setAttribute('data-type', 'variable');
      span.setAttribute('data-name', node.attrs.name);

      const at = document.createElement('span');
      at.className = 'text-blue-500 dark:text-blue-400';
      at.textContent = '@';
      span.appendChild(at);
      span.appendChild(document.createTextNode(node.attrs.label || node.attrs.name));

      return { dom: span };
    };
  },
});

// Suggestion list component
interface SuggestionListProps {
  items: VariableItem[];
  command: (item: VariableItem) => void;
  query: string;
}

interface SuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const SuggestionList = forwardRef<SuggestionListRef, SuggestionListProps>(
  ({ items, command, query }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    // Reset selection to 0 whenever `items` changes (e.g. user keeps typing
    // and the autocomplete narrows). Done via the React-recommended "store-
    // previous-value-and-compare" pattern during render rather than a
    // useEffect, which avoids the set-state-in-effect cascading-render
    // warning. The setState during render is OK here because it only fires
    // on the items-changed transition, not every render.
    const [prevItems, setPrevItems] = useState(items);
    if (items !== prevItems) {
      setPrevItems(items);
      setSelectedIndex(0);
    }

    const selectItem = useCallback((index: number) => {
      const item = items[index];
      if (item) command(item);
    }, [items, command]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }), [items.length, selectItem, selectedIndex]);

    // If no matches and user typed something, offer to create custom variable
    if (items.length === 0 && query.trim()) {
      const customName = query.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      const customItem: VariableItem = {
        name: customName,
        label: customName.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
        category: 'Custom',
        example: `Your custom value`,
      };

      return (
        <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden w-[280px]">
          <div className="px-3 py-2 border-b border-border bg-muted/50">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-base font-medium text-blue-500">@</span>
              <span>Create new variable</span>
            </div>
          </div>
          <div
            className="px-3 py-3 cursor-pointer hover:bg-accent flex items-center gap-3"
            onClick={() => {
              addCustomVariable(customName);
              command(customItem);
            }}
          >
            <div className="w-8 h-8 rounded-full bg-success/15 dark:bg-success/25 flex items-center justify-center text-success text-lg">
              +
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">Create @{customName}</div>
              <div className="text-xs text-muted-foreground">Press Enter to create this custom variable</div>
            </div>
          </div>
          <div className="px-3 py-1.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
            <kbd className="px-1 bg-muted rounded">Enter</kbd> create variable
          </div>
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden w-[280px]">
          <div className="px-3 py-3 text-sm text-muted-foreground text-center">
            Type a variable name...
          </div>
        </div>
      );
    }

    return (
      <div className="bg-popover text-popover-foreground border border-border rounded-lg shadow-md overflow-hidden w-[300px]">
        <div className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Insert
        </div>
        <div className="max-h-[280px] overflow-y-auto px-1 pb-1.5" role="listbox" aria-label="Insert variable">
          {items.map((item, idx) => {
            const Icon = iconForItem(item);
            const active = idx === selectedIndex;
            return (
              <button
                type="button"
                key={item.name}
                role="option"
                aria-selected={active}
                className={cn(
                  'w-full text-left rounded-md px-2 py-1.5 flex items-center gap-2.5 transition-colors',
                  active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60'
                )}
                onClick={() => selectItem(idx)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <Icon
                  className={cn('h-4 w-4 shrink-0', active ? 'text-accent-foreground' : 'text-muted-foreground')}
                  aria-hidden
                />
                <span className="flex-1 truncate text-sm font-medium">{item.label}</span>
                {item.example && (
                  <span
                    className={cn(
                      'shrink-0 max-w-[44%] truncate text-xs',
                      active ? 'text-accent-foreground/70' : 'text-muted-foreground'
                    )}
                  >
                    {item.example}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
);
SuggestionList.displayName = 'SuggestionList';

// Variable extension with suggestion
const VariableExtension = VariableNode.extend({
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '@',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => {
          const q = query.toLowerCase();

          // Doc-field shortcuts (Date/Unit/Signer/Subject) first, then cross-refs,
          // then custom variables, then the default batch placeholders — matching
          // the design's @ insert list.
          const customVars = getCustomVariables();
          const allVars: VariableItem[] = [
            ...getDocFieldItems(),
            ...getCrossReferenceItems(),
            ...customVars,
            ...BATCH_PLACEHOLDERS.map(p => ({ ...p })),
          ];

          // Filter and deduplicate by name AND label — a doc-field shortcut
          // (e.g. DOC_DATE "Date") and a batch placeholder (DATE "Date") have
          // different names but the same label; without the label dedup the menu
          // shows two identically-labelled rows. Doc-fields come first, so they win.
          const seen = new Set<string>();
          const seenLabels = new Set<string>();
          const filtered = allVars.filter((item) => {
            const lk = item.label.toLowerCase();
            if (seen.has(item.name) || seenLabels.has(lk)) return false;
            seen.add(item.name);
            seenLabels.add(lk);
            return (
              item.name.toLowerCase().includes(q) ||
              item.label.toLowerCase().includes(q) ||
              item.category.toLowerCase().includes(q)
            );
          });

          return filtered.slice(0, 15);
        },
        command: ({ editor, range, props }) => {
          // Cross-reference items insert literal text ("reference (a)"), not a
          // resolving variable chip.
          if (props.insertText) {
            editor.chain().focus().deleteRange(range).insertContent(`${props.insertText} `).run();
            return;
          }

          // Register the variable as custom (in case it's new)
          addCustomVariable(props.name);

          // Delete the trigger text (@query) and insert the variable node
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: 'variable',
              attrs: { name: props.name, label: props.label },
            })
            .run();
        },
        render: () => {
          let component: ReactRenderer<SuggestionListRef>;
          let popup: TippyInstance[];

          return {
            onStart: (props) => {
              markVariableSuggestionOpen();
              component = new ReactRenderer(SuggestionList, {
                props: { items: props.items, command: props.command, query: props.query },
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              });
            },
            onUpdate: (props) => {
              component.updateProps({ items: props.items, command: props.command, query: props.query });
              if (props.clientRect) {
                popup[0].setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
              }
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                popup[0].hide();
                return true;
              }
              return component.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              markVariableSuggestionClosed();
              popup[0].destroy();
              component.destroy();
            },
          };
        },
      }),
    ];
  },
});

// Pure text/HTML converters live in a sibling module so they can be
// property-tested in isolation. The production component wires them up
// with the customVariables store via the `deps` callbacks.
import {
  editorToText as editorToTextPure,
  textToEditorHtml as textToEditorHtmlPure,
} from './variable-chip-editor-text';

const editorToText = editorToTextPure;
const textToEditorHtml = (text: string) =>
  textToEditorHtmlPure(text, { getCustomVariables, addCustomVariable });

// Formatting toolbar for the editor
interface EditorToolbarProps {
  editor: ReturnType<typeof useEditor>;
}

function EditorToolbar({ editor }: EditorToolbarProps) {
  if (!editor) return null;

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-muted/30">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cn('h-7 w-7 p-0', editor.isActive('bold') && 'bg-primary/15 text-primary')}
        title="Bold (Ctrl+B)"
      >
        <Bold className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cn('h-7 w-7 p-0', editor.isActive('italic') && 'bg-primary/15 text-primary')}
        title="Italic (Ctrl+I)"
      >
        <Italic className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={cn('h-7 w-7 p-0', editor.isActive('underline') && 'bg-primary/15 text-primary')}
        title="Underline (Ctrl+U)"
      >
        <UnderlineIcon className="h-4 w-4" />
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          // Insert @ character to trigger the suggestion popup
          editor.chain().focus().insertContent('@').run();
        }}
        className="h-7 w-7 p-0"
        title="Insert Variable"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Main editor component
interface VariableChipEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  /**
   * If true, pressing Tab inserts 4 literal spaces (matching the SECNAV
   * 0.25" sub-paragraph indent and the wrap helper's TAB_AS_SPACES
   * constant). Used by NAVMC 10274 / 118-11 form fields where users need
   * to indent SECNAV-style sub-paragraphs directly in the textarea.
   *
   * Defaults to false so other consumers (e.g. correspondence body
   * paragraphs in BlockParagraphsEditor, where indentation is controlled by
   * `paragraph.level` rather than leading whitespace) keep the browser's
   * native Tab → focus-next-element behavior. Without this gate, every
   * VariableChipEditor in the app would swallow Tab, breaking keyboard
   * navigation everywhere.
   */
  tabInsertsSpaces?: boolean;
  /**
   * Block-editor mode: renders the editor borderless and toolbar-less (one row
   * in a flowing list) and routes structural keys to the callbacks below so the
   * parent BlockParagraphsEditor owns ⏎ new · ⇥/⇧⇥ nest · ⌫ merge · ⌘↑↓ move.
   * Off by default, so existing form-field usages are unchanged.
   */
  blockMode?: boolean;
  /** Focus this editor (caret at end) when it mounts — used for new blocks. */
  autoFocus?: boolean;
  /** Enter (no Shift) with the @-menu closed. */
  onEnterBlock?: () => void;
  /** Tab. */
  onIndentBlock?: () => void;
  /** Shift+Tab. */
  onOutdentBlock?: () => void;
  /** Backspace with the caret at the very start. Return true if consumed. */
  onBackspaceAtStart?: () => boolean;
  /** Cmd/Ctrl + ArrowUp / ArrowDown. */
  onMoveBlock?: (dir: -1 | 1) => void;
  /** Pasting multi-paragraph text: the parent splits it into real blocks
   *  instead of dumping one blob. Given the pre-split segments. */
  onSplitPaste?: (segments: string[]) => void;
}

export function VariableChipEditor({
  value,
  onChange,
  placeholder = 'Type @ to insert variables...',
  className,
  rows = 3,
  tabInsertsSpaces = false,
  blockMode = false,
  autoFocus = false,
  onEnterBlock,
  onIndentBlock,
  onOutdentBlock,
  onBackspaceAtStart,
  onMoveBlock,
  onSplitPaste,
}: VariableChipEditorProps) {
  const [isFocused, setIsFocused] = useState(false);
  // Floating B/I/U toolbar position when text is selected in block mode.
  const [selBox, setSelBox] = useState<{ top: number; left: number } | null>(null);
  const lastValue = useRef(value);
  const currentValue = useRef(value);

  // Keep current value ref updated
  useEffect(() => {
    currentValue.current = value;
  }, [value]);

  // Register this editor as a document scanner
  useEffect(() => {
    const unregister = registerDocumentScanner(() => [currentValue.current]);
    return unregister;
  }, []);

  // Latest block-nav handlers, read inside the (created-once) editor keydown
  // handler so it never closes over stale callbacks.
  const blockHandlersRef = useRef({
    blockMode,
    onEnterBlock,
    onIndentBlock,
    onOutdentBlock,
    onBackspaceAtStart,
    onMoveBlock,
    onSplitPaste,
  });
  useEffect(() => {
    blockHandlersRef.current = {
      blockMode,
      onEnterBlock,
      onIndentBlock,
      onOutdentBlock,
      onBackspaceAtStart,
      onMoveBlock,
      onSplitPaste,
    };
  });

  const editor = useEditor({
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
      Underline,
      VariableExtension,
    ],
    content: textToEditorHtml(value),
    // Preserve consecutive whitespace through HTML parsing. ProseMirror's
    // default parser uses HTML's "normal" whitespace rules — runs of
    // spaces collapse to a single space — which would drop SECNAV-style
    // sub-paragraph indents like "    a. ..." back to "a. ..." every
    // time the editor reloads its content from the form store. With
    // preserveWhitespace: 'full', the spaces survive parsing both for
    // initial content and for `setContent` calls in the value-sync
    // useEffect below.
    parseOptions: { preserveWhitespace: 'full' },
    editorProps: {
      attributes: {
        // `whitespace-pre-wrap` overrides Tailwind's `prose` default
        // (white-space: normal) so multiple spaces typed by the user —
        // both via the Space key and via the Tab handler below — render
        // literally instead of collapsing to a single space. The PDF
        // generator already preserves them; this just keeps the editor
        // visually faithful to what gets generated.
        class: blockMode
          ? 'focus:outline-none whitespace-pre-wrap text-sm leading-relaxed'
          : 'prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-2 whitespace-pre-wrap',
        style: blockMode ? 'min-height: 1.5em' : `min-height: ${rows * 24}px`,
      },
      // Tab key inserts 4 spaces (matching the SECNAV 0.25" / wrap-helper
      // `TAB_AS_SPACES` convention) so users can indent sub-paragraphs
      // directly in Field 12 / 13 / Page-11 entries instead of having to
      // type four spaces or paste pre-formatted text. Shift+Tab is left
      // to its default (move focus to previous field) so keyboard
      // navigation still works for getting out of the editor.
      //
      // Gated behind `tabInsertsSpaces` so consumers that DON'T want this
      // (e.g. correspondence body paragraphs, where indentation is
      // already handled via `paragraph.level`) keep Tab → focus-next-
      // element. Without this gate, the shared component would swallow
      // Tab in every editor instance, breaking keyboard navigation in
      // the SECNAV correspondence flow.
      // Pasting a multi-paragraph draft (Word/Outlook/email) in block mode
      // splits into real blocks instead of dumping one blob. A single-paragraph
      // paste falls through to TipTap's default handling.
      handlePaste(_view, event) {
        const bh = blockHandlersRef.current;
        if (!bh.blockMode || !bh.onSplitPaste) return false;
        const text = event.clipboardData?.getData('text/plain') ?? '';
        const segments = splitPastedParagraphs(text);
        if (segments.length <= 1) return false;
        event.preventDefault();
        bh.onSplitPaste(segments);
        return true;
      },
      handleKeyDown(view, event) {
        const bh = blockHandlersRef.current;
        if (bh.blockMode) {
          // Enter (no Shift) → new block, UNLESS the @-variable menu is open, in
          // which case Enter belongs to the menu (pick the highlighted variable).
          if (event.key === 'Enter' && !event.shiftKey) {
            if (isVariableSuggestionOpen()) return false;
            event.preventDefault();
            bh.onEnterBlock?.();
            return true;
          }
          // Tab indents / Shift+Tab outdents — but ONLY when indent is enabled for
          // this doc type. When the handlers are absent (compliant business letter,
          // endorsement, executive memo: numberedParagraphs=false), let Tab fall
          // through to the browser's native focus move instead of swallowing it,
          // otherwise the editor becomes a keyboard trap (WCAG 2.1.2).
          if (event.key === 'Tab' && !event.shiftKey) {
            if (!bh.onIndentBlock) return false;
            event.preventDefault();
            bh.onIndentBlock();
            return true;
          }
          if (event.key === 'Tab' && event.shiftKey) {
            if (!bh.onOutdentBlock) return false;
            event.preventDefault();
            bh.onOutdentBlock();
            return true;
          }
          // Backspace at the very start of the block → merge into the previous
          // block (handled by the parent). pos 1 is the caret at the start of the
          // first paragraph node.
          if (event.key === 'Backspace' && bh.onBackspaceAtStart) {
            const { empty, $from } = view.state.selection;
            if (empty && $from.pos === 1 && bh.onBackspaceAtStart()) {
              event.preventDefault();
              return true;
            }
          }
          if ((event.metaKey || event.ctrlKey) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            bh.onMoveBlock?.(event.key === 'ArrowUp' ? -1 : 1);
            return true;
          }
        }
        if (
          tabInsertsSpaces &&
          event.key === 'Tab' &&
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          view.dispatch(view.state.tr.insertText('    '));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const text = editorToText(editor);
      lastValue.current = text;
      currentValue.current = text;
      onChange(text);
      // Rescan document to update custom variables (debounced via React batching)
      rescanDocumentVariables();
    },
    onFocus: () => setIsFocused(true),
    onBlur: () => {
      setIsFocused(false);
      // Delay so a mousedown on the floating toolbar lands before it hides.
      setTimeout(() => setSelBox(null), 150);
    },
    // Block mode: surface a small B/I/U toolbar over a non-empty selection.
    onSelectionUpdate: ({ editor }) => {
      if (!blockMode) return;
      if (editor.state.selection.empty) {
        setSelBox(null);
        return;
      }
      const sel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (!sel || sel.rangeCount === 0) {
        setSelBox(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSelBox(null);
        return;
      }
      setSelBox({ top: rect.top, left: rect.left + rect.width / 2 });
    },
  });

  // Sync external value changes
  useEffect(() => {
    if (!editor || value === lastValue.current) return;
    lastValue.current = value;
    currentValue.current = value;
    // Same `preserveWhitespace: 'full'` as the initial parseOptions —
    // setContent uses its own parse pass, so the option must be passed
    // here too or every store-driven re-render would drop leading
    // whitespace from sub-paragraphs.
    editor.commands.setContent(textToEditorHtml(value), {
      parseOptions: { preserveWhitespace: 'full' },
    });
  }, [value, editor]);

  // Register any variables found in the initial value
  useEffect(() => {
    if (value) {
      registerVariablesFromDocument(value);
    }
  }, [value]);

  // Focus a freshly-mounted block (caret at end) when the parent requests it.
  useEffect(() => {
    if (autoFocus && editor) {
      editor.commands.focus('end');
    }
  }, [autoFocus, editor]);

  // Block mode renders the editor bare — no border box, no toolbar — so a list
  // of these reads as one flowing document. Bold/italic/underline stay available
  // via Ctrl/⌘+B/I/U (StarterKit/Underline keymaps); @ inserts variables.
  if (blockMode) {
    const fmtBtns: { cmd: 'bold' | 'italic' | 'underline'; glyph: string; cls: string }[] = [
      { cmd: 'bold', glyph: 'B', cls: 'font-bold' },
      { cmd: 'italic', glyph: 'I', cls: 'italic' },
      { cmd: 'underline', glyph: 'U', cls: 'underline' },
    ];
    return (
      <div className={cn('relative', className)}>
        <EditorContent editor={editor} />
        {editor?.isEmpty && !isFocused && (
          <div className="absolute top-0 left-0 text-muted-foreground pointer-events-none text-sm">
            {placeholder}
          </div>
        )}
        {selBox &&
          editor &&
          createPortal(
            <div
              role="toolbar"
              aria-label="Text formatting"
              onMouseDown={(e) => e.preventDefault()}
              style={{ position: 'fixed', top: selBox.top - 8, left: selBox.left, transform: 'translate(-50%, -100%)', zIndex: 60 }}
              className="flex gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-elevated"
            >
              {fmtBtns.map(({ cmd, glyph, cls }) => (
                <button
                  key={cmd}
                  type="button"
                  aria-label={cmd}
                  aria-pressed={editor.isActive(cmd)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (cmd === 'bold') editor.chain().focus().toggleBold().run();
                    else if (cmd === 'italic') editor.chain().focus().toggleItalic().run();
                    else editor.chain().focus().toggleUnderline().run();
                  }}
                  className={cn(
                    'grid h-7 w-7 place-items-center rounded text-sm transition-colors hover:bg-muted',
                    cls,
                    editor.isActive(cmd) ? 'bg-accent text-accent-foreground' : 'text-foreground'
                  )}
                >
                  {glyph}
                </button>
              ))}
            </div>,
            document.body
          )}
      </div>
    );
  }

  return (
    <div className={cn(
      'relative border rounded-md bg-background transition-colors overflow-hidden',
      isFocused ? 'ring-2 ring-ring ring-offset-2' : 'border-input',
      className
    )}>
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
      {editor?.isEmpty && !isFocused && (
        <div className="absolute top-10 left-3 text-muted-foreground pointer-events-none text-sm">
          {placeholder}
        </div>
      )}
    </div>
  );
}
