import { useState } from 'react';
import { Shield, Settings2, Eraser, FileStack, ClipboardList, FolderOpen } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { HelpTip } from '@/components/ui/help-tip';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { DOC_TYPE_CONFIG, DOC_TYPE_LABELS, DOC_TYPE_CATEGORIES, FORM_TYPE_LABELS, FORM_TYPE_CATEGORIES, type DocumentCategory, type DocumentMode, type FormType } from '@/types/document';
import { Badge } from '@/components/ui/badge';

export function DocumentTypeSelector() {
  const {
    formType, setFormType,
    documentCategory, setDocumentCategory,
    docType, setDocType,
    formData, setField,
    documentMode, setDocumentMode,
    clearFieldsExceptLetterhead,
  } = useDocumentStore();
  const setTemplateLoaderOpen = useUIStore((s) => s.setTemplateLoaderOpen);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;
  const isCompliant = documentMode === 'compliant';
  const isCorrespondence = documentCategory === 'correspondence';

  return (
    <div className="space-y-density-4">
      {/* Section heading — Document Type leads the editor as its own rail
          section (prototype parity), with a help tip matching the other
          sections' heading + HelpCircle pattern. */}
      <h3 className="flex items-center gap-2 text-base font-semibold">
        Document Type
        <HelpTip>
          <p className="font-medium mb-1">Document Type</p>
          <p className="text-xs">
            DonDocs builds Marine correspondence (letters, memos) and NAVMC
            forms. The editor reconfigures its sections per category and type,
            per SECNAV M-5216.5 / MCO 5216.19A.
          </p>
        </HelpTip>
      </h3>

      {/* Category Tabs - Correspondence vs Forms (at the top) */}
      <div data-tour="category" className="space-y-2">
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

      {/* Correspondence Settings — prototype order: Type → Format mode → regs → fonts → actions */}
      {isCorrespondence && (
      <div className="space-y-density-4">
        {/* Document Type Selector */}
        {/* No field label here: the section heading above already reads
            "Document Type"; the redundant inner label is dropped and the
            select keeps its accessible name via aria-label. */}
        <div data-tour="doctype" className="space-y-2">
          <Select value={docType} onValueChange={(v) => setDocType(v)}>
            <SelectTrigger aria-label="Document Type" className="w-full">
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

        {/* Format mode - segmented control (a quiet neutral toggle like the
            Category control above it, not two filled buttons — keeps the one
            scarlet primary rule), with an inline mode hint. */}
        <div className="space-y-2">
          <Label>Format mode</Label>
          <Tabs value={documentMode} onValueChange={(v) => setDocumentMode(v as DocumentMode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="compliant" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Compliant
              </TabsTrigger>
              <TabsTrigger value="custom" className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Custom
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="text-xs text-muted-foreground">
            {isCompliant
              ? 'Strictly adheres to SECNAV M-5216.5 formatting requirements.'
              : 'Customize fonts and formatting to your preferences.'}
          </p>
        </div>

        {/* Compliant mode locks the font FAMILY to the SECNAV recommendation, but
            the regulation permits a range of sizes (e.g. 10–12pt). Surface just
            the size picker so a fully-compliant letter can still be set to 10pt or
            11pt — hidden entirely would strand those regulation-legal sizes. */}
        {isCompliant &&
          config.regulations.fontSizeOptions &&
          config.regulations.fontSizeOptions.length > 1 && (
            <div className="space-y-2">
              <Label>Font Size</Label>
              <Select
                value={formData.fontSize || config.regulations.fontSize}
                onValueChange={(v) => setField('fontSize', v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.regulations.fontSizeOptions.map((size) => (
                    <SelectItem key={size} value={size}>{size}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                SECNAV M-5216.5 {config.regulations.ref} permits{' '}
                {config.regulations.fontSizeOptions.join(' / ')}.
              </p>
            </div>
          )}

        {/* Formatting controls + the regulation reference live ONLY in Custom
            mode, matching the prototype: Compliant locks formatting to the
            SECNAV defaults, so its panel stays clean (Category → Type → Format
            mode → actions). Choosing Custom reveals the font controls. */}
        {!isCompliant && (
          <>
            <div className="border-l-2 border-border pl-3 text-xs">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-xs">
                  SECNAV M-5216.5 {config.regulations.ref}
                </Badge>
              </div>
              <div className="text-muted-foreground space-y-0.5">
                <div>
                  <span className="font-medium">Required:</span>{' '}
                  {config.regulations.fontSizeOptions
                    ? `${config.regulations.fontSizeOptions[0]}–${config.regulations.fontSizeOptions[config.regulations.fontSizeOptions.length - 1]} font size`
                    : `${config.regulations.fontSize} font size`}
                </div>
                <div>
                  <span className="font-medium">Recommended:</span> Times New Roman
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-density-4">
              <div className="space-y-2">
                <Label>Font Size</Label>
                <Select
                  value={formData.fontSize || '12pt'}
                  onValueChange={(v) => setField('fontSize', v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['10pt', '11pt', '12pt'].map((size) => (
                      <SelectItem key={size} value={size}>{size}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Font Family</Label>
                <Select
                  value={formData.fontFamily || 'times'}
                  onValueChange={(v) => setField('fontFamily', v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="times">Times New Roman</SelectItem>
                    <SelectItem value="courier">Courier New</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        )}

        {/* Actions — load a template or clear content (letterhead is preserved,
            so Clear stays an amber "caution", not a red "danger"). */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            data-tour="templates"
            variant="outline"
            size="sm"
            onClick={() => setTemplateLoaderOpen(true)}
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            Templates
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-orange-600 hover:bg-orange-500/10 hover:text-orange-600 dark:text-orange-400 dark:hover:bg-orange-500/15 dark:hover:text-orange-400"
            onClick={() => setShowClearDialog(true)}
          >
            <Eraser className="h-4 w-4 mr-2" />
            Clear all fields
          </Button>
        </div>
      </div>
      )}

      {/* Forms Selector */}
      {!isCorrespondence && (
        <>
        <div className="space-y-2">
          <Label>Form Type</Label>
          <Select value={formType} onValueChange={(v) => setFormType(v as FormType)}>
            <SelectTrigger className="w-full">
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

        <div className="border-l-2 border-border pl-3 text-xs">
          <div className="text-muted-foreground">
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
              className="bg-warning text-warning-foreground hover:bg-warning/90"
            >
              Clear fields
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
