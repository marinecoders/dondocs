import { useState, useCallback } from 'react';
import { Shield, Settings2, Eraser, FileText, AlertTriangle, FileStack, ClipboardList } from 'lucide-react';
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
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showSwitchDialog, setShowSwitchDialog] = useState(false);
  const [pendingDocType, setPendingDocType] = useState<string | null>(null);
  const config = DOC_TYPE_CONFIG[docType];
  const isCompliant = documentMode === 'compliant';
  const isCorrespondence = documentCategory === 'correspondence';

  /**
   * Check if the user has meaningful content that would be lost
   */
  const hasUserContent = useCallback(() => {
    // Check if paragraphs have custom content (not empty)
    const hasCustomParagraphs = paragraphs.some(p => p.text && p.text.trim().length > 0);

    // Check if there are references beyond the first empty one
    const hasCustomReferences = references.length > 0 && references.some(r => r.title && r.title.trim().length > 0);

    // Check if there are enclosures
    const hasEnclosures = enclosures.length > 0;

    // Check if key form fields have been customized from defaults
    const hasCustomSubject = formData.subject && formData.subject.trim().length > 0 &&
      formData.subject !== 'AFTER ACTION REPORT FOR EXERCISE STEEL KNIGHT 25-1';
    const hasCustomBody = formData.body && formData.body.trim().length > 0;

    return hasCustomParagraphs || hasCustomReferences || hasEnclosures || hasCustomSubject || hasCustomBody;
  }, [paragraphs, references, enclosures, formData]);

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

    // Load the example data
    Object.entries(example.formData).forEach(([key, value]) => {
      setField(key as keyof DocumentData, value);
    });

    loadTemplate({
      references: example.references,
      enclosures: [],
      paragraphs: example.paragraphs,
      copyTos: example.copyTos,
    });

    setDocType(targetDocType);
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
   * Switch type and load example (replace content)
   */
  const handleLoadExample = useCallback(() => {
    if (pendingDocType) {
      loadExampleForDocType(pendingDocType);
    }
    setShowSwitchDialog(false);
    setPendingDocType(null);
  }, [pendingDocType, loadExampleForDocType]);

  return (
    <div className="space-y-density-4">
      {/* Mode Toggle */}
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

      {/* Category Tabs - Correspondence vs Forms */}
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

      {/* Correspondence Document Type Selector */}
      {isCorrespondence && (
        <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Document Type</Label>
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Switch to {pendingDocType ? DOC_TYPE_LABELS[pendingDocType] : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>You have content in your current document. What would you like to do?</p>

                {pendingDocType && getExampleByDocType(pendingDocType) && (
                  <div className="bg-muted/50 rounded-md p-3 text-sm">
                    <strong>Example available:</strong> {getExampleByDocType(pendingDocType)?.description}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel className="sm:mr-auto">Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={handleKeepContent}
            >
              Keep My Work
            </Button>
            {pendingDocType && getExampleByDocType(pendingDocType) && (
              <AlertDialogAction onClick={handleLoadExample}>
                <FileText className="h-4 w-4 mr-2" />
                Load Example
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
