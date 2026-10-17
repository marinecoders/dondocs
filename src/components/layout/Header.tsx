import { saveCheckpoint } from '@/lib/saveCheckpoint';
import { DraftIdentity } from './DraftIdentity';
import { DocumentNavigation } from './DocumentNavigation';
import { DocumentTypeSelector } from '@/components/editor/DocumentTypeSelector';
import { useState, useCallback, useRef, useEffect, type ChangeEvent, type ReactNode } from 'react';
import { PanelLeft, MoreHorizontal, Copy, History, Wrench, Check, Download, FileText, Braces, RefreshCw, Save, RotateCcw, Layers, Search, FileDown, FileUp, Undo2, Redo2, Eraser, Compass, PanelRight, Link2, FileInput, X, Loader2, FolderOpen, FolderSync, AlertTriangle } from 'lucide-react';
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
import { useDocumentStore, loadSharedSession, persistUnsavedEnclosures } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { detectPlaceholders } from '@/lib/placeholders';
import { useDocumentsStore } from '@/stores/documentsStore';
import { restoreBackup, summarizeRestore } from '@/lib/backup';
import { downloadWorkspaceBackup } from '@/lib/backupDownload';
import { useBackupStore } from '@/stores/backupStore';
import { useHistoryStore } from '@/stores/historyStore';
import { triggerDownload } from '@/lib/encoding';
import { buildDraftFile, parseDraftFile, type ReviewedDraft } from '@/lib/draftFile';
import { persistAttachment } from '@/lib/attachments';
import { SessionPreview } from '@/components/SessionPreview';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { STORAGE_KEYS } from '@/lib/constants';
import { useTourStore } from '@/stores/tourStore';
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

