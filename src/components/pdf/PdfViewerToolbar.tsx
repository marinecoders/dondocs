import { ChevronDown, ChevronUp, ExternalLink, Maximize2, Minimize2, Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface PdfViewerToolbarProps {
  page: number;
  pageCount: number;
  zoomPercent: number;
  isFitWidth: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onOpenInTab: () => void;
  fullscreen?: { isFullscreen: boolean; toggle: () => void } | null;
  className?: string;
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
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
  isFitWidth,
  onPrevPage,
  onNextPage,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onOpenInTab,
  fullscreen,
  className,
}: PdfViewerToolbarProps) {
  return (
    <div
      className={cn(
        'flex h-9 shrink-0 items-center gap-1 border-b border-border bg-card px-2',
        className
      )}
    >
      <ToolButton label="Previous page" onClick={onPrevPage} disabled={page <= 1}>
        <ChevronUp className="h-4 w-4" />
      </ToolButton>
      <ToolButton label="Next page" onClick={onNextPage} disabled={page >= pageCount}>
        <ChevronDown className="h-4 w-4" />
      </ToolButton>
      <span className="tnum min-w-[4.5rem] px-1 text-center text-xs text-muted-foreground" aria-live="polite">
        {pageCount > 0 ? `${page} of ${pageCount}` : '—'}
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
      <ToolButton label={isFitWidth ? 'Fit width (on)' : 'Fit width'} onClick={onZoomFit}>
        <Scan className={cn('h-4 w-4', isFitWidth && 'text-primary')} />
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
