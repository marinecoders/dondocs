import { useEffect, useCallback, useState, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { FormPanel } from '@/components/layout/FormPanel';
import { PreviewPanel } from '@/components/layout/PreviewPanel';
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
import { UpdatePromptModal } from '@/components/modals/UpdatePromptModal';
import { BrowserCompatibilityNotice } from '@/components/BrowserCompatibilityNotice';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useProfileStore } from '@/stores/profileStore';
import { useLogStore } from '@/stores/logStore';
import { useLatexEngine, useServiceWorker } from '@/hooks';
import { generateAllLatexFiles, type GeneratedFiles } from '@/services/latex/generator';
import { generateDocx } from '@/services/docx/generator';
import { mergeEnclosures } from '@/services/pdf/mergeEnclosures';
import type { ClassificationInfo, EnclosureError } from '@/services/pdf/mergeEnclosures';
import { addSignatureField, addDualSignatureFields } from '@/services/pdf/addSignatureField';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { detectPII, type PIIDetectionResult } from '@/services/pii/detector';
import { downloadPdfBlob, preOpenWindowForIOS } from '@/utils/downloadPdf';

// Helper to get classification marking for enclosures
function getClassificationInfo(classLevel: string | undefined): ClassificationInfo | undefined {
  if (!classLevel || classLevel === 'unclassified') {
    return undefined;
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

function App() {
  const {
    theme,
    colorScheme,
    density,
    setIsMobile,
    setFindReplaceOpen,
    setPiiWarningOpen,
    setTemplateLoaderOpen,
    setReferenceLibraryOpen,
    togglePreview,
    closeAllModals,
  } = useUIStore();
  const documentStore = useDocumentStore();
  const { setFormData, applySnapshot } = useDocumentStore();
  const { undo, redo } = useHistoryStore();
  const { selectedProfile, profiles } = useProfileStore();
  const { addLogDirect } = useLogStore();
  const { isReady, compile, waitForReady, error: engineError } = useLatexEngine();
  const { showUpdatePrompt, confirmUpdate, dismissUpdatePrompt } = useServiceWorker();

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const compileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isResettingRef = useRef(false);

  // PII detection state
  const [piiDetectionResult, setPiiDetectionResult] = useState<PIIDetectionResult | null>(null);
  const pendingDownloadRef = useRef<GeneratedFiles | null>(null);

  // Enclosure error state
  const [enclosureErrors, setEnclosureErrors] = useState<EnclosureError[]>([]);
  const [showEnclosureErrors, setShowEnclosureErrors] = useState(false);

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
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [setIsMobile]);

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
          const classification = getClassificationInfo(documentStore.formData.classLevel);
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
            pdfBytes = await addDualSignatureFields(new Uint8Array(pdfBytes));
          } else {
            pdfBytes = await addSignatureField(new Uint8Array(pdfBytes));
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
          pdfBytes = await addDualSignatureFields(new Uint8Array(pdfBytes));
        } else {
          pdfBytes = await addSignatureField(new Uint8Array(pdfBytes));
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
          pdfBytes = await addDualSignatureFields(new Uint8Array(pdfBytes));
        } else {
          pdfBytes = await addSignatureField(new Uint8Array(pdfBytes));
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

  const handleDownloadPdf = useCallback(() => {
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
  }, [isReady, handleDownloadPdfInternal, documentStore, setPiiWarningOpen]);

  const handleDownloadTex = useCallback(() => {
    const { texFiles } = generateAllLatexFiles(documentStore);

    // Combine all generated tex files into one downloadable file
    // The files are: document.tex, letterhead.tex, signatory.tex, flags.tex,
    // references.tex, reference-urls.tex, encl-config.tex, copyto-config.tex,
    // body.tex, classification.tex
    const combinedTex = `%=============================================================================
% LIBO-SECURED CORRESPONDENCE EXPORT
% Generated: ${new Date().toISOString()}
%
% This file contains all the configuration for your document.
% The main.tex template (not included) uses \\input{} to load these files.
% To compile: Use the libo-secured web app or a LaTeX distribution with
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
      // Convert to ArrayBuffer to avoid TypeScript issues with Uint8Array
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

      // Ctrl/Cmd + Shift + R - Open Reference Library
      if (isMod && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        setReferenceLibraryOpen(true);
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
    <div className="flex flex-col h-screen bg-background">
      <Header
        onDownloadPdf={handleDownloadPdf}
        onDownloadTex={handleDownloadTex}
        onDownloadDocx={handleDownloadDocx}
        onRefreshPreview={compilePdf}
        isCompiling={isCompiling}
      />

      <main className="flex flex-1 overflow-hidden">
        <div className="flex-1 min-w-0">
          <FormPanel />
        </div>

        <PreviewPanel
          pdfUrl={pdfUrl}
          isCompiling={isCompiling || !isReady}
          error={compileError || engineError}
        />
      </main>

      {/* Modals */}
      <ProfileModal />
      <ReferenceLibraryModal />
      <MobilePreviewModal
        pdfUrl={pdfUrl}
        isCompiling={isCompiling || !isReady}
        error={compileError || engineError}
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
