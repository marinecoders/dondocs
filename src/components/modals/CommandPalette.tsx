import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Search, type LucideIcon } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

export interface CommandItem {
  id: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  kbd?: string;
  onRun: () => void;
}

export interface CommandGroup {
  label: string;
  items: CommandItem[];
}

/**
 * Command palette (⌘K). Generic renderer: jump / create / actions / insert rows
 * grouped under uppercase micro-labels, with keyboard nav. The command list is
 * built by the caller (App) wired to the real Zustand actions. Entrance is
 * transform-only (dd-pop-in) so it can't be left invisible by a throttled clock.
 */
export function CommandPalette({
  open,
  onClose,
  groups,
}: {
  open: boolean;
  onClose: () => void;
  groups: CommandGroup[];
}) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // The parent mounts this only while open (see App), so each open starts from a
  // fresh instance — no reset effect needed. Focus the search input on mount, and
  // restore focus to whatever was focused before (the ⌘K trigger, or the field the
  // user was in) when the palette closes, so keyboard users aren't dropped to body.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      clearTimeout(t);
      previouslyFocused?.focus?.();
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = groups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (it) => !q || it.label.toLowerCase().includes(q) || it.hint?.toLowerCase().includes(q)
      ),
    }))
    .filter((g) => g.items.length > 0);
  const flat = filtered.flatMap((g) => g.items);
  const clampedSel = Math.min(sel, Math.max(0, flat.length - 1));

  // Keep the keyboard-selected row in view when arrowing through a list that
  // overflows the scroll area (otherwise the highlight rides off-screen).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [clampedSel]);

  const run = (it?: CommandItem) => {
    if (it) it.onRun();
    onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(flat[clampedSel]);
    } else if (e.key === 'Tab') {
      // Focus trap: the search input is the only focusable control, and the
      // result rows are navigated via aria-activedescendant (not Tab). Without
      // this, Tab walks focus out of the modal into the app behind the scrim.
      // Keep focus here and let Tab/Shift+Tab move the active row instead.
      e.preventDefault();
      setSel((s) =>
        e.shiftKey ? Math.max(s - 1, 0) : Math.min(s + 1, flat.length - 1)
      );
    }
  };

  const listboxId = 'command-palette-listbox';
  const activeOptionId = flat.length > 0 ? `command-palette-option-${clampedSel}` : undefined;

  if (!open) return null;

  let idx = -1;
  return createPortal(
    <div
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      // Shared modal scrim (.dd-scrim) so the palette backdrop matches every
      // Dialog/AlertDialog overlay instead of using a one-off rgba.
      className="dd-scrim fixed inset-0 z-[200] flex items-start justify-center"
      style={{ paddingTop: '12vh' }}
    >
      <div
        className="dd-anim w-[min(560px,92vw)] overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-elevated"
        style={{ animation: 'dd-pop-in 0.16s cubic-bezier(0.4,0,0.2,1)' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        {/* Search row */}
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
          <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            placeholder="Search documents, actions, references…"
            aria-label="Command search"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            className="flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Kbd>Esc</Kbd>
        </div>

        {/* Results */}
        <div id={listboxId} role="listbox" aria-label="Commands" className="max-h-[380px] overflow-y-auto p-1.5">
          {flat.length === 0 ? (
            <p className="px-3 py-7 text-center text-sm text-muted-foreground">No matches for “{query}”.</p>
          ) : (
            filtered.map((g) => (
              <div key={g.label} className="mb-1">
                <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {g.label}
                </div>
                {g.items.map((it) => {
                  idx += 1;
                  const active = idx === clampedSel;
                  const Icon = it.icon;
                  const flatIndex = flat.indexOf(it);
                  return (
                    <div
                      key={it.id}
                      id={`command-palette-option-${flatIndex}`}
                      ref={active ? activeRef : undefined}
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setSel(flatIndex)}
                      onClick={() => run(it)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2',
                        active ? 'bg-accent text-accent-foreground' : 'text-popover-foreground'
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-current' : 'text-muted-foreground')} />
                      <span className="flex-1 truncate text-sm">{it.label}</span>
                      {it.hint && (
                        <span className={cn('text-[11px]', active ? 'text-current opacity-85' : 'text-muted-foreground')}>
                          {it.hint}
                        </span>
                      )}
                      {it.kbd && <Kbd>{it.kbd}</Kbd>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
