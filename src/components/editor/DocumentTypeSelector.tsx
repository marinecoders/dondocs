import { Shield, Settings2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentStore } from '@/stores/documentStore';
import { DOC_TYPE_CONFIG, type DocumentMode } from '@/types/document';
import { Badge } from '@/components/ui/badge';

export function DocumentTypeSelector() {
  const {
    documentCategory,
    docType,
    formData, setField,
    documentMode, setDocumentMode,
  } = useDocumentStore();
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;
  const isCompliant = documentMode === 'compliant';
  const isCorrespondence = documentCategory === 'correspondence';
  const isPublication = isCorrespondence && docType === 'i_type';

  return (
    <div className="space-y-density-4">
      {/* Document formatting, opened from Tools. */}
      {isCorrespondence && (
      <div className="space-y-density-4">
        {/* Format mode uses a segmented control with an inline explanation. */}
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
              ? isPublication
                ? 'Formats I-Type publications for compliance with MIL-DTL-28999D(MC) and MIL-STD-38784C.'
                : 'Strictly adheres to SECNAV M-5216.5 formatting requirements.'
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
                <SelectTrigger aria-label="Font size" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.regulations.fontSizeOptions.map((size) => (
                    <SelectItem key={size} value={size}>{size}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {config.regulations.authority ?? 'SECNAV M-5216.5'} {config.regulations.ref} permits{' '}
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
                  {config.regulations.authority ?? 'SECNAV M-5216.5'} {config.regulations.ref}
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
                  <SelectTrigger aria-label="Font size" className="w-full">
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
                  <SelectTrigger aria-label="Font family" className="w-full">
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

      </div>
      )}

    </div>
  );
}
