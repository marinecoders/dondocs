import { useEffect, useCallback, useMemo, useState, useRef, lazy, Suspense } from 'react';
import { Header } from '@/components/layout/Header';
import { FormPanel } from '@/components/layout/FormPanel';
import { EditorSidebar } from '@/components/layout/EditorSidebar';
import { MobileRecents } from '@/components/layout/MobileRecents';
import { VersionHistoryModal } from '@/components/modals/VersionHistoryModal';
import { PreviewPanel } from '@/components/layout/PreviewPanel';
import { ResizableDivider } from '@/components/layout/ResizableDivider';
import { ProfileModal } from '@/components/modals/ProfileModal';
import { ReferenceLibraryModal } from '@/components/modals/ReferenceLibraryModal';
// MobilePreviewModal renders the shared in-app PdfViewer (react-pdf + pdf.js),
// which Rollup emits as its own chunk because the desktop panel dynamically
// imports the same component — one pdf.js copy for both surfaces. The modal
// stays lazy too; the mobilePreviewOpen gate below holds the fetch until the
// user taps "Preview PDF".
const MobilePreviewModal = lazy(() =>
  import('@/components/modals/MobilePreviewModal').then((m) => ({
    default: m.MobilePreviewModal,
  }))
);
import { AboutModal } from '@/components/modals/AboutModal';
import { NISTComplianceModal } from '@/components/modals/NISTComplianceModal';
import { BatchModal } from '@/components/modals/BatchModal';
import { FindReplaceModal } from '@/components/modals/FindReplaceModal';
import { TemplateLoaderModal } from '@/components/modals/TemplateLoaderModal';
import { DocumentGuideModal } from '@/components/modals/DocumentGuideModal';
import { WelcomeModal } from '@/components/modals/WelcomeModal';
import { TourOverlay } from '@/components/tour/TourOverlay';
import { ActivationChecklist } from '@/components/onboarding/ActivationChecklist';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { PIIWarningModal } from '@/components/modals/PIIWarningModal';
import { LogViewerModal } from '@/components/modals/LogViewerModal';
import { EnclosureErrorModal } from '@/components/modals/EnclosureErrorModal';
import { ShareModal } from '@/components/modals/ShareModal';
import { UpdatePromptModal } from '@/components/modals/UpdatePromptModal';
import { InstallAppModal } from '@/components/modals/InstallAppModal';
import { DownloadProgressModal } from '@/components/modals/DownloadProgressModal';
import { CompileErrorModal } from '@/components/modals/CompileErrorModal';
import {
  docxPhaseToDownloadPhase,
  type DownloadProgressPhase,
} from '@/components/modals/downloadProgressTypes';
import { parseShareUrl } from '@/lib/shareCrypto';
import { BrowserCompatibilityNotice } from '@/components/BrowserCompatibilityNotice';
import { AppAlertDialog } from '@/components/AppAlertDialog';
import { StorageNotice } from '@/components/StorageNotice';
import { BackupNotice } from '@/components/BackupNotice';
import { InstallNotice } from '@/components/InstallNotice';
import { probeStorageHealth } from '@/lib/documentsDb';
const marineCodersLogo = `${import.meta.env.BASE_URL}attachments/marine-coders-logo.svg`;
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore, getSavedSession, rehydrateEnclosureFiles } from '@/stores/documentStore';
import { useFormStore, FORMS_PERSIST_KEY } from '@/stores/formStore';
import { lastWriteFailed } from '@/lib/compressedStorage';
import { useHistoryStore } from '@/stores/historyStore';
import { useDocumentsStore, applySelectedProfile, correspondenceFilename } from '@/stores/documentsStore';
import { useBackupStore } from '@/stores/backupStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useEditorSections } from '@/components/layout/editorSections';
import { CommandPalette, type CommandGroup } from '@/components/modals/CommandPalette';
import { TooltipProvider } from '@/components/ui/tooltip';
import { formatShortcut } from '@/lib/platform';
import {
  CornerDownRight,
  Plus,
  FileText,
  Download,
  Save,
  Layers,
  Compass,
  BookOpen,
  Hash,
  Paperclip,
  Braces,
  FileDown,
  Link2,
  Search,
  History,
  Copy,
  Users,
  MoonStar,
  PanelRight,
  MonitorDown,
} from 'lucide-react';
import { useLogStore } from '@/stores/logStore';
import { useLatexEngine, useServiceWorker, useInstallPrompt, promptInstall } from '@/hooks';
import { useInstallStore } from '@/stores/installStore';
import { usePandocIdlePrefetch } from '@/hooks/usePandocIdlePrefetch';
import { generateAllLatexFiles, type GeneratedFiles } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { convertLatexToDocx } from '@/services/docx/pandoc-converter';
import { generateNavmc10274Pdf, loadNavmc10274Templates } from '@/services/pdf/navmc10274Generator';
import { generateNavmc11811Pdf, loadNavmc11811Template } from '@/services/pdf/navmc11811Generator';
import { applyPlaceholdersToNavmc11811, buildNavmc11811DefaultValues } from '@/lib/placeholders';
import { mergeEnclosures } from '@/services/pdf/mergeEnclosures';
import type { ClassificationInfo, EnclosureError } from '@/services/pdf/mergeEnclosures';
import { addSignatureField, addDualSignatureFields, type DualSignatureFieldConfig, type SignatureFieldConfig } from '@/services/pdf/addSignatureField';
import { DOC_TYPE_CONFIG, type DocumentData } from '@/types/document';
import { detectPII, type PIIDetectionResult } from '@/services/pii/detector';
import { downloadPdfBlob, preOpenWindowForIOS } from '@/utils/downloadPdf';

// Helper to get classification marking for enclosures
function getClassificationInfo(
  classLevel: string | undefined,
  customClassification?: string
): ClassificationInfo | undefined {
  if (!classLevel || classLevel === 'unclassified') {
    return undefined;
  }

  // Handle custom classification
  if (classLevel === 'custom' && customClassification) {
    return { level: classLevel, marking: customClassification };
  }

  const markingMap: Record<string, string> = {
    cui: 'CUI',
    confidential: 'CONFIDENTIAL',
    secret: 'SECRET',
    top_secret: 'TOP SECRET',
    top_secret_sci: 'TOP SECRET//SCI',
  };

  const marking = markingMap[classLevel];
  if (!marking) return undefined;

  return { level: classLevel, marking };
}

/**
 * Build signatory name configuration for signature field positioning.
 * Returns the abbreviated name format (e.g., "J. M. SMITH") used in signature blocks.
 */
function getSignatoryConfig(formData: Partial<DocumentData>): SignatureFieldConfig {
  // Build abbreviated name for single signatures: F. M. LASTNAME
  const firstName = formData.sigFirst?.trim() || '';
  const middleName = formData.sigMiddle?.trim() || '';
  const lastName = formData.sigLast?.toUpperCase()?.trim() || '';

  const abbrevName = [
    firstName ? `${firstName[0].toUpperCase()}.` : '',
    middleName ? `${middleName[0].toUpperCase()}.` : '',
    lastName,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    signatoryName: abbrevName || undefined,
  };
}

/**
 * Build dual signatory name configuration for joint letter/MOA/MOU signature field positioning.
 * Returns junior and senior signatory names as they appear in the PDF.
 */
function getDualSignatoryConfig(formData: Partial<DocumentData>, uiMode: string | undefined): DualSignatureFieldConfig {
  let juniorName: string | undefined;
  let seniorName: string | undefined;

  if (uiMode === 'moa') {
    // MOA/MOU: Junior uses full name uppercased, Senior uses "F. LASTNAME",
    // matching how the LaTeX generator renders them.
    juniorName = formData.juniorSigName?.toUpperCase()?.trim() || undefined;

    // Senior signatory in MOA/MOU uses abbreviated form: "F. LASTNAME"
    // e.g., "David Foster" -> "D. FOSTER"
    const seniorFullName = formData.seniorSigName?.trim() || '';
    if (seniorFullName) {
      const parts = seniorFullName.split(' ');
      const firstName = parts[0] || '';
      const lastName = parts[parts.length - 1]?.toUpperCase() || '';
      seniorName = firstName ? `${firstName[0].toUpperCase()}. ${lastName}` : lastName;
    }
  } else if (uiMode === 'joint' || uiMode === 'joint_memo') {
    // Joint letter and joint memo share the same fields (both uppercased)
    juniorName = formData.jointJuniorSigName?.toUpperCase()?.trim() || undefined;
    seniorName = formData.jointSeniorSigName?.toUpperCase()?.trim() || undefined;
  }

  return {
    juniorSignatoryName: juniorName,
    seniorSignatoryName: seniorName,
  };
}

// Latest download triggers, published by App in an effect. Held at module scope
// (like editorOutlineStore's jump handler) so the command-palette groups — built
// during render — can dispatch a download without referencing a ref-reading
// callback during render, which the React rules forbid.
const commandDownloadTriggers: { pdf: () => void; docx: () => void } = {
  pdf: () => {},
  docx: () => {},
};

