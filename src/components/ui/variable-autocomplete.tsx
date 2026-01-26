import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { BATCH_PLACEHOLDERS } from '@/lib/constants';
import { cn } from '@/lib/utils';

// Placeholder type that works with any placeholder list
export interface PlaceholderItem {
  name: string;
  label: string;
  category: string;
  example: string;
}

interface VariableAutocompleteProps {
  inputRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  placeholders?: readonly PlaceholderItem[];  // Custom placeholders (defaults to BATCH_PLACEHOLDERS)
  commonVariables?: string[];  // Custom common variables to show first
}

// Default common variables for correspondence
const DEFAULT_COMMON_VARIABLES = ['NAME_1', 'RANK_1', 'RANK_NAME_1', 'DATE', 'UNIT'];

const categoryIcons: Record<string, string> = {
  '1st Person': '👤',
  '2nd Person': '👥',
  '3rd Person': '👥',
  'Dates': '📅',
  'Contact': '📍',
  'Document': '📄',
  // Form-specific categories
  'Marine': '🎖️',
  'Action': '📋',
  'Unit': '🏢',
  'Entry': '📝',
};

export function useVariableAutocomplete({
  inputRef,
  value,
  onChange,
  placeholders = BATCH_PLACEHOLDERS,
  commonVariables = DEFAULT_COMMON_VARIABLES,
}: VariableAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerPosition, setTriggerPosition] = useState<{ top: number; left: number } | null>(null);
  const [triggerStart, setTriggerStart] = useState<number | null>(null);

  // Filter placeholders based on search
  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase();

    // Get all matching items
    const allMatches = placeholders.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.label.toLowerCase().includes(query) ||
      p.category.toLowerCase().includes(query)
    );

    if (!query) {
      // No search - show common first, then by category
      const common = allMatches.filter(p => commonVariables.includes(p.name));
      const others = allMatches.filter(p => !commonVariables.includes(p.name));
      return { common, others, all: allMatches };
    }

    return { common: [], others: allMatches, all: allMatches };
  }, [searchQuery, placeholders, commonVariables]);

  // Get caret coordinates in textarea
  const getCaretCoordinates = useCallback(() => {
    const input = inputRef.current;
    if (!input) return null;

    const { selectionStart } = input;
    if (selectionStart === null) return null;

    // Create a mirror div to measure text position
    const mirror = document.createElement('div');
    const computed = window.getComputedStyle(input);

    // Copy styles
    mirror.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow: hidden;
      width: ${input.clientWidth}px;
      font-family: ${computed.fontFamily};
      font-size: ${computed.fontSize};
      line-height: ${computed.lineHeight};
      padding: ${computed.padding};
      border: ${computed.border};
    `;

    // Get text up to cursor
    const textBeforeCursor = value.substring(0, selectionStart);
    mirror.textContent = textBeforeCursor;

    // Add a span at cursor position
    const span = document.createElement('span');
    span.textContent = '|';
    mirror.appendChild(span);

    document.body.appendChild(mirror);

    const inputRect = input.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    document.body.removeChild(mirror);

    return {
      top: inputRect.top + (spanRect.top - mirrorRect.top) + input.scrollTop + 20,
      left: inputRect.left + (spanRect.left - mirrorRect.left) - input.scrollLeft,
    };
  }, [inputRef, value]);

  // Check for trigger pattern {{
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const { selectionStart } = input;
    if (selectionStart === null) return;

    const textBeforeCursor = value.substring(0, selectionStart);

    // Find the last {{ that doesn't have a closing }}
    const lastTrigger = textBeforeCursor.lastIndexOf('{{');

    if (lastTrigger !== -1) {
      const textAfterTrigger = textBeforeCursor.substring(lastTrigger + 2);
      const hasClosing = textAfterTrigger.includes('}}');

      if (!hasClosing) {
        // We're in a trigger - extract search query
        setSearchQuery(textAfterTrigger.toUpperCase());
        setTriggerStart(lastTrigger);
        setSelectedIndex(0);

        if (!isOpen) {
          const coords = getCaretCoordinates();
          if (coords) {
            setTriggerPosition(coords);
            setIsOpen(true);
          }
        }
        return;
      }
    }

    // No active trigger
    setIsOpen(false);
    setSearchQuery('');
    setTriggerStart(null);
  }, [value, inputRef, isOpen, getCaretCoordinates]);

  // Insert selected variable
  const insertVariable = useCallback((variableName: string) => {
    const input = inputRef.current;
    if (!input || triggerStart === null) return;

    const { selectionStart } = input;
    if (selectionStart === null) return;

    const before = value.substring(0, triggerStart);
    const after = value.substring(selectionStart);
    const newValue = `${before}{{${variableName}}}${after}`;

    onChange(newValue);
    setIsOpen(false);
    setSearchQuery('');
    setTriggerStart(null);

    // Set cursor position after the inserted variable
    setTimeout(() => {
      const newPos = triggerStart + variableName.length + 4; // {{ + name + }}
      input.setSelectionRange(newPos, newPos);
      input.focus();
    }, 0);
  }, [inputRef, triggerStart, value, onChange]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) return;

    const items = filteredItems.all;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % items.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + items.length) % items.length);
        break;
      case 'Enter':
      case 'Tab':
        if (items.length > 0) {
          e.preventDefault();
          insertVariable(items[selectedIndex].name);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
    }
  }, [isOpen, filteredItems.all, selectedIndex, insertVariable]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = () => setIsOpen(false);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isOpen]);

  return {
    isOpen,
    triggerPosition,
    filteredItems,
    selectedIndex,
    searchQuery,
    handleKeyDown,
    insertVariable,
    setSelectedIndex,
  };
}

interface VariableAutocompletePopupProps {
  isOpen: boolean;
  position: { top: number; left: number } | null;
  filteredItems: {
    common: PlaceholderItem[];
    others: PlaceholderItem[];
    all: PlaceholderItem[];
  };
  selectedIndex: number;
  searchQuery: string;
  onSelect: (name: string) => void;
  onHover: (index: number) => void;
}

export function VariableAutocompletePopup({
  isOpen,
  position,
  filteredItems,
  selectedIndex,
  searchQuery,
  onSelect,
  onHover,
}: VariableAutocompletePopupProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen || !position) return null;

  const { common, others, all } = filteredItems;

  // Group others by category for display
  const othersByCategory = others.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, PlaceholderItem[]>);

  let globalIndex = 0;

  return createPortal(
    <div
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
      style={{
        top: position.top,
        left: Math.min(position.left, window.innerWidth - 320),
        width: '300px',
        maxHeight: '320px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Search indicator */}
      <div className="px-3 py-2 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          <span>
            {searchQuery ? (
              <>Searching: <code className="bg-muted px-1 rounded">{searchQuery}</code></>
            ) : (
              'Type to search variables...'
            )}
          </span>
        </div>
      </div>

      {/* Results */}
      <div ref={listRef} className="overflow-y-auto max-h-[260px]">
        {all.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
            No variables match "{searchQuery}"
          </div>
        ) : (
          <>
            {/* Common variables section */}
            {common.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/30 sticky top-0">
                  ⭐ Common
                </div>
                {common.map((item) => {
                  const idx = globalIndex++;
                  return (
                    <VariableItem
                      key={item.name}
                      item={item}
                      isSelected={selectedIndex === idx}
                      onSelect={() => onSelect(item.name)}
                      onHover={() => onHover(idx)}
                    />
                  );
                })}
              </div>
            )}

            {/* Categorized variables */}
            {Object.entries(othersByCategory).map(([category, items]) => (
              <div key={category}>
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/30 sticky top-0">
                  {categoryIcons[category] || '📋'} {category}
                </div>
                {items.map((item) => {
                  const idx = globalIndex++;
                  return (
                    <VariableItem
                      key={item.name}
                      item={item}
                      isSelected={selectedIndex === idx}
                      onSelect={() => onSelect(item.name)}
                      onHover={() => onHover(idx)}
                    />
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
        <kbd className="px-1 bg-muted rounded">↑↓</kbd> navigate
        <span className="mx-2">·</span>
        <kbd className="px-1 bg-muted rounded">Enter</kbd> select
        <span className="mx-2">·</span>
        <kbd className="px-1 bg-muted rounded">Esc</kbd> close
      </div>
    </div>,
    document.body
  );
}

interface VariableItemProps {
  item: PlaceholderItem;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
}

function VariableItem({ item, isSelected, onSelect, onHover }: VariableItemProps) {
  return (
    <div
      data-selected={isSelected}
      className={cn(
        'px-3 py-2 cursor-pointer flex items-center justify-between gap-2',
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
      )}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium truncate">{item.label}</span>
        <span className="text-xs text-muted-foreground truncate">e.g., {item.example}</span>
      </div>
      <code className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">
        {item.name}
      </code>
    </div>
  );
}

// Wrapper component for Input with variable autocomplete
interface InputWithVariablesProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string;
  onValueChange: (value: string) => void;
  placeholders?: readonly PlaceholderItem[];
  commonVariables?: string[];
}

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function InputWithVariables({
  value,
  onValueChange,
  className,
  placeholders,
  commonVariables,
  ...props
}: InputWithVariablesProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const autocomplete = useVariableAutocomplete({
    inputRef,
    value,
    onChange: onValueChange,
    placeholders,
    commonVariables,
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (autocomplete.isOpen) {
      autocomplete.handleKeyDown(e);
      if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        e.preventDefault();
      }
    }
  };

  return (
    <div className="relative flex-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className={className}
        {...props}
      />
      <VariableAutocompletePopup
        isOpen={autocomplete.isOpen}
        position={autocomplete.triggerPosition}
        filteredItems={autocomplete.filteredItems}
        selectedIndex={autocomplete.selectedIndex}
        searchQuery={autocomplete.searchQuery}
        onSelect={autocomplete.insertVariable}
        onHover={autocomplete.setSelectedIndex}
      />
    </div>
  );
}

// Wrapper component for Textarea with variable autocomplete
interface TextareaWithVariablesProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onValueChange: (value: string) => void;
  placeholders?: readonly PlaceholderItem[];
  commonVariables?: string[];
}

export function TextareaWithVariables({
  value,
  onValueChange,
  className,
  placeholders,
  commonVariables,
  ...props
}: TextareaWithVariablesProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autocomplete = useVariableAutocomplete({
    inputRef: textareaRef,
    value,
    onChange: onValueChange,
    placeholders,
    commonVariables,
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocomplete.isOpen) {
      autocomplete.handleKeyDown(e);
      if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        e.preventDefault();
      }
    }
  };

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className={className}
        {...props}
      />
      <VariableAutocompletePopup
        isOpen={autocomplete.isOpen}
        position={autocomplete.triggerPosition}
        filteredItems={autocomplete.filteredItems}
        selectedIndex={autocomplete.selectedIndex}
        searchQuery={autocomplete.searchQuery}
        onSelect={autocomplete.insertVariable}
        onHover={autocomplete.setSelectedIndex}
      />
    </div>
  );
}
