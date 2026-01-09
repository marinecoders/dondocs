import { useState, useCallback, useMemo } from 'react';
import { Plus, Trash2, Download, AlertCircle, FileText, Variable, CheckCircle, XCircle, Copy, Lightbulb, Eye, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { debug } from '@/lib/debug';
import { TIMING, BATCH_PLACEHOLDERS } from '@/lib/constants';

interface PlaceholderValue {
  [key: string]: string;
}

interface BatchRow {
  id: string;
  values: PlaceholderValue;
  status?: 'pending' | 'generating' | 'success' | 'error';
  error?: string;
}

interface BatchResults {
  succeeded: number;
  failed: number;
  total: number;
  errors: Array<{ index: number; error: string }>;
}

interface BatchModalProps {
  compile: (files: Record<string, string | Uint8Array>) => Promise<Uint8Array | null>;
  isEngineReady: boolean;
  waitForReady: (timeoutMs?: number) => Promise<boolean>;
}

// Max retries for ENGINE_RESET_NEEDED
const MAX_RETRIES = 2;

// Detect placeholders in text (format: {{PLACEHOLDER_NAME}} - case insensitive)
function detectPlaceholders(text: string): string[] {
  const regex = /\{\{([A-Za-z0-9_]+)\}\}/g;
  const placeholders = new Set<string>();
  let match;
  while ((match = regex.exec(text)) !== null) {
    // Normalize to uppercase for consistency
    placeholders.add(match[1].toUpperCase());
  }
  return Array.from(placeholders);
}

// Replace placeholders in text (case insensitive)
function replacePlaceholders(text: string, values: PlaceholderValue): string {
  return text.replace(/\{\{([A-Za-z0-9_]+)\}\}/gi, (match, key) => {
    const upperKey = key.toUpperCase();
    return values[upperKey] !== undefined ? values[upperKey] : match;
  });
}

// Copy text to clipboard
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

export function BatchModal({ compile, isEngineReady, waitForReady }: BatchModalProps) {
  const { batchModalOpen, setBatchModalOpen } = useUIStore();
  const documentStore = useDocumentStore();

  const [rows, setRows] = useState<BatchRow[]>([
    { id: '1', values: {}, status: 'pending' },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastResults, setLastResults] = useState<BatchResults | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewingRow, setPreviewingRow] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

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
      { id: Date.now().toString(), values: {}, status: 'pending' },
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

  // Create modified store with placeholder replacements
  const createModifiedStore = useCallback((values: PlaceholderValue) => {
    return {
      docType: documentStore.docType,
      formData: {
        ...documentStore.formData,
        to: replacePlaceholders(documentStore.formData.to || '', values),
        from: replacePlaceholders(documentStore.formData.from || '', values),
        via: replacePlaceholders(documentStore.formData.via || '', values),
        subject: replacePlaceholders(documentStore.formData.subject || '', values),
        serial: replacePlaceholders(documentStore.formData.serial || '', values),
      },
      references: documentStore.references.map((ref) => ({
        ...ref,
        title: replacePlaceholders(ref.title, values),
      })),
      enclosures: documentStore.enclosures.map((encl) => ({
        ...encl,
        title: replacePlaceholders(encl.title, values),
      })),
      paragraphs: documentStore.paragraphs.map((para) => ({
        ...para,
        text: replacePlaceholders(para.text, values),
      })),
      copyTos: documentStore.copyTos.map((ct) => ({
        ...ct,
        text: replacePlaceholders(ct.text, values),
      })),
    };
  }, [documentStore]);

  // Generate PDF for a single row with retry logic for ENGINE_RESET_NEEDED
  const generatePdfForRow = useCallback(async (values: PlaceholderValue, retryCount = 0): Promise<Uint8Array> => {
    const modifiedStore = createModifiedStore(values);
    const { texFiles } = generateAllLatexFiles(modifiedStore);

    try {
      // Compile LaTeX to PDF
      const pdf = await compile(texFiles);
      if (!pdf) {
        throw new Error('PDF compilation failed');
      }
      return pdf;
    } catch (err) {
      // Handle ENGINE_RESET_NEEDED with retry
      if (err instanceof Error && err.message === 'ENGINE_RESET_NEEDED' && retryCount < MAX_RETRIES) {
        debug.log('Batch', `Engine reset detected, waiting for ready and retrying (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        const ready = await waitForReady(5000);
        if (ready) {
          return generatePdfForRow(values, retryCount + 1);
        }
        throw new Error('Engine failed to recover after reset');
      }
      throw err;
    }
  }, [createModifiedStore, compile, waitForReady]);

  // Preview a single row
  const handlePreview = useCallback(async (row: BatchRow) => {
    if (!isEngineReady) return;

    setPreviewingRow(row.id);
    setPreviewError(null);
    try {
      const pdf = await generatePdfForRow(row.values);
      const blob = new Blob([new Uint8Array(pdf)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      // Clean up old preview URL
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      setPreviewUrl(url);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      debug.error('Batch', 'Preview failed', err);
      setPreviewError(`Preview failed: ${errorMsg}`);
    } finally {
      setPreviewingRow(null);
    }
  }, [isEngineReady, generatePdfForRow, previewUrl]);

  // Close preview
  const closePreview = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
  }, [previewUrl]);

  const handleGenerateBatch = useCallback(async () => {
    if (rows.length === 0 || !isEngineReady) return;

    setIsGenerating(true);
    setLastResults(null);

    const results: BatchResults = {
      succeeded: 0,
      failed: 0,
      total: rows.length,
      errors: [],
    };

    debug.log('Batch', 'Starting batch generation', { rowCount: rows.length });
    debug.time('BatchGeneration');

    // Reset all row statuses
    setRows((prev) => prev.map((row) => ({ ...row, status: 'pending' as const, error: undefined })));

    // For each row, generate a separate PDF
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Mark as generating
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: 'generating' as const } : r))
      );

      try {
        debug.log('Batch', `Generating PDF ${i + 1}/${rows.length}`, row.values);

        const pdf = await generatePdfForRow(row.values);

        // Download the PDF
        const blob = new Blob([new Uint8Array(pdf)], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Generate filename from row values or index
        const filenameHint = row.values[detectedPlaceholders[0]] || `document_${i + 1}`;
        const sanitizedFilename = filenameHint.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
        a.download = `${sanitizedFilename}.pdf`;
        a.click();
        URL.revokeObjectURL(url);

        // Mark row as successful
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, status: 'success' as const } : r))
        );
        results.succeeded++;
        debug.log('Batch', `Document ${i + 1} generated successfully`);

        // Small delay between downloads
        await new Promise((resolve) => setTimeout(resolve, TIMING.BATCH_DOWNLOAD_DELAY));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        debug.error('Batch', `Failed to generate document ${i + 1}`, err);

        // Mark row as failed
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, status: 'error' as const, error: errorMessage } : r))
        );
        results.failed++;
        results.errors.push({ index: i + 1, error: errorMessage });
      }
    }

    debug.timeEnd('BatchGeneration');
    debug.log('Batch', 'Batch generation complete', results);
    setLastResults(results);
    setIsGenerating(false);
  }, [rows, isEngineReady, generatePdfForRow, detectedPlaceholders]);

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

      return { id: Date.now().toString() + idx, values, status: 'pending' };
    });

    if (newRows.length > 0) {
      setRows(newRows);
    }
  }, [detectedPlaceholders]);

  const hasNoPlaceholders = detectedPlaceholders.length === 0;

  return (
    <>
      <Dialog open={batchModalOpen} onOpenChange={setBatchModalOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="bg-background px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Batch Generation
              {!isEngineReady && (
                <Badge variant="secondary" className="ml-2">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Engine loading...
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Generate multiple documents with different placeholder values
            </DialogDescription>
          </DialogHeader>

          {/* Preview Error Alert */}
          {previewError && (
            <div className="mx-6 mt-4 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {previewError}
            </div>
          )}

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-6 space-y-4">
              {hasNoPlaceholders ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
                    <Lightbulb className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium mb-1">No placeholders detected yet</p>
                      <p className="text-muted-foreground">
                        Type <code className="bg-muted px-1 rounded">{'{{'}</code> in any text field to insert placeholders,
                        or type them manually using <code className="bg-muted px-1 rounded">{'{{NAME}}'}</code> format.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Common Variables (click to copy)</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {BATCH_PLACEHOLDERS.slice(0, 8).map((p) => (
                        <button
                          key={p.name}
                          onClick={() => copyToClipboard(`{{${p.name}}}`)}
                          className="flex items-center justify-between p-2 text-left text-sm rounded border hover:bg-secondary/50 transition-colors group"
                        >
                          <div>
                            <span className="font-medium">{p.label}</span>
                            <span className="text-xs text-muted-foreground ml-2">{p.example}</span>
                          </div>
                          <Copy className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tip: Add a variable to your Subject line like "PROMOTION OF <code className="bg-muted px-0.5 rounded">{'{{NAME}}'}</code> TO <code className="bg-muted px-0.5 rounded">{'{{RANK}}'}</code>"
                    </p>
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
                              <th className="p-2 text-left font-medium w-20"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row, idx) => (
                              <tr key={row.id} className={`border-t ${row.status === 'error' ? 'bg-destructive/10' : row.status === 'success' ? 'bg-green-500/10' : ''}`}>
                                <td className="p-2 text-muted-foreground">
                                  <div className="flex items-center gap-1">
                                    {row.status === 'success' && <CheckCircle className="h-4 w-4 text-green-500" />}
                                    {row.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                                    {row.status === 'generating' && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {(!row.status || row.status === 'pending') && <span>{idx + 1}</span>}
                                  </div>
                                </td>
                                {detectedPlaceholders.map((placeholder) => (
                                  <td key={placeholder} className="p-2">
                                    <Input
                                      value={row.values[placeholder] || ''}
                                      onChange={(e) =>
                                        updateRowValue(row.id, placeholder, e.target.value)
                                      }
                                      placeholder={placeholder}
                                      className="h-8"
                                      disabled={isGenerating}
                                    />
                                  </td>
                                ))}
                                <td className="p-2">
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handlePreview(row)}
                                      disabled={!isEngineReady || isGenerating || previewingRow === row.id}
                                      title="Preview document"
                                    >
                                      {previewingRow === row.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Eye className="h-4 w-4" />
                                      )}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-destructive"
                                      onClick={() => removeRow(row.id)}
                                      disabled={rows.length === 1 || isGenerating}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Results Summary */}
                    {lastResults && (
                      <div className={`p-4 rounded-lg border ${lastResults.failed > 0 ? 'border-amber-500/30 bg-amber-500/10' : 'border-green-500/30 bg-green-500/10'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          {lastResults.failed === 0 ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-amber-500" />
                          )}
                          <span className="font-medium">
                            Generation Complete: {lastResults.succeeded}/{lastResults.total} succeeded
                          </span>
                        </div>
                        {lastResults.errors.length > 0 && (
                          <div className="text-sm space-y-1 mt-2">
                            <p className="text-destructive font-medium">Errors:</p>
                            {lastResults.errors.map((err) => (
                              <p key={err.index} className="text-muted-foreground">
                                Document #{err.index}: {err.error}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
              disabled={hasNoPlaceholders || isGenerating || rows.length === 0 || !isEngineReady}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Generate {rows.length} PDFs
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewUrl} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent className="sm:max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="bg-background px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Document Preview
            </DialogTitle>
            <DialogDescription className="sr-only">
              Preview of the generated PDF document
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {previewUrl && (
              <iframe
                src={previewUrl}
                className="w-full h-full border-0"
                title="Document Preview"
              />
            )}
          </div>
          <DialogFooter className="bg-background px-6 py-4 border-t shrink-0">
            <Button variant="outline" onClick={closePreview}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