function App() {
  // Prefetch the Pandoc WASM module (~58 MB) during browser idle time so the
  // first DOCX export skips the download wait. Skips slow/data-saver connections.
  usePandocIdlePrefetch();

  // Individual selectors so Zustand only re-renders App on the specific field's
  // change, not on every store update. Setters are stable, so selecting them is free.
  const theme = useUIStore((s) => s.theme);
  const colorScheme = useUIStore((s) => s.colorScheme);
  const density = useUIStore((s) => s.density);
  const isMobile = useUIStore((s) => s.isMobile);
  const setIsMobile = useUIStore((s) => s.setIsMobile);
  // Gate the lazy MobilePreviewModal; chunk fetches on first open only.
  const mobilePreviewOpen = useUIStore((s) => s.mobilePreviewOpen);
  const previewVisible = useUIStore((s) => s.previewVisible);
  const previewWidth = useUIStore((s) => s.previewWidth);
  const setPreviewVisible = useUIStore((s) => s.setPreviewVisible);
  const setPreviewWidth = useUIStore((s) => s.setPreviewWidth);
  const setFindReplaceOpen = useUIStore((s) => s.setFindReplaceOpen);
  const piiWarningOpen = useUIStore((s) => s.piiWarningOpen);
  const setPiiWarningOpen = useUIStore((s) => s.setPiiWarningOpen);
  const setTemplateLoaderOpen = useUIStore((s) => s.setTemplateLoaderOpen);
  const setReferenceLibraryOpen = useUIStore((s) => s.setReferenceLibraryOpen);
  const setShareModal = useUIStore((s) => s.setShareModal);
  const shareModal = useUIStore((s) => s.shareModal);
  const togglePreview = useUIStore((s) => s.togglePreview);
  const closeAllModals = useUIStore((s) => s.closeAllModals);
  const fullQualityPreview = useUIStore((s) => s.fullQualityPreview);
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  // The current document's section outline drives the palette's "Jump to section" group.
  const { sections: outlineSections } = useEditorSections();
  const mainContainerRef = useRef<HTMLElement>(null);
  // Individual selectors, not a full useDocumentStore() subscription. These are
  // the slices that should invalidate the debounced compile; other setter calls
  // no longer wake App. compilePdf reads the full store via getState() at call time.
  const docType = useDocumentStore((s) => s.docType);
  const formData = useDocumentStore((s) => s.formData);
  const references = useDocumentStore((s) => s.references);
  const enclosures = useDocumentStore((s) => s.enclosures);
  const paragraphs = useDocumentStore((s) => s.paragraphs);
  const copyTos = useDocumentStore((s) => s.copyTos);
  const distributions = useDocumentStore((s) => s.distributions);
  const documentCategory = useDocumentStore((s) => s.documentCategory);
  const formType = useDocumentStore((s) => s.formType);
  const applySnapshot = useDocumentStore((s) => s.applySnapshot);
  // Individual selectors so App re-renders only when one of these slices changes.
  const navmc10274 = useFormStore((s) => s.navmc10274);
  const navmc11811 = useFormStore((s) => s.navmc11811);
  const includeCoverPage = useFormStore((s) => s.includeCoverPage);
  // Individual selectors across the remaining stores too.
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const addLogDirect = useLogStore((s) => s.addLogDirect);
  const { isReady, compile, waitForReady, error: engineError } = useLatexEngine();
  const { showUpdatePrompt, confirmUpdate, dismissUpdatePrompt } = useServiceWorker();
  // Capture beforeinstallprompt / appinstalled + seed standalone detection.
  useInstallPrompt();
  const isInstalled = useInstallStore((s) => s.isInstalled);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [formPdfUrl, setFormPdfUrl] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  // Full compile-failure log from SwiftLaTeX. Drives the compile-error modal,
  // kept separate from the logStore feed as a clean one-shot value.
  const [compileLog, setCompileLog] = useState<string | null>(null);
  // Live-preview compile errors pop a modal the first time a new error appears.
  // lastShownCompileErrorRef holds the text already shown so repeated debounce
  // cycles with the same error don't re-pop; reset to null on success.
  const [compileErrorModalOpen, setCompileErrorModalOpen] = useState(false);
  const lastShownCompileErrorRef = useRef<string | null>(null);
  // Download progress (PDF + DOCX). Non-null means a download is in flight or
  // failed; drives the modal and the Header's "Generating…" menu state.
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressPhase | null>(null);
  // On a successful export, flash a brief "Downloaded — nothing left your device"
  // beat before dismissing the progress modal, so the app narrates the ending it
  // used to drop. The functional guard avoids clearing a fresh download the user
  // kicked off during the beat.
  const finishDownload = useCallback(() => {
    setDownloadProgress({ kind: 'success' });
    window.setTimeout(() => {
      setDownloadProgress((p) => (p?.kind === 'success' ? null : p));
    }, 1800);
  }, []);
  const compileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formCompileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isResettingRef = useRef(false);
  // Idle-time full-quality preview upgrade. When fullQualityPreview is off
  // (default, for responsiveness), the resting preview is upgraded to match the
  // download — enclosures merged, signature fields added — once the user goes
  // idle. previewGenRef stamps each compile so a stale idle pass never swaps in
  // an out-of-date PDF; the idle handle is cancelled when a newer compile starts.
  const [previewEnhanced, setPreviewEnhanced] = useState(false);
  const previewGenRef = useRef(0);
  const idleEnhanceRef = useRef<number | null>(null);
  const cancelIdleEnhance = useCallback(() => {
    if (idleEnhanceRef.current == null) return;
    if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleEnhanceRef.current);
    else clearTimeout(idleEnhanceRef.current);
    idleEnhanceRef.current = null;
  }, []);

  // PII detection state
  const [piiDetectionResult, setPiiDetectionResult] = useState<PIIDetectionResult | null>(null);
  const pendingDownloadRef = useRef<GeneratedFiles | null>(null);

  // Enclosure error state
  const [enclosureErrors, setEnclosureErrors] = useState<EnclosureError[]>([]);
  const [showEnclosureErrors, setShowEnclosureErrors] = useState(false);

  // Share link payload from the URL hash (#s=...), parsed once at mount via a
  // lazy initializer to avoid a flash of the empty editor before the import modal.
  const [sharePayloadFromHash, setSharePayloadFromHash] = useState<string | null>(() =>
    parseShareUrl(window.location.href)
  );

  // If the URL had a share hash, open the import modal once on mount, after
  // render rather than during state init.
  useEffect(() => {
    if (sharePayloadFromHash) {
      setShareModal('import');
    }
  }, [sharePayloadFromHash, setShareModal]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    // Keep the browser/PWA chrome color in step with the app theme. The static
    // theme-color metas key off prefers-color-scheme, but the app theme is
    // user-controlled and independent — so override both metas' content to the
    // active canvas color, else the status bar mistints when they disagree.
    const canvas = theme === 'dark' ? '#0b0d11' : '#f1f6fa';
    document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach((m) => {
        m.content = canvas;
      });
  }, [theme]);

  // Apply density to document
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  // Apply color scheme to document
  useEffect(() => {
    document.documentElement.dataset.scheme = colorScheme;
  }, [colorScheme]);

  // Track if initial setup has been done
  const initialSetupDoneRef = useRef(false);

  // Detect mobile/tablet devices. iPads and tablets use the mobile UI because
  // embedded PDF preview doesn't work well there.
  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

      // Detect iPad specifically (works for iPadOS which reports as Macintosh)
      const isIPad = /iPad/i.test(navigator.userAgent) ||
        (/Macintosh/i.test(navigator.userAgent) && isTouchDevice);

      // Consider mobile if:
      // 1. Width < 768px (phones)
      // 2. Width < 1024px AND touch device (small tablets)
      // 3. Any iPad (regardless of screen size - they have PDF issues)
      // 4. Any touch device under 1366px (covers most tablets)
      const isMobileOrTablet = width < 768 ||
        (width < 1024 && isTouchDevice) ||
        isIPad ||
        (width < 1366 && isTouchDevice);

      console.log('[device] width:', width, 'touch:', isTouchDevice, 'iPad:', isIPad, 'mobile:', isMobileOrTablet);
      setIsMobile(isMobileOrTablet);

      // Only set preview visibility on initial setup, not on every resize
      if (!initialSetupDoneRef.current) {
        initialSetupDoneRef.current = true;
        // Check if user has a persisted preference. Reading localStorage can throw
        // (blocked site data) or the value can be corrupt; treat either as "no
        // preference" so this never aborts the resize listener registration below.
        let hasPersistedPreference = false;
        try {
          const stored = localStorage.getItem('dondocs_ui');
          hasPersistedPreference = !!stored && JSON.parse(stored)?.state?.previewVisible !== undefined;
        } catch {
          // blocked or corrupt storage: keep the default (no preference)
        }

        if (!hasPersistedPreference) {
          // First-time user: show preview on desktop, hide on mobile
          setPreviewVisible(!isMobileOrTablet && width >= 1024);
        }
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [setIsMobile, setPreviewVisible]);

  // Bootstrap the document registry on initial load.
  useEffect(() => {
    // init() resumes the last open document, or returns false for a fresh start.
    // On a fresh start, seed the profile letterhead then baseline, so applying
    // the profile counts as part of the starting state and the document enters
    // Recents only once the user changes it. Don't re-apply over restored content.
    let cancelled = false;
    const seedFreshStart = () => {
      if (cancelled) return;
      applySelectedProfile();
      useDocumentsStore.getState().markBaseline();
    };
    // If the user was last working on a NAVMC form, return them to that view
    // after init (the form field data itself is rehydrated by formStore's own
    // persist; init only resumes correspondence). Read before init runs.
    const lastSession = getSavedSession();
    const resumeFormType =
      lastSession?.documentCategory === 'forms' ? lastSession.formType : null;
    const restoreFormsView = () => {
      if (cancelled || !resumeFormType) return;
      const ds = useDocumentStore.getState();
      ds.setDocumentCategory('forms');
      ds.setFormType(resumeFormType);
    };
    void useDocumentsStore
      .getState()
      .init()
      .then((resumed) => {
        if (!resumed) seedFreshStart();
        restoreFormsView();
      })
      // Hydration shouldn't reject (storage failures are caught internally), but
      // if it ever does, degrade to a usable seeded document instead of an
      // unhandled rejection that leaves the editor unseeded.
      .catch(() => {
        seedFreshStart();
        restoreFormsView();
      })
      // Probe how durable storage is only AFTER hydration/migration settles, so a
      // returning user's just-migrated docs are already in IndexedDB and the
      // StorageNotice can't be suppressed by reading an empty store mid-migration.
      .finally(() => {
        void probeStorageHealth()
          .then((health) => {
            if (!cancelled) useUIStore.getState().setStorageHealth(health);
          })
          .catch(() => {
            /* probe is best-effort; leave storageHealth at its default */
          });
      });
    // Reconnect a previously-chosen synced-backup file (no-op if none / unsupported).
    void useBackupStore.getState().init();
    return () => {
      cancelled = true;
    };
    // Only run on initial mount
  }, []);

  // Forms persist on every edit (formStore's own persist middleware); reflect
  // that in the "Saved" indicator the same way the correspondence registry
  // write does, so the signal is honest in both categories. Debounced so the
  // passive indicator wakes once per typing pause rather than on every keystroke.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const unsub = useFormStore.subscribe(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        // Verify the write actually landed before claiming "Saved". Forms
        // persist through safeLocalStorage, which swallows quota/security
        // errors by design — and storageHealth measures IndexedDB, not
        // localStorage, so it can read healthy while the form write failed.
        if (lastWriteFailed(FORMS_PERSIST_KEY)) {
          useUIStore.getState().setSaveStatus('error');
          return;
        }
        if (useUIStore.getState().storageHealth === 'unavailable') return;
        useUIStore.getState().markSaved();
      }, 800);
    });
    return () => {
      clearTimeout(t);
      unsub();
    };
  }, []);

  // Compile PDF
  // Upgrade a base preview PDF to full quality — merge enclosures + hyperlink
  // annotations, then add signature fields — reusing the exact export pipeline so
  // the resting preview equals the download. Regenerates from the passed store so
  // it's safe to run detached (at idle). Returns the enhanced bytes.
  const enhancePreviewPdf = useCallback(
    async (pdfBytes: Uint8Array, currentStore: ReturnType<typeof useDocumentStore.getState>): Promise<Uint8Array> => {
      const { enclosures: generatedEnclosures, includeHyperlinks, referenceUrls } = generateAllLatexFiles(currentStore);
      let out = pdfBytes;
      let lastBasicPageIndex: number | undefined;
      if (generatedEnclosures.length > 0 || (includeHyperlinks && referenceUrls.length > 0)) {
        const classification = getClassificationInfo(currentStore.formData.classLevel);
        const mergeResult = await mergeEnclosures(out, generatedEnclosures, classification, includeHyperlinks, referenceUrls);
        out = mergeResult.pdfBytes;
        lastBasicPageIndex = mergeResult.basicPageCount !== undefined ? mergeResult.basicPageCount - 1 : undefined;
      }
      if (currentStore.formData.signatureType === 'digital') {
        const config = DOC_TYPE_CONFIG[currentStore.docType];
        const isDualSignature = config?.uiMode === 'moa' || config?.compliance?.dualSignature;
        if (isDualSignature) {
          const sigConfig = getDualSignatoryConfig(currentStore.formData, config?.uiMode);
          out = await addDualSignatureFields(new Uint8Array(out), { ...sigConfig, lastBasicPageIndex });
        } else {
          const sigConfig = getSignatoryConfig(currentStore.formData);
          out = await addSignatureField(new Uint8Array(out), { ...sigConfig, lastBasicPageIndex });
        }
      }
      return out;
    },
    []
  );

  const compilePdf = useCallback(async () => {
    if (!isReady) return;
    // Invalidate any pending idle upgrade and stamp this compile so a late idle
    // pass from a previous edit can't swap in a stale PDF.
    cancelIdleEnhance();
    const gen = ++previewGenRef.current;

    // Don't show new compiling state if we're recovering from a reset
    if (!isResettingRef.current) {
      setIsCompiling(true);
    }
    setCompileError(null);
    setCompileLog(null);

    try {
      // If the document was just restored, its enclosure bytes may still be
      // streaming back from the attachments store; make sure they're present
      // before the pipeline reads file.data (no-op once already hydrated).
      await rehydrateEnclosureFiles();
      // Read the full store via getState() at compile time; the debounce dep
      // array already handles when to re-compile, so the state here is current.
      const currentStore = useDocumentStore.getState();
      const { texFiles, enclosures: generatedEnclosures, includeHyperlinks, signatureImage, referenceUrls } = generateAllLatexFiles(currentStore);

      // Build files object including signature image if present
      const files: Record<string, string | Uint8Array> = { ...texFiles };
      if (signatureImage) {
        files['attachments/signature.png'] = signatureImage;
      }

      let pdfBytes = await compile(files);

      if (pdfBytes) {
        // Is there anything beyond the base letter to show (enclosures, hyperlink
        // annotations, or a digital-signature field)?
        const hasEnhancements =
          generatedEnclosures.length > 0 ||
          (includeHyperlinks && referenceUrls.length > 0) ||
          currentStore.formData.signatureType === 'digital';
        const basePdfBytes = pdfBytes;

        // fullQualityPreview runs the full pipeline inline. When off (default),
        // the base letter is shown now (fast) and upgraded to full quality once
        // the user is idle (see below), so per-keystroke previews stay cheap.
        if (fullQualityPreview && hasEnhancements) {
          pdfBytes = await enhancePreviewPdf(pdfBytes, currentStore);
        }

        // Revoke the old URL on a delay: the viewer double-buffers document
        // swaps, so an in-flight load of the outgoing URL may still be reading
        // it (the idle-enhance pass replaces the resting compile within the
        // same second). Immediate revocation aborts that read — harmless (the
        // swap machine abandons quietly) but it litters the console with
        // pdf.js fetch warnings. A few seconds keeps every in-flight load
        // alive; blobs are ~100 KB, so the deferred memory cost is trivial.
        if (pdfUrl) {
          const stale = pdfUrl;
          setTimeout(() => URL.revokeObjectURL(stale), 5000);
        }

        const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
        setPreviewEnhanced(fullQualityPreview && hasEnhancements);
        // Success: clear any held-over log and reset the modal dedup guard so a
        // future failure (including a re-break of the same error) pops again.
        setCompileLog(null);
        lastShownCompileErrorRef.current = null;

        // Not full-quality but there's more to show: upgrade the resting preview
        // to match the download once the browser is idle. Guarded by the compile
        // generation so it can only ever run after the user has stopped editing.
        if (!fullQualityPreview && hasEnhancements) {
          const runIdleEnhance = () => {
            idleEnhanceRef.current = null;
            if (gen !== previewGenRef.current) return; // a newer compile superseded us
            void enhancePreviewPdf(basePdfBytes, useDocumentStore.getState())
              .then((enhanced) => {
                if (gen !== previewGenRef.current) return; // went stale during the async work
                const enhancedUrl = URL.createObjectURL(
                  new Blob([new Uint8Array(enhanced)], { type: 'application/pdf' })
                );
                setPdfUrl((prev) => {
                  // Deferred like the resting-compile revocation above: the
                  // viewer may be mid-load on `prev` when the enhanced swap
                  // lands.
                  if (prev) setTimeout(() => URL.revokeObjectURL(prev), 5000);
                  return enhancedUrl;
                });
                setPreviewEnhanced(true);
              })
              .catch((err) => addLogDirect('info', `Idle preview upgrade skipped: ${err instanceof Error ? err.message : 'error'}`));
          };
          if (typeof window.requestIdleCallback === 'function') {
            idleEnhanceRef.current = window.requestIdleCallback(runIdleEnhance, { timeout: 2500 });
          } else {
            idleEnhanceRef.current = window.setTimeout(runIdleEnhance, 500) as unknown as number;
          }
        }
      }
      // Clear reset flag on success
      isResettingRef.current = false;
    } catch (err) {
      console.error('Compilation error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Compilation failed';
      // Get compile log directly from error if available (for immediate access)
      const errCompileLog = (err as Error & { compileLog?: string })?.compileLog;

      // If engine reset is needed, mark that we're resetting so next compile doesn't flash
      if (errorMessage === 'ENGINE_RESET_NEEDED') {
        isResettingRef.current = true;
      } else {
        setCompileError(errorMessage);
        setCompileLog(errCompileLog ?? null);
        // Add error and full log to log store directly so it's available when user opens log viewer
        addLogDirect('error', `Compilation failed: ${errorMessage}`);
        if (errCompileLog) {
          addLogDirect('error', errCompileLog);
        }
      }
    } finally {
      setIsCompiling(false);
    }
    // documentStore is read via getState() inside, so it's not a dep; only the
    // values closed over are. pdfUrl is captured for revocation.
  }, [isReady, compile, pdfUrl, addLogDirect, fullQualityPreview, enhancePreviewPdf, cancelIdleEnhance]);

  // Auto-open the compile-error modal when a new error (different message than
  // the last one shown) appears, so a persistent error doesn't re-pop every
  // debounce cycle.
  //
  // Suppress the pop while a download or PII modal is up to avoid stacking
  // modals for the same underlying failure; the deps re-run this when those
  // clear so we can pop belatedly if the error is still unresolved.
  useEffect(() => {
    if (!compileError) return;
    if (compileError === lastShownCompileErrorRef.current) return;
    if (downloadProgress !== null) return;
    if (piiWarningOpen) return;
    lastShownCompileErrorRef.current = compileError;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompileErrorModalOpen(true);
  }, [compileError, downloadProgress, piiWarningOpen]);

  // Debounced compilation on document changes
  useEffect(() => {
    if (!isReady) return;

    if (compileTimeoutRef.current) {
      clearTimeout(compileTimeoutRef.current);
    }

    compileTimeoutRef.current = setTimeout(() => {
      compilePdf();
    }, 1500);

    return () => {
      if (compileTimeoutRef.current) {
        clearTimeout(compileTimeoutRef.current);
      }
      // A pending edit supersedes any queued idle upgrade from the last compile.
      cancelIdleEnhance();
    };
    // Deps are the slices that should invalidate a re-compile. compilePdf is not
    // a dep: it reads documentStore via getState(), and a new compilePdf identity
    // (e.g. from pdfUrl changing) shouldn't kick off a debounce cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady,
    docType,
    formData,
    references,
    enclosures,
    paragraphs,
    copyTos,
    distributions,
    fullQualityPreview,
  ]);

  // Form PDF preview state. Templates load async, so cache them.
  const [navmc10274Templates, setNavmc10274Templates] = useState<{
    page1: ArrayBuffer;
    page2: ArrayBuffer;
    page3: ArrayBuffer;
  } | null>(null);
  const [navmc11811Template, setNavmc11811Template] = useState<ArrayBuffer | null>(null);

  // Load form templates when entering forms mode
  useEffect(() => {
    if (documentCategory === 'forms') {
      // Load NAVMC 10274 templates (3 pages)
      if (!navmc10274Templates) {
        loadNavmc10274Templates()
          .then(setNavmc10274Templates)
          .catch(err => console.error('Failed to load NAVMC 10274 templates:', err));
      }
      // Load NAVMC 118(11) template (1 page)
      if (!navmc11811Template) {
        loadNavmc11811Template()
          .then(setNavmc11811Template)
          .catch(err => console.error('Failed to load NAVMC 118(11) template:', err));
      }
    }
  }, [documentCategory, navmc10274Templates, navmc11811Template]);

  // Generate form preview based on selected form type
  useEffect(() => {
    if (documentCategory !== 'forms') return;

    if (formCompileTimeoutRef.current) {
      clearTimeout(formCompileTimeoutRef.current);
    }

    formCompileTimeoutRef.current = setTimeout(async () => {
      try {
        let pdfBytes: Uint8Array | null = null;

        if (formType === 'navmc_10274' && navmc10274Templates) {
          pdfBytes = await generateNavmc10274Pdf(
            navmc10274,
            navmc10274Templates.page1,
            navmc10274Templates.page2,
            navmc10274Templates.page3
          );
        } else if (formType === 'navmc_118_11' && navmc11811Template) {
          // Resolve cross-field placeholders ({{NAME}}, {{DATE}}, etc.) from the
          // form's own values, so {{NAME}} in the remarks field renders the joined
          // name in the PDF instead of the literal token.
          const values = buildNavmc11811DefaultValues(navmc11811);
          const resolved = applyPlaceholdersToNavmc11811(navmc11811, values);
          pdfBytes = await generateNavmc11811Pdf(
            resolved,
            navmc11811Template
          );
        }

        if (pdfBytes) {
          const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);

          // Revoke old URL after creating new one (deferred — see the
          // correspondence revocations above for why).
          setFormPdfUrl((prevUrl) => {
            if (prevUrl) {
              setTimeout(() => URL.revokeObjectURL(prevUrl), 5000);
            }
            return url;
          });
        }
      } catch (err) {
        console.error('Form PDF generation error:', err);
      }
    }, 500); // Faster debounce for forms since no LaTeX compilation

    return () => {
      if (formCompileTimeoutRef.current) {
        clearTimeout(formCompileTimeoutRef.current);
      }
    };
  }, [documentCategory, formType, navmc10274, navmc11811, navmc10274Templates, navmc11811Template]);

  // Track if download is in progress to prevent double downloads
  const downloadInProgressRef = useRef(false);

  // Core download function, also called on retry. onProgress is optional so
  // batch/programmatic callers can skip the modal wiring.
  const executeDownload = useCallback(async (
    preOpenedWindow?: Window | null,
    onProgress?: (phase: DownloadProgressPhase) => void,
  ): Promise<boolean> => {
    // Ensure any just-restored enclosure bytes are back before the export
    // pipeline reads file.data (no-op once already hydrated).
    await rehydrateEnclosureFiles();
    // Snapshot fresh state at download time via getState().
    const currentStore = useDocumentStore.getState();
    const { texFiles, enclosures: generatedEnclosures, includeHyperlinks, signatureImage, referenceUrls } = generateAllLatexFiles(currentStore);

    // Build files object including signature image if present
    const files: Record<string, string | Uint8Array> = { ...texFiles };
    if (signatureImage) {
      files['attachments/signature.png'] = signatureImage;
    }

    onProgress?.({ kind: 'pdf-compiling' });
    let pdfBytes = await compile(files);

    if (pdfBytes) {
      // Merge enclosures and/or create hyperlinks (handles both PDF and text-only enclosures, and reference URLs)
      let lastBasicPageIndex: number | undefined;
      if (generatedEnclosures.length > 0 || (includeHyperlinks && referenceUrls.length > 0)) {
        onProgress?.({ kind: 'pdf-merging-enclosures' });
        const classification = getClassificationInfo(currentStore.formData.classLevel);
        const mergeResult = await mergeEnclosures(pdfBytes, generatedEnclosures, classification, includeHyperlinks, referenceUrls);
        pdfBytes = mergeResult.pdfBytes;
        lastBasicPageIndex = mergeResult.basicPageCount !== undefined ? mergeResult.basicPageCount - 1 : undefined;

        // Track enclosure errors for user notification (download context)
        if (mergeResult.hasErrors) {
          setEnclosureErrors(mergeResult.errors);
          setShowEnclosureErrors(true);
        }
      }

      // Add digital signature field if requested
      if (currentStore.formData.signatureType === 'digital') {
        onProgress?.({ kind: 'pdf-signing' });
        const config = DOC_TYPE_CONFIG[currentStore.docType];
        const isDualSignature = config?.uiMode === 'moa' || config?.compliance?.dualSignature;
        if (isDualSignature) {
          const sigConfig = getDualSignatoryConfig(currentStore.formData, config?.uiMode);
          pdfBytes = await addDualSignatureFields(new Uint8Array(pdfBytes), { ...sigConfig, lastBasicPageIndex });
        } else {
          const sigConfig = getSignatoryConfig(currentStore.formData);
          pdfBytes = await addSignatureField(new Uint8Array(pdfBytes), { ...sigConfig, lastBasicPageIndex });
        }
      }

      onProgress?.({ kind: 'pdf-saving' });
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      const downloaded = await downloadPdfBlob(blob, correspondenceFilename('pdf'), preOpenedWindow);
      // First real PDF checks off "Build your first document" (idempotent).
      if (downloaded) useOnboardingStore.getState().markComplete('first_document');
      return downloaded;
    }
    return false;
  }, [compile]);

  const handleDownloadPdfInternal = useCallback(async () => {
    // Prevent multiple simultaneous downloads
    if (downloadInProgressRef.current) {
      console.log('Download already in progress, skipping');
      return;
    }
    downloadInProgressRef.current = true;

    // Pre-open window for iOS BEFORE any async work (must be synchronous from user gesture)
    const preOpenedWindow = preOpenWindowForIOS();

    // Show the modal immediately; the compile step alone can take seconds.
    setDownloadProgress({ kind: 'pdf-preparing' });
    setIsCompiling(true);
    setCompileError(null);
    try {
      const success = await executeDownload(preOpenedWindow, setDownloadProgress);
      if (!success) {
        if (preOpenedWindow) preOpenedWindow.close();
        // No exception but no PDF either; worth reporting.
        addLogDirect('error', 'PDF download failed: no output produced');
        setDownloadProgress({
          kind: 'error',
          target: 'pdf',
          title: 'PDF download failed',
          message:
            'No PDF was produced. Check the preview panel for compile errors and try again.',
          retryable: true,
          reportable: true,
        });
        return;
      }
      // Success: hide the modal.
      finishDownload();
    } catch (err) {
      console.error('Download error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Download failed';
      // SwiftLaTeX attaches the full compile log to the thrown error as
      // .compileLog; surface it in the error UI and the log store.
      const compileLog = (err as Error & { compileLog?: string })?.compileLog;

      // Mirror compilePdf's logging pattern so the LogViewer shows the
      // full context even if the user closes the error modal.
      addLogDirect('error', `PDF download failed: ${errorMessage}`);
      if (compileLog) addLogDirect('error', compileLog);

      // If engine reset was needed, wait for it and retry once. Keep the
      // modal visible on the preparing phase while we wait.
      if (errorMessage === 'ENGINE_RESET_NEEDED') {
        console.log('Engine reset needed, waiting for engine to be ready...');
        setDownloadProgress({ kind: 'pdf-preparing' });
        try {
          const ready = await waitForReady(10000); // 10 second timeout
          if (ready) {
            console.log('Engine ready, retrying download...');
            const success = await executeDownload(preOpenedWindow, setDownloadProgress);
            if (!success) {
              if (preOpenedWindow) preOpenedWindow.close();
              // Engine reset succeeded but the retry produced nothing; worth reporting.
              setDownloadProgress({
                kind: 'error',
                target: 'pdf',
                title: 'PDF download failed',
                message: 'PDF generation failed after an engine retry — no output was produced.',
                retryable: true,
                reportable: true,
              });
            } else {
              finishDownload();
            }
          } else {
            if (preOpenedWindow) preOpenedWindow.close();
            // Engine didn't come back in time; offer a manual retry.
            setDownloadProgress({
              kind: 'error',
              target: 'pdf',
              title: 'Engine failed to recover',
              message:
                'The LaTeX engine didn\u2019t restart in time. Give it a moment and try again.',
              retryable: true,
              reportable: false,
            });
          }
        } catch (retryErr) {
          console.error('Retry failed:', retryErr);
          const retryMsg = retryErr instanceof Error ? retryErr.message : 'Download failed';
          const retryLog = (retryErr as Error & { compileLog?: string })?.compileLog;
          addLogDirect('error', `PDF retry failed: ${retryMsg}`);
          if (retryLog) addLogDirect('error', retryLog);
          if (preOpenedWindow) preOpenedWindow.close();
          setDownloadProgress({
            kind: 'error',
            target: 'pdf',
            title: 'PDF download failed',
            message: `Download failed after retry: ${retryMsg}`,
            compileLog: retryLog,
            retryable: true,
            reportable: true,
          });
        }
        return;
      }

      if (preOpenedWindow) preOpenedWindow.close();
      setDownloadProgress({
        kind: 'error',
        target: 'pdf',
        title: 'PDF download failed',
        message: errorMessage,
        compileLog,
        retryable: true,
        reportable: true,
      });
    } finally {
      setIsCompiling(false);
      downloadInProgressRef.current = false;
    }
  }, [executeDownload, waitForReady, addLogDirect, finishDownload]);

  // DOCX download helpers (must be before handleProceedWithPII)
  const pendingDocxRef = useRef<boolean>(false);

  const executeDocxDownload = useCallback(async () => {
    const currentStore = useDocumentStore.getState();
    const latexContent = generateFlatLatex(currentStore);
    // Show the progress modal immediately; the first run can sit in
    // docx-preparing for several seconds before the WASM fetch on slow
    // connections. On error, leave downloadProgress set: the caller flips the
    // modal into an error phase, avoiding a hidden-then-shown flash.
    setDownloadProgress({ kind: 'docx-preparing' });
    const blob = await convertLatexToDocx(
      latexContent,
      currentStore.formData.sealType,
      currentStore.formData.letterheadColor,
      currentStore.formData.fontFamily,
      currentStore.formData.fontSize,
      currentStore.formData.classLevel,
      currentStore.formData.customClassification,
      (phase) => setDownloadProgress(docxPhaseToDownloadPhase(phase)),
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = correspondenceFilename('docx');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // Success: clear the modal.
    finishDownload();
  }, [finishDownload]);

  // Core PII download function - can be called for retry
  const executePIIDownload = useCallback(async (
    preOpenedWindow?: Window | null,
    onProgress?: (phase: DownloadProgressPhase) => void,
  ): Promise<boolean> => {
    if (!pendingDownloadRef.current) return false;

    const currentStore = useDocumentStore.getState();
    const { texFiles, enclosures, includeHyperlinks, signatureImage, referenceUrls } = pendingDownloadRef.current;

    const files: Record<string, string | Uint8Array> = { ...texFiles };
    if (signatureImage) {
      files['attachments/signature.png'] = signatureImage;
    }

    onProgress?.({ kind: 'pdf-compiling' });
    let pdfBytes = await compile(files);

    if (pdfBytes) {
      let lastBasicPageIndex: number | undefined;
      if (enclosures.length > 0 || (includeHyperlinks && referenceUrls.length > 0)) {
        onProgress?.({ kind: 'pdf-merging-enclosures' });
        const classification = getClassificationInfo(currentStore.formData.classLevel);
        const mergeResult = await mergeEnclosures(pdfBytes, enclosures, classification, includeHyperlinks, referenceUrls);
        pdfBytes = mergeResult.pdfBytes;
        lastBasicPageIndex = mergeResult.basicPageCount !== undefined ? mergeResult.basicPageCount - 1 : undefined;

        // Track enclosure errors for user notification (PII download context)
        if (mergeResult.hasErrors) {
          setEnclosureErrors(mergeResult.errors);
          setShowEnclosureErrors(true);
        }
      }

      // Add digital signature field if requested
      if (currentStore.formData.signatureType === 'digital') {
        onProgress?.({ kind: 'pdf-signing' });
        const config = DOC_TYPE_CONFIG[currentStore.docType];
        const isDualSignature = config?.uiMode === 'moa' || config?.compliance?.dualSignature;
        if (isDualSignature) {
          const sigConfig = getDualSignatoryConfig(currentStore.formData, config?.uiMode);
          pdfBytes = await addDualSignatureFields(new Uint8Array(pdfBytes), { ...sigConfig, lastBasicPageIndex });
        } else {
          const sigConfig = getSignatoryConfig(currentStore.formData);
          pdfBytes = await addSignatureField(new Uint8Array(pdfBytes), { ...sigConfig, lastBasicPageIndex });
        }
      }

      onProgress?.({ kind: 'pdf-saving' });
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      const downloaded = await downloadPdfBlob(blob, correspondenceFilename('pdf'), preOpenedWindow);
      // First real PDF checks off "Build your first document" (idempotent).
      if (downloaded) useOnboardingStore.getState().markComplete('first_document');
      return downloaded;
    }
    return false;
  }, [compile]);

  // Handle proceeding with download after PII warning is acknowledged
  const handleProceedWithPII = useCallback(async () => {
    // Check if this was a DOCX download
    if (pendingDocxRef.current) {
      pendingDocxRef.current = false;
      setPiiDetectionResult(null);
      try {
        await executeDocxDownload();
      } catch (err) {
        console.error('DOCX generation error:', err);
        const msg = err instanceof Error ? err.message : 'An unexpected error occurred while generating the DOCX.';
        addLogDirect('error', `DOCX download failed: ${msg}`);
        setDownloadProgress({
          kind: 'error',
          target: 'docx',
          title: 'DOCX download failed',
          message: msg,
          retryable: true,
          reportable: true,
        });
      }
      return;
    }

    if (!pendingDownloadRef.current) return;

    // Prevent clicks while download is in progress
    if (downloadInProgressRef.current) {
      console.log('Download already in progress, ignoring PII proceed');
      return;
    }
    downloadInProgressRef.current = true;

    // Pre-open window for iOS BEFORE any async work (must be synchronous from user gesture)
    const preOpenedWindow = preOpenWindowForIOS();

    setDownloadProgress({ kind: 'pdf-preparing' });
    setIsCompiling(true);
    setCompileError(null);

    try {
      const success = await executePIIDownload(preOpenedWindow, setDownloadProgress);
      if (!success) {
        if (preOpenedWindow) preOpenedWindow.close();
        addLogDirect('error', 'PDF download failed: no output produced');
        setDownloadProgress({
          kind: 'error',
          target: 'pdf',
          title: 'PDF download failed',
          message:
            'No PDF was produced. Check the preview panel for compile errors and try again.',
          retryable: true,
          reportable: true,
        });
        return;
      }
      finishDownload();
    } catch (err) {
      console.error('Download error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Download failed';
      const compileLog = (err as Error & { compileLog?: string })?.compileLog;

      addLogDirect('error', `PDF download failed: ${errorMessage}`);
      if (compileLog) addLogDirect('error', compileLog);

      // If engine reset was needed, wait for it and retry once
      if (errorMessage === 'ENGINE_RESET_NEEDED') {
        console.log('Engine reset needed for PII download, waiting for engine to be ready...');
        setDownloadProgress({ kind: 'pdf-preparing' });
        try {
          const ready = await waitForReady(10000);
          if (ready) {
            console.log('Engine ready, retrying PII download...');
            const success = await executePIIDownload(preOpenedWindow, setDownloadProgress);
            if (!success) {
              if (preOpenedWindow) preOpenedWindow.close();
              setDownloadProgress({
                kind: 'error',
                target: 'pdf',
                title: 'PDF download failed',
                message: 'PDF generation failed after an engine retry — no output was produced.',
                retryable: true,
                reportable: true,
              });
            } else {
              finishDownload();
            }
          } else {
            if (preOpenedWindow) preOpenedWindow.close();
            setDownloadProgress({
              kind: 'error',
              target: 'pdf',
              title: 'Engine failed to recover',
              message:
                'The LaTeX engine didn\u2019t restart in time. Give it a moment and try again.',
              retryable: true,
              reportable: false,
            });
          }
        } catch (retryErr) {
          console.error('PII download retry failed:', retryErr);
          const retryMsg = retryErr instanceof Error ? retryErr.message : 'Download failed';
          const retryLog = (retryErr as Error & { compileLog?: string })?.compileLog;
          addLogDirect('error', `PDF retry failed: ${retryMsg}`);
          if (retryLog) addLogDirect('error', retryLog);
          if (preOpenedWindow) preOpenedWindow.close();
          setDownloadProgress({
            kind: 'error',
            target: 'pdf',
            title: 'PDF download failed',
            message: `Download failed after retry: ${retryMsg}`,
            compileLog: retryLog,
            retryable: true,
            reportable: true,
          });
        }
        return;
      }

      if (preOpenedWindow) preOpenedWindow.close();
      setDownloadProgress({
        kind: 'error',
        target: 'pdf',
        title: 'PDF download failed',
        message: errorMessage,
        compileLog,
        retryable: true,
        reportable: true,
      });
    } finally {
      setIsCompiling(false);
      downloadInProgressRef.current = false;
      pendingDownloadRef.current = null;
      setPiiDetectionResult(null);
    }
  }, [executePIIDownload, executeDocxDownload, waitForReady, addLogDirect, finishDownload]);

  // Handle canceling download after PII warning
  const handleCancelPIIDownload = useCallback(() => {
    pendingDownloadRef.current = null;
    pendingDocxRef.current = false;
    setPiiDetectionResult(null);
  }, []);

  // Form-specific PDF download handler
  const handleDownloadFormPdf = useCallback(async () => {
    if (downloadInProgressRef.current) {
      console.log('Download already in progress, ignoring click');
      return;
    }
    downloadInProgressRef.current = true;

    try {
      let pdfBytes: Uint8Array | null = null;
      let filename = 'form.pdf';

      if (formType === 'navmc_10274' && navmc10274Templates) {
        pdfBytes = await generateNavmc10274Pdf(
          navmc10274,
          navmc10274Templates.page1,
          navmc10274Templates.page2,
          navmc10274Templates.page3,
          { includeCoverPage }
        );
        filename = `NAVMC-10274-${navmc10274.date || 'form'}.pdf`;
      } else if (formType === 'navmc_118_11' && navmc11811Template) {
        // Same self-referential placeholder resolution as the live-preview
        // path above (compile useEffect). Without this, normal download
        // renders `{{NAME}}` etc. as literal yellow-highlighted text.
        const values = buildNavmc11811DefaultValues(navmc11811);
        const resolved = applyPlaceholdersToNavmc11811(navmc11811, values);
        pdfBytes = await generateNavmc11811Pdf(
          resolved,
          navmc11811Template
        );
        const lastName = navmc11811.lastName || 'Marine';
        filename = `NAVMC-118-11-${lastName}-${navmc11811.entryDate || 'entry'}.pdf`;
      }

      if (pdfBytes) {
        const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        // Exporting a form PDF also completes the checklist's first-document step.
        useOnboardingStore.getState().markComplete('first_document');
      } else {
        console.error('No PDF generated - missing templates or unsupported form type');
      }
    } catch (err) {
      console.error('Form PDF download error:', err);
    } finally {
      downloadInProgressRef.current = false;
    }
  }, [formType, navmc10274, navmc11811, includeCoverPage, navmc10274Templates, navmc11811Template]);

  const handleDownloadPdf = useCallback(() => {
    // Reveal validation now, so the section rail's error dots appear on Generate.
    useUIStore.getState().setValidationVisible(true);
    // Handle forms mode separately
    if (documentCategory === 'forms') {
      handleDownloadFormPdf();
      return;
    }

    // Correspondence mode - check engine ready
    if (!isReady) {
      // Surface the problem in the download modal (same place all other
      // download errors live) with a Retry button. The engine typically
      // finishes initializing within a few seconds of page load, so one
      // retry click is usually all the user needs.
      setDownloadProgress({
        kind: 'error',
        target: 'pdf',
        title: 'Engine still starting up',
        message:
          'The LaTeX engine is still initializing. Give it a couple seconds and try again.',
        retryable: true,
        // Not a bug worth reporting; a normal transient state.
        reportable: false,
      });
      return;
    }

    // Prevent clicks while download is in progress (including during retry)
    if (downloadInProgressRef.current) {
      console.log('Download already in progress, ignoring click');
      return;
    }

    console.log('Manual download click');

    // Check for PII before downloading
    const currentStore = useDocumentStore.getState();
    const piiResult = detectPII(currentStore);
    if (piiResult.found) {
      // Store the generated files for later use
      const { texFiles, enclosures, includeHyperlinks, signatureImage, referenceUrls } = generateAllLatexFiles(currentStore);
      pendingDownloadRef.current = { texFiles, enclosures, includeHyperlinks, signatureImage, referenceUrls };
      setPiiDetectionResult(piiResult);
      setPiiWarningOpen(true);
      return;
    }

    // No PII found, proceed with download
    handleDownloadPdfInternal();
  }, [documentCategory, isReady, handleDownloadPdfInternal, handleDownloadFormPdf, setPiiWarningOpen]);

  const handleDownloadTex = useCallback(() => {
    const { texFiles } = generateAllLatexFiles(useDocumentStore.getState());

    // Combine all generated tex files into one downloadable file
    // The files are: document.tex, letterhead.tex, signatory.tex, flags.tex,
    // references.tex, reference-urls.tex, encl-config.tex, copyto-config.tex,
    // body.tex, classification.tex
    const combinedTex = `%=============================================================================
% DONDOCS CORRESPONDENCE EXPORT
% Generated: ${new Date().toISOString()}
%
% This file contains all the configuration for your document.
% The main.tex template (not included) uses \\input{} to load these files.
% To compile: Use the dondocs web app or a LaTeX distribution with
% the main.tex template.
%=============================================================================

%-----------------------------------------------------------------------------
% LETTERHEAD CONFIGURATION (letterhead.tex)
%-----------------------------------------------------------------------------
${texFiles['letterhead.tex'] || '% No letterhead configuration'}

%-----------------------------------------------------------------------------
% DOCUMENT CONFIGURATION (document.tex)
%-----------------------------------------------------------------------------
${texFiles['document.tex'] || '% No document configuration'}

%-----------------------------------------------------------------------------
% CLASSIFICATION (classification.tex)
%-----------------------------------------------------------------------------
${texFiles['classification.tex'] || '% No classification'}

%-----------------------------------------------------------------------------
% SIGNATORY CONFIGURATION (signatory.tex)
%-----------------------------------------------------------------------------
${texFiles['signatory.tex'] || '% No signatory configuration'}

%-----------------------------------------------------------------------------
% FLAGS (flags.tex)
%-----------------------------------------------------------------------------
${texFiles['flags.tex'] || '% No flags'}

%-----------------------------------------------------------------------------
% REFERENCES (references.tex)
%-----------------------------------------------------------------------------
${texFiles['references.tex'] || '% No references'}

%-----------------------------------------------------------------------------
% REFERENCE URLs (reference-urls.tex)
%-----------------------------------------------------------------------------
${texFiles['reference-urls.tex'] || '% No reference URLs'}

%-----------------------------------------------------------------------------
% ENCLOSURES (encl-config.tex)
%-----------------------------------------------------------------------------
${texFiles['encl-config.tex'] || '% No enclosures'}

%-----------------------------------------------------------------------------
% COPY TO / DISTRIBUTION (copyto-config.tex)
%-----------------------------------------------------------------------------
${texFiles['copyto-config.tex'] || '% No copy-to recipients'}

%-----------------------------------------------------------------------------
% DOCUMENT BODY (body.tex)
%-----------------------------------------------------------------------------
${texFiles['body.tex'] || '% No body content'}
`;

    const blob = new Blob([combinedTex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = correspondenceFilename('tex');
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadFlatTex = useCallback(() => {
    const flatTex = generateFlatLatex(useDocumentStore.getState());
    const blob = new Blob([flatTex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'correspondence-flat.tex';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadDocx = useCallback(async () => {
    useUIStore.getState().setValidationVisible(true);
    // Check for PII before downloading
    const piiResult = detectPII(useDocumentStore.getState());
    if (piiResult.found) {
      pendingDocxRef.current = true;
      setPiiDetectionResult(piiResult);
      setPiiWarningOpen(true);
      return;
    }

    try {
      await executeDocxDownload();
    } catch (err) {
      console.error('DOCX generation error:', err);
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred while generating the DOCX.';
      addLogDirect('error', `DOCX download failed: ${msg}`);
      setDownloadProgress({
        kind: 'error',
        target: 'docx',
        title: 'DOCX download failed',
        message: msg,
        retryable: true,
        reportable: true,
      });
    }
  }, [executeDocxDownload, setPiiWarningOpen, addLogDirect]);

  /**
   * Re-run the last failed download. The error phase carries the target
   * (pdf | docx), so dispatch to the matching entry point; those handle PII
   * re-check, engine-ready check, and progress reset.
   */
  const handleRetryDownload = useCallback(() => {
    if (!downloadProgress || downloadProgress.kind !== 'error') return;
    const target = downloadProgress.target;
    // Clear the error immediately so the retry can set a fresh phase.
    setDownloadProgress(null);
    if (target === 'pdf') {
      handleDownloadPdf();
    } else {
      handleDownloadDocx();
    }
  }, [downloadProgress, handleDownloadPdf, handleDownloadDocx]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;
      const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Escape - Close all modals
      if (e.key === 'Escape') {
        closeAllModals();
        return;
      }

      // Ctrl/Cmd + K - toggle the command palette. Handled first so it always
      // works (including to close the palette).
      if (isMod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        const ui = useUIStore.getState();
        ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
        return;
      }

      // While the command palette is open, swallow every other global
      // mod-shortcut (save / download / print / find / preview) so they can't
      // fire behind it — e.g. ⌘D over the open palette must not export a PDF.
      if (useUIStore.getState().commandPaletteOpen) {
        return;
      }

      // Ctrl/Cmd + D - Download PDF
      if (isMod && e.key === 'd') {
        e.preventDefault();
        handleDownloadPdf();
        return;
      }

      // Ctrl/Cmd + P - Print (trigger browser print on the PDF)
      if (isMod && e.key === 'p') {
        e.preventDefault();
        if (pdfUrl) {
          // Open PDF in new tab for printing
          const printWindow = window.open(pdfUrl, '_blank');
          if (printWindow) {
            // { once: true } so the listener auto-removes after firing,
            // otherwise each popup window stays pinned by the closure.
            printWindow.addEventListener('load', () => {
              printWindow.print();
            }, { once: true });
          }
        }
        return;
      }

      // Ctrl/Cmd + S - flush a real save now. Work already autosaves
      // continuously; this forces the current document to persist immediately
      // (correspondence -> registry; forms already persist per edit) and the
      // passive "Saved" indicator reflects it.
      if (isMod && e.key === 's') {
        e.preventDefault();
        useDocumentsStore.getState().saveCurrent();
        useUIStore.getState().markSaved();
        return;
      }

      // Ctrl/Cmd + Shift + T - Open Templates
      if (isMod && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        setTemplateLoaderOpen(true);
        return;
      }

      // Ctrl/Cmd + H - Find & Replace
      if (isMod && e.key === 'h') {
        e.preventDefault();
        setFindReplaceOpen(true);
        return;
      }

      // Ctrl/Cmd + E - Toggle Preview
      if (isMod && e.key === 'e') {
        e.preventDefault();
        togglePreview();
        return;
      }

      // Ctrl/Cmd + Z - Undo (only when not in input fields)
      if (isMod && e.key === 'z' && !e.shiftKey && !isInInput) {
        e.preventDefault();
        const snapshot = undo();
        if (snapshot) {
          applySnapshot(snapshot);
        }
        return;
      }

      // Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z - Redo (only when not in input fields)
      if (isMod && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !isInInput) {
        e.preventDefault();
        const snapshot = redo();
        if (snapshot) {
          applySnapshot(snapshot);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    closeAllModals,
    handleDownloadPdf,
    pdfUrl,
    setTemplateLoaderOpen,
    setReferenceLibraryOpen,
    setFindReplaceOpen,
    togglePreview,
    undo,
    redo,
    applySnapshot,
  ]);

  // Keep the latest download triggers in the module-level holder so the
  // command-palette groups, built during render, can dispatch a download without
  // referencing a ref-reading callback at render time (the React rules forbid
  // touching refs during render). onRun reads the holder at click time.
  useEffect(() => {
    commandDownloadTriggers.pdf = handleDownloadPdf;
    commandDownloadTriggers.docx = () => {
      void handleDownloadDocx();
    };
  }, [handleDownloadPdf, handleDownloadDocx]);

  // Command palette (⌘K) groups, wired to the real Zustand actions. getState() is
  // read inside each onRun so the actions are always current; the only render-time
  // dependency is the section outline (the "Jump to section" group).
  const allDocs = useDocumentsStore((s) => s.docs);
  const currentDocId = useDocumentsStore((s) => s.currentId);
  const commandGroups = useMemo<CommandGroup[]>(() => {
    const groups: CommandGroup[] = [];

    if (outlineSections.length > 0) {
      groups.push({
        label: 'Jump to section',
        items: outlineSections.map((s) => ({
          id: `jump-${s.id}`,
          label: s.label,
          icon: CornerDownRight,
          onRun: () => useEditorOutlineStore.getState().jump(s.id),
        })),
      });
    }

    // Switch to a recent document — Recents are otherwise unreachable by keyboard.
    const recentDocs = Object.values(allDocs)
      .map((d) => d.meta)
      .filter((m) => m.id !== currentDocId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12);
    if (recentDocs.length > 0) {
      groups.push({
        label: 'Switch to document',
        items: recentDocs.map((m) => ({
          id: `switch-${m.id}`,
          label: m.title,
          icon: FileText,
          onRun: () => useDocumentsStore.getState().switchTo(m.id),
        })),
      });
    }

    groups.push({
      label: 'Create',
      items: [
        {
          id: 'new-document',
          label: 'New document',
          icon: Plus,
          onRun: () => useDocumentsStore.getState().newDocument(),
        },
        {
          id: 'new-naval-letter',
          label: 'New Naval Letter',
          icon: FileText,
          onRun: () => {
            useDocumentsStore.getState().newDocument();
            useDocumentStore.getState().setDocType('naval_letter');
          },
        },
        {
          id: 'new-mfr',
          label: 'New Memorandum for the Record',
          icon: FileText,
          onRun: () => {
            useDocumentsStore.getState().newDocument();
            useDocumentStore.getState().setDocType('mfr');
          },
        },
        {
          id: 'new-moa',
          label: 'New Memorandum of Agreement',
          icon: FileText,
          onRun: () => {
            useDocumentsStore.getState().newDocument();
            useDocumentStore.getState().setDocType('moa');
          },
        },
      ],
    });

    groups.push({
      label: 'Actions',
      items: [
        {
          id: 'download-pdf',
          label: 'Download PDF',
          icon: Download,
          kbd: formatShortcut('mod D'),
          onRun: () => commandDownloadTriggers.pdf(),
        },
        {
          id: 'download-docx',
          label: 'Download Word (.docx)',
          icon: Download,
          onRun: () => commandDownloadTriggers.docx(),
        },
        {
          id: 'save-draft',
          label: 'Save draft now',
          icon: Save,
          kbd: formatShortcut('mod S'),
          onRun: () => {
            useDocumentsStore.getState().saveCurrent();
            useUIStore.getState().markSaved();
          },
        },
        {
          id: 'batch-generate',
          label: 'Batch generate…',
          icon: Layers,
          onRun: () => useUIStore.getState().setBatchModalOpen(true),
        },
        {
          id: 'document-guide',
          label: 'Document type guide',
          icon: Compass,
          onRun: () => useUIStore.getState().setDocumentGuideOpen(true),
        },
        {
          id: 'browse-templates',
          label: 'Browse templates…',
          icon: FileDown,
          onRun: () => useUIStore.getState().setTemplateLoaderOpen(true),
        },
        {
          id: 'find-replace',
          label: 'Find & Replace…',
          icon: Search,
          kbd: formatShortcut('mod H'),
          onRun: () => useUIStore.getState().setFindReplaceOpen(true),
        },
        {
          id: 'share-link',
          label: 'Create share link…',
          icon: Link2,
          onRun: () => useUIStore.getState().setShareModal('share'),
        },
        {
          id: 'import-link',
          label: 'Open a share link…',
          icon: Link2,
          onRun: () => useUIStore.getState().setShareModal('import'),
        },
        // Hidden once running as an installed app.
        ...(!isInstalled
          ? [
              {
                id: 'install-app',
                label: 'Install app…',
                icon: MonitorDown,
                onRun: () => void promptInstall(),
              },
            ]
          : []),
      ],
    });

    // Commands scoped to the open document (only when it's actually in Recents).
    if (currentDocId && allDocs[currentDocId]) {
      groups.push({
        label: 'This document',
        items: [
          {
            id: 'version-history',
            label: 'Version history…',
            icon: History,
            onRun: () => useUIStore.getState().setHistoryDocId(currentDocId),
          },
          {
            id: 'duplicate-document',
            label: 'Duplicate document',
            icon: Copy,
            onRun: () => useDocumentsStore.getState().duplicateDocument(currentDocId),
          },
        ],
      });
    }

    groups.push({
      label: 'View',
      items: [
        {
          id: 'toggle-theme',
          label: 'Toggle light / dark theme',
          icon: MoonStar,
          onRun: () => useUIStore.getState().toggleTheme(),
        },
        {
          id: 'toggle-preview',
          label: 'Toggle preview panel',
          icon: PanelRight,
          onRun: () => useUIStore.getState().togglePreview(),
        },
        {
          id: 'manage-profiles',
          label: 'Manage profiles…',
          icon: Users,
          onRun: () => useUIStore.getState().setProfileModalOpen(true),
        },
      ],
    });

    const insertItems: CommandGroup['items'] = [
      {
        id: 'insert-reference',
        label: 'Insert reference…',
        icon: BookOpen,
        onRun: () => useUIStore.getState().setReferenceLibraryOpen(true),
      },
    ];
    // The SSIC field lives in the addressing section; only offer the jump when
    // that section exists for the current doc type (it's absent for MOAs, joint
    // letters, and the NAVMC forms), so the command never fires a dead jump that
    // would briefly hide the section-rail indicator.
    if (outlineSections.some((s) => s.id === 'addressing')) {
      insertItems.push({
        id: 'lookup-ssic',
        label: 'Look up SSIC code…',
        icon: Hash,
        onRun: () => useEditorOutlineStore.getState().jump('addressing'),
      });
    }
    if (outlineSections.some((s) => s.id === 'enclosures')) {
      insertItems.push({
        id: 'attach-enclosure',
        label: 'Attach enclosure…',
        icon: Paperclip,
        onRun: () => useEditorOutlineStore.getState().jump('enclosures'),
      });
    }
    insertItems.push({
      id: 'insert-batch-variable',
      label: 'Insert batch variable…',
      icon: Braces,
      onRun: () => useUIStore.getState().setBatchModalOpen(true),
    });
    groups.push({ label: 'Insert', items: insertItems });

    return groups;
  }, [outlineSections, allDocs, currentDocId, isInstalled]);

  return (
    <TooltipProvider>
    {/* h-screen-dvh (index.css): the shell sizes to the VISIBLE viewport on
        mobile — 100vh is ~50-100px taller than what's on screen under iOS
        Safari / Chrome Android browser chrome, which pushed the bottom FABs
        and preview toolbar under it — with a 100vh fallback for pre-dvh
        engines. */}
    <div className="flex flex-col h-screen-dvh bg-background relative overflow-hidden">
      {/* Faint Marine Coders EGA watermark behind the whole app. The animated
          beams + a denser EGA seal live inside the editor column (FormPanel),
          so the branded motion stays in the editor and doesn't sweep behind the
          sidebar, header, and preview. */}
      <div className="fixed inset-0 z-0 flex items-center justify-center pointer-events-none mt-16">
        <img
          src={marineCodersLogo}
          alt=""
          className="w-full max-w-[90vw] sm:max-w-[1200px] opacity-[0.04] sm:opacity-[0.035] dark:opacity-[0.055] dark:sm:opacity-[0.05] invert dark:invert-0"
          aria-hidden="true"
        />
      </div>
      {/* Skip link for keyboard navigation - WCAG 2.4.1 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>

      <Header
        onDownloadPdf={handleDownloadPdf}
        onDownloadTex={handleDownloadTex}
        onDownloadDocx={handleDownloadDocx}
        onDownloadFlatTex={handleDownloadFlatTex}
        onRefreshPreview={compilePdf}
        isCompiling={isCompiling}
        isDocxGenerating={downloadProgress !== null && downloadProgress.kind.startsWith('docx-')}
        isPdfGenerating={downloadProgress !== null && downloadProgress.kind.startsWith('pdf-')}
        isFormsMode={documentCategory === 'forms'}
      />

      <StorageNotice />
      <BackupNotice />
      <InstallNotice />

      <div className="flex flex-1 overflow-hidden">
        {/* Document workspace (desktop). Sits beside the main editor so the
            resize-divider math inside <main> is unaffected. */}
        <EditorSidebar />
        {/* Mobile-only Recents (floating button + dialog); desktop sidebar is hidden on phones. */}
        <MobileRecents />
        <VersionHistoryModal />

        <main id="main-content" ref={mainContainerRef} className="flex flex-1 min-w-0 overflow-hidden">
        {/* Form Panel - takes remaining space when preview is visible */}
        <div
          className="min-w-0 overflow-hidden"
          style={{
            // shrink=1 so the panels absorb the divider's width; with shrink=0 the
            // preview's right edge got clipped.
            flex: previewVisible && !isMobile ? `1 1 ${100 - previewWidth}%` : '1 1 100%',
          }}
        >
          <FormPanel />
        </div>

        {/* Resizable divider - only show on desktop when preview is visible */}
        {previewVisible && !isMobile && (
          <ResizableDivider
            onResize={setPreviewWidth}
            containerRef={mainContainerRef}
            currentWidth={previewWidth}
          />
        )}

        {/* Preview Panel - width controlled by previewWidth */}
        <div
          className="min-w-0 overflow-hidden"
          style={{
            flex: previewVisible && !isMobile ? `1 1 ${previewWidth}%` : undefined,
            display: previewVisible || isMobile ? 'block' : 'none',
          }}
        >
          <PreviewPanel
            pdfUrl={documentCategory === 'forms' ? formPdfUrl : pdfUrl}
            isCompiling={documentCategory === 'forms' ? false : (isCompiling || !isReady)}
            isWarmingUp={documentCategory === 'forms' ? false : !isReady}
            previewEnhanced={documentCategory === 'forms' ? true : previewEnhanced}
            error={documentCategory === 'forms' ? null : (compileError || engineError)}
          />
        </div>
        </main>
      </div>

      {/* Modals */}
      <ProfileModal />
      <ReferenceLibraryModal />
      {/* Lazy-mounted only while open; first open fetches the chunk, then it's
          cached for the session. Suspense fallback is null since a brief blank
          reads as normal dialog-open latency. */}
      {mobilePreviewOpen && (
        <Suspense fallback={null}>
          <MobilePreviewModal
            pdfUrl={documentCategory === 'forms' ? formPdfUrl : pdfUrl}
            isCompiling={documentCategory === 'forms' ? false : (isCompiling || !isReady)}
            error={documentCategory === 'forms' ? null : (compileError || engineError)}
            onDownloadPdf={handleDownloadPdf}
          />
        </Suspense>
      )}
      <AboutModal />
      <NISTComplianceModal />
      {commandPaletteOpen && (
        <CommandPalette
          open
          onClose={() => setCommandPaletteOpen(false)}
          groups={commandGroups}
        />
      )}
      <BatchModal compile={compile} isEngineReady={isReady} waitForReady={waitForReady} />
      <FindReplaceModal />
      <TemplateLoaderModal />
      <DocumentGuideModal />
      <WelcomeModal />
      <TourOverlay />
      <ActivationChecklist />
      <PIIWarningModal
        detectionResult={piiDetectionResult}
        onCancel={handleCancelPIIDownload}
        onProceed={handleProceedWithPII}
      />
      <LogViewerModal />
      <EnclosureErrorModal
        errors={enclosureErrors}
        open={showEnclosureErrors}
        onClose={() => {
          setShowEnclosureErrors(false);
          setEnclosureErrors([]);
        }}
      />
      {/* RestoreSessionModal retired: the registry auto-resumes the last open
          document, and Recents replaces the old "restore?" prompt. */}
      <ShareModal
        open={shareModal !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShareModal(null);
            setSharePayloadFromHash(null);
          }
        }}
        mode={shareModal ?? 'share'}
        initialPayload={shareModal === 'import' ? sharePayloadFromHash : undefined}
        onImportComplete={() => {
          setSharePayloadFromHash(null);
          const u = window.location;
          window.history.replaceState(null, '', u.pathname + u.search);
        }}
      />
      <UpdatePromptModal
        open={showUpdatePrompt}
        onConfirm={confirmUpdate}
        onDismiss={dismissUpdatePrompt}
      />
      <InstallAppModal />
      <AppAlertDialog />
      <DownloadProgressModal
        phase={downloadProgress}
        onClose={() => setDownloadProgress(null)}
        onRetry={handleRetryDownload}
      />
      <CompileErrorModal
        open={compileErrorModalOpen}
        error={compileError}
        compileLog={compileLog}
        onClose={() => setCompileErrorModalOpen(false)}
      />
      <BrowserCompatibilityNotice />
    </div>
    </TooltipProvider>
  );
}

export default App;
