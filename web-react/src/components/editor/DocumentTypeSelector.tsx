import { Shield, Settings2 } from 'lucide-react';
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
import { useDocumentStore } from '@/stores/documentStore';
import { DOC_TYPE_LABELS, DOC_TYPE_CONFIG, DOC_TYPE_CATEGORIES } from '@/types/document';
import { Badge } from '@/components/ui/badge';

export function DocumentTypeSelector() {
  const { docType, setDocType, formData, setField, documentMode, setDocumentMode } = useDocumentStore();
  const config = DOC_TYPE_CONFIG[docType];
  const isCompliant = documentMode === 'compliant';

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex gap-2">
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
      <div className={`text-xs p-2 rounded-md border ${isCompliant ? 'bg-primary/5 border-primary/20 text-primary' : 'bg-secondary/30 border-border text-muted-foreground'}`}>
        {isCompliant ? (
          <>Strictly adheres to SECNAV M-5216.5 formatting requirements.</>
        ) : (
          <>Customize fonts and formatting to your preferences.</>
        )}
      </div>

      <div className="space-y-2">
        <Label>Document Type</Label>
        <Select value={docType} onValueChange={setDocType}>
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

      {/* Font settings - only show in custom mode */}
      {!isCompliant && (
        <div className="grid grid-cols-2 gap-4">
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
    </div>
  );
}
