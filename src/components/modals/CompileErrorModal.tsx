/**
 * Compile Error Modal
 *
 * Shown when the live preview auto-compile fails (e.g. user typed invalid
 * LaTeX). Unlike the download error flow, this one fires passively — the
 * user didn't click a button expecting output, so the dismissible modal
 * surfaces the failure proactively the first time a new error appears.
 *
 * Dedup strategy is owned by the caller (App.tsx): it tracks the last
 * error it showed and won't re-open this modal for the same error text,
 * so editing a doc with an unresolved error doesn't spam the user on
 * every debounce cycle.
 */

import { useState } from 'react';
import { AlertCircle, Copy, Check, Github, X, ScrollText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLogStore } from '@/stores/logStore';

const GITHUB_NEW_ISSUE_URL = 'https://github.com/marinecoders/dondocs/issues/new';
// Keep the prefilled URL under the ~8 KB threshold that breaks some browsers.
const GH_ISSUE_LOG_MAX = 6000;

interface CompileErrorModalProps {
  open: boolean;
  /** The error message (e.g. 'Compilation failed'). */
  error: string | null;
  /** The formatted compile log from SwiftLaTeX, if attached. */
  compileLog?: string | null;
  onClose: () => void;
}

function buildIssueUrl(args: { error: string; compileLog?: string | null }): string {
  const log = args.compileLog ?? undefined;
  const truncated = log && log.length > GH_ISSUE_LOG_MAX
    ? log.slice(0, GH_ISSUE_LOG_MAX) +
      `\n\n… [log truncated — ${log.length - GH_ISSUE_LOG_MAX} more chars, paste the full log from the "Copy logs" button]`
    : log;

  const body = [
    '<!--',
    'Thanks for reporting this! The log below was captured automatically — you',
    'only need to fill in what you were editing when it broke. Reporting bugs',
    'is the fastest way to get them fixed; we triage every report.',
    '-->',
    '',
    '## What happened',
    args.error,
    '',
    '## Context',
    'Auto-compile failed during live preview editing.',
    '',
    '## What I was editing',
    '<!-- short description of what LaTeX / fields you were changing when this happened -->',
    '',
    '## Log output',
    truncated ? '```\n' + truncated + '\n```' : '(no log available)',
    '',
    '## Environment',
    `- User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    `- URL: ${typeof window !== 'undefined' ? window.location.href : 'unknown'}`,
    `- Reported: ${new Date().toISOString()}`,
  ].join('\n');

  const params = new URLSearchParams({
    title: `[Bug] Preview compile failed: ${args.error}`.slice(0, 200),
    body,
    labels: 'bug',
  });
  return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}

export function CompileErrorModal({ open, error, compileLog, onClose }: CompileErrorModalProps) {
  const [logCopied, setLogCopied] = useState(false);
  const openLogViewer = useLogStore((s) => s.setOpen);

  const handleCopyLog = async () => {
    if (!compileLog) return;
    try {
      await navigator.clipboard.writeText(compileLog);
      setLogCopied(true);
      setTimeout(() => setLogCopied(false), 2000);
    } catch (err) {
      // Clipboard API can fail in insecure contexts — log so the user can
      // still select + copy the inline pre block by hand.
      console.warn('Failed to copy log to clipboard:', err);
    }
  };

  const handleReport = () => {
    if (!error) return;
    const url = buildIssueUrl({ error, compileLog });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleOpenLogs = () => {
    openLogViewer(true);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="sm:max-w-md w-[calc(100vw-2rem)] overflow-hidden">
        <div className="flex flex-col gap-4 overflow-hidden">
          <DialogHeader className="min-w-0">
            <DialogTitle className="flex items-center gap-2 min-w-0">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              <span className="truncate">Preview compile failed</span>
            </DialogTitle>
            <DialogDescription className="break-words">
              {error || 'The document failed to compile. Your last successful preview is still visible below.'}
            </DialogDescription>
          </DialogHeader>

          {compileLog && (
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
                aria-label="Compile error log"
              >
                {compileLog}
              </pre>
            </div>
          )}

          <p className="text-xs text-muted-foreground break-words">
            If this looks like a bug (not just a typo in your document), reporting
            it on GitHub is the fastest way to get it fixed — we triage every
            report.
            {compileLog ? ' The log is included in the prefilled issue.' : ''}
          </p>

          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              <X className="h-4 w-4 mr-2" />
              Dismiss
            </Button>
            <Button variant="outline" onClick={handleOpenLogs}>
              <ScrollText className="h-4 w-4 mr-2" />
              View all logs
            </Button>
            <Button variant="outline" onClick={handleReport}>
              <Github className="h-4 w-4 mr-2" />
              Report issue
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
