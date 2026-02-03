import { useEffect, useCallback, useState, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { FormPanel } from '@/components/layout/FormPanel';
import { PreviewPanel } from '@/components/layout/PreviewPanel';
import { ResizableDivider } from '@/components/layout/ResizableDivider';
import { ProfileModal } from '@/components/modals/ProfileModal';
import { ReferenceLibraryModal } from '@/components/modals/ReferenceLibraryModal';
import { MobilePreviewModal } from '@/components/modals/MobilePreviewModal';
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
import { parseShareUrl } from '@/lib/shareCrypto';
import { BrowserCompatibilityNotice } from '@/components/BrowserCompatibilityNotice';
import { BackgroundBeams } from '@/components/effects/BackgroundBeams';
import marineCodersLogo from '/attachments/marine-coders-logo.svg';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useProfileStore } from '@/stores/profileStore';
import { useLogStore } from '@/stores/logStore';
import { useLatexEngine, useServiceWorker } from '@/hooks';
import { generateAllLatexFiles, type GeneratedFiles } from '@/services/latex/generator';
import { generateDocx } from '@/services/docx/generator';
import { generateNavmc10274Pdf, loadNavmc10274Templates } from '@/services/pdf/navmc10274Generator';
import { generateNavmc11811Pdf, loadNavmc11811Template } from '@/services/pdf/navmc11811Generator';
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
  } else if (uiMode === 'joint') {
    // Joint letter uses jointJuniorSigName and jointSeniorSigName (both uppercased)
    juniorName = formData.jointJuniorSigName?.toUpperCase()?.trim() || undefined;
    seniorName = formData.jointSeniorSigName?.toUpperCase()?.trim() || undefined;
  } else if (uiMode === 'joint_memo') {
    // Joint memo uses jointMemoJuniorSigName and jointMemoSeniorSigName
    juniorName = formData.jointMemoJuniorSigName?.toUpperCase()?.trim() || undefined;
    seniorName = formData.jointMemoSeniorSigName?.toUpperCase()?.trim() || undefined;
  }

  return {
    juniorSignatoryName: juniorName,
    seniorSignatoryName: seniorName,
  };
}

