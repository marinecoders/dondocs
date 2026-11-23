import { usePreviewSources } from '@/hooks/usePreviewSources';
import { isOutputFieldActive } from '@/lib/documentFields';
import { lazy, Suspense, useEffect } from 'react';
import { Loader2, AlertCircle, Eye, Paperclip } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';

// The in-app viewer (react-pdf + pdf.js) is its own chunk: the desktop shell
// stays pdf.js-free until a preview actually exists. The warm-up effect below
// starts fetching it during the first compile so it's ready before the PDF is.
const PdfViewer = lazy(() => import('@/components/pdf/PdfViewer'));

interface PreviewPanelProps {
  pdfUrl: string | null;
  isCompiling: boolean;
  /** The one-time in-browser LaTeX engine boot (distinct from a routine
   *  recompile) — the slowest, most anxious wait, so it gets its own copy. */
  isWarmingUp?: boolean;
  /** True once the resting preview has been upgraded to include enclosures +
   *  signature (full quality), so the "encl. in download" note can stand down. */
  previewEnhanced?: boolean;
  error: string | null;
  documentId?: string;
  onDownloadPdf: () => void;
}

export function PreviewPanel({ pdfUrl, isCompiling, isWarmingUp = false, previewEnhanced = false, error, documentId, onDownloadPdf }: PreviewPanelProps) {
  const navigation = usePreviewSources(isCompiling || !!error);
  // Individual selectors avoid re-rendering for unrelated UI-store updates.
  const isMobile = useUIStore((s) => s.isMobile);
  const fullQualityPreview = useUIStore((s) => s.fullQualityPreview);
  const enclosureCount = useDocumentStore((s) => isOutputFieldActive(s, ['enclosures']) ? s.enclosures.length : 0);
  // The empty state told every user to fill in "the Subject and body", which a
  // form does not have.
  const isFormsMode = useDocumentStore((s) => s.documentCategory) === 'forms';

  // Prefetch the viewer chunk while the first compile runs, so the viewer is
  // parsed and ready by the time a pdfUrl exists. (Scroll preservation across
  // recompiles now lives inside PdfViewer's double-buffered swap — the old
  // reach-into-the-iframe hack is gone with the iframe.)
  useEffect(() => {
    if (isCompiling) void import('@/components/pdf/PdfViewer');
  }, [isCompiling]);

  // Filter out engine reset message - it's not a user-facing error
  const engineResetNeeded = error === 'ENGINE_RESET_NEEDED';
  const displayError = engineResetNeeded ? null : error;
  const previewState = isCompiling || isWarmingUp || engineResetNeeded ? 'loading' : displayError ? 'error' : pdfUrl ? 'ready' : 'idle';

  // The document header opens the full-screen preview on mobile.
  if (isMobile) return null;

  const previewLabel = <>
    <span>Preview</span>
    {isCompiling && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
    {enclosureCount > 0 && !fullQualityPreview && !previewEnhanced && <span
      className="inline-flex items-center gap-1 text-[11px]"
      title="Enclosures are included in the downloaded PDF. The preview upgrades to show them once you pause."
    ><Paperclip className="h-3 w-3" aria-hidden="true" /><span>{enclosureCount} encl.</span></span>}
  </>;

  return (
    <div className="workspace-preview relative flex h-full flex-col" data-preview-state={previewState}>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {previewState === 'loading' ? (isWarmingUp || engineResetNeeded ? 'Loading the typesetter…' : 'Updating preview…') : displayError ? (pdfUrl ? 'Preview is out of date. Check the generation error.' : 'Preview could not be generated.') : pdfUrl ? 'Preview ready. Review the exported file before sending.' : 'Waiting for document content.'}
      </div>
      {!pdfUrl && <div className="flex h-12 shrink-0 items-center gap-2 px-4 text-xs text-muted-foreground">{previewLabel}</div>}
      {isCompiling && <div className="pointer-events-none absolute inset-x-0 top-[46px] z-10 h-0.5 overflow-hidden" aria-hidden="true">
        <div className="dd-anim h-full w-1/4 bg-primary" style={{ animation: 'dd-progress 1.1s cubic-bezier(0.4,0,0.2,1) infinite' }} />
      </div>}

      {/* Content — a deeper mat so the document reads as paper resting on a
          surface (visible in the empty / loading / error states; the embedded
          PDF viewer supplies its own mat once a page is shown). */}
      <div className="flex-1 min-h-0 relative">
        {/* Show PDF if available, with optional loading overlay */}
        {pdfUrl && (
          <>
            <Suspense fallback={null /* the mat behind is already painted */}>
              <div className="absolute inset-0" title="Document preview">
                <PdfViewer
                  key={documentId}
                  documentId={documentId}
                  pdfUrl={pdfUrl}
                  toolbarLabel={previewLabel}
                  onDownloadPdf={onDownloadPdf}
                  follow={navigation.sources.length > 0 ? { mode: navigation.followMode, onChange: navigation.changeFollowMode } : undefined}
                  sourceNavigationMessage={navigation.unavailableMessage}
                  sourceToReveal={navigation.sourceToReveal}
                  onManualNavigation={navigation.pauseEditorFollow}
                  onSourcesInView={navigation.followSources}
                  sources={navigation.sources}
                  sourceSubject={navigation.sourceSubject}
                  onNavigateSource={navigation.navigate}
                />
              </div>
            </Suspense>
            {/* While recompiling, the stale PDF stays visible and unobscured —
                the header's compile sweep conveys the in-flight state instead of
                a blocking overlay wash. */}
            {/* Persistent error banner shown OVER the (now stale) PDF so the
                user knows their latest edits failed to compile. Previously
                this branch was gated on `!pdfUrl`, which meant once any
                compile had ever succeeded, subsequent failures left no
                visible indicator — see the auto-popup modal in App.tsx for
                the one-shot attention-grabber that complements this banner. */}
            {displayError && !isCompiling && (
              // Leave the unified toolbar reachable above stale-preview errors.
              <div
                className="absolute top-12 inset-x-0 flex items-start gap-2 bg-destructive/10 border-b border-destructive/30 text-destructive px-3 py-2 text-xs"
                role="alert"
              >
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{isFormsMode ? 'Check these fields before exporting' : 'Compile failed — preview is out of date'}</div>
                  <div className="break-words opacity-90">{displayError}</div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Error state - only show if no PDF */}
        {displayError && !pdfUrl && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive">{displayError}</p>
            </div>
          </div>
        )}

        {/* Initial loading state - no PDF yet */}
        {!pdfUrl && !displayError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              {isCompiling ? (
                isWarmingUp ? (
                  <>
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-sm font-medium">Warming up the typesetter…</p>
                    <p className="max-w-[19rem] text-center text-xs text-muted-foreground">
                      The typesetter loads into your browser for local processing. Loading time depends on cached resources and your connection.
                    </p>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-sm font-medium">Generating PDF…</p>
                    <p className="text-xs text-muted-foreground">This should only take a moment.</p>
                  </>
                )
              ) : (
                <>
                  <Eye className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Your document preview will appear here</p>
                  <p className="max-w-xs text-center text-xs text-muted-foreground">
                    {isFormsMode
                      ? 'Pick a form and start filling it in on the left — the filled form renders here as you type.'
                      : 'Start editing on the left — your formatted document appears here as you type.'}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
