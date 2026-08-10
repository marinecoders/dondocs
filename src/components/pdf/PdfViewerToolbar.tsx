import {
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  MoveHorizontal,
  PanelLeft,
  RectangleVertical,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  onDownload: () => void;
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
          className={cn(
            'h-8 w-8',
            // A pressed toggle gets a toned fill, not just an icon tint, so the
            // selected state reads without relying on color alone.
            pressed && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
          )}
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
  onDownload,
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
    // @container: in narrow panels (rail open, divider dragged tight) the row
    // sheds in order — first the zoom readout, then the trailing actions into
    // an overflow menu — rather than letting overflow-hidden cut controls off.
    // What is left over (paging, page entry, zoom) fits a 250px panel, and is
    // what the panel is for. Page entry and paging never yield.
    <div
      className={cn(
        '@container flex h-9 shrink-0 items-center gap-1 overflow-hidden border-b border-border bg-card px-2',
        className
      )}
    >
      {thumbnails && (
        <ToolButton
          label={thumbnails.open ? 'Hide page thumbnails' : 'Show page thumbnails'}
          onClick={thumbnails.toggle}
          pressed={thumbnails.open}
        >
          <PanelLeft className="h-4 w-4" />
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
          className="tnum h-6 w-10 rounded-md border border-border bg-background text-center text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitPage(e.currentTarget);
            if (e.key === 'Escape') e.currentTarget.value = String(page);
          }}
          onBlur={(e) => commitPage(e.currentTarget)}
          onFocus={(e) => e.currentTarget.select()}
        />
        <span className="tnum hidden whitespace-nowrap @[360px]:inline">
          of {pageCount > 0 ? pageCount : '—'}
        </span>
      </span>

      <div className="flex-1" />

      <ToolButton label="Zoom out" onClick={onZoomOut}>
        <ZoomOut className="h-4 w-4" />
      </ToolButton>
      {/* First to go, and it can afford to: it is a readout, and its click
          target only duplicates Fit width. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onZoomFitWidth}
            aria-label={`Zoom ${zoomPercent} percent — reset to fit width`}
            className="tnum hidden min-w-[3rem] rounded text-center text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 @[420px]:block"
          >
            {zoomPercent}%
          </button>
        </TooltipTrigger>
        <TooltipContent>Reset zoom (fit width)</TooltipContent>
      </Tooltip>
      <ToolButton label="Zoom in" onClick={onZoomIn}>
        <ZoomIn className="h-4 w-4" />
      </ToolButton>

      {/* Wide enough for the whole row: the fit modes and the document actions
          sit out in the open. */}
      <div className="hidden items-center gap-1 @[520px]:flex">
        <ToolButton label="Fit width" onClick={onZoomFitWidth} pressed={fitMode === 'width'}>
          <MoveHorizontal className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Fit page" onClick={onZoomFitPage} pressed={fitMode === 'page'}>
          <RectangleVertical className="h-4 w-4" />
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
        <ToolButton label="Download PDF" onClick={onDownload}>
          <Download className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Open in browser tab" onClick={onOpenInTab}>
          <ExternalLink className="h-4 w-4" />
        </ToolButton>
      </div>

      {/* Narrower: the same five, one button wide. Until this existed they were
          simply cut off by the row's overflow-hidden — and Fullscreen and Open in
          browser tab have no other route anywhere in the app, so a narrow preview
          lost them with nothing to say they had ever been there. The rest of this
          toolbar already thins itself by container query; this extends that from
          the text spans to the buttons.

          One threshold for the whole group, not a gate per button: the menu is
          portaled out of this container, so it cannot answer container queries
          itself, and a partly-collapsed group would show items twice.

          A plain Button rather than ToolButton: ToolButton wraps its Button in a
          Tooltip, and nesting that inside DropdownMenuTrigger asChild breaks the
          ref. The menu names its own items, so no label is lost. */}
      <div className="@[520px]:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="More preview actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Checkbox items, so the active fit mode still reads as selected
                the way the buttons' pressed fill does. */}
            <DropdownMenuCheckboxItem checked={fitMode === 'width'} onSelect={onZoomFitWidth}>
              Fit width
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={fitMode === 'page'} onSelect={onZoomFitPage}>
              Fit page
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {fullscreen && (
              <DropdownMenuItem onSelect={fullscreen.toggle}>
                {fullscreen.isFullscreen ? (
                  <Minimize2 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                )}
                {fullscreen.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onDownload}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Download PDF
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenInTab}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open in browser tab
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
