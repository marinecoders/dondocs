import { useState, useCallback, useRef, useEffect, type ChangeEvent } from 'react';
import { Moon, Sun, Download, FileText, RefreshCw, Github, Bug, Save, RotateCcw, Shield, HelpCircle, Info, Layers, Search, Keyboard, Menu, FileDown, FileUp, ScrollText, SlidersHorizontal, Minimize2, Maximize2, Check, Settings, Undo2, Redo2, Eraser, Compass, PanelRight, PanelRightClose, Link2, FileInput, X, Zap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useHistoryStore } from '@/stores/historyStore';
import { uint8ArrayToBase64, base64ToUint8Array, arrayBufferToUint8Array } from '@/lib/encoding';
import { useLogStore } from '@/stores/logStore';

interface HeaderProps {
  onDownloadPdf?: () => void;
  onDownloadTex?: () => void;
  onDownloadDocx?: () => void;
  onDownloadFlatTex?: () => void;
  onRefreshPreview?: () => void;
  isCompiling?: boolean;
  /**
   * True while a DOCX download is in flight. Disables the DOCX menu item and
   * swaps its icon for a spinner so a second click can't spawn a parallel
   * conversion (the pandoc WASM module is a singleton but the modal UX is not).
   */
  isDocxGenerating?: boolean;
  /**
   * True while a PDF download is in flight (compile → merge → sign → save).
   * Disables the PDF menu item and swaps its icon for a spinner so a second
   * click can't start a parallel compile while the modal is up.
   */
  isPdfGenerating?: boolean;
  isFormsMode?: boolean;  // Whether we're in forms mode (hides LaTeX options)
}

const GITHUB_REPO_URL = 'https://github.com/marinecoders/dondocs';
const GITHUB_NEW_ISSUE_URL = 'https://github.com/marinecoders/dondocs/issues/new';
const STORAGE_KEY = 'dondocs-document';

// GitHub URLs over ~8 KB start to fail in some browsers; cap the prefilled
// log payload so the link always works. Users can still copy full logs from
// Help → View Logs if they need the rest.
const GH_ISSUE_LOG_MAX = 4000;
// How many recent log entries to auto-include. We filter to errors + warnings
// first — if there aren't enough, we fall back to the tail of all levels so
// non-error bugs (UI glitches, etc.) still get useful context.
const RECENT_LOG_COUNT = 40;

/**
 * Grab recent logs from the LogStore for auto-inclusion in a bug report.
 * Prioritizes errors/warnings (what devs actually care about), falls back to
 * the tail of all levels if there aren't enough signal-level entries.
 * Returns null if logging isn't available or the store is empty.
 */
function collectRecentLogs(): string | null {
  const logs = useLogStore.getState().logs;
  if (logs.length === 0) return null;

  // Prefer error + warn; if we don't have at least a handful, include the
  // tail of everything so there's still something to look at.
  const signalLogs = logs.filter((l) => l.level === 'error' || l.level === 'warn');
  const picked = signalLogs.length >= 5
    ? signalLogs.slice(-RECENT_LOG_COUNT)
    : logs.slice(-RECENT_LOG_COUNT);

  const formatted = picked
    .map((l) => `[${l.timestamp.toISOString()}] [${l.level.toUpperCase()}] ${l.message}`)
    .join('\n');

  if (formatted.length > GH_ISSUE_LOG_MAX) {
    const truncated = formatted.slice(-GH_ISSUE_LOG_MAX);
    return `… [older entries truncated — ${formatted.length - GH_ISSUE_LOG_MAX} more chars in Help → View Logs]\n${truncated}`;
  }
  return formatted;
}

/**
 * Build a prefilled "New issue" URL for the Help-menu bug report button.
 *
 * This is the app's universal bug-report entry point — used anywhere the
 * user notices something wrong (UI glitch, unexpected behavior, etc.), not
 * just download failures. To keep it a true catch-all, we auto-include:
 *   - Recent error + warning logs from the LogStore (so reports about weird
 *     behavior still carry context the dev can act on)
 *   - Environment (user agent, URL, timestamp)
 *
 * The download-error modal uses its own, richer builder that includes the
 * full compile log and a target ("pdf" | "docx") — the two complement each
 * other rather than overlap.
 */
