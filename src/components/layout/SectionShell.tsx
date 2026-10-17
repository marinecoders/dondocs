import { useVisibleEditorSection } from './EditorSectionContext';
import { memo, type ReactNode } from 'react';

/**
 * Keep inactive sections mounted, preserving field and editor state while
 * removing them from display and keyboard navigation. The anchor is also the
 * focus destination for Contents, search results, and validation jumps.
 */
export const SectionShell = memo(function SectionShell({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const visible = useVisibleEditorSection();
  return (
    <div
      hidden={visible !== null && visible !== id}
      id={`sec-${id}`}
      data-section={id}
      tabIndex={-1}
      style={{ scrollMarginTop: 12 }}
      className="outline-none"
    >
      {children}
    </div>
  );
});
