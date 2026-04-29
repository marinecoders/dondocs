import { useEffect, useCallback, useState, useRef, lazy, Suspense } from 'react';
import { Header } from '@/components/layout/Header';
import { FormPanel } from '@/components/layout/FormPanel';
import { PreviewPanel } from '@/components/layout/PreviewPanel';
import { ResizableDivider } from '@/components/layout/ResizableDivider';
import { ProfileModal } from '@/components/modals/ProfileModal';
import { ReferenceLibraryModal } from '@/components/modals/ReferenceLibraryModal';
// MobilePreviewModal pulls react-pdf + @react-pdf-viewer + pdf.js core
// (~400 KB raw / ~120 KB gz). Desktop users (the majority) never open
// it — the floating "Preview PDF" button that triggers it only appears
// on mobile. Lazy-loading splits it into its own chunk that's only
// fetched when the user actually opens the modal. Combined with the
// `mobilePreviewOpen &&` gate in the JSX below, the chunk doesn't
// even start loading until the user taps the button.
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
import { PIIWarningModal } from '@/components/modals/PIIWarningModal';
import { LogViewerModal } from '@/components/modals/LogViewerModal';
import { EnclosureErrorModal } from '@/components/modals/EnclosureErrorModal';
import { RestoreSessionModal } from '@/components/modals/RestoreSessionModal';
import { ShareModal } from '@/components/modals/ShareModal';
import { UpdatePromptModal } from '@/components/modals/UpdatePromptModal';
import { DownloadProgressModal } from '@/components/modals/DownloadProgressModal';
import { CompileErrorModal } from '@/components/modals/CompileErrorModal';
import {
  docxPhaseToDownloadPhase,
  type DownloadProgressPhase,
} from '@/components/modals/downloadProgressTypes';
import { parseShareUrl } from '@/lib/shareCrypto';
import { canonicalizeUnitAddress } from '@/lib/unitAddress';
import { BrowserCompatibilityNotice } from '@/components/BrowserCompatibilityNotice';
import { BackgroundBeams } from '@/components/effects/BackgroundBeams';
const marineCodersLogo = `${import.meta.env.BASE_URL}attachments/marine-coders-logo.svg`;
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useProfileStore } from '@/stores/profileStore';
import { useLogStore } from '@/stores/logStore';
import { useLatexEngine, useServiceWorker } from '@/hooks';
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
    // MOA/MOU: Junior uses full name uppercased, Senior uses abbreviated form "F. LASTNAME"
    // This matches how the LaTeX generator renders them (see generator.ts lines 255-278)
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