function buildBugReportUrl(): string {
  const recentLogs = collectRecentLogs();

  const body = [
    '<!--',
    'Thanks for reporting a bug! Not every section below is required — fill',
    'in what you can and delete anything that does not apply. The more',
    'context you share, the faster we can track down and fix the issue.',
    '',
    'Reporting bugs and suggesting features is the fastest way to get them',
    'fixed or built — we triage every report.',
    '-->',
    '',
    '## What happened',
    '<!-- describe the bug in a sentence or two -->',
    '',
    '## Steps to reproduce',
    '<!-- 1. ...',
    '2. ...',
    '3. ... -->',
    '',
    '## Expected behavior',
    '<!-- what you expected to happen instead -->',
    '',
    '## Screenshots',
    '<!-- paste images here if relevant -->',
    '',
    '## Logs',
    recentLogs
      ? '<!-- auto-captured from the in-app log store. Full logs available via Help → View Logs. -->\n```\n' +
        recentLogs +
        '\n```'
      : '<!-- no recent errors were captured. If this bug produced one, open Help → View Logs, copy what you see, and paste below. -->\n```\n\n```',
    '',
    '## Environment',
    `- User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    `- URL: ${typeof window !== 'undefined' ? window.location.href : 'unknown'}`,
    `- Reported: ${new Date().toISOString()}`,
  ].join('\n');

  const params = new URLSearchParams({
    title: '[Bug] ',
    body,
    labels: 'bug',
  });
  return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}

export function Header({
  onDownloadPdf,
  onDownloadTex,
  onDownloadDocx,
  onDownloadFlatTex,
  onRefreshPreview,
  isCompiling,
  isDocxGenerating = false,
  isPdfGenerating = false,
  isFormsMode = false,
}: HeaderProps) {
  const { theme, toggleTheme, density, setDensity, autoSaveStatus, setAboutModalOpen, setNistModalOpen, setBatchModalOpen, setDocumentGuideOpen, setFindReplaceOpen, setShareModal, isMobile, previewVisible, togglePreview, fullQualityPreview, setFullQualityPreview } = useUIStore();
  const documentStore = useDocumentStore();
  const { resetForm, applySnapshot, clearFieldsExceptLetterhead } = useDocumentStore();
  const { undo, redo, canUndo, canRedo } = useHistoryStore();
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showClearFieldsDialog, setShowClearFieldsDialog] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem('dondocs-banner-dismissed');
      if (dismissed === 'true') setBannerDismissed(true);
    } catch { /* localStorage unavailable (private browsing) */ }
  }, []);

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    try {
      localStorage.setItem('dondocs-banner-dismissed', 'true');
    } catch { /* localStorage unavailable */ }
  }, []);

  // Check if document contains any {{VARIABLE}} placeholders
  const hasVariables = useCallback(() => {
    const variablePattern = /\{\{[A-Z0-9_]+\}\}/;
    const { formData, paragraphs } = documentStore;

    // Check common text fields
    const fieldsToCheck = [
      formData.subject,
      formData.from,
      formData.to,
      formData.via,
    ];

    for (const field of fieldsToCheck) {
      if (field && variablePattern.test(field)) return true;
    }

    // Check paragraphs
    for (const para of paragraphs) {
      if (variablePattern.test(para.text)) return true;
    }

    return false;
  }, [documentStore]);

  // Handle download PDF - redirect to batch mode if variables detected
  const handleDownloadPdf = useCallback(() => {
    if (hasVariables()) {
      setBatchModalOpen(true);
    } else if (onDownloadPdf) {
      onDownloadPdf();
    }
  }, [hasVariables, setBatchModalOpen, onDownloadPdf]);

  const handleSaveProgress = useCallback(() => {
    try {
      const dataToSave = {
        documentMode: documentStore.documentMode,
        docType: documentStore.docType,
        formData: documentStore.formData,
        references: documentStore.references,
        // Enclosures with files need special handling - we'll save metadata only
        enclosures: documentStore.enclosures.map(encl => ({
          title: encl.title,
          pageStyle: encl.pageStyle,
          hasCoverPage: encl.hasCoverPage,
          coverPageDescription: encl.coverPageDescription,
          // Don't save file data (too large for localStorage)
          hasFile: !!encl.file,
          fileName: encl.file?.name,
        })),
        paragraphs: documentStore.paragraphs,
        copyTos: documentStore.copyTos,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
      setSaveStatus('Saved!');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (err) {
      console.error('Failed to save progress:', err);
      setSaveStatus('Save failed');
      setTimeout(() => setSaveStatus(null), 2000);
    }
  }, [documentStore]);

  const handleLoadProgress = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        documentStore.setDocumentMode?.(data.documentMode || 'compliant');
        if (data.docType) {
          documentStore.setDocType(data.docType);
        }
        if (data.formData) {
          documentStore.setFormData(data.formData);
        }
        // Note: File data is not restored - user will need to re-attach PDFs
        setSaveStatus('Loaded!');
        setTimeout(() => setSaveStatus(null), 2000);
      } else {
        setSaveStatus('No saved data');
        setTimeout(() => setSaveStatus(null), 2000);
      }
    } catch (err) {
      console.error('Failed to load progress:', err);
      setSaveStatus('Load failed');
      setTimeout(() => setSaveStatus(null), 2000);
    }
  }, [documentStore]);

  const handleReset = useCallback(() => {
    resetForm();
    localStorage.removeItem(STORAGE_KEY);
    setShowResetDialog(false);
  }, [resetForm]);

  const handleClearFields = useCallback(() => {
    clearFieldsExceptLetterhead();
    setShowClearFieldsDialog(false);
  }, [clearFieldsExceptLetterhead]);

  const handleUndo = useCallback(() => {
    const snapshot = undo();
    if (snapshot) {
      applySnapshot(snapshot);
    }
  }, [undo, applySnapshot]);

  const handleRedo = useCallback(() => {
    const snapshot = redo();
    if (snapshot) {
      applySnapshot(snapshot);
    }
  }, [redo, applySnapshot]);

  // Export entire document state to a JSON file
  const handleExportDraft = useCallback(() => {
    try {
      const dataToExport = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        documentMode: documentStore.documentMode,
        documentCategory: documentStore.documentCategory,
        docType: documentStore.docType,
        formType: documentStore.formType,
        formData: documentStore.formData,
        references: documentStore.references,
        // Include enclosure file data as base64 for full restoration
        enclosures: documentStore.enclosures.map(encl => ({
          title: encl.title,
          pageStyle: encl.pageStyle,
          hasCoverPage: encl.hasCoverPage,
          coverPageDescription: encl.coverPageDescription,
          file: encl.file ? {
            name: encl.file.name,
            size: encl.file.size,
            // Convert ArrayBuffer to base64 for JSON serialization
            data: uint8ArrayToBase64(arrayBufferToUint8Array(encl.file.data)),
          } : null,
        })),
        paragraphs: documentStore.paragraphs,
        copyTos: documentStore.copyTos,
      };

      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().split('T')[0];
      a.download = `dondocs-draft-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSaveStatus('Exported!');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (err) {
      console.error('Failed to export draft:', err);
      setSaveStatus('Export failed');
      setTimeout(() => setSaveStatus(null), 2000);
    }
  }, [documentStore]);

  // Import document state from a JSON file
  const handleImportDraft = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        // Validate it's a dondocs draft file
        if (!data.version || !data.docType) {
          throw new Error('Invalid draft file format');
        }

        // Apply document mode
        if (data.documentMode) {
          documentStore.setDocumentMode?.(data.documentMode);
        }

        // Apply document category
        if (data.documentCategory) {
          documentStore.setDocumentCategory(data.documentCategory);
        }

        // Apply document type
        if (data.docType) {
          documentStore.setDocType(data.docType);
        }

        // Apply form type
        if (data.formType) {
          documentStore.setFormType(data.formType);
        }

        // Apply form data
        if (data.formData) {
          documentStore.setFormData(data.formData);
        }

        // Use loadTemplate for bulk loading (handles references, enclosures, paragraphs, copyTos)
        documentStore.loadTemplate({
          references: data.references || [],
          enclosures: data.enclosures?.map((encl: {
            title: string;
            pageStyle?: string;
            hasCoverPage?: boolean;
            coverPageDescription?: string;
            file?: { name: string; size: number; data: string } | null;
          }) => ({
            title: encl.title,
            pageStyle: encl.pageStyle,
            hasCoverPage: encl.hasCoverPage,
            coverPageDescription: encl.coverPageDescription,
            file: encl.file ? {
              name: encl.file.name,
              size: encl.file.size,
              // Convert base64 back to ArrayBuffer
              data: base64ToUint8Array(encl.file.data).buffer as ArrayBuffer,
            } : undefined,
          })) || [],
          paragraphs: data.paragraphs?.map((para: { text: string; level?: number; header?: string; portionMarking?: string }) => ({
            text: para.text,
            level: para.level || 0,
            header: para.header,
            portionMarking: para.portionMarking,
          })) || [],
          copyTos: data.copyTos || [],
        });

        setSaveStatus('Imported!');
        setTimeout(() => setSaveStatus(null), 2000);
      } catch (err) {
        console.error('Failed to import draft:', err);
        setSaveStatus('Import failed');
        setTimeout(() => setSaveStatus(null), 2000);
      }
    };

    reader.readAsText(file);
    // Reset the input so the same file can be selected again
    event.target.value = '';
  }, [documentStore]);

  return (
    <header className="border-b-2 border-primary/40 bg-gradient-to-r from-card via-card to-secondary/30 shadow-card">
      {/* Dismissable beta release banner */}
      {!bannerDismissed && (
        <div className="bg-amber-500/90 text-amber-950 text-xs font-medium py-1 text-center tracking-wide relative">
          Not an official DoW website. Beta release - report issues on GitHub.
          <button
            onClick={dismissBanner}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-amber-700/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-900 transition-colors"
            aria-label="Dismiss banner"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="px-density-2 sm:px-density-4 py-density-2 sm:py-density-3">
      {/* Hidden file input for importing drafts */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportDraft}
        accept=".json"
        className="hidden"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 lg:gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 lg:h-6 lg:w-6 text-primary shrink-0" />
            <div className="flex flex-col min-w-0">
              <h1 className="text-sm lg:text-lg font-bold text-foreground leading-tight truncate tracking-wide">
                <span className="hidden sm:inline">Naval Correspondence</span>
                <span className="sm:hidden">Naval Corr.</span>
              </h1>
              <span className="text-xs text-muted-foreground hidden lg:block leading-tight tracking-wider uppercase">Generator</span>
            </div>
          </div>
          {/* NIST 800-171 Compliance Badge - icon only below lg, full badge on lg+ */}
          <button
            onClick={() => setNistModalOpen(true)}
            className="flex items-center justify-center gap-1.5 rounded-md bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 text-xs cursor-pointer hover:bg-green-500/20 transition-colors p-1.5 lg:px-2 lg:py-1 shrink-0"
            title="Click to learn about NIST 800-171 compliance"
          >
            <Shield className="h-4 w-4 lg:h-3 lg:w-3" />
            <span className="hidden lg:inline">NIST 800-171</span>
          </button>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Aria-live region for status announcements - WCAG 4.1.3 */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {saveStatus || autoSaveStatus}
          </div>
          {(autoSaveStatus || saveStatus) && (
            <span className="text-xs text-muted-foreground hidden lg:inline" aria-hidden="true">
              {saveStatus || autoSaveStatus}
            </span>
          )}

          {/* Undo/Redo buttons - always visible */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleUndo}
            disabled={!canUndo()}
            aria-label="Undo (Ctrl+Z)"
            title="Undo (Ctrl+Z)"
            className="h-8 w-8 sm:h-9 sm:w-9"
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRedo}
            disabled={!canRedo()}
            aria-label="Redo (Ctrl+Y)"
            title="Redo (Ctrl+Y)"
            className="h-8 w-8 sm:h-9 sm:w-9"
          >
            <Redo2 className="h-4 w-4" aria-hidden="true" />
          </Button>

          {/* Refresh - hidden below xl, in hamburger menu */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefreshPreview}
            disabled={isCompiling}
            aria-label="Refresh Preview"
            title="Refresh Preview"
            className="h-8 w-8 sm:h-9 sm:w-9 hidden xl:flex"
          >
            <RefreshCw className={`h-4 w-4 ${isCompiling ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>

          {/* Preview toggle - hidden below xl and on mobile devices */}
          {!isMobile && (
            <Button
              variant={previewVisible ? "default" : "outline"}
              size="sm"
              onClick={togglePreview}
              aria-label={previewVisible ? "Hide Preview (Ctrl+E)" : "Show Preview (Ctrl+E)"}
              title={previewVisible ? "Hide Preview (Ctrl+E)" : "Show Preview (Ctrl+E)"}
              className="h-8 px-2 sm:px-3 hidden xl:flex"
            >
              {previewVisible ? (
                <PanelRightClose className="h-4 w-4 xl:mr-2" aria-hidden="true" />
              ) : (
                <PanelRight className="h-4 w-4 xl:mr-2" aria-hidden="true" />
              )}
              <span className="hidden 2xl:inline">Preview</span>
            </Button>
          )}

          {/* Save/Load dropdown - always visible but compact on smaller screens */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 px-2 lg:px-3">
                <Save className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">Save</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleSaveProgress}>
                <Save className="h-4 w-4 mr-2" />
                Save Progress
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLoadProgress}>
                <Download className="h-4 w-4 mr-2" />
                Load Saved
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShareModal('share')}>
                <Link2 className="h-4 w-4 mr-2" />
                Share link…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShareModal('import')}>
                <FileInput className="h-4 w-4 mr-2" />
                Import from link
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleExportDraft}>
                <FileDown className="h-4 w-4 mr-2" />
                Export Draft to File
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <FileUp className="h-4 w-4 mr-2" />
                Import Draft from File
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowClearFieldsDialog(true)} className="text-orange-600 dark:text-orange-400">
                <Eraser className="h-4 w-4 mr-2" />
                Clear Fields (Keep Letterhead)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowResetDialog(true)} className="text-destructive">
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset All Fields
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Download dropdown - always visible but compact on smaller screens */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 px-2 lg:px-3">
                <Download className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">Download</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleDownloadPdf}
                disabled={isPdfGenerating}
                // Block re-entry while the PDF pipeline is running — same
                // rationale as DOCX: the modal blocks the app visually but a
                // second click on the dropdown item would still fire.
              >
                {isPdfGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-2" />
                )}
                {isPdfGenerating ? 'Generating PDF…' : 'Download PDF'}
              </DropdownMenuItem>
              {/* LaTeX and DOCX only available for correspondence */}
              {!isFormsMode && (
                <>
                  <DropdownMenuItem
                    onClick={onDownloadDocx}
                    disabled={isDocxGenerating}
                    // Radix treats `disabled` on menu items correctly (aria-disabled
                    // + pointer-events none), so a second click can't fire while
                    // the WASM is still loading or pandoc is running.
                  >
                    {isDocxGenerating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4 mr-2" />
                    )}
                    {isDocxGenerating ? 'Generating DOCX…' : 'Download DOCX'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onDownloadTex}>
                    <FileText className="h-4 w-4 mr-2" />
                    Download LaTeX
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onDownloadFlatTex}>
                    <FileText className="h-4 w-4 mr-2" />
                    Download Flat LaTeX (Pandoc)
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Guide button - hidden below xl */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 xl:px-3 hidden xl:flex"
            onClick={() => setDocumentGuideOpen(true)}
            title="When to use each document type"
          >
            <Compass className="h-4 w-4 xl:mr-2" />
            <span className="hidden 2xl:inline">Guide</span>
          </Button>

          {/* Find & Replace button - hidden below xl */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 xl:px-3 hidden xl:flex"
            onClick={() => setFindReplaceOpen(true)}
            title="Find & Replace (Ctrl+H)"
          >
            <Search className="h-4 w-4 xl:mr-2" />
            <span className="hidden 2xl:inline">Find</span>
          </Button>

          {/* Batch Generation button - hidden below xl */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 xl:px-3 hidden xl:flex"
            onClick={() => setBatchModalOpen(true)}
            title="Generate multiple documents with variables"
          >
            <Layers className="h-4 w-4 xl:mr-2" />
            <span className="hidden 2xl:inline">Batch</span>
          </Button>

          {/* Help dropdown - hidden below xl */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Help & Info" title="Help & Info" className="h-8 w-8 hidden xl:flex">
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onClick={() => setNistModalOpen(true)}>
                <Shield className="h-4 w-4 mr-2" />
                NIST 800-171 Compliance
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAboutModalOpen(true)}>
                <Info className="h-4 w-4 mr-2" />
                About
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.open(GITHUB_REPO_URL, '_blank')}>
                <Github className="h-4 w-4 mr-2" />
                View on GitHub
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(buildBugReportUrl(), '_blank', 'noopener,noreferrer')}>
                <Bug className="h-4 w-4 mr-2" />
                Report a Bug
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => useLogStore.getState().setOpen(true)}>
                <ScrollText className="h-4 w-4 mr-2" />
                View Logs
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5">
                <h4 className="font-medium text-sm mb-2 flex items-center">
                  <Keyboard className="h-4 w-4 mr-2" />
                  Keyboard Shortcuts
                </h4>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div className="text-muted-foreground">Download PDF</div>
                  <div className="font-mono text-right">Ctrl+D</div>
                  <div className="text-muted-foreground">Save Draft</div>
                  <div className="font-mono text-right">Ctrl+S</div>
                  <div className="text-muted-foreground">Find & Replace</div>
                  <div className="font-mono text-right">Ctrl+H</div>
                  <div className="text-muted-foreground">Toggle Preview</div>
                  <div className="font-mono text-right">Ctrl+E</div>
                  <div className="text-muted-foreground">Undo / Redo</div>
                  <div className="font-mono text-right">Ctrl+Z/Y</div>
                </div>
                <p className="text-xs text-muted-foreground mt-2 pt-1 border-t">
                  Mac: Use Cmd instead of Ctrl
                </p>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Appearance dropdown - hidden below xl */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Appearance settings" title="Appearance" className="h-8 w-8 sm:h-9 sm:w-9 hidden xl:flex">
                <Settings className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {/* Theme */}
              <DropdownMenuItem onClick={toggleTheme} className="flex items-center justify-between">
                <div className="flex items-center">
                  {theme === 'dark' ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Density */}
              <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Density</div>
              <DropdownMenuItem onClick={() => setDensity('compact')} className="flex items-center justify-between">
                <div className="flex items-center">
                  <Minimize2 className="h-4 w-4 mr-2" />
                  Compact
                </div>
                {density === 'compact' && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDensity('comfortable')} className="flex items-center justify-between">
                <div className="flex items-center">
                  <SlidersHorizontal className="h-4 w-4 mr-2" />
                  Comfortable
                </div>
                {density === 'comfortable' && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDensity('spacious')} className="flex items-center justify-between">
                <div className="flex items-center">
                  <Maximize2 className="h-4 w-4 mr-2" />
                  Spacious
                </div>
                {density === 'spacious' && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Preview quality */}
              <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Preview</div>
              <DropdownMenuItem onClick={() => setFullQualityPreview(!fullQualityPreview)} className="flex items-center justify-between">
                <div className="flex items-center">
                  <Zap className="h-4 w-4 mr-2" />
                  Full Quality
                </div>
                {fullQualityPreview && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
              <p className="px-2 pb-1.5 text-[10px] text-muted-foreground leading-tight">
                Includes enclosures, hyperlinks, and signatures in live preview. May slow compilation.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Hamburger menu - visible below xl breakpoint (1280px) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="h-8 w-8 xl:hidden">
                <Menu className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {/* Quick actions */}
              <DropdownMenuItem onClick={onRefreshPreview} disabled={isCompiling}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isCompiling ? 'animate-spin' : ''}`} />
                Refresh Preview
              </DropdownMenuItem>
              {!isMobile && (
                <DropdownMenuItem onClick={togglePreview}>
                  {previewVisible ? <PanelRightClose className="h-4 w-4 mr-2" /> : <PanelRight className="h-4 w-4 mr-2" />}
                  {previewVisible ? 'Hide Preview' : 'Show Preview'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {/* Tools section */}
              <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Tools</div>
              <DropdownMenuItem onClick={() => setDocumentGuideOpen(true)}>
                <Compass className="h-4 w-4 mr-2" />
                Document Guide
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setBatchModalOpen(true)}>
                <Layers className="h-4 w-4 mr-2" />
                Batch Generation
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFindReplaceOpen(true)}>
                <Search className="h-4 w-4 mr-2" />
                Find & Replace
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Appearance section */}
              <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Appearance</div>
              <DropdownMenuItem onClick={toggleTheme}>
                {theme === 'dark' ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Help section */}
              <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Help</div>
              <DropdownMenuItem onClick={() => setNistModalOpen(true)}>
                <Shield className="h-4 w-4 mr-2" />
                NIST 800-171
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAboutModalOpen(true)}>
                <Info className="h-4 w-4 mr-2" />
                About
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => useLogStore.getState().setOpen(true)}>
                <ScrollText className="h-4 w-4 mr-2" />
                View Logs
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(GITHUB_REPO_URL, '_blank')}>
                <Github className="h-4 w-4 mr-2" />
                GitHub
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(buildBugReportUrl(), '_blank', 'noopener,noreferrer')}>
                <Bug className="h-4 w-4 mr-2" />
                Report Bug
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      </div>

      {/* Reset confirmation dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset All Fields?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all form data, references, enclosures, and paragraphs.
              Any saved progress will also be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Reset Everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear fields (keep letterhead) confirmation dialog */}
      <AlertDialog open={showClearFieldsDialog} onOpenChange={setShowClearFieldsDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Fields?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all document content including addressing, signature, paragraphs,
              references, enclosures, and copy-tos. Your letterhead information (unit name,
              address, seal, and font settings) will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearFields} className="bg-orange-600 text-white hover:bg-orange-700">
              Clear Fields
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
