import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { Node, mergeAttributes } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useState, useCallback, useRef } from 'react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { Bold, Italic, Underline as UnderlineIcon, Plus } from 'lucide-react';
import { BATCH_PLACEHOLDERS } from '@/lib/constants';

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

// Types
interface VariableItem {
  name: string;
  label: string;
  category: string;
  example: string;
}

// Category icons
const categoryIcons: Record<string, string> = {
  'Custom': '✨',
  'Examples': '💡',
  '1st Person': '👤',
  '2nd Person': '👥',
  '3rd Person': '👥',
  'Dates': '📅',
  'Contact': '📍',
  'Document': '📄',
};

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

    useEffect(() => setSelectedIndex(0), [items]);

    // Group by category
    const grouped = items.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {} as Record<string, VariableItem[]>);

    let globalIndex = 0;

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
            <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400 text-lg">
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
      <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden w-[280px]">
        <div className="px-3 py-2 border-b border-border bg-muted/50">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-base font-medium text-blue-500">@</span>
            <span>{query ? <>Searching: <code className="bg-muted px-1 rounded">{query}</code></> : 'Insert variable...'}</span>
          </div>
        </div>
        <div className="max-h-[240px] overflow-y-auto">
          {Object.entries(grouped).map(([category, categoryItems]) => (
            <div key={category}>
              <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/30 sticky top-0">
                {categoryIcons[category] || '📋'} {category}
              </div>
              {categoryItems.map((item) => {
                const idx = globalIndex++;
                return (
                  <div
                    key={item.name}
                    className={cn(
                      'px-3 py-2 cursor-pointer flex items-center justify-between gap-2',
                      selectedIndex === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
                    )}
                    onClick={() => selectItem(idx)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate">{item.label}</span>
                      <span className="text-xs text-muted-foreground truncate">e.g., {item.example}</span>
                    </div>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">{item.name}</code>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="px-3 py-1.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
          <kbd className="px-1 bg-muted rounded">↑↓</kbd> navigate · <kbd className="px-1 bg-muted rounded">Enter</kbd> select
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

          // Combine default placeholders with custom variables
          const customVars = getCustomVariables();
          const allVars: VariableItem[] = [
            ...customVars,
            ...BATCH_PLACEHOLDERS.map(p => ({ ...p })),
          ];

          // Filter and deduplicate by name
          const seen = new Set<string>();
          const filtered = allVars.filter((item) => {
            if (seen.has(item.name)) return false;
            seen.add(item.name);
            return (
              item.name.toLowerCase().includes(q) ||
              item.label.toLowerCase().includes(q) ||
              item.category.toLowerCase().includes(q)
            );
          });

          return filtered.slice(0, 15);
        },
        command: ({ editor, range, props }) => {
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
              popup[0].destroy();
              component.destroy();
            },
          };
        },
      }),
    ];
  },
});

// Convert editor content to {{VARIABLE}} text format with LaTeX formatting
// Each ProseMirror paragraph becomes a line separated by \n
function editorToText(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return '';
  const paragraphs: string[] = [];

  // Iterate over top-level paragraph nodes
  editor.state.doc.forEach((paragraphNode) => {
    let paraText = '';

    paragraphNode.forEach((child) => {
      if (child.type.name === 'variable') {
        paraText += `{{${child.attrs.name}}}`;
      } else if (child.type.name === 'hardBreak') {
        paraText += '\n';
      } else if (child.isText && child.text) {
        let text = child.text;
        // Apply markdown-style formatting markers
        // processBodyText() expects these markers and converts them to LaTeX
        const marks = child.marks;
        const hasBold = marks.some(m => m.type.name === 'bold');
        const hasItalic = marks.some(m => m.type.name === 'italic');
        const hasUnderline = marks.some(m => m.type.name === 'underline');

        if (hasBold) text = `**${text}**`;
        if (hasItalic) text = `*${text}*`;
        if (hasUnderline) text = `__${text}__`;

        paraText += text;
      }
    });

    paragraphs.push(paraText);
  });

  return paragraphs.join('\n').trim();
}

// Convert a single line of text to HTML (escaping, LaTeX formatting, variables)
function lineToHtml(line: string): string {
  let html = line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert markdown formatting to HTML
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/__(.+?)__/g, '<u>$1</u>');

  // Also support legacy LaTeX formatting for backward compatibility
  html = html.replace(/\\textbf\{([^{}]*)\}/g, '<strong>$1</strong>');
  html = html.replace(/\\textit\{([^{}]*)\}/g, '<em>$1</em>');
  html = html.replace(/\\underline\{([^{}]*)\}/g, '<u>$1</u>');

  // Convert variables to spans - check both default and custom variables
  html = html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, name) => {
    const placeholder = BATCH_PLACEHOLDERS.find(p => p.name === name);
    const customVars = getCustomVariables();
    const customVar = customVars.find(p => p.name === name);
    const label = placeholder?.label || customVar?.label || name;
    // Register the variable in case it's new
    addCustomVariable(name);
    return `<span data-type="variable" data-name="${name}" data-label="${label}">@${label}</span>`;
  });

  return html;
}

// Convert {{VARIABLE}} text with LaTeX formatting to editor HTML content
// Each \n in the text becomes a separate <p> tag so Tiptap preserves line structure
function textToEditorHtml(text: string): string {
  if (!text) return '<p><br></p>';

  const lines = text.split('\n');
  return lines
    .map(line => `<p>${lineToHtml(line) || '<br>'}</p>`)
    .join('');
}

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
        className={cn('h-7 w-7 p-0', editor.isActive('bold') && 'bg-accent')}
        title="Bold (Ctrl+B)"
      >
        <Bold className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cn('h-7 w-7 p-0', editor.isActive('italic') && 'bg-accent')}
        title="Italic (Ctrl+I)"
      >
        <Italic className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={cn('h-7 w-7 p-0', editor.isActive('underline') && 'bg-accent')}
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
}

export function VariableChipEditor({
  value,
  onChange,
  placeholder = 'Type @ to insert variables...',
  className,
  rows = 3,
}: VariableChipEditorProps) {
  const [isFocused, setIsFocused] = useState(false);
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
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-2',
        style: `min-height: ${rows * 24}px`,
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
    onBlur: () => setIsFocused(false),
  });

  // Sync external value changes
  useEffect(() => {
    if (!editor || value === lastValue.current) return;
    lastValue.current = value;
    currentValue.current = value;
    editor.commands.setContent(textToEditorHtml(value));
  }, [value, editor]);

  // Register any variables found in the initial value
  useEffect(() => {
    if (value) {
      registerVariablesFromDocument(value);
    }
  }, [value]);

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
