import { useEffect, useId, useRef, useState } from 'react';
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
  PencilLine,
  RectangleVertical,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { PreviewFollowMode, PreviewSource } from '@/lib/previewSources';
import type { StarterExamplesControl } from '@/lib/previewHints';

export interface PreviewFollow {
  mode: PreviewFollowMode;
  onChange: (mode: PreviewFollowMode) => void;
}

interface DraftSourceNavigation {
  sources: readonly PreviewSource[];
  message?: string;
  onEdit: (source: PreviewSource) => void;
}

interface PdfViewerToolbarProps {
  label?: React.ReactNode;
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
  onOpenInTab?: () => void;
  onDownload?: () => void;
  downloadLabel?: string;
  fullscreen?: { isFullscreen: boolean; toggle: () => void } | null;
  menuContainer?: HTMLElement | null;
  sourceNavigation?: DraftSourceNavigation;
  follow?: PreviewFollow;
  starterExamples?: StarterExamplesControl;
  className?: string;
}

const FOLLOW_LABELS = {
  off: 'Off',
  editor: 'Preview follows editor',
  preview: 'Paragraphs follow preview',
} satisfies Record<PreviewFollowMode, string>;

function FollowOptions({ mode, onChange }: PreviewFollow) {
  return (
    <DropdownMenuRadioGroup value={mode} aria-label="Follow mode">
      {(Object.keys(FOLLOW_LABELS) as PreviewFollowMode[]).map(value => (
        <DropdownMenuRadioItem key={value} value={value} onSelect={() => onChange(value)}>
          {FOLLOW_LABELS[value]}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

function DraftSourceMenu({ page, navigation, container, touchSize }: {
  page: number;
  navigation: DraftSourceNavigation;
  container?: HTMLElement | null;
  touchSize: boolean;
}) {
  const selected = useRef<PreviewSource | null>(null);
  const [openPage, setOpenPage] = useState<number | null>(null);
  const emptyMessageId = useId();
  const hasSources = navigation.sources.length > 0;
  if (openPage !== null && openPage !== page) setOpenPage(null);

  return (
    <DropdownMenu
      modal={false}
      open={openPage === page}
      onOpenChange={open => setOpenPage(open ? page : null)}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('shrink-0 gap-1.5 px-2 text-xs', touchSize ? 'size-11 @[520px]:w-auto' : 'size-8 @[520px]:w-auto')}
          aria-label="Edit in draft"
          title="Edit in draft"
        >
          <PencilLine className="size-4" aria-hidden="true" />
          <span className="hidden @[520px]:inline">Edit in draft</span>
          <ChevronDown className="hidden size-3 text-muted-foreground @[520px]:inline" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        container={container}
        className="w-56"
        aria-describedby={hasSources ? undefined : emptyMessageId}
        onCloseAutoFocus={(event) => {
          const source = selected.current;
          selected.current = null;
          if (!source || !navigation.sources.includes(source)) return;
          // Radix normally restores focus to the trigger. An explicit edit
          // selection hands it to the draft after the menu has closed.
          event.preventDefault();
          navigation.onEdit(source);
        }}
      >
        <DropdownMenuLabel>On page {page}</DropdownMenuLabel>
        {hasSources
          ? navigation.sources.map(source => (
            <DropdownMenuItem key={source.id} className={touchSize ? 'min-h-11' : undefined} onSelect={() => { selected.current = source; }}>
              {source.label}
            </DropdownMenuItem>
          ))
          : (
            <DropdownMenuItem id={emptyMessageId} disabled className="text-muted-foreground data-[disabled]:opacity-100">
              {navigation.message ?? 'No editable content was matched on this page.'}
            </DropdownMenuItem>
          )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  label,
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
  downloadLabel = 'Download PDF',
  fullscreen,
  menuContainer,
  follow,
  starterExamples,
  sourceNavigation,
  className,
}: PdfViewerToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const pagingControlsRef = useRef<HTMLDivElement>(null);
  const zoomControlsRef = useRef<HTMLDivElement>(null);
  const wideActionsRef = useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const [overflowControls, setOverflowControls] = useState({ paging: false, zoom: false, actions: true });
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if ((!overflowOpen && !followOpen) || !toolbar) return;
    const width = toolbar.clientWidth;
    const close = () => {
      setOverflowOpen(false);
      setFollowOpen(false);
    };
    // The divider can resize the toolbar without resizing the window.
    const observer = new ResizeObserver(() => {
      if (toolbar.clientWidth !== width) close();
    });
    observer.observe(toolbar);
    window.addEventListener('resize', close);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', close);
    };
  }, [overflowOpen, followOpen]);

  const wideActions = follow ? '@[740px]:flex' : label ? '@[620px]:flex' : '@[520px]:flex';
  const narrowActions = follow ? '@[740px]:hidden' : label ? '@[620px]:hidden' : '@[520px]:hidden';
  const pagingLayout = sourceNavigation ? 'hidden @[232px]:flex' : 'flex';
  const zoomLayout = sourceNavigation ? 'hidden @[340px]:flex' : 'flex';
  const touchSource = !!sourceNavigation && !label;
  const thumbnailsLabel = thumbnails?.open ? 'Hide page thumbnails' : 'Show page thumbnails';

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
      ref={toolbarRef}
      className={cn(
        '@container flex shrink-0 items-center gap-1 overflow-hidden px-2',
        label ? 'h-12 bg-transparent' : cn('border-b border-border bg-card', touchSource ? 'h-11' : 'h-9'),
        className
      )}
    >
      {label && (
        <div className={cn(
          'sr-only mr-auto min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground',
          sourceNavigation ? '@[430px]:not-sr-only @[430px]:flex' : '@[360px]:not-sr-only @[360px]:flex',
          follow && '@[740px]:sr-only @[820px]:not-sr-only @[820px]:flex',
        )}>
          {label}
        </div>
      )}
      <div ref={pagingControlsRef} className={cn('shrink-0 items-center gap-1', pagingLayout)}>
        {thumbnails && (
          <ToolButton label={thumbnailsLabel} onClick={thumbnails.toggle} pressed={thumbnails.open}>
            <PanelLeft className="h-4 w-4" />
          </ToolButton>
        )}
        <ToolButton label="Previous page" onClick={onPrevPage} disabled={page <= 1}>
          <ChevronUp className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Next page" onClick={onNextPage} disabled={page >= pageCount}>
          <ChevronDown className="h-4 w-4" />
        </ToolButton>
      </div>
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
      {sourceNavigation && pageCount > 0 && <DraftSourceMenu page={page} navigation={sourceNavigation} container={menuContainer} touchSize={touchSource} />}

      <div className="flex-1" />

      <div ref={zoomControlsRef} className={cn('items-center gap-1', zoomLayout)}>
        <ToolButton label="Zoom out" onClick={onZoomOut}>
          <ZoomOut className="h-4 w-4" />
        </ToolButton>
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
      </div>

      {/* Wide enough for the whole row: the fit modes and the document actions
          sit out in the open. */}
      <div ref={wideActionsRef} className={cn('hidden shrink-0 items-center gap-1', wideActions)}>
        <ToolButton label="Fit width" onClick={onZoomFitWidth} pressed={fitMode === 'width'}>
          <MoveHorizontal className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Fit page" onClick={onZoomFitPage} pressed={fitMode === 'page'}>
          <RectangleVertical className="h-4 w-4" />
        </ToolButton>
        {follow && (
          <DropdownMenu open={followOpen} onOpenChange={setFollowOpen} modal={false}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" aria-label="Follow" aria-description={FOLLOW_LABELS[follow.mode]}
                className={cn('h-8 gap-1.5 px-2 text-xs', follow.mode !== 'off' && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}>
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Follow
                <ChevronDown className="size-3" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" container={menuContainer}>
              <FollowOptions {...follow} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <div className="mx-1 h-4 w-px bg-border" />
        {fullscreen && (
          <ToolButton
            label={fullscreen.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={fullscreen.toggle}
          >
            {fullscreen.isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </ToolButton>
        )}
        {onDownload && <ToolButton label={downloadLabel} onClick={onDownload}>
          <Download className="h-4 w-4" />
        </ToolButton>}
        {onOpenInTab && <ToolButton label="Open in browser tab" onClick={onOpenInTab}>
          <ExternalLink className="h-4 w-4" />
        </ToolButton>}
      </div>

      {/* The portaled menu takes the paging and zoom groups only when the
          toolbar has hidden them. Page entry and Edit in draft stay visible. */}
      <div className={starterExamples ? 'shrink-0' : narrowActions}>
        <DropdownMenu open={overflowOpen} onOpenChange={(open) => {
          if (open) {
            setOverflowControls({
              paging: pagingControlsRef.current?.offsetWidth === 0,
              zoom: zoomControlsRef.current?.offsetWidth === 0,
              actions: wideActionsRef.current?.offsetWidth === 0,
            });
          }
          setOverflowOpen(open);
        }}>
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
          <DropdownMenuContent align="end" container={menuContainer}>
            {starterExamples && (
              <DropdownMenuCheckboxItem checked={starterExamples.checked} onCheckedChange={starterExamples.onChange}>
                Show starter examples
              </DropdownMenuCheckboxItem>
            )}
            {starterExamples && overflowControls.actions && <DropdownMenuSeparator />}
            {follow && overflowControls.actions && (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    aria-description={FOLLOW_LABELS[follow.mode]}
                    className={follow.mode !== 'off' ? 'font-medium text-primary' : undefined}
                  >
                    <RefreshCw aria-hidden="true" />
                    Follow
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <FollowOptions {...follow} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            )}
            {overflowControls.paging && (
              <>
                {thumbnails && (
                  <DropdownMenuItem onSelect={thumbnails.toggle}>
                    <PanelLeft aria-hidden="true" /> {thumbnailsLabel}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={onPrevPage} disabled={page <= 1}>
                  <ChevronUp aria-hidden="true" /> Previous page
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onNextPage} disabled={page >= pageCount}>
                  <ChevronDown aria-hidden="true" /> Next page
                </DropdownMenuItem>
              </>
            )}
            {overflowControls.zoom && (
              <>
                <DropdownMenuItem onSelect={onZoomOut}><ZoomOut aria-hidden="true" /> Zoom out</DropdownMenuItem>
                <DropdownMenuItem onSelect={onZoomIn}><ZoomIn aria-hidden="true" /> Zoom in</DropdownMenuItem>
              </>
            )}
            {overflowControls.actions && <>
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
              {onDownload && <DropdownMenuItem onSelect={onDownload}>
                <Download className="h-4 w-4" aria-hidden="true" />
                {downloadLabel}
              </DropdownMenuItem>}
              {onOpenInTab && <DropdownMenuItem onSelect={onOpenInTab}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open in browser tab
              </DropdownMenuItem>}
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
