import { useState, useCallback, useMemo } from 'react';
import { Plus, Trash2, Download, AlertCircle, FileText, Variable } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { generateAllLatexFiles } from '@/services/latex/generator';

interface PlaceholderValue {
  [key: string]: string;
}

interface BatchRow {
  id: string;
  values: PlaceholderValue;
}

// Detect placeholders in text (format: {{PLACEHOLDER_NAME}})
function detectPlaceholders(text: string): string[] {
  const regex = /\{\{([A-Z0-9_]+)\}\}/g;
  const placeholders = new Set<string>();
  let match;
  while ((match = regex.exec(text)) !== null) {
    placeholders.add(match[1]);
  }
  return Array.from(placeholders);
}

// Replace placeholders in text
function replacePlaceholders(text: string, values: PlaceholderValue): string {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    return values[key] !== undefined ? values[key] : match;
  });
}

export function BatchModal() {
  const { batchModalOpen, setBatchModalOpen } = useUIStore();
  const documentStore = useDocumentStore();

  const [rows, setRows] = useState<BatchRow[]>([
    { id: '1', values: {} },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Detect all placeholders from current document
  const detectedPlaceholders = useMemo(() => {
    const allText: string[] = [];

    // Check all text fields for placeholders
    const { formData, paragraphs, references, enclosures, copyTos } = documentStore;

    // Form fields
    if (formData.to) allText.push(formData.to);
    if (formData.from) allText.push(formData.from);
    if (formData.via) allText.push(formData.via);
    if (formData.subject) allText.push(formData.subject);
    if (formData.serial) allText.push(formData.serial);

    // Paragraphs
    paragraphs.forEach((p) => allText.push(p.text));

    // References
    references.forEach((r) => allText.push(r.title));

    // Enclosures
    enclosures.forEach((e) => allText.push(e.title));

    // Copy-tos
    copyTos.forEach((c) => allText.push(c.text));

    const allPlaceholders = allText.flatMap((text) => detectPlaceholders(text));
    return [...new Set(allPlaceholders)];
  }, [documentStore]);

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      { id: Date.now().toString(), values: {} },
    ]);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const updateRowValue = useCallback((rowId: string, placeholder: string, value: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? { ...row, values: { ...row.values, [placeholder]: value } }
          : row
      )
    );
  }, []);

  const handleGenerateBatch = useCallback(async () => {
    if (rows.length === 0) return;

    setIsGenerating(true);

    try {
      // For each row, generate a separate document
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Create a modified version of the document store with placeholder replacements
        const modifiedStore = {
          docType: documentStore.docType,
          formData: {
            ...documentStore.formData,
            to: replacePlaceholders(documentStore.formData.to || '', row.values),
            from: replacePlaceholders(documentStore.formData.from || '', row.values),
            via: replacePlaceholders(documentStore.formData.via || '', row.values),
            subject: replacePlaceholders(documentStore.formData.subject || '', row.values),
            serial: replacePlaceholders(documentStore.formData.serial || '', row.values),
          },
          references: documentStore.references.map((ref) => ({
            ...ref,
            title: replacePlaceholders(ref.title, row.values),
          })),
          enclosures: documentStore.enclosures.map((encl) => ({
            ...encl,
            title: replacePlaceholders(encl.title, row.values),
          })),
          paragraphs: documentStore.paragraphs.map((para) => ({
            ...para,
            text: replacePlaceholders(para.text, row.values),
          })),
          copyTos: documentStore.copyTos.map((ct) => ({
            ...ct,
            text: replacePlaceholders(ct.text, row.values),
          })),
        };

        // Generate LaTeX
        const { texFiles } = generateAllLatexFiles(modifiedStore);
        const mainTex = texFiles['main.tex'] || '';

        // Download the LaTeX file
        const blob = new Blob([mainTex], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Generate filename from row values or index
        const filenameHint = row.values[detectedPlaceholders[0]] || `document_${i + 1}`;
        const sanitizedFilename = filenameHint.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
        a.download = `${sanitizedFilename}.tex`;
        a.click();
        URL.revokeObjectURL(url);

        // Small delay between downloads
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (err) {
      console.error('Batch generation error:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [rows, documentStore, detectedPlaceholders]);

  const handlePasteData = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const lines = pastedText.split('\n').filter((line) => line.trim());

    if (lines.length === 0) return;

    // Assume first line might be headers, or just data
    // If we have placeholders, try to match columns
    const newRows: BatchRow[] = lines.map((line, idx) => {
      const columns = line.split('\t');
      const values: PlaceholderValue = {};

      detectedPlaceholders.forEach((placeholder, colIdx) => {
        if (columns[colIdx] !== undefined) {
          values[placeholder] = columns[colIdx].trim();
        }
      });

      return { id: Date.now().toString() + idx, values };
    });

    if (newRows.length > 0) {
      setRows(newRows);
    }
  }, [detectedPlaceholders]);

  const hasNoPlaceholders = detectedPlaceholders.length === 0;

  return (
    <Dialog open={batchModalOpen} onOpenChange={setBatchModalOpen}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="bg-background px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Batch Generation
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6 space-y-4">
            {hasNoPlaceholders ? (
              <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
                <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div className="text-sm">
                  No placeholders detected in your document. Add placeholders using the format{' '}
                  <code className="bg-muted px-1 rounded">{'{{PLACEHOLDER_NAME}}'}</code> in any
                  text field (subject, body, references, etc.) to enable batch generation.
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Variable className="h-4 w-4 text-primary" />
                    <Label>Detected Placeholders</Label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detectedPlaceholders.map((placeholder) => (
                      <Badge key={placeholder} variant="secondary">
                        {`{{${placeholder}}}`}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Paste Data (Tab-separated)</Label>
                  <Textarea
                    placeholder={`Paste tab-separated data here. Each row becomes a document.\nColumns should match: ${detectedPlaceholders.join(', ')}`}
                    rows={3}
                    onPaste={handlePasteData}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Tip: Copy data from Excel or a spreadsheet and paste here.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Documents to Generate ({rows.length})</Label>
                    <Button variant="outline" size="sm" onClick={addRow}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add Row
                    </Button>
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="p-2 text-left font-medium w-10">#</th>
                            {detectedPlaceholders.map((placeholder) => (
                              <th key={placeholder} className="p-2 text-left font-medium min-w-[150px]">
                                {placeholder}
                              </th>
                            ))}
                            <th className="p-2 text-left font-medium w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, idx) => (
                            <tr key={row.id} className="border-t">
                              <td className="p-2 text-muted-foreground">{idx + 1}</td>
                              {detectedPlaceholders.map((placeholder) => (
                                <td key={placeholder} className="p-2">
                                  <Input
                                    value={row.values[placeholder] || ''}
                                    onChange={(e) =>
                                      updateRowValue(row.id, placeholder, e.target.value)
                                    }
                                    placeholder={placeholder}
                                    className="h-8"
                                  />
                                </td>
                              ))}
                              <td className="p-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive"
                                  onClick={() => removeRow(row.id)}
                                  disabled={rows.length === 1}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="bg-background px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={() => setBatchModalOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerateBatch}
            disabled={hasNoPlaceholders || isGenerating || rows.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            {isGenerating ? 'Generating...' : `Generate ${rows.length} Documents`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