function App() {
  // Background-prefetch the Pandoc WASM module (~58 MB) during browser idle
  // time so the first user-initiated DOCX export feels instant rather than
  // a 5-15s download wait. Gated on connection type internally — skips on
  // offline, data-saver, and very slow connections.
  usePandocIdlePrefetch();

  // Individual selectors — Zustand only re-renders this component when the
  // specific field changes by strict equality. Previously `useUIStore()`
  // subscribed to the whole store, so every modal open/close and every
  // autoSaveStatus transition was re-rendering App and its entire subtree.
  // Setters are stable references from Zustand's `create()` callback, so
  // selecting them individually adds no cost.
  const theme = useUIStore((s) => s.theme);
  const colorScheme = useUIStore((s) => s.colorScheme);
  const density = useUIStore((s) => s.density);
  const isMobile = useUIStore((s) => s.isMobile);
  const setIsMobile = useUIStore((s) => s.setIsMobile);
  // Gate the lazy MobilePreviewModal — chunk only fetches on first open.
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
  const mainContainerRef = useRef<HTMLElement>(null);
  // Individual selectors instead of a full `useDocumentStore()` subscription.
  // The seven slices below are the ones that should invalidate the debounced
  // compile; subscribing to them granularly means every other setter call
  // (auto-save status pings, unrelated form field changes that the compile
  // doesn't care about, etc.) no longer wakes App.tsx. Inside compilePdf we
  // still need the full store for `generateAllLatexFiles`, but we pull it
  // via `useDocumentStore.getState()` at call time so nothing gets stale.
  const docType = useDocumentStore((s) => s.docType);
  const formData = useDocumentStore((s) => s.formData);
  const references = useDocumentStore((s) => s.references);
  const enclosures = useDocumentStore((s) => s.enclosures);
  const paragraphs = useDocumentStore((s) => s.paragraphs);
  const copyTos = useDocumentStore((s) => s.copyTos);
  const distributions = useDocumentStore((s) => s.distributions);
  const documentCategory = useDocumentStore((s) => s.documentCategory);
  const formType = useDocumentStore((s) => s.formType);
  const setFormData = useDocumentStore((s) => s.setFormData);
  const applySnapshot = useDocumentStore((s) => s.applySnapshot);
  // Individual selectors — App no longer re-renders on every form-store
  // keystroke (only when one of these three slices actually changes).
  const navmc10274 = useFormStore((s) => s.navmc10274);
  const navmc11811 = useFormStore((s) => s.navmc11811);
  const includeCoverPage = useFormStore((s) => s.includeCoverPage);
  // Individual selectors across the remaining stores too — same reasoning.
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const selectedProfile = useProfileStore((s) => s.selectedProfile);
  const profiles = useProfileStore((s) => s.profiles);
  const addLogDirect = useLogStore((s) => s.addLogDirect);
  const { isReady, compile, waitForReady, error: engineError } = useLatexEngine();
  const { showUpdatePrompt, confirmUpdate, dismissUpdatePrompt } = useServiceWorker();

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [formPdfUrl, setFormPdfUrl] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  // Full formatted log from the compile failure (from SwiftLaTeX). Drives the
  // compile-error modal — kept separate from the logStore feed so we have a
  // clean one-shot value to show without having to scrape the log history.
  const [compileLog, setCompileLog] = useState<string | null>(null);
  // Live-preview compile errors pop a modal the FIRST time a new error
  // appears. `lastShownCompileErrorRef` holds the text we already showed so
  // subsequent debounce cycles with the same error don't re-pop. Reset to
  // null on every successful compile (see useEffect below).
  const [compileErrorModalOpen, setCompileErrorModalOpen] = useState(false);
  const lastShownCompileErrorRef = useRef<string | null>(null);
  // Download loading feedback (PDF + DOCX). Non-null means a download is in
  // flight (modal visible) or failed (error phase, dismissible modal). Drives
  // the Header's "Generating…" menu state so the user can't double-click.
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressPhase | null>(null);
  const compileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formCompileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isResettingRef = useRef(false);

  // PII detection state
  const [piiDetectionResult, setPiiDetectionResult] = useState<PIIDetectionResult | null>(null);
  const pendingDownloadRef = useRef<GeneratedFiles | null>(null);

  // Enclosure error state
  const [enclosureErrors, setEnclosureErrors] = useState<EnclosureError[]>([]);
  const [showEnclosureErrors, setShowEnclosureErrors] = useState(false);

  // Share link payload when opened from URL hash (#s=...)
  const [sharePayloadFromHash, setSharePayloadFromHash] = useState<string | null>(null);

  // On mount, if URL has a share hash, open import modal with that payload
  useEffect(() => {
    const payload = parseShareUrl(window.location.href);
    if (payload) {
      setSharePayloadFromHash(payload);
      setShareModal('import');
    }
  }, [setShareModal]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
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

  // Detect mobile/tablet devices
  // iPads and tablets should use mobile UI since embedded PDF preview doesn't work well
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
        // Check if user has a persisted preference (localStorage)
        const stored = localStorage.getItem('dondocs_ui');
        const hasPersistedPreference = stored && JSON.parse(stored)?.state?.previewVisible !== undefined;

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

  // Sync selected profile with form data on initial load
  useEffect(() => {
    if (selectedProfile && profiles[selectedProfile]) {
      const profile = profiles[selectedProfile];
      setFormData({
        department: profile.department,
        unitLine1: profile.unitLine1,
        unitLine2: profile.unitLine2,
        // Canonicalize on read so legacy profiles (saved before PR #63's
        // canonicalize-on-pick fix) get the SECNAV-correct comma layout.
        // No-op if the profile is already in canonical form.
        unitAddress: canonicalizeUnitAddress(profile.unitAddress),
        ssic: profile.ssic,
        from: profile.from,
        sigFirst: profile.sigFirst,
        sigMiddle: profile.sigMiddle,
        sigLast: profile.sigLast,
        sigRank: profile.sigRank,
        sigTitle: profile.sigTitle,
        byDirection: profile.byDirection,
        byDirectionAuthority: profile.byDirectionAuthority,
        cuiControlledBy: profile.cuiControlledBy,
        pocEmail: profile.pocEmail,
        signatureImage: profile.signatureImage,
      });
    }
    // Only run on initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compile PDF
  const compilePdf = useCallback(async () => {
    if (!isReady) return;

    // Don't show new compiling state if we're recovering from a reset
    if (!isResettingRef.current) {
      setIsCompiling(true);
    }
    setCompileError(null);
    setCompileLog(null);

    try {
      // Read the full document store at compile time via getState() so we
      // don't need a render-subscribing reference. The debounce dep array
      // already handles "when should we re-compile" granularly; by the time
      // we get here the state is current.
      const currentStore = useDocumentStore.getState();
      const { texFiles, enclosures: generatedEnclosures, includeHyperlinks, signatureImage, referenceUrls } = generateAllLatexFiles(currentStore);

      // Build files object including signature image if present
      const files: Record<string, string | Uint8Array> = { ...texFiles };
      if (signatureImage) {
        files['attachments/signature.png'] = signatureImage;
      }

      let pdfBytes = await compile(files);

      if (pdfBytes) {
        // When fullQualityPreview is enabled, run the full pipeline in preview
        // (enclosure merging, hyperlink annotation, digital signature fields).
        // When disabled (default), these are deferred to the download/export path
        // for better responsiveness on slower machines.
        if (fullQualityPreview) {
          if (generatedEnclosures.length > 0 || (includeHyperlinks && referenceUrls.length > 0)) {
            const classification = getClassificationInfo(currentStore.formData.classLevel);
            const mergeResult = await mergeEnclosures(pdfBytes, generatedEnclosures, classification, includeHyperlinks, referenceUrls);
            pdfBytes = mergeResult.pdfBytes;
          }

          if (currentStore.formData.signatureType === 'digital') {
            const config = DOC_TYPE_CONFIG[currentStore.docType];
            const isDualSignature = config?.uiMode === 'moa' || config?.compliance?.dualSignature;
            if (isDualSignature) {
              const sigConfig = getDualSignatoryConfig(currentStore.formData, config?.uiMode);
              pdfBytes = await addDualSignatureFields(new Uint8Array(pdfBytes), sigConfig);
            } else {
              const sigConfig = getSignatoryConfig(currentStore.formData);
              pdfBytes = await addSignatureField(new Uint8Array(pdfBytes), sigConfig);
            }
          }
        }

        // Revoke old URL
        if (pdfUrl) {
          URL.revokeObjectURL(pdfUrl);
        }

        const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
        // Successful compile — clear any held-over log and reset the modal
        // dedup guard so a *future* failure pops the modal again (otherwise
        // after fixing and re-breaking with the same error, we'd stay silent).
        setCompileLog(null);
        lastShownCompileErrorRef.current = null;
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
    // documentStore is read via useDocumentStore.getState() inside, so it
    // doesn't need to be in the deps — only the things we actually close
    // over as React values. pdfUrl is captured for revocation.
  }, [isReady, compile, pdfUrl, addLogDirect, fullQualityPreview]);

  // Auto-open the compile-error modal when a *new* error appears.
  // "New" = different message than the last one we popped the modal for.
  // This avoids spamming the user on every debounce cycle while an error
  // persists (they type more, compile keeps failing, but modal stays quiet
  // after the first pop). The successful-compile branch of compilePdf
  // resets `lastShownCompileErrorRef` to null so a *future* failure pops
  // again — including re-breaks of the same error after a fix.
  //
  // Guard: suppress the pop while a download or PII modal is already up so
  // we don't stack two modals on top of each other for what's often the
  // same underlying compile failure (the download pipeline runs its own
  // compile and will surface the error through the download modal's error
  // phase). The dep on `downloadProgress` / `piiWarningOpen` re-runs this
  // effect when those clear, giving us the chance to pop belatedly if the
  // compile error is still unresolved — but only if it wasn't already
  // shown (lastShownCompileErrorRef dedup still applies).
  useEffect(() => {
    if (!compileError) return;
    if (compileError === lastShownCompileErrorRef.current) return;
    if (downloadProgress !== null) return;
    if (piiWarningOpen) return;
    lastShownCompileErrorRef.current = compileError;
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
    };
    // The deps are the granular slices that should invalidate a re-compile.
    // `compilePdf` is intentionally NOT a dep — it captures documentStore via
    // getState(), and we don't want a new compilePdf identity (e.g. from pdfUrl
    // changing) to kick off an unrelated debounce cycle.
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

  // Generate form PDF preview when in forms mode
  // Note: Templates need to be loaded async, so we cache them
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
          // Resolve cross-field placeholders ({{NAME}}, {{DATE}}, etc.)
          // from the form's own field values before generating, so users
          // typing `{{NAME}}` in the remarks field see the joined name
          // in the output PDF instead of literal `{{NAME}}` (issue #13).
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

          // Revoke old URL after creating new one
          setFormPdfUrl((prevUrl) => {
            if (prevUrl) {
              URL.revokeObjectURL(prevUrl);
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

  // Core download function - can be called for retry.
  // `onProgress` is optional so batch-mode / programmatic callers can invoke
  // this without the modal wiring; the interactive path always passes it.
  const executeDownload = useCallback(async (
    preOpenedWindow?: Window | null,
    onProgress?: (phase: DownloadProgressPhase) => void,
  ): Promise<boolean> => {
    // Snapshot fresh state at download time via getState() rather than
    // closing over a render-subscribed reference.
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
      if (generatedEnclosures.length > 0 || (includeHyperlinks && referenceUrls.length > 0)) {
        onProgress?.({ kind: 'pdf-merging-enclosures' });
        const classification = getClassificationInfo(currentStore.formData.classLevel);
        const mergeResult = await mergeEnclosures(pdfBytes, generatedEnclosures, classification, includeHyperlinks, referenceUrls);
        pdfBytes = mergeResult.pdfBytes;

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
          pdfBytes = await addDualSignatureFields(new Uint8Array(pdfBytes), sigConfig);
        } else {
          const sigConfig = getSignatoryConfig(currentStore.formData);
          pdfBytes = await addSignatureField(new Uint8Array(pdfBytes), sigConfig);
        }
      }

      onProgress?.({ kind: 'pdf-saving' });
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      return await downloadPdfBlob(blob, 'correspondence.pdf', preOpenedWindow);
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

    // Show the modal immediately — the compile step alone can take seconds.
    setDownloadProgress({ kind: 'pdf-preparing' });
    setIsCompiling(true);
    setCompileError(null);
    try {
      const success = await executeDownload(preOpenedWindow, setDownloadProgress);
      if (!success) {
        if (preOpenedWindow) preOpenedWindow.close();
        // No exception but no PDF either — unusual path, worth reporting.
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
      // Success — hide the modal.
      setDownloadProgress(null);
    } catch (err) {
      console.error('Download error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Download failed';
      // SwiftLaTeX attaches the full compile log to the thrown error as
      // `.compileLog` — surface it in the error UI and the log store.
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
              // Engine reset succeeded but the retry still produced nothing —
              // unexpected, worth reporting.
              setDownloadProgress({
                kind: 'error',
                target: 'pdf',
                title: 'PDF download failed',
                message: 'PDF generation failed after an engine retry — no output was produced.',
                retryable: true,
                reportable: true,
              });
            } else {
              setDownloadProgress(null);
            }
          } else {
            if (preOpenedWindow) preOpenedWindow.close();
            // Engine didn't come back in time — transient; offer a manual retry.
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
  }, [executeDownload, waitForReady, addLogDirect]);

  // DOCX download helpers (must be before handleProceedWithPII)
  const pendingDocxRef = useRef<boolean>(false);

  const executeDocxDownload = useCallback(async () => {
    const currentStore = useDocumentStore.getState();
    const latexContent = generateFlatLatex(currentStore);
    // Show the progress modal immediately so the user gets feedback the moment
    // they click "Download DOCX" — the first run can spend several seconds in
    // `docx-preparing` before the WASM fetch even starts on slow connections.
    // On error we intentionally do NOT clear downloadProgress here; the caller
    // catches the exception and flips the modal into an error phase, which
    // avoids a flash of hidden-then-shown modal.
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
    a.download = 'correspondence.docx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // Success — clear the modal.
    setDownloadProgress(null);
  }, []);

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
      if (enclosures.length > 0 || (includeHyperlinks && referenceUrls.length > 0)) {
        onProgress?.({ kind: 'pdf-merging-enclosures' });
        const classification = getClassificationInfo(currentStore.formData.classLevel);
        const mergeResult = await mergeEnclosures(pdfBytes, enclosures, classification, includeHyperlinks, referenceUrls);
        pdfBytes = mergeResult.pdfBytes;

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
          pdfBytes = await addDualSignatureFields(new Uint8Array(pdfBytes), sigConfig);
        } else {
          const sigConfig = getSignatoryConfig(currentStore.formData);
          pdfBytes = await addSignatureField(new Uint8Array(pdfBytes), sigConfig);
        }
      }

      onProgress?.({ kind: 'pdf-saving' });
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      return await downloadPdfBlob(blob, 'correspondence.pdf', preOpenedWindow);
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
      setDownloadProgress(null);
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
              setDownloadProgress(null);
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
  }, [executePIIDownload, executeDocxDownload, waitForReady, addLogDirect]);

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
        // Not a bug worth reporting — this is a normal transient state.
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
    a.download = 'correspondence.tex';
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
   * (`pdf` | `docx`), so we just dispatch to the matching top-level entry
   * point. Those entry points handle PII re-check, engine-ready check,
   * progress reset, etc. — we don't need to reproduce any of that here.
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
            // { once: true } so the listener auto-removes after firing —
            // otherwise repeated Ctrl/Cmd+P presses leave each fresh
            // popup window holding a closure reference indefinitely
            // (the listener targets a window object that lives until
            // the user closes it, and even after close the closure can
            // pin it from being GC'd until the listener is unbound).
            printWindow.addEventListener('load', () => {
              printWindow.print();
            }, { once: true });
          }
        }
        return;
      }

      // Ctrl/Cmd + S - Save draft (triggers save status indicator)
      if (isMod && e.key === 's') {
        e.preventDefault();
        useUIStore.getState().setAutoSaveStatus('Draft saved');
        setTimeout(() => useUIStore.getState().setAutoSaveStatus(''), 2000);
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

  return (
    <div className="flex flex-col h-screen bg-background relative overflow-hidden">
      {/* Marine Coders EGA watermark - behind beams */}
      <div className="fixed inset-0 z-0 flex items-center justify-center pointer-events-none mt-16">
        <img
          src={marineCodersLogo}
          alt=""
          className="w-full max-w-[90vw] sm:max-w-[1200px] opacity-[0.08] sm:opacity-[0.07] dark:opacity-[0.12] dark:sm:opacity-[0.10] invert dark:invert-0"
          aria-hidden="true"
        />
      </div>
      {/* Animated background beams - ported from Marines.dev */}
      <BackgroundBeams className="fixed inset-0 z-0 opacity-60 dark:opacity-100" reducedMotion={isMobile} />
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

      <main id="main-content" ref={mainContainerRef} className="flex flex-1 overflow-hidden">
        {/* Form Panel - takes remaining space when preview is visible */}
        <div
          className="min-w-0 overflow-hidden"
          style={{
            flex: previewVisible && !isMobile ? `0 0 ${100 - previewWidth}%` : '1 1 100%',
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
            flex: previewVisible && !isMobile ? `0 0 ${previewWidth}%` : undefined,
            display: previewVisible || isMobile ? 'block' : 'none',
          }}
        >
          <PreviewPanel
            pdfUrl={documentCategory === 'forms' ? formPdfUrl : pdfUrl}
            isCompiling={documentCategory === 'forms' ? false : (isCompiling || !isReady)}
            error={documentCategory === 'forms' ? null : (compileError || engineError)}
          />
        </div>
      </main>

      {/* Modals */}
      <ProfileModal />
      <ReferenceLibraryModal />
      {/*
        Lazy-mounted only while open. On first open, React fetches the
        chunk (the modal + react-pdf + react-pdf-viewer + pdf.js core).
        Suspense fallback is null because the user just tapped the
        "Preview PDF" button — they expect the dialog to appear with
        whatever animation; a brief blank moment is indistinguishable
        from regular dialog-open latency. After the first open, the
        chunk is cached for the rest of the session.
      */}
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
      <BatchModal compile={compile} isEngineReady={isReady} waitForReady={waitForReady} />
      <FindReplaceModal />
      <TemplateLoaderModal />
      <DocumentGuideModal />
      <WelcomeModal />
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
      <RestoreSessionModal />
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
  );
}

export default App;
