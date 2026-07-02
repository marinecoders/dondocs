import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  PanelLeft,
  RectangleVertical,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface PdfViewerToolbarProps {
  page: number;
  pageCount: number;
  zoomPercent: number;
  fitMode: 'width' | 'page' | null;
  /** Thumbnail-rail control; null hides the toggle (single-page documents). */
  thumbnails: { open: boolean; toggle: () => void } | null;
  onGoToPage: (page: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFitWidth: () => void;
  onZoomFitPage: () => void;
  onOpenInTab: () => void;
  fullscreen?: { isFullscreen: boolean; toggle: () => void } | null;
  className?: string;
}

function ToolButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Slim viewer chrome in the app's design language — quiet card bar, tabular
 *  figures for the page/zoom readouts, unified tooltips. */
export function PdfViewerToolbar({
  page,
  pageCount,
  zoomPercent,
  fitMode,
  thumbnails,
  onGoToPage,
  onPrevPage,
  onNextPage,
  onZoomIn,
  onZoomOut,
  onZoomFitWidth,
  onZoomFitPage,
  onOpenInTab,
  fullscreen,
  className,
}: PdfViewerToolbarProps) {
  // Uncontrolled input keyed by the current page: it remounts (and re-seeds)
  // whenever the page changes from scrolling/buttons, while typing stays local
  // until Enter/blur commits — no set-state-in-effect syncing needed.
  const commitPage = (el: HTMLInputElement) => {
    const n = Math.round(Number(el.value));
    if (Number.isFinite(n) && n >= 1 && n <= pageCount && n !== page) {
      onGoToPage(n);
    } else {
      el.value = String(page); // invalid or unchanged — restore the readout
    }
  };

  return (
    <div
      className={cn(
        'flex h-9 shrink-0 items-center gap-1 border-b border-border bg-card px-2',
        className
      )}
    >
      {thumbnails && (
        <ToolButton
          label={thumbnails.open ? 'Hide page thumbnails' : 'Show page thumbnails'}
          onClick={thumbnails.toggle}
          pressed={thumbnails.open}
        >
          <PanelLeft className={cn('h-4 w-4', thumbnails.open && 'text-primary')} />
        </ToolButton>
      )}
      <ToolButton label="Previous page" onClick={onPrevPage} disabled={page <= 1}>
        <ChevronUp className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Next page" onClick={onNextPage} disabled={page >= pageCount}>
        <ChevronDown className="h-4 w-4" />
      </ToolButton>
      <span className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
        <input
          key={page}
          defaultValue={pageCount > 0 ? page : ''}
          disabled={pageCount === 0}
          inputMode="numeric"
          aria-label="Page number"
          className="tnum h-6 w-9 rounded border border-border bg-background text-center text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitPage(e.currentTarget);
            if (e.key === 'Escape') e.currentTarget.value = String(page);
          }}
          onBlur={(e) => commitPage(e.currentTarget)}
          onFocus={(e) => e.currentTarget.select()}
        />
        <span className="tnum whitespace-nowrap">of {pageCount > 0 ? pageCount : '—'}</span>
      </span>

      <div className="flex-1" />

      <ToolButton label="Zoom out" onClick={onZoomOut}>
        <ZoomOut className="h-4 w-4" />
      </ToolButton>
      <span className="tnum min-w-[3rem] text-center text-xs text-muted-foreground">
        {zoomPercent}%
      </span>
      <ToolButton label="Zoom in" onClick={onZoomIn}>
        <ZoomIn className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Fit width" onClick={onZoomFitWidth} pressed={fitMode === 'width'}>
        <MoveHorizontal className={cn('h-4 w-4', fitMode === 'width' && 'text-primary')} />
      </ToolButton>
      <ToolButton label="Fit page" onClick={onZoomFitPage} pressed={fitMode === 'page'}>
        <RectangleVertical className={cn('h-4 w-4', fitMode === 'page' && 'text-primary')} />
      </ToolButton>

      <div className="mx-1 h-4 w-px bg-border" />

      {fullscreen && (
        <ToolButton
          label={fullscreen.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          onClick={fullscreen.toggle}
        >
          {fullscreen.isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </ToolButton>
      )}
      <ToolButton label="Open in browser tab" onClick={onOpenInTab}>
        <ExternalLink className="h-4 w-4" />
      </ToolButton>
    </div>
  );
}
