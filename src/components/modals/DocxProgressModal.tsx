/**
 * DOCX Progress Modal
 *
 * Non-dismissible modal shown while a DOCX download is being generated.
 * Displays phased status messages and a byte-accurate progress bar for
 * the initial ~58 MB pandoc WASM download (slowest step on first use).
 *
 * After the WASM is cached in-memory (subsequent downloads in the same
 * session), the modal flashes through the fast phases — we still render
 * it so the user always gets immediate feedback that their click worked.
 */

import { FileText, Loader2, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { DocxProgressPhase } from '@/services/docx/pandoc-converter';

interface DocxProgressModalProps {
  /**
   * Current progress phase. `null` hides the modal.
   * Render the modal with a non-null phase whenever a DOCX conversion is
   * in flight and hide it (set to null) when the download finishes or errors.
   */
  phase: DocxProgressPhase | null;
}

interface PhaseCopy {
  title: string;
  description: string;
}

function phaseCopy(phase: DocxProgressPhase): PhaseCopy {
  switch (phase.kind) {
    case 'preparing':
      return {
        title: 'Preparing DOCX…',
        description: 'Getting things ready.',
      };
    case 'fetching-engine':
      return {
        title: 'Downloading document engine…',
        description:
          'First DOCX download of this session — grabbing the ~58 MB pandoc engine. ' +
          'This is cached after the first time, so future downloads are much faster.',
      };
    case 'instantiating':
      return {
        title: 'Starting document engine…',
        description: 'Initializing WebAssembly. This usually takes a few seconds.',
      };
    case 'fetching-support':
      return {
        title: 'Loading templates…',
        description: 'Fetching reference template and formatting filters.',
      };
    case 'converting':
      return {
        title: 'Converting to DOCX…',
        description: 'Transforming your letter into a Word document.',
      };
    case 'postprocessing':
      return {
        title: 'Finalizing document…',
        description: 'Applying page geometry, fonts, and classification markings.',
      };
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocxProgressModal({ phase }: DocxProgressModalProps) {
  const open = phase !== null;

  // When hidden we still render the Dialog so Radix handles unmount cleanly;
  // we just pass open=false. Everything inside is keyed off `phase`.
  const copy = phase ? phaseCopy(phase) : { title: '', description: '' };

  // Progress bar is only meaningful during the large WASM download.
  // `total === 0` means the server didn't send Content-Length; fall back to
  // an indeterminate animation rather than showing a misleading percentage.
  const showBar = phase?.kind === 'fetching-engine';
  const loaded = phase?.kind === 'fetching-engine' ? phase.loaded : 0;
  const total = phase?.kind === 'fetching-engine' ? phase.total : 0;
  const hasTotal = total > 0;
  const pct = hasTotal ? Math.min(100, Math.max(0, (loaded / total) * 100)) : 0;

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md w-[calc(100vw-2rem)] overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <div className="flex flex-col gap-4 overflow-hidden">
          <DialogHeader className="min-w-0">
            <DialogTitle className="flex items-center gap-2 min-w-0">
              {phase?.kind === 'fetching-engine' ? (
                <Download className="h-5 w-5 text-primary flex-shrink-0" />
              ) : (
                <FileText className="h-5 w-5 text-primary flex-shrink-0" />
              )}
              <span className="truncate">{copy.title}</span>
              <Loader2 className="h-4 w-4 text-muted-foreground animate-spin flex-shrink-0 ml-auto" />
            </DialogTitle>
            <DialogDescription className="break-words">
              {copy.description}
            </DialogDescription>
          </DialogHeader>

          {showBar && (
            <div
              className="flex flex-col gap-2"
              role="progressbar"
              aria-label="Downloading document engine"
              aria-valuemin={0}
              aria-valuemax={hasTotal ? 100 : undefined}
              aria-valuenow={hasTotal ? Math.round(pct) : undefined}
            >
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                {hasTotal ? (
                  <div
                    className="h-full bg-primary transition-[width] duration-150 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                ) : (
                  // Indeterminate state: no Content-Length header. Pulse to show
                  // we're still working even though we can't compute a percentage.
                  <div className="h-full w-full animate-pulse bg-primary" />
                )}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{formatBytes(loaded)}{hasTotal ? ` / ${formatBytes(total)}` : ''}</span>
                <span>{hasTotal ? `${Math.round(pct)}%` : '…'}</span>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground break-words">
            Please keep this tab open. You can continue editing your letter — the
            download will complete in the background.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
