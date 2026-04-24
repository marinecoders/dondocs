/**
 * Download Progress Modal
 *
 * Unified modal shown while a download (PDF or DOCX) is being generated.
 * Displays phased status messages and a byte-accurate progress bar for
 * the initial ~58 MB pandoc WASM download (DOCX path, slowest step on
 * first use).
 *
 * The modal is non-dismissible during normal progress — the app is
 * unresponsive behind the overlay while heavy work (WASM instantiate,
 * LaTeX compile, PDF merging) happens. When an error phase is set,
 * the modal flips to a dismissible error state with a close button.
 *
 * After assets are cached (subsequent downloads in the same session),
 * the modal flashes through the fast phases — we still render it so the
 * user always gets immediate feedback that their click worked.
 */

import { useState } from 'react';
import { FileText, Loader2, Download, AlertCircle, FilePen, RotateCw, Copy, Check, Github } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { DownloadProgressPhase } from './downloadProgressTypes';

const GITHUB_NEW_ISSUE_URL = 'https://github.com/marinecoders/dondocs/issues/new';
// GitHub URLs over ~8 KB start to fail in some browsers; cap the pasted log
// so the prefill link always works. Users hit "Copy logs" for the full text.
const GH_ISSUE_LOG_MAX = 6000;

interface DownloadProgressModalProps {
  /**
   * Current progress phase. `null` hides the modal.
   * Set to a non-null phase whenever a download is in flight; set to
   * `null` when work finishes successfully. On failure, set to an
   * `error` phase instead of `null` so the user sees the failure.
   */
  phase: DownloadProgressPhase | null;
  /**
   * Invoked when the user dismisses the modal. Only called for the
   * `error` phase — non-error phases have no close affordance.
   * Callers should clear their progress state (set to `null`).
   */
  onClose: () => void;
  /**
   * Invoked when the user clicks "Retry" in the error state. Only
   * triggered when `phase.retryable` is true. Callers should clear the
   * current error and re-run the original download operation.
   */
  onRetry?: () => void;
}

/**
 * Build a prefilled "New issue" URL for the current error. Logs are
 * capped at GH_ISSUE_LOG_MAX chars so the URL stays under browser
 * length limits; the full log is still available via Copy logs.
 */
