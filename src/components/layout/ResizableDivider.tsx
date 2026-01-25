import { useCallback, useEffect, useState } from 'react';
import { GripVertical } from 'lucide-react';

interface ResizableDividerProps {
  onResize: (percentage: number) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  currentWidth: number;
}

export function ResizableDivider({ onResize, containerRef, currentWidth }: ResizableDividerProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      e.preventDefault();

      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const mouseX = e.clientX - containerRect.left;

      // Calculate percentage for the form panel (left side)
      const formPercentage = (mouseX / containerWidth) * 100;

      // Preview percentage is the remaining space
      const previewPercentage = 100 - formPercentage;

      // Clamp between 20% and 80%
      const clampedPreviewPercentage = Math.max(20, Math.min(80, previewPercentage));

      onResize(clampedPreviewPercentage);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    // Set cursor on body while dragging
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onResize, containerRef]);

  return (
    <>
      {/* Full-screen overlay while dragging to capture mouse events over iframes */}
      {isDragging && (
        <div
          className="fixed inset-0 z-50 cursor-col-resize"
          style={{ background: 'transparent' }}
        />
      )}
      <div
        onMouseDown={handleMouseDown}
        className="relative flex-shrink-0 cursor-col-resize group"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview panel. Drag left or right to resize."
        tabIndex={0}
        onKeyDown={(e) => {
          // Allow keyboard resizing with arrow keys
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            onResize(Math.min(80, currentWidth + 5));
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            onResize(Math.max(20, currentWidth - 5));
          }
        }}
      >
        {/* Invisible wider hit area for easier grabbing */}
        <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
        {/* Visible divider line */}
        <div
          className={`w-2.5 h-full flex items-center justify-center transition-colors ${
            isDragging ? 'bg-primary' : 'bg-border hover:bg-primary/50'
          }`}
        >
          <GripVertical
            className={`h-6 w-6 transition-colors ${
              isDragging ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-primary'
            }`}
            aria-hidden="true"
          />
        </div>
      </div>
    </>
  );
}
