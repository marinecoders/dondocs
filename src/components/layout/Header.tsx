import { DraftIdentity } from './DraftIdentity';
import { DocumentNavigation } from './DocumentNavigation';
import { useState, useCallback, useRef, useEffect, type ChangeEvent, type ReactNode } from 'react';
import { PanelLeft, MoreHorizontal, Copy, History, Wrench, Check, Download, FileText, Braces, RefreshCw, Bug, Save, RotateCcw, Shield, HelpCircle, Info, Layers, Search, FileDown, FileUp, ScrollText, Settings, Undo2, Redo2, Eraser, Compass, PanelRight, PanelRightClose, Link2, FileInput, X, Loader2, Lightbulb, FolderOpen, Rocket, FolderSync, AlertTriangle, MonitorDown, Radio } from 'lucide-react';
import { GithubIcon } from '@/components/icons/GithubIcon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatShortcut, isMac } from '@/lib/platform';

// Redo is Ctrl+Y on Windows/Linux but ⌘⇧Z on macOS; the handler accepts both,
// so display the native gesture per platform.
const REDO_SHORTCUT = isMac ? 'mod shift Z' : 'mod Y';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
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
import { showAppAlert } from '@/stores/alertStore';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore, getSerializedSession, loadSharedSession, persistUnsavedEnclosures } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { restoreBackup, summarizeRestore } from '@/lib/backup';
import { downloadWorkspaceBackup } from '@/lib/backupDownload';
import { useBackupStore } from '@/stores/backupStore';
import { useInstallStore } from '@/stores/installStore';
import { promptInstall } from '@/hooks/useInstallPrompt';
import { useHistoryStore } from '@/stores/historyStore';
import { triggerDownload } from '@/lib/encoding';
import { buildDraftFile, parseDraftFile, type ReviewedDraft } from '@/lib/draftFile';
import { persistAttachment } from '@/lib/attachments';
import { SessionPreview } from '@/components/SessionPreview';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { STORAGE_KEYS } from '@/lib/constants';
import { useLogStore } from '@/stores/logStore';
import { useTourStore } from '@/stores/tourStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { safeReportUrl, BUG_REPORT_PRIVACY_NOTICE, BUG_REPORT_LOG_PROMPT } from '@/lib/bugReport';
import { DOC_TYPE_CONFIG } from '@/types/document';

interface HeaderProps {
  onDownloadPdf?: () => void;
  onDownloadTex?: () => void;
  onDownloadDocx?: () => void;
  onDownloadFlatTex?: () => void;
  onRefreshPreview?: () => void;
  isCompiling?: boolean;
  /** True while a DOCX download is in flight; disables the menu item. */
  isDocxGenerating?: boolean;
  /** True while a PDF download is in flight; disables the menu item. */
  isPdfGenerating?: boolean;
  isFormsMode?: boolean;  // Forms mode hides LaTeX options
}

const GITHUB_REPO_URL = 'https://github.com/marinecoders/dondocs';
const GITHUB_NEW_ISSUE_URL = 'https://github.com/marinecoders/dondocs/issues/new';
const STORAGE_KEY = STORAGE_KEYS.DOCUMENT;

/**
 * Build a prefilled "New issue" URL for the Help-menu bug report button.
 * The app's general bug-report entry point. Auto-includes recent error/warning
 * logs and environment (user agent, URL, timestamp). The download-error modal
 * has its own builder that also carries the full compile log and a target.
 */
