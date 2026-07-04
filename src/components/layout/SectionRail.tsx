import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { EditorSection } from './editorSections';

/**
 * Section outline for the document form. Lists the current doc type's sections
 * in order and jumps to any of them; the in-view section is highlighted (via
 * FormPanel's scroll-spy). No progress or completion indicators.
 *
 * A single scarlet indicator bar slides to the vertical center of the active
 * row (transform transition) instead of each row painting its own accent, so
 * the rail reads as one quiet marker rather than a stack of fills.
 *
 * Renders as a bare list so the editor sidebar can embed it; the sidebar owns
 * the surrounding chrome.
 */
export function SectionRail({
  sections,
  activeId,
  errorIds,
  onJump,
}: {
  sections: EditorSection[];
  activeId: string | null;
  errorIds?: Set<string>;
  onJump: (id: string) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  // Vertical offset (px) for the sliding indicator, or null when no row is
  // active (nothing to point at, so the bar stays hidden).
  const [indicatorTop, setIndicatorTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const el = nav.querySelector<HTMLElement>(`[data-sec="${activeId}"]`);
    setIndicatorTop(el ? el.offsetTop + (el.offsetHeight - 16) / 2 : null);
  }, [activeId, sections]);

  return (
    <nav ref={navRef} aria-label="Document sections" className="relative">
      {/* Single sliding scarlet indicator — one bar that translates to the
          active row's center rather than a per-row accent. */}
      {indicatorTop !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 h-4 w-[3px] rounded-r-[3px] bg-primary transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ transform: `translateY(${indicatorTop}px)` }}
        />
      )}
      <ul className="space-y-0.5">
        {sections.map((s) => {
          const active = s.id === activeId;
          const hasError = errorIds?.has(s.id) ?? false;
          return (
            <li key={s.id}>
              <button
                type="button"
                data-sec={s.id}
                onClick={() => onJump(s.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active
                    ? 'font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                {s.icon && <s.icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {hasError && (
                  <>
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
                      aria-hidden="true"
                    />
                    <span className="sr-only">needs attention</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
