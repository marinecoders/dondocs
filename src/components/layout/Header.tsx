import { useState, useCallback, useRef, useEffect, type ChangeEvent, type ReactNode } from 'react';
import { Moon, Sun, Download, FileText, Braces, RefreshCw, Bug, Save, RotateCcw, Shield, HelpCircle, Info, Layers, Search, Keyboard, Menu, FileDown, FileUp, ScrollText, SlidersHorizontal, Minimize2, Maximize2, Check, Settings, Undo2, Redo2, Eraser, Compass, PanelRight, PanelRightClose, Link2, FileInput, X, Zap, Loader2, Lightbulb, FolderOpen, Rocket, FolderSync, AlertTriangle } from 'lucide-react';
import { GithubIcon } from '@/components/icons/GithubIcon';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatShortcut } from '@/lib/platform';
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
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore, persistUnsavedEnclosures } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { buildBackup, restoreBackup, summarizeRestore } from '@/lib/backup';
import { useBackupStore } from '@/stores/backupStore';
import { useHistoryStore } from '@/stores/historyStore';
import { uint8ArrayToBase64, base64ToUint8Array, arrayBufferToUint8Array } from '@/lib/encoding';
import { STORAGE_KEYS } from '@/lib/constants';
import { canonicalizeUnitAddress } from '@/lib/unitAddress';
import { useLogStore } from '@/stores/logStore';
import { useTourStore } from '@/stores/tourStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { safeReportUrl, BUG_REPORT_PRIVACY_NOTICE, BUG_REPORT_LOG_PROMPT } from '@/lib/bugReport';

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
// Marine Coders seal: same-origin SVG, already preloaded for the watermark.
const marineCodersLogo = `${import.meta.env.BASE_URL}attachments/marine-coders-logo.svg`;

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
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const density = useUIStore((s) => s.density);
  const setDensity = useUIStore((s) => s.setDensity);
  const setAboutModalOpen = useUIStore((s) => s.setAboutModalOpen);
  const setNistModalOpen = useUIStore((s) => s.setNistModalOpen);
  const setBatchModalOpen = useUIStore((s) => s.setBatchModalOpen);
  const setDocumentGuideOpen = useUIStore((s) => s.setDocumentGuideOpen);
  const setFindReplaceOpen = useUIStore((s) => s.setFindReplaceOpen);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setShareModal = useUIStore((s) => s.setShareModal);
  const isMobile = useUIStore((s) => s.isMobile);
  const previewVisible = useUIStore((s) => s.previewVisible);
  const togglePreview = useUIStore((s) => s.togglePreview);
  const fullQualityPreview = useUIStore((s) => s.fullQualityPreview);
  const setFullQualityPreview = useUIStore((s) => s.setFullQualityPreview);
  // Reopen the getting-started checklist. Hidden once onboarding is finished.
  const checklistCelebrated = useOnboardingStore((s) => s.checklistCelebrated);
  const reopenChecklist = () => useOnboardingStore.getState().setChecklistDismissed(false);

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
  // Seed banner-dismissed from localStorage via a lazy initializer so the
  // banner doesn't flash before an effect could close it.
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dondocs-banner-dismissed') === 'true';
    } catch {
      return false; // localStorage unavailable (private browsing)
    }
  });
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

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    try {
      localStorage.setItem('dondocs-banner-dismissed', 'true');
    } catch { /* localStorage unavailable */ }
  }, []);

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

  const handleSaveProgress = useCallback(() => {
    try {
      const ds = useDocumentStore.getState();
      const dataToSave = {
        documentMode: ds.documentMode,
        docType: ds.docType,
        formData: ds.formData,
        references: ds.references,
        // Save enclosure metadata only, not the file data (too large for localStorage)
        enclosures: ds.enclosures.map(encl => ({
          title: encl.title,
          pageStyle: encl.pageStyle,
          hasCoverPage: encl.hasCoverPage,
          coverPageDescription: encl.coverPageDescription,
          hasFile: !!encl.file,
          fileName: encl.file?.name,
        })),
        paragraphs: ds.paragraphs,
        copyTos: ds.copyTos,
        distributions: ds.distributions,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
      // Also promote into Recents so an explicit Save shows in the sidebar list.
      useDocumentsStore.getState().saveCurrent();
      // Correspondence: the ambient "Saved · <time>" indicator in the ProfileBar
      // is the single source of truth — no redundant "Saved!" toast. Forms aren't
      // persisted yet, so they still get an explicit heads-up.
      if (ds.documentCategory === 'forms') flashSaveStatus("Form drafts aren't saved yet");
    } catch (err) {
      console.error('Failed to save progress:', err);
      flashSaveStatus('Save failed');
    }
  }, [flashSaveStatus]);

  const handleLoadProgress = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        // Preserve the open document before overwriting the live store, so the
        // loaded draft opens as its own Recents entry instead of clobbering it.
        useDocumentsStore.getState().syncCurrent();
        const ds = useDocumentStore.getState();
        const data = JSON.parse(saved);
        // Saved drafts are correspondence-only; reset the category so the loaded
        // doc is coherent and saveCurrent() can promote it to Recents.
        ds.setDocumentCategory('correspondence');
        ds.setDocumentMode?.(data.documentMode || 'compliant');
        if (data.docType) {
          ds.setDocType(data.docType);
        }
        if (data.formData) {
          // Canonicalize unitAddress on read (see App.tsx for rationale).
          const formData = data.formData.unitAddress
            ? { ...data.formData, unitAddress: canonicalizeUnitAddress(data.formData.unitAddress) }
            : data.formData;
          ds.setFormData(formData);
        }
        // Restore the body and lists too; otherwise the loaded draft keeps the
        // previously-open document's paragraphs/references/enclosures/copyTos.
        // Enclosure file bytes aren't saved, so the user re-attaches PDFs.
        ds.loadTemplate({
          references: data.references || [],
          enclosures: (data.enclosures || []).map((encl: {
            title: string;
            pageStyle?: string;
            hasCoverPage?: boolean;
            coverPageDescription?: string;
          }) => ({
            title: encl.title,
            pageStyle: encl.pageStyle,
            hasCoverPage: encl.hasCoverPage,
            coverPageDescription: encl.coverPageDescription,
            file: undefined,
          })),
          paragraphs: data.paragraphs || [],
          copyTos: data.copyTos || [],
        });
        // loadTemplate doesn't cover distributions; set it explicitly so the
        // loaded draft doesn't inherit the previously-open document's list.
        useDocumentStore.setState({ distributions: data.distributions || [] });
        useDocumentsStore.getState().openLoadedAsNew();
        flashSaveStatus('Loaded!');
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

  // Export entire document state to a JSON file
  const handleExportDraft = useCallback(() => {
    try {
      const ds = useDocumentStore.getState();
      const dataToExport = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        documentMode: ds.documentMode,
        documentCategory: ds.documentCategory,
        docType: ds.docType,
        formType: ds.formType,
        formData: ds.formData,
        references: ds.references,
        // Include enclosure file data as base64 for full restoration
        enclosures: ds.enclosures.map(encl => ({
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
        paragraphs: ds.paragraphs,
        copyTos: ds.copyTos,
        distributions: ds.distributions,
        // NAVMC form field data lives in a separate store; include it so a
        // forms draft round-trips (Export is the only durable copy for forms).
        forms: (() => {
          const fs = useFormStore.getState();
          return {
            navmc10274: fs.navmc10274,
            navmc11811: fs.navmc11811,
            includeCoverPage: fs.includeCoverPage,
          };
        })(),
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

      flashSaveStatus('Exported!');
    } catch (err) {
      console.error('Failed to export draft:', err);
      flashSaveStatus('Export failed');
    }
  }, [flashSaveStatus]);

  // Import document state from a JSON file
  const handleImportDraft = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const ds = useDocumentStore.getState();
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        // Validate it's a dondocs draft file
        if (!data.version || !data.docType) {
          throw new Error('Invalid draft file format');
        }

        // Preserve the currently-open document before overwriting the live
        // store, so the import opens as its own Recents entry instead of
        // clobbering (and then silently overwriting) the open doc — mirrors
        // handleLoadProgress.
        useDocumentsStore.getState().syncCurrent();

        // Apply document mode
        if (data.documentMode) {
          ds.setDocumentMode?.(data.documentMode);
        }

        // Apply document category
        if (data.documentCategory) {
          ds.setDocumentCategory(data.documentCategory);
        }

        // Apply document type
        if (data.docType) {
          ds.setDocType(data.docType);
        }

        // Apply form type
        if (data.formType) {
          ds.setFormType(data.formType);
        }

        // Apply form data
        if (data.formData) {
          // Canonicalize unitAddress on read (see App.tsx for rationale).
          const formData = data.formData.unitAddress
            ? { ...data.formData, unitAddress: canonicalizeUnitAddress(data.formData.unitAddress) }
            : data.formData;
          ds.setFormData(formData);
        }

        // Use loadTemplate for bulk loading (handles references, enclosures, paragraphs, copyTos)
        ds.loadTemplate({
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
        // loadTemplate doesn't cover distributions; restore it explicitly.
        useDocumentStore.setState({ distributions: data.distributions || [] });

        // Restore NAVMC form field data (separate store; shallow-merges the
        // navmc10274/navmc11811/includeCoverPage slices that were exported).
        if (data.forms) {
          useFormStore.setState(data.forms);
        }

        // Register the import as its own Recents entry under a fresh id rather
        // than overwriting the previously-open document.
        useDocumentsStore.getState().openLoadedAsNew();

        // The draft's enclosure bytes arrived inline; persist them to the
        // attachments store so they survive a reload and a full backup, just
        // like a file attached through the UI.
        void persistUnsavedEnclosures();

        flashSaveStatus('Imported!');
      } catch (err) {
        console.error('Failed to import draft:', err);
        flashSaveStatus('Import failed');
      }
    };

    reader.readAsText(file);
    // Reset the input so the same file can be selected again
    event.target.value = '';
  }, [flashSaveStatus]);

  // Whole-library backup: export/import EVERY saved document (not just the open
  // one) — a safety net against browser-storage eviction.
  const handleExportLibrary = useCallback(async () => {
    try {
      // Full-account bundle: documents + profiles/signatures + snippets +
      // templates + live NAVMC forms — not just documents.
      const json = await buildBackup();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dondocs-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      flashSaveStatus('Backed up everything!');
      // First real backup → credit the getting-started checklist row.
      useOnboardingStore.getState().markComplete('first_backup');
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

  return (
    <header className="border-b border-border bg-card">
      {/* Dismissable beta release banner */}
      {!bannerDismissed && (
        <div className="bg-amber-500/10 text-amber-700 dark:text-amber-300/90 text-[0.6875rem] font-medium py-0.5 text-center tracking-wide relative border-b border-amber-500/20">
          Not an official DoW website. Beta release — report issues on GitHub.
          <button
            onClick={dismissBanner}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 transition-colors"
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
      {/* Hidden file input for importing a whole-library backup */}
      <input
        type="file"
        ref={libraryInputRef}
        onChange={handleImportLibrary}
        accept=".json"
        className="hidden"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 lg:gap-3 min-w-0">
          <div className="flex items-center gap-2.5">
            {/* Brand mark. The seal SVG is solid white, so invert it on the
                light header and leave it white in dark mode. */}
            <img
              src={marineCodersLogo}
              alt="Marine Coders"
              decoding="sync"
              className="h-7 lg:h-8 w-auto shrink-0 invert dark:invert-0"
            />
            <div className="flex flex-col min-w-0">
              <h1 className="text-base font-semibold tracking-[-0.01em] text-foreground leading-tight truncate">
                DonDocs
              </h1>
              <span className="text-[10px] text-muted-foreground hidden sm:block leading-tight truncate">Naval correspondence &amp; forms</span>
            </div>
          </div>
          {/* NIST 800-171 Compliance Badge - icon only below lg, full badge on lg+ */}
          <HeaderTip label="NIST 800-171 compliance — learn more">
            <button
              type="button"
              onClick={() => setNistModalOpen(true)}
              aria-label="NIST 800-171 compliance"
              // Demoted to a quiet neutral chip: neutral border + muted text so it
              // reads as a status marker, not a call to action. Only the shield
              // carries the success tint. Faint muted bg on hover, neutral focus ring.
              className="flex items-center justify-center gap-1.5 rounded-md border border-border text-muted-foreground text-xs cursor-pointer hover:bg-muted transition-colors p-1.5 lg:px-2 lg:py-1 shrink-0 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <Shield className="h-4 w-4 lg:h-3 lg:w-3 text-[var(--success)]" />
              <span className="hidden lg:inline">NIST 800-171</span>
            </button>
          </HeaderTip>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Aria-live region for transient action toasts - WCAG 4.1.3 */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {saveStatus}
          </div>
          {/* Transient action toast only (e.g. "Exported!", "Loaded!"). The
              passive "Saved · <time>" indicator lives in the ProfileBar per the
              design, so it isn't duplicated in the header chrome. */}
          {saveStatus && (
            <span className="text-xs text-muted-foreground hidden lg:inline" aria-hidden="true">
              {saveStatus}
            </span>
          )}

          {/* Mobile: an icon-only entry to the same palette (there's no ⌘K on
              touch, so without this the palette is unreachable on phones). */}
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Search or jump to…"
            className="flex lg:hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* ⌘K command palette trigger — Linear/Raycast search affordance.
              The palette is also reachable via the global ⌘K keybinding; this
              pill is the discoverable entry point. */}
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Open command palette"
            className="hidden lg:flex h-8 min-w-[180px] items-center gap-2 rounded-md border border-border bg-transparent pl-2.5 pr-2 text-muted-foreground transition-colors hover:bg-muted outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="flex-1 text-left text-xs">Search or jump…</span>
            <Kbd>{formatShortcut('mod K')}</Kbd>
          </button>
          <div aria-hidden="true" className="hidden lg:block w-px h-5 self-center bg-border mx-1" />

          {/* Undo/Redo buttons - always visible */}
          <HeaderTip label={`Undo (${formatShortcut('mod Z')})`}>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleUndo}
              disabled={!canUndo}
              aria-label="Undo"
              className="h-8 w-8 sm:h-9 sm:w-9"
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </HeaderTip>
          <HeaderTip label={`Redo (${formatShortcut('mod Y')})`}>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRedo}
              disabled={!canRedo}
              aria-label="Redo"
              className="h-8 w-8 sm:h-9 sm:w-9"
            >
              <Redo2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </HeaderTip>

          {/* Group divider, only at xl where the full toolbar shows. */}
          <div aria-hidden="true" className="hidden xl:block w-px h-5 self-center bg-border mx-1" />

          {/* Refresh - hidden below xl, in hamburger menu */}
          <HeaderTip label="Refresh preview">
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefreshPreview}
              disabled={isCompiling}
              aria-label="Refresh preview"
              className="h-8 w-8 sm:h-9 sm:w-9 hidden xl:flex"
            >
              <RefreshCw className={`h-4 w-4 ${isCompiling ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
          </HeaderTip>

          {/* Preview toggle - hidden below xl and on mobile devices */}
          {!isMobile && (
            <HeaderTip label={`${previewVisible ? 'Hide' : 'Show'} preview (${formatShortcut('mod E')})`}>
              <Button
                variant={previewVisible ? "secondary" : "ghost"}
                size="sm"
                onClick={togglePreview}
                aria-label={previewVisible ? "Hide preview" : "Show preview"}
                className="h-8 px-2 sm:px-3 hidden xl:flex"
              >
                {previewVisible ? (
                  <PanelRightClose className="h-4 w-4 xl:mr-2" aria-hidden="true" />
                ) : (
                  <PanelRight className="h-4 w-4 xl:mr-2" aria-hidden="true" />
                )}
                <span className="hidden 2xl:inline">Preview</span>
              </Button>
            </HeaderTip>
          )}

          <div aria-hidden="true" className="hidden xl:block w-px h-5 self-center bg-border mx-1" />

          {/* Save/Load dropdown - always visible but compact on smaller screens.
              Controlled through uiStore so the backup walkthrough can open it and
              spotlight the items inside; while a tour is running, dismissal
              requests (outside click/focus, Escape) are refused so the
              spotlighted item can't vanish mid-step. */}
          <DropdownMenu
            open={saveMenuOpen}
            onOpenChange={(open) => {
              if (!open && useTourStore.getState().active) return;
              setSaveMenuOpen(open);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button data-tour="save" variant="outline" size="sm" className="h-8 px-2 lg:px-3">
                <Save className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">Save</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Draft (this browser)</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleSaveProgress}>
                <Save className="h-4 w-4 mr-2" />
                Save draft
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
                    className="text-orange-600 dark:text-orange-400"
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
              <DropdownMenuItem onClick={() => setShowClearFieldsDialog(true)} className="text-orange-600 dark:text-orange-400">
                <Eraser className="h-4 w-4 mr-2" />
                Clear fields (keep letterhead)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowResetDialog(true)} variant="destructive">
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset all fields
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Download dropdown - always visible but compact on smaller screens */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-tour="download" variant="default" size="sm" className="h-8 px-2 lg:px-3">
                <Download className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">Download</span>
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
              {/* LaTeX and DOCX only available for correspondence */}
              {!isFormsMode && (
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

          <div aria-hidden="true" className="hidden xl:block w-px h-5 self-center bg-border mx-1" />

          {/* Guide button - hidden below xl */}
          <HeaderTip label="When to use each document type">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 xl:px-3 hidden xl:flex"
              onClick={() => setDocumentGuideOpen(true)}
              aria-label="Document type guide"
            >
              <Compass className="h-4 w-4 xl:mr-2" />
              <span className="hidden 2xl:inline">Guide</span>
            </Button>
          </HeaderTip>

          {/* Find & Replace button - hidden below xl */}
          <HeaderTip label={`Find & Replace (${formatShortcut('mod H')})`}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 xl:px-3 hidden xl:flex"
              onClick={() => setFindReplaceOpen(true)}
              aria-label="Find and replace"
            >
              <Search className="h-4 w-4 xl:mr-2" />
              <span className="hidden 2xl:inline">Find</span>
            </Button>
          </HeaderTip>

          {/* Batch Generation button - hidden below xl */}
          <HeaderTip label="Generate multiple documents with variables">
            <Button
              data-tour="batch"
              variant="ghost"
              size="sm"
              className="h-8 px-2 xl:px-3 hidden xl:flex"
              onClick={() => setBatchModalOpen(true)}
              aria-label="Batch generate"
            >
              <Layers className="h-4 w-4 xl:mr-2" />
              <span className="hidden 2xl:inline">Batch</span>
            </Button>
          </HeaderTip>

          {/* Help dropdown - hidden below xl */}
          <DropdownMenu>
            <HeaderTip label="Help & info">
              <DropdownMenuTrigger asChild>
                <Button data-tour="help" variant="ghost" size="icon" aria-label="Help & info" className="h-8 w-8 hidden xl:flex">
                  <HelpCircle className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </HeaderTip>
            <DropdownMenuContent align="end" className="w-72">
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
              <DropdownMenuSeparator />
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
                <GithubIcon className="h-4 w-4 mr-2" />
                View on GitHub
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(buildBugReportUrl(), '_blank', 'noopener,noreferrer')}>
                <Bug className="h-4 w-4 mr-2" />
                Report a Bug
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(buildFeatureRequestUrl(), '_blank', 'noopener,noreferrer')}>
                <Lightbulb className="h-4 w-4 mr-2" />
                Suggest a Feature
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
                  <div className="font-mono text-right">{formatShortcut('mod D')}</div>
                  <div className="text-muted-foreground">Save Draft</div>
                  <div className="font-mono text-right">{formatShortcut('mod S')}</div>
                  <div className="text-muted-foreground">Find & Replace</div>
                  <div className="font-mono text-right">{formatShortcut('mod H')}</div>
                  <div className="text-muted-foreground">Toggle Preview</div>
                  <div className="font-mono text-right">{formatShortcut('mod E')}</div>
                  <div className="text-muted-foreground">Undo / Redo</div>
                  <div className="font-mono text-right">{formatShortcut('mod Z')} / {formatShortcut('mod Y')}</div>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Appearance dropdown - hidden below xl */}
          <DropdownMenu>
            <HeaderTip label="Appearance">
              <DropdownMenuTrigger asChild>
                <Button data-tour="appearance" variant="ghost" size="icon" aria-label="Appearance settings" className="h-8 w-8 sm:h-9 sm:w-9 hidden xl:flex">
                  <Settings className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </HeaderTip>
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
              <p className="px-2 pb-1.5 text-xs text-muted-foreground leading-tight">
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