function App() {
  const {
    theme,
    colorScheme,
    density,
    isMobile,
    setIsMobile,
    previewVisible,
    previewWidth,
    setPreviewVisible,
    setPreviewWidth,
    setFindReplaceOpen,
    setPiiWarningOpen,
    setTemplateLoaderOpen,
    setReferenceLibraryOpen,
    setShareModal,
    shareModal,
    togglePreview,
    closeAllModals,
  } = useUIStore();
  const mainContainerRef = useRef<HTMLElement>(null);
  const documentStore = useDocumentStore();
  const { documentCategory, formType } = useDocumentStore();
  const { setFormData, applySnapshot } = useDocumentStore();
  const formStore = useFormStore();
  const { undo, redo } = useHistoryStore();
  const { selectedProfile, profiles } = useProfileStore();
  const { addLogDirect } = useLogStore();
  const { isReady, compile, waitForReady, error: engineError } = useLatexEngine();
  const { showUpdatePrompt, confirmUpdate, dismissUpdatePrompt } = useServiceWorker();

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [formPdfUrl, setFormPdfUrl] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
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
        unitAddress: profile.unitAddress,
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

    try {
      const { texFiles, enclosures, includeHyperlinks, signatureImage, referenceUrls } = generateAllLatexFiles(documentStore);

      // Build files object including signature image if present
      const files: Record<string, string | Uint8Array> = { ...texFiles };
      if (signatureImage) {
        files['attachments/signature.png'] = signatureImage;
      }

      let pdfBytes = await compile(files);

      if (pdfBytes) {
        // Merge enclosures and/or create hyperlinks (handles both PDF and text-only enclosures, and reference URLs)
        if (enclosures.length > 0 || (includeHyperlinks && referenceUrls.length > 0)) {
          const classification = getClassificationInfo(
            documentStore.formData.classLevel,
            documentStore.formData.customClassification
          );
          const mergeResult = await mergeEnclosures(pdfBytes, enclosures, classification, includeHyperlinks, referenceUrls);
          pdfBytes = mergeResult.pdfBytes;

          // Track enclosure errors for user notification
          if (mergeResult.hasErrors) {
            setEnclosureErrors(mergeResult.errors);
            setShowEnclosureErrors(true);
          }
        }

        // Add digital signature field if requested
        if (documentStore.formData.signatureType === 'digital') {
          const config = DOC_TYPE_CONFIG[documentStore.docType];
          const isDualSignature = config?.uiMode === 'moa' || config?.compliance?.dualSignature;
          if (isDualSignature) {
            const sigConfig = getDualSignatoryConfig(documentStore.formData, config?.uiMode);
            pdfBytes = await addDualSignatureFields(new Uint8Array(pdfBytes), sigConfig);
          } else {
            const sigConfig = getSignatoryConfig(documentStore.formData);
            pdfBytes = await addSignatureField(new Uint8Array(pdfBytes), sigConfig);
          }
        }

        // Revoke old URL
        if (pdfUrl) {
          URL.revokeObjectURL(pdfUrl);
        }

        const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
      }
      // Clear reset flag on success
      isResettingRef.current = false;
    } catch (err) {
      console.error('Compilation error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Compilation failed';
      // Get compile log directly from error if available (for immediate access)
      const compileLog = (err as Error & { compileLog?: string })?.compileLog;

      // If engine reset is needed, mark that we're resetting so next compile doesn't flash
      if (errorMessage === 'ENGINE_RESET_NEEDED') {
        isResettingRef.current = true;
      } else {
        setCompileError(errorMessage);
        // Add error and full log to log store directly so it's available when user opens log viewer
        addLogDirect('error', `Compilation failed: ${errorMessage}`);
        if (compileLog) {
          addLogDirect('error', compileLog);
        }
      }
    } finally {
      setIsCompiling(false);
    }
  }, [isReady, compile, documentStore, pdfUrl, addLogDirect]);

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
  }, [
    isReady,
    documentStore.docType,
    documentStore.formData,
    documentStore.references,
    documentStore.enclosures,
    documentStore.paragraphs,
    documentStore.copyTos,
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
            formStore.navmc10274,
            navmc10274Templates.page1,
            navmc10274Templates.page2,
            navmc10274Templates.page3
          );
        } else if (formType === 'navmc_118_11' && navmc11811Template) {
          pdfBytes = await generateNavmc11811Pdf(
            formStore.navmc11811,
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
  }, [documentCategory, formType, formStore.navmc10274, formStore.navmc11811, navmc10274Templates, navmc11811Template]);

  // Track if download is in progress to prevent double downloads
  const downloadInProgressRef = useRef(false);

  // Core download function - can be called for retry
  const executeDownload = useCallback(async (preOpenedWindow?: Window | null): Promise<boolean> => {
    const { texFiles, enclosures, includeHyperlinks, signatureImage, referenceUrls } = generateAllLatexFiles(documentStore);

    // Build files object including signature image if present
    const files: Record<string, string | Uint8Array> = { ...texFiles };
    if (signatureImage) {
      files['attachments/signature.png'] = signatureImage;
    }

    let pdfBytes = await compile(files);

    if (pdfBytes) {
      // Merge enclosures and/or create hyperlinks (handles both PDF and text-only enclosures, and reference URLs)
      if (enclosures.length > 0 || (includeHyperlinks && referenceUrls.length > 0)) {
        const classification = getClassificationInfo(documentStore.formData.classLevel);
        const mergeResult = await mergeEnclosures(pdfBytes, enclosures, classification, includeHyperlinks, referenceUrls);
        pdfBytes = mergeResult.pdfBytes;

        // Track enclosure errors for user notification (download context)
        if (mergeResult.hasErrors) {
          setEnclosureErrors(mergeResult.errors);
          setShowEnclosureErrors(true);
        }
      }

      // Add digital signature field if requested
      if (documentStore.formData.signatureType === 'digital') {
        const config = DOC_TYPE_CONFIG[documentStore.docType];
        const isDualSignature = config?.uiMode === 'moa' || config?.compliance?.dualSignature;
        if (isDualSignature) {
          const sigConfig = getDualSignatoryConfig(documentStore.formData, config?.uiMode);
          pdfBytes = await addDualSignatureFields(new Uint8Array(pdfBytes), sigConfig);
        } else {
          const sigConfig = getSignatoryConfig(documentStore.formData);
          pdfBytes = await addSignatureField(new Uint8Array(pdfBytes), sigConfig);
        }
      }

      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      return await downloadPdfBlob(blob, 'correspondence.pdf', preOpenedWindow);
    }
    return false;
  }, [compile, documentStore]);

  const handleDownloadPdfInternal = useCallback(async () => {
    // Prevent multiple simultaneous downloads
    if (downloadInProgressRef.current) {
      console.log('Download already in progress, skipping');
      return;
    }
    downloadInProgressRef.current = true;

    // Pre-open window for iOS BEFORE any async work (must be synchronous from user gesture)
    const preOpenedWindow = preOpenWindowForIOS();

    setIsCompiling(true);
    setCompileError(null);
    try {
      const success = await executeDownload(preOpenedWindow);
      if (!success) {
        if (preOpenedWindow) preOpenedWindow.close();
        setCompileError('PDF generation failed - no output produced');
      }
    } catch (err) {
      console.error('Download error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Download failed';

      // If engine reset was needed, wait for it and retry once
      if (errorMessage === 'ENGINE_RESET_NEEDED') {
        console.log('Engine reset needed, waiting for engine to be ready...');
        // Keep downloadInProgressRef true to block user clicks during retry
        try {
          const ready = await waitForReady(10000); // 10 second timeout
          if (ready) {
            console.log('Engine ready, retrying download...');
            const success = await executeDownload(preOpenedWindow);
            if (!success) {
              if (preOpenedWindow) preOpenedWindow.close();
              setCompileError('PDF generation failed after retry - no output produced');
            }
          } else {
            if (preOpenedWindow) preOpenedWindow.close();
            setCompileError('Engine failed to recover. Please try again.');
          }
        } catch (retryErr) {
          console.error('Retry failed:', retryErr);
          if (preOpenedWindow) preOpenedWindow.close();
          setCompileError('PDF download failed after retry. Please try again.');
        }
        return;
      }

      if (preOpenedWindow) preOpenedWindow.close();
      setCompileError(`PDF download failed: ${errorMessage}`);
    } finally {
      setIsCompiling(false);
      downloadInProgressRef.current = false;
    }
  }, [executeDownload, waitForReady]);

  // Core PII download function - can be called for retry
  const executePIIDownload = useCallback(async (preOpenedWindow?: Window | null): Promise<boolean> => {
    if (!pendingDownloadRef.current) return false;

    const { texFiles, enclosures, includeHyperlinks, signatureImage, referenceUrls } = pendingDownloadRef.current;

    const files: Record<string, string | Uint8Array> = { ...texFiles };
    if (signatureImage) {
      files['attachments/signature.png'] = signatureImage;
    }

    let pdfBytes = await compile(files);

    if (pdfBytes) {
      if (enclosures.length > 0 || (includeHyperlinks && referenceUrls.length > 0)) {
        const classification = getClassificationInfo(documentStore.formData.classLevel);
        const mergeResult = await mergeEnclosures(pdfBytes, enclosures, classification, includeHyperlinks, referenceUrls);
        pdfBytes = mergeResult.pdfBytes;

        // Track enclosure errors for user notification (PII download context)
        if (mergeResult.hasErrors) {
          setEnclosureErrors(mergeResult.errors);
          setShowEnclosureErrors(true);
        }
      }

      // Add digital signature field if requested
      if (documentStore.formData.signatureType === 'digital') {
        const config = DOC_TYPE_CONFIG[documentStore.docType];
        const isDualSignature = config?.uiMode === 'moa' || config?.compliance?.dualSignature;
        if (isDualSignature) {
          const sigConfig = getDualSignatoryConfig(documentStore.formData, config?.uiMode);
          pdfBytes = await addDualSignatureFields(new Uint8Array(pdfBytes), sigConfig);
        } else {
          const sigConfig = getSignatoryConfig(documentStore.formData);
          pdfBytes = await addSignatureField(new Uint8Array(pdfBytes), sigConfig);
        }
      }

      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      return await downloadPdfBlob(blob, 'correspondence.pdf', preOpenedWindow);
    }
    return false;
  }, [compile, documentStore]);

  // Handle proceeding with download after PII warning is acknowledged
  const handleProceedWithPII = useCallback(async () => {
    if (!pendingDownloadRef.current) return;

    // Prevent clicks while download is in progress
    if (downloadInProgressRef.current) {
      console.log('Download already in progress, ignoring PII proceed');
      return;
    }
    downloadInProgressRef.current = true;

    // Pre-open window for iOS BEFORE any async work (must be synchronous from user gesture)
    const preOpenedWindow = preOpenWindowForIOS();

    setIsCompiling(true);
    setCompileError(null);

    try {
      const success = await executePIIDownload(preOpenedWindow);
      if (!success) {
        if (preOpenedWindow) preOpenedWindow.close();
        setCompileError('PDF generation failed - no output produced');
      }
    } catch (err) {
      console.error('Download error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Download failed';

      // If engine reset was needed, wait for it and retry once
      if (errorMessage === 'ENGINE_RESET_NEEDED') {
        console.log('Engine reset needed for PII download, waiting for engine to be ready...');
        try {
          const ready = await waitForReady(10000);
          if (ready) {
            console.log('Engine ready, retrying PII download...');
            const success = await executePIIDownload(preOpenedWindow);
            if (!success) {
              if (preOpenedWindow) preOpenedWindow.close();
              setCompileError('PDF generation failed after retry - no output produced');
            }
          } else {
            if (preOpenedWindow) preOpenedWindow.close();
            setCompileError('Engine failed to recover. Please try again.');
          }
        } catch (retryErr) {
          console.error('PII download retry failed:', retryErr);
          if (preOpenedWindow) preOpenedWindow.close();
          setCompileError('PDF download failed after retry. Please try again.');
        }
        return;
      }

      if (preOpenedWindow) preOpenedWindow.close();
      setCompileError(`PDF download failed: ${errorMessage}`);
    } finally {
      setIsCompiling(false);
      downloadInProgressRef.current = false;
      pendingDownloadRef.current = null;
      setPiiDetectionResult(null);
    }
  }, [executePIIDownload, waitForReady]);

  // Handle canceling download after PII warning
  const handleCancelPIIDownload = useCallback(() => {
    pendingDownloadRef.current = null;
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
          formStore.navmc10274,
          navmc10274Templates.page1,
          navmc10274Templates.page2,
          navmc10274Templates.page3,
          { includeCoverPage: formStore.includeCoverPage }
        );
        filename = `NAVMC-10274-${formStore.navmc10274.date || 'form'}.pdf`;
      } else if (formType === 'navmc_118_11' && navmc11811Template) {
        pdfBytes = await generateNavmc11811Pdf(
          formStore.navmc11811,
          navmc11811Template
        );
        const lastName = formStore.navmc11811.lastName || 'Marine';
        filename = `NAVMC-118-11-${lastName}-${formStore.navmc11811.entryDate || 'entry'}.pdf`;
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
  }, [formType, formStore.navmc10274, formStore.navmc11811, formStore.includeCoverPage, navmc10274Templates, navmc11811Template]);

  const handleDownloadPdf = useCallback(() => {
    // Handle forms mode separately
    if (documentCategory === 'forms') {
      handleDownloadFormPdf();
      return;
    }

    // Correspondence mode - check engine ready
    if (!isReady) {
      setCompileError('PDF engine not ready. Please wait for initialization.');
      return;
    }

    // Prevent clicks while download is in progress (including during retry)
    if (downloadInProgressRef.current) {
      console.log('Download already in progress, ignoring click');
      return;
    }

    console.log('Manual download click');

    // Check for PII before downloading
    const piiResult = detectPII(documentStore);
    if (piiResult.found) {
      // Store the generated files for later use
      const { texFiles, enclosures, includeHyperlinks, signatureImage, referenceUrls } = generateAllLatexFiles(documentStore);
      pendingDownloadRef.current = { texFiles, enclosures, includeHyperlinks, signatureImage, referenceUrls };
      setPiiDetectionResult(piiResult);
      setPiiWarningOpen(true);
      return;
    }

    // No PII found, proceed with download
    handleDownloadPdfInternal();
  }, [documentCategory, isReady, handleDownloadPdfInternal, handleDownloadFormPdf, documentStore, setPiiWarningOpen]);

  const handleDownloadTex = useCallback(() => {
    const { texFiles } = generateAllLatexFiles(documentStore);

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
  }, [documentStore]);

  const handleDownloadDocx = useCallback(async () => {
    try {
      const docxBytes = await generateDocx(documentStore);
      const arrayBuffer = docxBytes.buffer.slice(
        docxBytes.byteOffset,
        docxBytes.byteOffset + docxBytes.byteLength
      ) as ArrayBuffer;
      const blob = new Blob([arrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'correspondence.docx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('DOCX generation error:', err);
    }
  }, [documentStore]);

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
            printWindow.addEventListener('load', () => {
              printWindow.print();
            });
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
        onRefreshPreview={compilePdf}
        isCompiling={isCompiling}
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
      <MobilePreviewModal
        pdfUrl={documentCategory === 'forms' ? formPdfUrl : pdfUrl}
        isCompiling={documentCategory === 'forms' ? false : (isCompiling || !isReady)}
        error={documentCategory === 'forms' ? null : (compileError || engineError)}
        onDownloadPdf={handleDownloadPdf}
      />
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
      <BrowserCompatibilityNotice />
    </div>
  );
}

export default App;
