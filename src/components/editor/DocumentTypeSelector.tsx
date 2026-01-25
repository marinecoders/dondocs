import { useState, useCallback } from 'react';
import { Shield, Settings2, Eraser, FileText, AlertTriangle, FileStack, ClipboardList, File, LayoutTemplate, FolderOpen } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { DOC_TYPE_LABELS, DOC_TYPE_CONFIG, DOC_TYPE_CATEGORIES, FORM_TYPE_LABELS, FORM_TYPE_CATEGORIES, type DocumentData, type DocumentCategory, type FormType } from '@/types/document';
import { Badge } from '@/components/ui/badge';
import { getExampleByDocType } from '@/data/exampleDocuments';

export function DocumentTypeSelector() {
  const {
    docType, setDocType,
    formType, setFormType,
    documentCategory, setDocumentCategory,
    formData, setField,
    documentMode, setDocumentMode,
    clearFieldsExceptLetterhead, loadTemplate,
    paragraphs, references, enclosures
  } = useDocumentStore();
  const { setTemplateLoaderOpen } = useUIStore();
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showSwitchDialog, setShowSwitchDialog] = useState(false);
  const [pendingDocType, setPendingDocType] = useState<string | null>(null);
  const config = DOC_TYPE_CONFIG[docType];
  const isCompliant = documentMode === 'compliant';
  const isCorrespondence = documentCategory === 'correspondence';

  /**
   * Check if the user has meaningful content that would be lost.
   * Returns false for:
   * - Empty/placeholder content
   * - Auto-loaded example data that matches the current doc type
   * - Profile/letterhead fields (these are preserved on switch anyway)
   */
  const hasUserContent = useCallback(() => {
    // Helper: Check if a string is just a placeholder
    const isPlaceholder = (str: string | undefined | null): boolean => {
      if (!str || !str.trim()) return true;
      const trimmed = str.trim();
      // Common placeholders
      return trimmed.startsWith('[') && trimmed.endsWith(']') ||
             trimmed === '[SUBJECT]' ||
             trimmed === '[RECIPIENT]' ||
             trimmed.includes('[Your content here');
    };

    // Get the auto-loaded example for the current doc type
    const currentExample = getExampleByDocType(docType);

    // Helper: Check if content matches the example exactly
    const matchesExample = (field: string, value: string | undefined | null): boolean => {
      if (!currentExample || !value) return false;
      const exampleValue = currentExample.formData[field];
      return exampleValue === value;
    };

    // Check paragraphs: ignore if empty, placeholder, or matches example exactly
    const hasCustomParagraphs = paragraphs.some((p, index) => {
      if (!p.text || !p.text.trim()) return false;
      if (isPlaceholder(p.text)) return false;
      // Check if it matches example paragraph at same index
      if (currentExample?.paragraphs[index]?.text === p.text) return false;
      return true;
    });

    // Check if ALL paragraphs match example (user loaded example, didn't modify)
    const paragraphsMatchExample = currentExample &&
      paragraphs.length === currentExample.paragraphs.length &&
      paragraphs.every((p, i) => p.text === currentExample.paragraphs[i]?.text);

    // Check references: ignore if empty or matches example
    const hasCustomReferences = references.some((r, index) => {
      if (!r.title || !r.title.trim()) return false;
      if (currentExample?.references[index]?.title === r.title) return false;
      return true;
    });

    const refsMatchExample = currentExample &&
      references.length === currentExample.references.length &&
      references.every((r, i) => r.title === currentExample.references[i]?.title);

    // Check enclosures (examples typically don't have enclosures, so any = user added)
    const hasEnclosures = enclosures.length > 0 && enclosures.some(e => e.title && e.title.trim().length > 0);

    // Check subject: ignore if empty, placeholder, or matches example
    const hasCustomSubject = formData.subject &&
      formData.subject.trim().length > 0 &&
      !isPlaceholder(formData.subject) &&
      !matchesExample('subject', formData.subject);

    // Check body field (used by some memo types)
    const hasCustomBody = formData.body &&
      formData.body.trim().length > 0 &&
      !isPlaceholder(formData.body);

    // If everything matches the example exactly, no user content
    if (paragraphsMatchExample && refsMatchExample && !hasEnclosures &&
        matchesExample('subject', formData.subject)) {
      return false;
    }

    return hasCustomParagraphs || hasCustomReferences || hasEnclosures || hasCustomSubject || hasCustomBody;
  }, [paragraphs, references, enclosures, formData, docType]);

  /**
   * Load example data for a specific document type
   */
  const loadExampleForDocType = useCallback((targetDocType: string) => {
    const example = getExampleByDocType(targetDocType);
    if (!example) {
      // No example available, just switch type
      setDocType(targetDocType);
      return;
    }

    // IMPORTANT: Set doc type FIRST (this resets formData to defaults)
    // Then set the example fields AFTER
    setDocType(targetDocType);

    // Load the example data after type is set
    Object.entries(example.formData).forEach(([key, value]) => {
      setField(key as keyof DocumentData, value);
    });

    loadTemplate({
      references: example.references,
      enclosures: [],
      paragraphs: example.paragraphs,
      copyTos: example.copyTos,
    });
  }, [setDocType, setField, loadTemplate]);

  /**
   * Handle document type change with smart detection
   */
  const handleDocTypeChange = useCallback((newDocType: string) => {
    if (newDocType === docType) return;

    if (hasUserContent()) {
      // User has content - show dialog
      setPendingDocType(newDocType);
      setShowSwitchDialog(true);
    } else {
      // No meaningful content - auto-load example
      loadExampleForDocType(newDocType);
    }
  }, [docType, hasUserContent, loadExampleForDocType]);

  /**
   * Switch type and keep user's current content
   */
  const handleKeepContent = useCallback(() => {
    if (pendingDocType) {
      setDocType(pendingDocType);
    }
    setShowSwitchDialog(false);
    setPendingDocType(null);
  }, [pendingDocType, setDocType]);

  /**
   * Switch type with blank document (just reset to defaults)
   */
  const handleBlankDocument = useCallback(() => {
    if (pendingDocType) {
      setDocType(pendingDocType); // This resets formData to defaults
    }
    setShowSwitchDialog(false);
    setPendingDocType(null);
  }, [pendingDocType, setDocType]);

  /**
   * Open template picker after switching type
   */
  const handleOpenTemplates = useCallback(() => {
    if (pendingDocType) {
      setDocType(pendingDocType);
    }
    setShowSwitchDialog(false);
    setPendingDocType(null);
    // Open the template loader modal
    setTemplateLoaderOpen(true);
  }, [pendingDocType, setDocType, setTemplateLoaderOpen]);

  return (
    <div className="space-y-density-4">
      {/* Category Tabs - Correspondence vs Forms (at the top) */}
      <div className="space-y-2">
        <Label>Category</Label>
        <Tabs value={documentCategory} onValueChange={(v) => setDocumentCategory(v as DocumentCategory)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="correspondence" className="flex items-center gap-2">
              <FileStack className="h-4 w-4" />
              Correspondence
            </TabsTrigger>
            <TabsTrigger value="forms" className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Forms
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Mode Toggle - Only show for Correspondence (Forms have fixed format) */}
      {isCorrespondence && (
        <>
          <div className="flex gap-density-2">
            <Button
              variant={isCompliant ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => setDocumentMode('compliant')}
            >
              <Shield className="h-4 w-4 mr-2" />
              Compliant
            </Button>
            <Button
              variant={!isCompliant ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => setDocumentMode('custom')}
            >
              <Settings2 className="h-4 w-4 mr-2" />
              Custom
            </Button>
          </div>

          {/* Mode description */}
          <div className={`text-density-sm p-density-2 rounded-md border ${isCompliant ? 'bg-primary/5 border-primary/20 text-primary' : 'bg-secondary/30 border-border text-muted-foreground'}`}>
            {isCompliant ? (
              <>Strictly adheres to SECNAV M-5216.5 formatting requirements.</>
            ) : (
              <>Customize fonts and formatting to your preferences.</>
            )}
          </div>
        </>
      )}

      {/* Correspondence Document Type Selector */}
      {isCorrespondence && (
        <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Document Type</Label>
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-primary hover:text-primary/80 hover:bg-primary/10"
                    onClick={() => setTemplateLoaderOpen(true)}
                  >
                    <FolderOpen className="h-3.5 w-3.5 mr-1" />
                    <span className="text-xs">Templates</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Load a saved template</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-orange-600 hover:text-orange-700 hover:bg-orange-100 dark:text-orange-400 dark:hover:text-orange-300 dark:hover:bg-orange-900/30"
                    onClick={() => setShowClearDialog(true)}
                  >
                    <Eraser className="h-3.5 w-3.5 mr-1" />
                    <span className="text-xs">Clear</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Clear all fields except letterhead</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <Select value={docType} onValueChange={handleDocTypeChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select document type" />
          </SelectTrigger>
          <SelectContent>
            {DOC_TYPE_CATEGORIES.map((cat) => (
              <SelectGroup key={cat.category}>
                <SelectLabel>{cat.category}</SelectLabel>
                {cat.types.map((type) => (
                  <SelectItem key={type} value={type}>
                    {DOC_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Regulation hints - always show in compliant mode, show as "recommended" in custom */}
      {config && (
        <div className={`border rounded-md p-3 text-xs ${isCompliant ? 'bg-primary/5 border-primary/20' : 'bg-secondary/30 border-border'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant={isCompliant ? 'default' : 'outline'} className="text-xs">
              SECNAV M-5216.5 {config.regulations.ref}
            </Badge>
          </div>
          <div className={isCompliant ? 'text-primary' : 'text-muted-foreground'}>
            {isCompliant ? 'Applied' : 'Recommended'}: {config.regulations.fontSize} {config.regulations.fontFamily}
          </div>
        </div>
      )}

      {/* Font settings - only show in custom mode and correspondence */}
      {!isCompliant && (
        <div className="grid grid-cols-2 gap-density-4">
          <div className="space-y-2">
            <Label>Font Size</Label>
            <Select
              value={formData.fontSize || '12pt'}
              onValueChange={(v) => setField('fontSize', v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10pt">10pt</SelectItem>
                <SelectItem value="11pt">11pt</SelectItem>
                <SelectItem value="12pt">12pt</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Font Family</Label>
            <Select
              value={formData.fontFamily || 'courier'}
              onValueChange={(v) => setField('fontFamily', v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="courier">Courier</SelectItem>
                <SelectItem value="times">Times New Roman</SelectItem>
                <SelectItem value="arial">Arial</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      </>
      )}

      {/* Forms Selector */}
      {!isCorrespondence && (
        <>
        <div className="space-y-2">
          <Label>Form Type</Label>
          <Select value={formType} onValueChange={(v) => setFormType(v as FormType)}>
            <SelectTrigger>
              <SelectValue placeholder="Select form type" />
            </SelectTrigger>
            <SelectContent>
              {FORM_TYPE_CATEGORIES.map((cat) => (
                <SelectGroup key={cat.category}>
                  <SelectLabel>{cat.category}</SelectLabel>
                  {cat.types.map((type) => (
                    <SelectItem key={type} value={type}>
                      {FORM_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="border rounded-md p-3 text-xs bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800">
          <div className="text-blue-700 dark:text-blue-400">
            Select a form type above to edit. The form editor will appear below.
          </div>
        </div>
        </>
      )}

      {/* Clear fields confirmation dialog */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Fields?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all document content including addressing, signature, paragraphs,
              references, enclosures, and copy-tos. Your letterhead information (unit name,
              address, seal) will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                clearFieldsExceptLetterhead();
                setShowClearDialog(false);
              }}
              className="bg-orange-600 text-white hover:bg-orange-700"
            >
              Clear Fields
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Switch document type dialog - shown when user has content */}
      <AlertDialog open={showSwitchDialog} onOpenChange={(open) => {
        if (!open) {
          setShowSwitchDialog(false);
          setPendingDocType(null);
        }
      }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Switch to {pendingDocType ? DOC_TYPE_LABELS[pendingDocType] : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You have content in your current document. What would you like to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <AlertDialogCancel className="sm:mr-auto">Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={handleBlankDocument}
            >
              <File className="h-4 w-4 mr-2" />
              Blank
            </Button>
            <Button
              variant="outline"
              onClick={handleOpenTemplates}
            >
              <LayoutTemplate className="h-4 w-4 mr-2" />
              Template
            </Button>
            <AlertDialogAction onClick={handleKeepContent}>
              <FileText className="h-4 w-4 mr-2" />
              Keep Content
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
