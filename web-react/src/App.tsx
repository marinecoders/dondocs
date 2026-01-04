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
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useProfileStore } from '@/stores/profileStore';
import { useLatexEngine } from '@/hooks/useLatexEngine';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { generateDocx } from '@/services/docx/generator';
import { mergeEnclosures } from '@/services/pdf/mergeEnclosures';
import type { ClassificationInfo } from '@/services/pdf/mergeEnclosures';

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
  const { theme, setIsMobile } = useUIStore();
  const documentStore = useDocumentStore();
  const { setFormData } = useDocumentStore();
  const { selectedProfile, profiles } = useProfileStore();
  const { isReady, compile, error: engineError } = useLatexEngine();

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const compileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isResettingRef = useRef(false);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
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
      const { texFiles, enclosures, includeHyperlinks, signatureImage } = generateAllLatexFiles(documentStore);

      // Build files object including signature image if present
      const files: Record<string, string | Uint8Array> = { ...texFiles };
      if (signatureImage) {
        files['attachments/signature.png'] = signatureImage;
      }

      let pdfBytes = await compile(files);

      if (pdfBytes) {
        // Merge enclosures if any (handles both PDF and text-only)
        if (enclosures.length > 0) {
          const classification = getClassificationInfo(documentStore.formData.classLevel);
          pdfBytes = await mergeEnclosures(pdfBytes, enclosures, classification, includeHyperlinks);
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

      // If engine reset is needed, mark that we're resetting so next compile doesn't flash
      if (errorMessage === 'ENGINE_RESET_NEEDED') {
        isResettingRef.current = true;
      } else {
        setCompileError(errorMessage);
      }
    } finally {
      setIsCompiling(false);
    }
  }, [isReady, compile, documentStore, pdfUrl]);

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

  const handleDownloadPdf = useCallback(async () => {
    if (!isReady) return;

    setIsCompiling(true);
    try {
      const { texFiles, enclosures, includeHyperlinks, signatureImage } = generateAllLatexFiles(documentStore);

      // Build files object including signature image if present
      const files: Record<string, string | Uint8Array> = { ...texFiles };
      if (signatureImage) {
        files['attachments/signature.png'] = signatureImage;
      }

      let pdfBytes = await compile(files);

      if (pdfBytes) {
        // Merge enclosures if any (handles both PDF and text-only)
        if (enclosures.length > 0) {
          const classification = getClassificationInfo(documentStore.formData.classLevel);
          pdfBytes = await mergeEnclosures(pdfBytes, enclosures, classification, includeHyperlinks);
        }

        const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'correspondence.pdf';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsCompiling(false);
    }
  }, [isReady, compile, documentStore]);

  const handleDownloadTex = useCallback(() => {
    const { texFiles } = generateAllLatexFiles(documentStore);
    const mainTex = texFiles['main.tex'] || '';
    const blob = new Blob([mainTex], { type: 'text/plain' });
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
      />
      <AboutModal />
      <NISTComplianceModal />
      <BatchModal />
    </div>
  );
}

export default App;