function buildBugReportUrl(): string {

  const body = [
    BUG_REPORT_PRIVACY_NOTICE,
    '',
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
    BUG_REPORT_LOG_PROMPT,
    '',
    '## Environment',
    `- User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    `- URL: ${safeReportUrl()}`,
    `- Reported: ${new Date().toISOString()}`,
  ].join('\n');

  const params = new URLSearchParams({
    title: '[Bug] ',
    body,
    labels: 'bug',
  });
  return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}

/**
 * Build a prefilled "New issue" URL for the Help-menu feature-suggestion
 * button. Unlike the bug report, nothing is auto-embedded.
 */
function buildFeatureRequestUrl(): string {
  const body = [
    BUG_REPORT_PRIVACY_NOTICE,
    '',
    '<!--',
    'Thanks for helping shape DonDocs. Tell us what you would like it to do.',
    'A rough idea is welcome; the more concrete, the faster we can build it.',
    '-->',
    '',
    '## What would you like to see',
    '<!-- the feature or change, in a sentence or two -->',
    '',
    '## Why it would help',
    '<!-- what it makes easier, faster, or possible -->',
    '',
    '## Anything else',
    '<!-- the document type it applies to, examples, references, or a mockup -->',
    '',
    '## Environment',
    `- URL: ${safeReportUrl()}`,
  ].join('\n');

  const params = new URLSearchParams({
    title: '[Feature] ',
    body,
    labels: 'enhancement',
  });
  return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}

/**
 * Wrap a header control in the styled (themeable, delayed) tooltip. The control
 * keeps its own aria-label for screen readers; the tooltip is the hover hint.
 */
function HeaderTip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
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
  // One selector per field so Zustand only re-renders on that field's change,
  // not on every store update (this header is ~40 buttons + dropdowns). Setters
  // are stable, so selecting them is free. Same for the document + history stores.
  const setAboutModalOpen = useUIStore((s) => s.setAboutModalOpen);
  const setConnectivityModalOpen = useUIStore((s) => s.setConnectivityModalOpen);
  const setNistModalOpen = useUIStore((s) => s.setNistModalOpen);
  const setBatchModalOpen = useUIStore((s) => s.setBatchModalOpen);
  const setImportLetterModalOpen = useUIStore((s) => s.setImportLetterModalOpen);
  const setDocumentGuideOpen = useUIStore((s) => s.setDocumentGuideOpen);
  const setFindReplaceOpen = useUIStore((s) => s.setFindReplaceOpen);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setShareModal = useUIStore((s) => s.setShareModal);
  const isMobile = useUIStore((s) => s.isMobile);
  const previewVisible = useUIStore((s) => s.previewVisible);
  const togglePreview = useUIStore((s) => s.togglePreview);
  // Reopen the getting-started checklist. Hidden once onboarding is finished.
  // Getting started is an explicit Help action on every screen size.
  const checklistCelebrated = useOnboardingStore((s) => s.checklistCelebrated);
  const reopenChecklist = () => useUIStore.getState().setChecklistSheetOpen(true);

  // Actions only, no document-state subscription. The handlers below read the
  // full document via useDocumentStore.getState() at call time, so Header
  // doesn't re-render per keystroke.
  const resetForm = useDocumentStore((s) => s.resetForm);
  const applySnapshot = useDocumentStore((s) => s.applySnapshot);
  const clearFieldsExceptLetterhead = useDocumentStore((s) => s.clearFieldsExceptLetterhead);

  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  // Select the derived booleans, not the stable getter functions, so the
  // Undo/Redo enabled state updates when past/future change.
  const canUndo = useHistoryStore((s) => s.past.length > 0);
  const canRedo = useHistoryStore((s) => s.future.length > 0);
  const [reviewedDraft, setReviewedDraft] = useState<ReviewedDraft | null>(null);
  const [openingDraft, setOpeningDraft] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showClearFieldsDialog, setShowClearFieldsDialog] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  // Pending "clear saveStatus" timeout, tracked so we can cancel it when a new
  // flash replaces an in-flight one and clear it on unmount.
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSaveStatus = useCallback((message: string, durationMs = 2000) => {
    if (saveStatusTimeoutRef.current) {
      clearTimeout(saveStatusTimeoutRef.current);
    }
    setSaveStatus(message);
    saveStatusTimeoutRef.current = setTimeout(() => {
      setSaveStatus(null);
      saveStatusTimeoutRef.current = null;
    }, durationMs);
  }, []);
  useEffect(() => {
    return () => {
      if (saveStatusTimeoutRef.current) {
        clearTimeout(saveStatusTimeoutRef.current);
        saveStatusTimeoutRef.current = null;
      }
    };
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  // Synced-backup file (File System Access API).
  const saveMenuOpen = useUIStore((s) => s.saveMenuOpen);
  const setSaveMenuOpen = useUIStore((s) => s.setSaveMenuOpen);
  const isInstalled = useInstallStore((s) => s.isInstalled);
  const backupStatus = useBackupStore((s) => s.status);
  const backupFileName = useBackupStore((s) => s.fileName);
  const setupBackup = useBackupStore((s) => s.setupBackup);
  const reconnectBackup = useBackupStore((s) => s.reconnect);
  const disableBackup = useBackupStore((s) => s.disable);
  const writeBackupNow = useBackupStore((s) => s.writeNow);

  // Does the document contain any {{VARIABLE}} placeholders? Reads via
  // getState() at click time, so the callback has no store dependencies.
  const hasVariables = useCallback(() => {
    const variablePattern = /\{\{[A-Z0-9_]+\}\}/;
    const { formData, paragraphs } = useDocumentStore.getState();

    const fieldsToCheck = [
      formData.subject,
      formData.from,
      formData.to,
      formData.via,
    ];

    for (const field of fieldsToCheck) {
      if (field && variablePattern.test(field)) return true;
    }

    for (const para of paragraphs) {
      if (variablePattern.test(para.text)) return true;
    }

    return false;
  }, []);

  // Handle download PDF - redirect to batch mode if variables detected
  const handleDownloadPdf = useCallback(() => {
    if (hasVariables()) {
      setBatchModalOpen(true);
    } else if (onDownloadPdf) {
      onDownloadPdf();
    }
  }, [hasVariables, setBatchModalOpen, onDownloadPdf]);

  const docType = useDocumentStore((s) => s.docType);
  const pdfOnly = !!DOC_TYPE_CONFIG[docType]?.pdfOnly;

  const handleSaveProgress = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getSerializedSession()));
      useDocumentsStore.getState().saveCurrent();
    } catch (err) {
      console.error('Failed to save progress:', err);
      flashSaveStatus('Save failed');
    }
  }, [flashSaveStatus]);

  const handleLoadProgress = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setReviewedDraft(parseDraftFile(JSON.parse(saved), true));
        setDraftError('');
      } else {
        flashSaveStatus('No saved data');
      }
    } catch (err) {
      console.error('Failed to load progress:', err);
      flashSaveStatus('Load failed');
    }
  }, [flashSaveStatus]);

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

  const handleExportDraft = useCallback(async () => {
    try {
      const data = await buildDraftFile();
      triggerDownload(new TextEncoder().encode(JSON.stringify(data, null, 2)), `dondocs-draft-${new Date().toISOString().split('T')[0]}.json`, 'application/json');
      flashSaveStatus('Exported!');
    } catch (err) {
      showAppAlert({ title: 'Could not export draft', message: err instanceof Error ? err.message : 'Export failed' });
      flashSaveStatus('Export failed', 5000);
    }
  }, [flashSaveStatus]);

  const handleImportDraft = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setReviewedDraft(parseDraftFile(JSON.parse(await file.text())));
      setDraftError('');
    } catch {
      flashSaveStatus('Invalid draft — nothing was changed', 5000);
    }
  }, [flashSaveStatus]);

  const openReviewedDraft = async () => {
    if (!reviewedDraft) return;
    setOpeningDraft(true);
    try {
      const session = structuredClone(reviewedDraft.session);
      for (const [index, file] of reviewedDraft.figures.entries()) {
        if (file) {
          const figure = session.paragraphs[index].figure!;
          figure.fileRef = await persistAttachment({ name: file.name, size: file.size, type: figure.type ?? 'image/png' }, file.data);
        }
      }
      if (reviewedDraft.basicLetter) {
        const file = reviewedDraft.basicLetter;
        session.formData.basicLetterFileRef = await persistAttachment({ name: file.name, size: file.size, type: 'application/pdf' }, file.data);
      }
      useDocumentsStore.getState().syncCurrent();
      loadSharedSession(session);
      useDocumentStore.setState((state) => ({
        formData: reviewedDraft.basicLetter ? { ...state.formData, basicLetterFile: reviewedDraft.basicLetter } : state.formData,
        enclosures: state.enclosures.map((enclosure, i) => ({ ...enclosure, file: reviewedDraft.files[i] ?? enclosure.file })),
      }));
      useDocumentsStore.getState().openLoadedAsNew();
      await persistUnsavedEnclosures();
      useDocumentsStore.getState().syncCurrent();
      setReviewedDraft(null);
      flashSaveStatus('Imported!');
    } catch {
      setDraftError('Could not finish opening the draft. Check browser storage and try again.');
    } finally { setOpeningDraft(false); }
  };

  // Whole-library backup: export/import EVERY saved document (not just the open
  // one) — a safety net against browser-storage eviction.
  const handleExportLibrary = useCallback(async () => {
    try {
      await downloadWorkspaceBackup();
      flashSaveStatus('Backup download started');
    } catch (err) {
      console.error('Failed to export backup:', err);
      flashSaveStatus('Backup failed');
    }
  }, [flashSaveStatus]);

  const handleImportLibrary = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // Branches on file kind: full backups restore everything, legacy
        // docs-only files still restore documents. Merges non-destructively.
        const result = await restoreBackup(e.target?.result as string);
        flashSaveStatus(summarizeRestore(result));
      } catch (err) {
        console.error('Failed to restore backup:', err);
        flashSaveStatus('Restore failed');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }, [flashSaveStatus]);

  const currentId = useDocumentsStore((s) => s.currentId);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const openHistory = () => { const ds = useDocumentsStore.getState(); ds.saveCurrent(); if (ds.currentId) useUIStore.getState().setHistoryDocId(ds.currentId); };

  return (
    <header className="workspace-header shrink-0 border-b border-border bg-background">
      <input type="file" ref={fileInputRef} onChange={handleImportDraft} accept=".json" className="hidden" />
      <input type="file" ref={libraryInputRef} onChange={handleImportLibrary} accept=".json" className="hidden" />
      <div className="flex min-w-0 items-center gap-2 px-3 sm:px-5 py-3 sm:min-h-[76px]">
        <HeaderTip label={isMobile ? 'Open workspace' : sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
          <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8 shrink-0" aria-label={isMobile ? 'Open workspace' : sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} onClick={() => isMobile ? useUIStore.getState().setMobileDocsOpen(true) : useUIStore.getState().toggleSidebar()}><PanelLeft className="h-4 w-4" /></Button>
        </HeaderTip>
        <DraftIdentity />
        <div aria-live="polite" className="sr-only">{saveStatus}</div>
        {(sidebarCollapsed || isMobile) && <Button variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label="Search workspace" onClick={() => setCommandPaletteOpen(true)}><Search className="h-4 w-4" /></Button>}
        <Button variant="ghost" size="sm" className="hidden sm:inline-flex h-8 px-3" onClick={() => setShareModal('share')}>Share</Button>
        <Button variant="ghost" size="sm" className="h-10 sm:h-8 px-2 sm:px-3" aria-label="Preview" aria-pressed={isMobile ? undefined : previewVisible} onClick={() => isMobile ? useUIStore.getState().setMobilePreviewOpen(true) : togglePreview()}><PanelRight className="h-4 w-4 sm:hidden" /><span className="hidden sm:inline">Preview</span></Button>
          {/* Download dropdown - always visible but compact on smaller screens */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-tour="download" aria-label="Download" variant="default" size="sm" className="h-10 sm:h-8 px-3">
                <Download className="h-4 w-4 sm:hidden" />
                <span className="hidden sm:inline">Download</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleDownloadPdf}
                disabled={isPdfGenerating}
                // Block re-entry while the PDF pipeline runs; the modal doesn't
                // stop a second click on the dropdown item.
              >
                {isPdfGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-2" />
                )}
                {isPdfGenerating ? 'Generating PDF…' : 'Download PDF'}
                {!isPdfGenerating && (
                  <DropdownMenuShortcut>{formatShortcut('mod D')}</DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
              {/* LaTeX and DOCX only available for correspondence; publication
                  types are delivered as PDF and offer no DOCX at all. */}
              {!isFormsMode && !pdfOnly && (
                <>
                  <DropdownMenuItem
                    onClick={onDownloadDocx}
                    disabled={isDocxGenerating}
                    // Radix sets pointer-events:none on disabled items, so a
                    // second click can't fire while pandoc is running.
                  >
                    {isDocxGenerating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4 mr-2" />
                    )}
                    {isDocxGenerating ? 'Generating DOCX…' : 'Download DOCX'}
                  </DropdownMenuItem>
                  {/* Code exports are a secondary tier: separated + muted with a
                      Braces glyph so they read below the document exports. */}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onDownloadTex} className="text-muted-foreground">
                    <Braces className="h-4 w-4 mr-2" />
                    Download LaTeX
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onDownloadFlatTex} className="text-muted-foreground">
                    <Braces className="h-4 w-4 mr-2" />
                    Download Flat LaTeX (Pandoc)
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu
            open={saveMenuOpen}
            onOpenChange={(open) => {
              if (!open && useTourStore.getState().active) return;
              setSaveMenuOpen(open);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button data-tour="save" aria-label="Document actions" variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Draft (this browser)</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => { const ds = useDocumentsStore.getState(); ds.saveCurrent(); if (ds.currentId) ds.duplicateDocument(ds.currentId); }}><Copy className="h-4 w-4 mr-2" />Duplicate draft</DropdownMenuItem>
              <DropdownMenuItem onClick={handleSaveProgress}>
                <Save className="h-4 w-4 mr-2" />
                Save draft
                <DropdownMenuShortcut>{formatShortcut('mod S')}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLoadProgress}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Open saved draft
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Share</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setShareModal('share')}>
                <Link2 className="h-4 w-4 mr-2" />
                Create share link…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShareModal('import')}>
                <FileInput className="h-4 w-4 mr-2" />
                Open from share link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportLetterModalOpen(true)}>
                <FileUp className="h-4 w-4 mr-2" />
                Import letter from PDF or Word…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Backup file (.json)</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleExportDraft}>
                <FileDown className="h-4 w-4 mr-2" />
                Export to file
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <FileUp className="h-4 w-4 mr-2" />
                Import from file
              </DropdownMenuItem>
              <DropdownMenuItem data-tour="backup-export" onClick={handleExportLibrary}>
                <FileDown className="h-4 w-4 mr-2" />
                Back up everything
              </DropdownMenuItem>
              <DropdownMenuItem data-tour="backup-restore" onClick={() => libraryInputRef.current?.click()}>
                <FileUp className="h-4 w-4 mr-2" />
                Restore from backup
              </DropdownMenuItem>
              {/* data-tour="backup-auto" rides on whichever auto-backup item the
                  current status renders, so the walkthrough spotlights the right
                  control in every state (absent on non-Chromium, where the tour
                  falls back to a centered card). */}
              {backupStatus === 'off' && (
                <DropdownMenuItem data-tour="backup-auto" onClick={() => void setupBackup()}>
                  <FolderSync className="h-4 w-4 mr-2" />
                  Set up auto-backup…
                </DropdownMenuItem>
              )}
              {backupStatus === 'needs-permission' && (
                <DropdownMenuItem data-tour="backup-auto" onClick={() => void reconnectBackup()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reconnect auto-backup
                </DropdownMenuItem>
              )}
              {backupStatus === 'error' && (
                <>
                  <DropdownMenuItem
                    onClick={() => void writeBackupNow()}
                    className="text-warning"
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    <span className="truncate">Auto-backup failing — retry now</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem data-tour="backup-auto" onClick={() => void setupBackup()}>
                    <FolderSync className="h-4 w-4 mr-2" />
                    Choose a different backup file…
                  </DropdownMenuItem>
                </>
              )}
              {backupStatus === 'connected' && (
                <>
                  <DropdownMenuItem data-tour="backup-auto" disabled className="opacity-100">
                    <Check className="h-4 w-4 mr-2 text-primary" />
                    <span className="truncate">Auto-backup: {backupFileName}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void disableBackup()}>
                    <X className="h-4 w-4 mr-2" />
                    Turn off auto-backup
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowClearFieldsDialog(true)} className="text-warning">
                <Eraser className="h-4 w-4 mr-2" />
                Clear fields (keep letterhead)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowResetDialog(true)} variant="destructive">
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset all fields
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>


      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1 px-4 sm:px-6 pb-2 text-xs">
        <DocumentNavigation />
        <Button variant="ghost" size="sm" className="ml-auto h-10 sm:h-8 px-2" onClick={openHistory} disabled={!currentId}><History className="h-3.5 w-3.5" />History</Button>
        <Button data-tour="batch" variant="ghost" size="sm" className="h-10 sm:h-8 px-2" onClick={() => setBatchModalOpen(true)}><Layers className="h-3.5 w-3.5" />Batch</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Document tools" className="h-10 sm:h-8 px-2">
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />Tools
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {/* Quick actions */}
              <DropdownMenuItem onClick={handleUndo} disabled={!canUndo}><Undo2 className="h-4 w-4 mr-2" />Undo</DropdownMenuItem>
              <DropdownMenuItem onClick={handleRedo} disabled={!canRedo}><Redo2 className="h-4 w-4 mr-2" />Redo<DropdownMenuShortcut>{formatShortcut(REDO_SHORTCUT)}</DropdownMenuShortcut></DropdownMenuItem>
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
              <DropdownMenuItem onClick={() => setConnectivityModalOpen(true)}><Radio className="h-4 w-4 mr-2" />Endpoint Check</DropdownMenuItem>
              <DropdownMenuItem onClick={() => useUIStore.getState().setSettingsOpen(true)}><Settings className="h-4 w-4 mr-2" />Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Help section */}
              <DropdownMenuItem onClick={() => useUIStore.getState().setHelpOpen(true)}>
                <HelpCircle className="h-4 w-4 mr-2" />Help & keyboard shortcuts
              </DropdownMenuItem>
              <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Help</div>
              <DropdownMenuItem onClick={() => useTourStore.getState().start()}>
                <Compass className="h-4 w-4 mr-2" />
                Take the Tour
              </DropdownMenuItem>
              {!checklistCelebrated && (
                <DropdownMenuItem onClick={reopenChecklist}>
                  <Rocket className="h-4 w-4 mr-2" />
                  Getting started
                </DropdownMenuItem>
              )}
              {!isInstalled && (
                <DropdownMenuItem onClick={() => void promptInstall()}>
                  <MonitorDown className="h-4 w-4 mr-2" />
                  Install app
                </DropdownMenuItem>
              )}
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
              <DropdownMenuItem onClick={() => window.open(GITHUB_REPO_URL, '_blank', 'noopener,noreferrer')}>
                <GithubIcon className="h-4 w-4 mr-2" />
                GitHub
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(buildBugReportUrl(), '_blank', 'noopener,noreferrer')}>
                <Bug className="h-4 w-4 mr-2" />
                Report Bug
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(buildFeatureRequestUrl(), '_blank', 'noopener,noreferrer')}>
                <Lightbulb className="h-4 w-4 mr-2" />
                Suggest Feature
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
      </div>
      <Dialog open={!!reviewedDraft} onOpenChange={(open) => { if (!open && !openingDraft) setReviewedDraft(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Review draft</DialogTitle><DialogDescription>Open a separate editable copy. Your current document stays in Recents.</DialogDescription></DialogHeader>
          {reviewedDraft && <><SessionPreview session={reviewedDraft.session} /><p className="text-sm text-muted-foreground">{reviewedDraft.session.enclosures.filter((e, i) => e.fileRef || reviewedDraft.files[i]).length} attached files{reviewedDraft.basicLetter || reviewedDraft.session.formData.basicLetterFileRef ? ' and a basic letter' : ''} included.</p></>}
          {draftError && <p role="alert" className="text-sm text-destructive">{draftError}</p>}
          <DialogFooter><Button variant="outline" disabled={openingDraft} onClick={() => setReviewedDraft(null)}>Cancel</Button><Button disabled={openingDraft} onClick={() => void openReviewedDraft()}>{openingDraft ? 'Opening…' : 'Open as new document'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
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
              Reset everything
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
            <AlertDialogAction onClick={handleClearFields} className="bg-warning text-warning-foreground hover:bg-warning/90">
              Clear fields
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