function buildIssueUrl(args: { target: 'pdf' | 'docx'; title: string; message: string; compileLog?: string }): string {
  const truncated = args.compileLog && args.compileLog.length > GH_ISSUE_LOG_MAX
    ? args.compileLog.slice(0, GH_ISSUE_LOG_MAX) +
      `\n\n… [log truncated — ${args.compileLog.length - GH_ISSUE_LOG_MAX} more chars, paste the full log from the "Copy logs" button]`
    : args.compileLog;

  const body = [
    '## What happened',
    args.message,
    '',
    '## Download target',
    args.target.toUpperCase(),
    '',
    '## Steps to reproduce',
    '<!-- describe what you were doing when this happened -->',
    '',
    '## Log output',
    truncated ? '```\n' + truncated + '\n```' : '(no log available)',
    '',
    '## Environment',
    `- User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    `- URL: ${typeof window !== 'undefined' ? window.location.href : 'unknown'}`,
  ].join('\n');

  const params = new URLSearchParams({
    title: `[Bug] ${args.title}`,
    body,
    labels: 'bug',
  });
  return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}

interface PhaseCopy {
  title: string;
  description: string;
}

function phaseCopy(phase: DownloadProgressPhase): PhaseCopy {
  switch (phase.kind) {
    // --- DOCX ---
    case 'docx-preparing':
      return {
        title: 'Preparing DOCX…',
        description: 'Getting things ready.',
      };
    case 'docx-fetching-engine':
      return {
        title: 'Downloading document engine…',
        description:
          'First DOCX download of this session — grabbing the ~58 MB pandoc engine. ' +
          'This is cached after the first time, so future downloads are much faster.',
      };
    case 'docx-instantiating':
      return {
        title: 'Starting document engine…',
        description: 'Initializing WebAssembly. This usually takes a few seconds.',
      };
    case 'docx-fetching-support':
      return {
        title: 'Loading templates…',
        description: 'Fetching reference template and formatting filters.',
      };
    case 'docx-converting':
      return {
        title: 'Converting to DOCX…',
        description: 'Transforming your letter into a Word document.',
      };
    case 'docx-postprocessing':
      return {
        title: 'Finalizing document…',
        description: 'Applying page geometry, fonts, and classification markings.',
      };
    // --- PDF ---
    case 'pdf-preparing':
      return {
        title: 'Preparing PDF…',
        description: 'Getting things ready.',
      };
    case 'pdf-compiling':
      return {
        title: 'Compiling PDF…',
        description: 'Running LaTeX to typeset your document. This can take several seconds.',
      };
    case 'pdf-merging-enclosures':
      return {
        title: 'Merging enclosures…',
        description: 'Attaching enclosure PDFs and adding hyperlinks.',
      };
    case 'pdf-signing':
      return {
        title: 'Adding signature field…',
        description: 'Embedding a digital signature placeholder in the PDF.',
      };
    case 'pdf-saving':
      return {
        title: 'Saving PDF…',
        description: 'Triggering the browser download.',
      };
    // --- Error ---
    case 'error':
      return {
        title: phase.title,
        description: phase.message,
      };
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Pick a phase-appropriate icon. Download icon for the big WASM fetch
 * (it's the one where "downloading" is literal), alert icon for errors,
 * FilePen for PDF compile/sign/save, FileText for everything else.
 */
function phaseIcon(phase: DownloadProgressPhase) {
  switch (phase.kind) {
    case 'error':
      return <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />;
    case 'docx-fetching-engine':
      return <Download className="h-5 w-5 text-primary flex-shrink-0" />;
    case 'pdf-compiling':
    case 'pdf-signing':
    case 'pdf-saving':
    case 'pdf-merging-enclosures':
      return <FilePen className="h-5 w-5 text-primary flex-shrink-0" />;
    default:
      return <FileText className="h-5 w-5 text-primary flex-shrink-0" />;
  }
}

export function DownloadProgressModal({ phase, onClose, onRetry }: DownloadProgressModalProps) {
  const open = phase !== null;
  const isError = phase?.kind === 'error';
  const [logCopied, setLogCopied] = useState(false);

  const handleCopyLog = async () => {
    if (phase?.kind !== 'error' || !phase.compileLog) return;
    try {
      await navigator.clipboard.writeText(phase.compileLog);
      setLogCopied(true);
      setTimeout(() => setLogCopied(false), 2000);
    } catch (err) {
      // Clipboard API can fail in insecure contexts / older browsers.
      // Fall back to a visible no-op; users can still scroll the inline
      // log and select manually.
      console.warn('Failed to copy log to clipboard:', err);
    }
  };

  const handleReport = () => {
    if (phase?.kind !== 'error') return;
    const url = buildIssueUrl({
      target: phase.target,
      title: phase.title,
      message: phase.message,
      compileLog: phase.compileLog,
    });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // When hidden we still render the Dialog so Radix handles unmount cleanly;
  // we just pass open=false. Everything inside is keyed off `phase`.
  const copy = phase ? phaseCopy(phase) : { title: '', description: '' };

  // Progress bar is only meaningful during the large WASM download.
  // `total === 0` means the server didn't send Content-Length; fall back to
  // an indeterminate animation rather than showing a misleading percentage.
  const showBar = phase?.kind === 'docx-fetching-engine';
  const loaded = phase?.kind === 'docx-fetching-engine' ? phase.loaded : 0;
  const total = phase?.kind === 'docx-fetching-engine' ? phase.total : 0;
  const hasTotal = total > 0;
  const pct = hasTotal ? Math.min(100, Math.max(0, (loaded / total) * 100)) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // Only honor close requests when in the error state. Non-error
        // phases render no close affordance, but this is belt-and-braces.
        if (!nextOpen && isError) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-md w-[calc(100vw-2rem)] overflow-hidden"
        // Non-error: block all dismissal so the user can't accidentally kill
        // a long-running operation. Error: allow Escape + click-outside.
        onInteractOutside={(e) => {
          if (!isError) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!isError) e.preventDefault();
        }}
        showCloseButton={isError}
      >
        <div className="flex flex-col gap-4 overflow-hidden">
          <DialogHeader className="min-w-0">
            <DialogTitle className="flex items-center gap-2 min-w-0">
              {phase && phaseIcon(phase)}
              <span className="truncate">{copy.title}</span>
              {!isError && (
                <Loader2 className="h-4 w-4 text-muted-foreground animate-spin flex-shrink-0 ml-auto" />
              )}
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

          {!isError && (
            <p className="text-xs text-muted-foreground break-words">
              Please keep this tab open. The app will be available again as soon
              as this finishes.
            </p>
          )}

          {isError && phase.kind === 'error' && (
            <>
              {phase.compileLog && (
                <div className="flex flex-col gap-2 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Error log
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={handleCopyLog}
                      aria-label="Copy log to clipboard"
                    >
                      {logCopied ? (
                        <>
                          <Check className="h-3 w-3 mr-1" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 mr-1" />
                          Copy logs
                        </>
                      )}
                    </Button>
                  </div>
                  <pre
                    className="max-h-48 overflow-auto rounded-md bg-muted border border-border p-2 text-[11px] leading-tight font-mono whitespace-pre-wrap break-all text-foreground/80"
                    aria-label="Error log output"
                  >
                    {phase.compileLog}
                  </pre>
                </div>
              )}

              {phase.reportable && (
                <p className="text-xs text-muted-foreground break-words">
                  If this keeps happening, report it on GitHub so we can fix it.
                  {phase.compileLog ? ' The log is included in the prefilled issue.' : ''}
                </p>
              )}

              <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
                {phase.reportable && (
                  <Button variant="outline" onClick={handleReport}>
                    <Github className="h-4 w-4 mr-2" />
                    Report issue
                  </Button>
                )}
                {phase.retryable && onRetry && (
                  <Button onClick={onRetry} autoFocus>
                    <RotateCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
