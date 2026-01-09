import { useState, useCallback, useRef, type ChangeEvent } from 'react';
import { Moon, Sun, Download, FileText, RefreshCw, Github, Bug, Save, RotateCcw, Shield, HelpCircle, Info, Layers, FolderOpen, Search, Keyboard, Menu, FileDown, FileUp, ScrollText, SlidersHorizontal, Minimize2, Maximize2, Check, Palette, Anchor, Medal, Wrench, Settings } from 'lucide-react';
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
import { uint8ArrayToBase64, base64ToUint8Array, arrayBufferToUint8Array } from '@/lib/encoding';
import { useLogStore } from '@/stores/logStore';

interface HeaderProps {
  onDownloadPdf?: () => void;
  onDownloadTex?: () => void;
  onDownloadDocx?: () => void;
  onRefreshPreview?: () => void;
  isCompiling?: boolean;
}

const GITHUB_REPO_URL = 'https://github.com/rchiofalo/libo-secured';
const GITHUB_ISSUES_URL = 'https://github.com/rchiofalo/libo-secured/issues';
const STORAGE_KEY = 'libo-secured-document';

export function Header({
  onDownloadPdf,
  onDownloadTex,
  onDownloadDocx,
  onRefreshPreview,
  isCompiling,
}: HeaderProps) {
  const { theme, toggleTheme, colorScheme, setColorScheme, density, setDensity, autoSaveStatus, setAboutModalOpen, setNistModalOpen, setBatchModalOpen, setTemplateLoaderOpen, setFindReplaceOpen } = useUIStore();
  const documentStore = useDocumentStore();
  const { resetForm } = useDocumentStore();
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Export entire document state to a JSON file
  const handleExportDraft = useCallback(() => {
    try {
      const dataToExport = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        documentMode: documentStore.documentMode,
        docType: documentStore.docType,
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
      a.download = `libo-draft-${date}.json`;
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

        // Validate it's a libo draft file
        if (!data.version || !data.docType) {
          throw new Error('Invalid draft file format');
        }

        // Apply document mode
        if (data.documentMode) {
          documentStore.setDocumentMode?.(data.documentMode);
        }

        // Apply document type
        if (data.docType) {
          documentStore.setDocType(data.docType);
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
          paragraphs: data.paragraphs?.map((para: { text: string; level?: number; portionMarking?: string }) => ({
            text: para.text,
            level: para.level || 0,
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
    <header className="border-b border-border bg-card px-density-2 sm:px-density-4 py-density-2 sm:py-density-3">
      {/* Hidden file input for importing drafts */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportDraft}
        accept=".json"
        className="hidden"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <h1 className="text-base sm:text-xl font-bold text-foreground whitespace-nowrap">libo-secured</h1>
          <p className="text-sm text-muted-foreground hidden lg:block">
            "Libo isn't secured until the paperwork is done."
          </p>
          {/* NIST 800-171 Compliance Badge */}
          <button
            onClick={() => setNistModalOpen(true)}
            className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 text-xs cursor-pointer hover:bg-green-500/20 transition-colors"
            title="Click to learn about NIST 800-171 compliance"
          >
            <Shield className="h-3 w-3" />
            <span>NIST 800-171</span>
            <HelpCircle className="h-3 w-3 opacity-60" />
          </button>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {(autoSaveStatus || saveStatus) && (
            <span className="text-xs text-muted-foreground animate-pulse hidden sm:inline">
              {saveStatus || autoSaveStatus}
            </span>
          )}

          {/* Always visible: Refresh */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefreshPreview}
            disabled={isCompiling}
            title="Refresh Preview"
            className="h-8 w-8 sm:h-9 sm:w-9"
          >
            <RefreshCw className={`h-4 w-4 ${isCompiling ? 'animate-spin' : ''}`} />
          </Button>

          {/* Save/Load dropdown - always visible but compact on mobile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3">
                <Save className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Save</span>
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
              <DropdownMenuItem onClick={handleExportDraft}>
                <FileDown className="h-4 w-4 mr-2" />
                Export Draft to File
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <FileUp className="h-4 w-4 mr-2" />
                Import Draft from File
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowResetDialog(true)} className="text-destructive">
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset All Fields
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Download dropdown - always visible but compact on mobile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3">
                <Download className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Download</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onDownloadPdf}>
                <FileText className="h-4 w-4 mr-2" />
                Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDownloadDocx}>
                <FileText className="h-4 w-4 mr-2" />
                Download DOCX
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDownloadTex}>
                <FileText className="h-4 w-4 mr-2" />
                Download LaTeX
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Tools dropdown - desktop only */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3 hidden md:flex">
                <Wrench className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Tools</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTemplateLoaderOpen(true)}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Templates
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setBatchModalOpen(true)}>
                <Layers className="h-4 w-4 mr-2" />
                Batch Generation
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFindReplaceOpen(true)}>
                <Search className="h-4 w-4 mr-2" />
                Find & Replace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Help dropdown - desktop only */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="Help & Info" className="h-8 w-8 hidden md:flex">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onClick={() => setNistModalOpen(true)}>
                <Shield className="h-4 w-4 mr-2" />
                NIST 800-171 Compliance
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAboutModalOpen(true)}>
                <Info className="h-4 w-4 mr-2" />
                About libo-secured
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.open(GITHUB_REPO_URL, '_blank')}>
                <Github className="h-4 w-4 mr-2" />
                View on GitHub
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(GITHUB_ISSUES_URL, '_blank')}>
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

          {/* Appearance dropdown - combines theme, color scheme, density */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="Appearance" className="h-8 w-8 sm:h-9 sm:w-9">
                <Settings className="h-4 w-4" />
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
              {/* Color schemes */}
              <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Color Scheme</div>
              <DropdownMenuItem onClick={() => setColorScheme('default')} className="flex items-center justify-between">
                <div className="flex items-center">
                  <Palette className="h-4 w-4 mr-2" />
                  Default
                </div>
                {colorScheme === 'default' && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setColorScheme('navy')} className="flex items-center justify-between">
                <div className="flex items-center">
                  <Anchor className="h-4 w-4 mr-2" />
                  Navy
                </div>
                {colorScheme === 'navy' && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setColorScheme('usmc')} className="flex items-center justify-between">
                <div className="flex items-center">
                  <Medal className="h-4 w-4 mr-2" />
                  USMC
                </div>
                {colorScheme === 'usmc' && <Check className="h-4 w-4" />}
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
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mobile menu - only visible on mobile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden">
                <Menu className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {/* Tools section */}
              <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Tools</div>
              <DropdownMenuItem onClick={() => setTemplateLoaderOpen(true)}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Templates
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
              <DropdownMenuItem onClick={() => window.open(GITHUB_REPO_URL, '_blank')}>
                <Github className="h-4 w-4 mr-2" />
                GitHub
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(GITHUB_ISSUES_URL, '_blank')}>
                <Bug className="h-4 w-4 mr-2" />
                Report Bug
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded inline-block hidden sm:inline-block">
        All data stays in your browser session. Nothing is sent to any server.
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
    </header>
  );
}