const STORAGE_KEY = STORAGE_KEYS.DOCUMENT;

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
  const setBatchModalOpen = useUIStore((s) => s.setBatchModalOpen);
  const setImportLetterModalOpen = useUIStore((s) => s.setImportLetterModalOpen);
  const setDocumentGuideOpen = useUIStore((s) => s.setDocumentGuideOpen);
  const setFindReplaceOpen = useUIStore((s) => s.setFindReplaceOpen);
  const setShareModal = useUIStore((s) => s.setShareModal);
  const isMobile = useUIStore((s) => s.isMobile);
  const previewVisible = useUIStore((s) => s.previewVisible);
  const mobilePreviewOpen = useUIStore((s) => s.mobilePreviewOpen);
  const previewOpen = isMobile ? mobilePreviewOpen : previewVisible;
  const togglePreview = useUIStore((s) => s.togglePreview);
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
  const [formattingOpen, setFormattingOpen] = useState(false);
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
  const backupStatus = useBackupStore((s) => s.status);
  const backupFileName = useBackupStore((s) => s.fileName);
  const setupBackup = useBackupStore((s) => s.setupBackup);
  const reconnectBackup = useBackupStore((s) => s.reconnect);
  const disableBackup = useBackupStore((s) => s.disable);
  const writeBackupNow = useBackupStore((s) => s.writeNow);

  // Does the document contain any {{VARIABLE}} placeholders? Reads via
  // getState() at click time, so the callback has no store dependencies.
  const hasVariables = useCallback(() => {
    const { documentCategory, formType, formData, paragraphs } = useDocumentStore.getState();
    if (documentCategory === 'forms') {
      const forms = useFormStore.getState();
      const active = formType === 'navmc_118_11' ? forms.navmc11811 : forms.navmc10274;
      return Object.values(active).some((value) => typeof value === 'string' && detectPlaceholders(value).length > 0)
        || active.signatureBlocks.some((block) => detectPlaceholders(`${block.name} ${block.statement}`).length > 0);
    }
    return [formData.subject, formData.from, formData.to, formData.via,
      ...paragraphs.flatMap((paragraph) => [paragraph.text, paragraph.header ?? ''])]
      .some((value) => detectPlaceholders(value ?? '').length > 0);
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
    if (saveCheckpoint()) flashSaveStatus('Checkpoint saved in this browser');
  }, [flashSaveStatus]);

  const handleLoadProgress = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setReviewedDraft(parseDraftFile(JSON.parse(saved), true));
        setDraftError('');
      } else {
        showAppAlert({ title: 'No saved checkpoint', message: 'There is no manually saved checkpoint to open. Your current document has not changed. Choose a document from the sidebar or import a draft file.' });
      }
    } catch (err) {
      console.error('Failed to load progress:', err);
      showAppAlert({ title: 'Could not open saved checkpoint', message: 'The saved checkpoint could not be read. Your current document has not changed. Try another draft or restore a backup.' });
    }
  }, []);

  const handleReset = useCallback(() => {
    const { documentCategory, formType } = useDocumentStore.getState();
    if (documentCategory === 'forms') {
      const forms = useFormStore.getState();
      if (formType === 'navmc_118_11') forms.resetNavmc11811();
      else forms.resetNavmc10274();
    } else resetForm();
    setShowResetDialog(false);
  }, [resetForm]);

  const handleClearFields = useCallback(() => {
    const { documentCategory, formType } = useDocumentStore.getState();
    if (documentCategory === 'forms') {
      const forms = useFormStore.getState();
      if (formType === 'navmc_118_11') forms.clearNavmc11811();
      else forms.clearNavmc10274();
    } else clearFieldsExceptLetterhead();
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
      showAppAlert({ title: 'Could not import draft', message: 'This file is not a valid DonDocs draft. Choose a JSON draft exported by DonDocs. Nothing was changed.' });
    }
  }, []);

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
      showAppAlert({ title: 'Could not back up workspace', message: 'The backup file could not be created. Your documents are still open. Check browser storage and try again before reloading.' });
    }
  }, [flashSaveStatus]);

  const handleImportLibrary = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    void (async () => {
      try {
        // Branches on file kind: full backups restore everything, legacy
        // docs-only files still restore documents. Merges non-destructively.
        const result = await restoreBackup(await file.text());
        flashSaveStatus(summarizeRestore(result));
      } catch (err) {
        console.error('Failed to restore backup:', err);
        showAppAlert({ title: 'Could not restore backup', message: 'The backup could not be read or fully restored. Check the file and available browser storage, then try again. Existing documents were not deleted.' });
      }
    })();
  }, [flashSaveStatus]);

  const currentId = useDocumentsStore((s) => s.currentId);
  const mobileDocsOpen = useUIStore((s) => s.mobileDocsOpen);
  const openHistory = () => {
    const ds = useDocumentsStore.getState();
    // Flush actual edits without creating a deliberate checkpoint just to view history.
    ds.syncCurrent();
    if (ds.currentId) useUIStore.getState().setHistoryDocId(ds.currentId);
  };

  return (
    <header className="workspace-header shrink-0 border-b border-border bg-background">
      <input type="file" aria-label="Import draft file" ref={fileInputRef} onChange={handleImportDraft} accept=".json" className="hidden" />
      <input type="file" aria-label="Restore workspace backup file" ref={libraryInputRef} onChange={handleImportLibrary} accept=".json" className="hidden" />
      <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 sm:px-5 py-2 sm:min-h-16">
        {isMobile ? <HeaderTip label="Open workspace">
          <Button variant="ghost" className="workspace-sidebar-toggle shrink-0 gap-0 overflow-hidden"
            data-tour="workspace-menu" aria-label="Open workspace" aria-expanded={mobileDocsOpen}
            aria-haspopup="dialog" onClick={() => useUIStore.getState().setMobileDocsOpen(true)}
          ><PanelLeft aria-hidden="true" className="h-4 w-4 shrink-0" /></Button>
        </HeaderTip> : null}
        <DraftIdentity />
        <Button variant="ghost" size="sm" className="hidden sm:inline-flex h-8 px-3" onClick={() => setShareModal('share')}>Share</Button>
        <Button variant="ghost" size="sm"
          className="h-10 sm:h-8 px-2 sm:px-3 border border-transparent data-[active=true]:border-primary/20 data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:hover:bg-primary/15"
          aria-label="Preview" aria-pressed={isMobile ? undefined : previewOpen}
          aria-haspopup={isMobile ? 'dialog' : undefined} aria-expanded={isMobile ? previewOpen : undefined}
          data-active={previewOpen}
          onClick={() => isMobile ? useUIStore.getState().setMobilePreviewOpen(true) : togglePreview()}
        ><PanelRight className="h-4 w-4 sm:hidden" /><span className="hidden sm:inline">Preview</span></Button>
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
                    {isDocxGenerating ? 'Generating Word…' : 'Download Word (.docx)'}
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
              <p className="px-2 pb-2 text-xs text-muted-foreground">Drafts autosave. A checkpoint keeps a manual copy until you save another.</p>
              <DropdownMenuItem onClick={() => { const ds = useDocumentsStore.getState(); ds.saveCurrent(); if (ds.currentId) ds.duplicateDocument(ds.currentId); }}><Copy className="h-4 w-4 mr-2" />Duplicate draft</DropdownMenuItem>
              <DropdownMenuItem onClick={handleSaveProgress}>
                <Save className="h-4 w-4 mr-2" />
                Save checkpoint
                <DropdownMenuShortcut>{formatShortcut('mod S')}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLoadProgress}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Open saved checkpoint
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
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Import & export drafts</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setImportLetterModalOpen(true)}><FileUp className="h-4 w-4 mr-2" />Import letter from PDF or Word…</DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportDraft}>
                <FileDown className="h-4 w-4 mr-2" />
                Export draft (.json)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <FileUp className="h-4 w-4 mr-2" />
                Import draft (.json)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Workspace backup</DropdownMenuLabel>
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
                {isFormsMode ? 'Clear form fields' : 'Clear fields (keep letterhead)'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowResetDialog(true)} variant="destructive">
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset all fields
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>


      </div>
      {saveStatus && <div role="status" className="border-b border-border px-4 sm:px-5 py-2 text-xs text-foreground">{saveStatus}</div>}
      <div className="flex min-w-0 flex-wrap items-center gap-1 px-4 sm:px-5 py-2 text-xs">
        <DocumentNavigation />
        <Button variant="ghost" size="sm" className="ml-auto h-10 sm:h-8 px-2" onClick={openHistory} disabled={!currentId}><History className="h-3.5 w-3.5" />History</Button>
        <Button data-tour="batch" variant="ghost" size="sm" className="h-10 sm:h-8 px-2" onClick={() => setBatchModalOpen(true)}><Layers className="h-3.5 w-3.5" />Batch</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Document tools" data-tour="tools" className="h-10 sm:h-8 px-2">
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />Tools
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {!isFormsMode && <DropdownMenuItem onClick={() => setFormattingOpen(true)}><FileText className="h-4 w-4" />Formatting…</DropdownMenuItem>}
              <DropdownMenuItem onClick={handleUndo} disabled={!canUndo}><Undo2 className="h-4 w-4" />Undo<DropdownMenuShortcut>{formatShortcut('mod Z')}</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem onClick={handleRedo} disabled={!canRedo}><Redo2 className="h-4 w-4" />Redo<DropdownMenuShortcut>{formatShortcut(REDO_SHORTCUT)}</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFindReplaceOpen(true)}><Search className="h-4 w-4" />Find and replace<DropdownMenuShortcut>{formatShortcut('mod H')}</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRefreshPreview} disabled={isCompiling}>
                <RefreshCw className={`h-4 w-4 ${isCompiling ? 'animate-spin' : ''}`} />Refresh preview
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDocumentGuideOpen(true)}><Compass className="h-4 w-4" />Document type guide</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
      </div>
      <Dialog open={formattingOpen} onOpenChange={setFormattingOpen}>
        <DialogContent className="sm:max-w-md max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Document formatting</DialogTitle><DialogDescription>Formatting for this correspondence. Changes are applied to the current draft.</DialogDescription></DialogHeader>
          <DocumentTypeSelector />
          <DialogFooter><Button onClick={() => setFormattingOpen(false)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
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
              {isFormsMode
                ? 'This replaces the active form with its sample values. Other documents and saved backups are unchanged.'
                : 'This replaces the active correspondence with the sample naval letter, including its letterhead and content. Other documents and saved backups are unchanged.'}
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
              {isFormsMode
                ? 'This clears all fields and signatures in the active form. Other documents are unchanged.'
                : 'This clears all document content including addressing, signature, paragraphs, references, enclosures, and copy-tos. Your letterhead information (unit name, address, seal, and font settings) will be preserved.'}
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
