import { memo, type ReactNode } from 'react';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';

/**
 * One editor-section wrapper: provides the scroll-spy anchor (`#sec-<id>`), the
 * keyboard-focus target, and the sliding active left-rule. Memoized and
 * subscribed to its own active state so scrolling — which republishes the active
 * id on every section boundary — only re-renders the entering and leaving
 * wrappers, not every section. The section content is passed as children so its
 * element identity stays stable across the border toggle.
 *
 * Shared by FormPanel (correspondence sections) and the NAVMC form editors so
 * letters, memos, and forms all get the same active highlight.
 */
export const SectionShell = memo(function SectionShell({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const active = useEditorOutlineStore((s) => s.activeId === id);
  return (
    <div
      id={`sec-${id}`}
      data-section={id}
      tabIndex={-1}
      style={{ scrollMarginTop: 12 }}
      className={`px-3 -mx-3 border-l-2 outline-none transition-colors duration-200 ${
        active ? 'border-muted-foreground/30' : 'border-transparent'
      }`}
    >
      {children}
    </div>
  );
});
