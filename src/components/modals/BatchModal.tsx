import { useState, useCallback, useMemo, useEffect } from 'react';
import { Plus, Trash2, Download, AlertCircle, FileText, Variable, CheckCircle, XCircle, Copy, Lightbulb, Eye, Loader2, Settings, ArrowRight } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useFormStore, type NavmcForm10274Data, type Navmc11811Data } from '@/stores/formStore';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { generateNavmc10274Pdf, loadNavmc10274Templates } from '@/services/pdf/navmc10274Generator';
import { generateNavmc11811Pdf, loadNavmc11811Template } from '@/services/pdf/navmc11811Generator';
import { debug } from '@/lib/debug';
import { TIMING, BATCH_PLACEHOLDERS, NAVMC_10274_PLACEHOLDERS, NAVMC_118_11_PLACEHOLDERS } from '@/lib/constants';

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
  const formStore = useFormStore();
  const { documentCategory, formType } = useDocumentStore();

  const [rows, setRows] = useState<BatchRow[]>([
    { id: '1', values: {}, status: 'pending' },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastResults, setLastResults] = useState<BatchResults | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewingRow, setPreviewingRow] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Column mapping state
  const [columnHeaders, setColumnHeaders] = useState<string[]>([]);
  const [columnMappings, setColumnMappings] = useState<Record<number, string>>({});
  const [showColumnMapping, setShowColumnMapping] = useState(false);
  const [rawPastedData, setRawPastedData] = useState<string[][]>([]);

  // Variable insertion state
  const [selectedVariable, setSelectedVariable] = useState<string>('');
  const [targetField, setTargetField] = useState<string>('');

  // Form templates (loaded on demand when in forms mode)
  const [navmc10274Templates, setNavmc10274Templates] = useState<{
    page1: ArrayBuffer;
    page2: ArrayBuffer;
    page3: ArrayBuffer;
  } | null>(null);
  const [navmc11811Template, setNavmc11811Template] = useState<ArrayBuffer | null>(null);
  const [_templatesLoading, setTemplatesLoading] = useState(false);

  // Load form templates when in forms mode
  useEffect(() => {
    if (documentCategory === 'forms' && batchModalOpen) {
      setTemplatesLoading(true);
      const loadTemplates = async () => {
        try {
          if (formType === 'navmc_10274' && !navmc10274Templates) {
            const templates = await loadNavmc10274Templates();
            setNavmc10274Templates(templates);
          } else if (formType === 'navmc_118_11' && !navmc11811Template) {
            const template = await loadNavmc11811Template();
            setNavmc11811Template(template);
          }
        } catch (err) {
          debug.error('Batch', 'Failed to load form templates', err);
        } finally {
          setTemplatesLoading(false);
        }
      };
      loadTemplates();
    }
  }, [documentCategory, formType, batchModalOpen, navmc10274Templates, navmc11811Template]);

  const isFormsMode = documentCategory === 'forms';

  // Detect all placeholders from current document (correspondence) or form (forms mode)
  const detectedPlaceholders = useMemo(() => {
    const allText: string[] = [];

    if (isFormsMode) {
      // Forms mode: scan form fields for placeholders
      if (formType === 'navmc_10274') {
        const data = formStore.navmc10274;
        if (data.actionNo) allText.push(data.actionNo);
        if (data.ssicFileNo) allText.push(data.ssicFileNo);
        if (data.date) allText.push(data.date);
        if (data.from) allText.push(data.from);
        if (data.via) allText.push(data.via);
        if (data.orgStation) allText.push(data.orgStation);
        if (data.to) allText.push(data.to);
        if (data.natureOfAction) allText.push(data.natureOfAction);
        if (data.copyTo) allText.push(data.copyTo);
        if (data.references) allText.push(data.references);
        if (data.enclosures) allText.push(data.enclosures);
        if (data.supplementalInfo) allText.push(data.supplementalInfo);
        if (data.proposedAction) allText.push(data.proposedAction);
      } else if (formType === 'navmc_118_11') {
        const data = formStore.navmc11811;
        if (data.lastName) allText.push(data.lastName);
        if (data.firstName) allText.push(data.firstName);
        if (data.middleName) allText.push(data.middleName);
        if (data.edipi) allText.push(data.edipi);
        if (data.remarksText) allText.push(data.remarksText);
        if (data.remarksTextRight) allText.push(data.remarksTextRight);
        if (data.entryDate) allText.push(data.entryDate);
        if (data.box11) allText.push(data.box11);
      }
    } else {
      // Correspondence mode: scan document store fields
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
    }

    const allPlaceholders = allText.flatMap((text) => detectPlaceholders(text));
    return [...new Set(allPlaceholders)];
  }, [documentStore, formStore.navmc10274, formStore.navmc11811, isFormsMode, formType]);

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

  // Create modified store with placeholder replacements (for correspondence)
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

  // Create modified NAVMC 10274 form data with placeholder replacements
  const createModifiedNavmc10274 = useCallback((values: PlaceholderValue): NavmcForm10274Data => {
    const data = formStore.navmc10274;
    return {
      actionNo: replacePlaceholders(data.actionNo, values),
      ssicFileNo: replacePlaceholders(data.ssicFileNo, values),
      date: replacePlaceholders(data.date, values),
      from: replacePlaceholders(data.from, values),
      via: replacePlaceholders(data.via, values),
      orgStation: replacePlaceholders(data.orgStation, values),
      to: replacePlaceholders(data.to, values),
      natureOfAction: replacePlaceholders(data.natureOfAction, values),
      copyTo: replacePlaceholders(data.copyTo, values),
      references: replacePlaceholders(data.references, values),
      enclosures: replacePlaceholders(data.enclosures, values),
      supplementalInfo: replacePlaceholders(data.supplementalInfo, values),
      proposedAction: replacePlaceholders(data.proposedAction, values),
    };
  }, [formStore.navmc10274]);

  // Create modified NAVMC 118(11) form data with placeholder replacements
  const createModifiedNavmc11811 = useCallback((values: PlaceholderValue): Navmc11811Data => {
    const data = formStore.navmc11811;
    return {
      lastName: replacePlaceholders(data.lastName, values),
      firstName: replacePlaceholders(data.firstName, values),
      middleName: replacePlaceholders(data.middleName, values),
      edipi: replacePlaceholders(data.edipi, values),
      remarksText: replacePlaceholders(data.remarksText, values),
      remarksTextRight: replacePlaceholders(data.remarksTextRight || '', values),
      entryDate: replacePlaceholders(data.entryDate, values),
      box11: replacePlaceholders(data.box11, values),
    };
  }, [formStore.navmc11811]);

  // Generate PDF for a single row with retry logic for ENGINE_RESET_NEEDED
  const generatePdfForRow = useCallback(async (values: PlaceholderValue, retryCount = 0): Promise<Uint8Array> => {
    // Forms mode: use pdf-lib form generators
    if (isFormsMode) {
      if (formType === 'navmc_10274') {
        if (!navmc10274Templates) {
          throw new Error('NAVMC 10274 templates not loaded');
        }
        const modifiedData = createModifiedNavmc10274(values);
        return generateNavmc10274Pdf(
          modifiedData,
          navmc10274Templates.page1,
          navmc10274Templates.page2,
          navmc10274Templates.page3
        );
      } else if (formType === 'navmc_118_11') {
        if (!navmc11811Template) {
          throw new Error('NAVMC 118(11) template not loaded');
        }
        const modifiedData = createModifiedNavmc11811(values);
        return generateNavmc11811Pdf(modifiedData, navmc11811Template);
      }
      throw new Error(`Unknown form type: ${formType}`);
    }

    // Correspondence mode: use LaTeX compilation
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
  }, [createModifiedStore, createModifiedNavmc10274, createModifiedNavmc11811, compile, waitForReady, isFormsMode, formType, navmc10274Templates, navmc11811Template]);

  // Check if we're ready to generate (depends on mode)
  const isReadyToGenerate = useMemo(() => {
    if (isFormsMode) {
      // Forms mode: check if templates are loaded
      if (formType === 'navmc_10274') return !!navmc10274Templates;
      if (formType === 'navmc_118_11') return !!navmc11811Template;
      return false;
    }
    // Correspondence mode: check if LaTeX engine is ready
    return isEngineReady;
  }, [isFormsMode, formType, navmc10274Templates, navmc11811Template, isEngineReady]);

  // Preview a single row
  const handlePreview = useCallback(async (row: BatchRow) => {
    if (!isReadyToGenerate) return;

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
  }, [isReadyToGenerate, generatePdfForRow, previewUrl]);

  // Close preview
  const closePreview = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
  }, [previewUrl]);

  const handleGenerateBatch = useCallback(async () => {
    if (rows.length === 0 || !isReadyToGenerate) return;

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
  }, [rows, isReadyToGenerate, generatePdfForRow, detectedPlaceholders]);

  // Detect if a row looks like headers (all non-numeric, reasonable length)
  const looksLikeHeaders = useCallback((columns: string[]): boolean => {
    if (columns.length === 0) return false;
    // Headers typically: short strings, no numbers, uppercase or title case
    return columns.every((col) => {
      const trimmed = col.trim();
      if (!trimmed) return true; // Empty cells are OK
      // Check if it's all letters/underscores/spaces (typical header format)
      const isAlphaOnly = /^[A-Za-z_\s]+$/.test(trimmed);
      // Check if it looks like a placeholder name
      const isPlaceholderLike = /^[A-Z][A-Z0-9_]*$/.test(trimmed);
      return isAlphaOnly || isPlaceholderLike;
    });
  }, []);

  // Update a single column mapping
  const updateColumnMapping = useCallback((colIdx: number, placeholder: string) => {
    setColumnMappings((prev) => ({
      ...prev,
      [colIdx]: placeholder,
    }));
  }, []);

  // Apply the current column mappings to create rows
  const applyColumnMappings = useCallback(() => {
    if (rawPastedData.length === 0) return;

    // Skip header row if we detected headers
    const dataRows = columnHeaders.length > 0 ? rawPastedData.slice(1) : rawPastedData;

    const newRows: BatchRow[] = dataRows.map((columns, idx) => {
      const values: PlaceholderValue = {};

      Object.entries(columnMappings).forEach(([colIdxStr, placeholder]) => {
        if (placeholder) {
          const colIdx = parseInt(colIdxStr);
          if (columns[colIdx] !== undefined) {
            values[placeholder] = columns[colIdx].trim();
          }
        }
      });

      return { id: Date.now().toString() + idx, values, status: 'pending' };
    });

    if (newRows.length > 0) {
      setRows(newRows);
    }
    setShowColumnMapping(false);
  }, [rawPastedData, columnHeaders, columnMappings]);

  const handlePasteData = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const lines = pastedText.split('\n').filter((line) => line.trim());

    if (lines.length === 0) return;

    // Parse all lines into columns
    const allData = lines.map((line) => line.split('\t'));
    setRawPastedData(allData);

    // Check if first row looks like headers
    const firstRow = allData[0];
    const hasHeaders = looksLikeHeaders(firstRow);

    if (hasHeaders) {
      // Set up column headers and show mapping UI
      setColumnHeaders(firstRow.map((h) => h.trim()));

      // Auto-map columns by matching header names to placeholders
      const autoMappings: Record<number, string> = {};
      firstRow.forEach((header, idx) => {
        const normalizedHeader = header.trim().toUpperCase().replace(/\s+/g, '_');
        // Try to find a matching placeholder
        const matchedPlaceholder = detectedPlaceholders.find(
          (p) => p === normalizedHeader || p.includes(normalizedHeader) || normalizedHeader.includes(p)
        );
        if (matchedPlaceholder) {
          autoMappings[idx] = matchedPlaceholder;
        }
      });
      setColumnMappings(autoMappings);
      setShowColumnMapping(true);
    } else {
      // No headers detected, auto-map columns to placeholders in order
      setColumnHeaders([]);
      const newRows: BatchRow[] = allData.map((columns, idx) => {
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
    }
  }, [detectedPlaceholders, looksLikeHeaders]);

  // Handle adding a variable to the document
  const handleAddVariable = useCallback(() => {
    if (!selectedVariable || !targetField) return;

    const variableText = `{{${selectedVariable}}}`;

    if (isFormsMode) {
      // Forms mode: Add to specific form fields
      if (formType === 'navmc_10274') {
        const currentData = formStore.navmc10274;
        if (targetField === 'to') {
          formStore.setNavmc10274Field('to', currentData.to ? `${currentData.to} ${variableText}` : variableText);
        } else if (targetField === 'from') {
          formStore.setNavmc10274Field('from', currentData.from ? `${currentData.from} ${variableText}` : variableText);
        } else if (targetField === 'natureOfAction') {
          formStore.setNavmc10274Field('natureOfAction', currentData.natureOfAction ? `${currentData.natureOfAction} ${variableText}` : variableText);
        }
      } else if (formType === 'navmc_118_11') {
        const currentData = formStore.navmc11811;
        if (targetField === 'lastName') {
          formStore.setNavmc11811Field('lastName', currentData.lastName ? `${currentData.lastName} ${variableText}` : variableText);
        } else if (targetField === 'firstName') {
          formStore.setNavmc11811Field('firstName', currentData.firstName ? `${currentData.firstName} ${variableText}` : variableText);
        } else if (targetField === 'remarksText') {
          formStore.setNavmc11811Field('remarksText', currentData.remarksText ? `${currentData.remarksText} ${variableText}` : variableText);
        }
      }
    } else {
      // Correspondence mode: Add to document fields
      if (targetField === 'subject') {
        const currentSubject = documentStore.formData.subject || '';
        documentStore.setField('subject', currentSubject ? `${currentSubject} ${variableText}` : variableText);
      } else if (targetField === 'to') {
        const currentTo = documentStore.formData.to || '';
        documentStore.setField('to', currentTo ? `${currentTo} ${variableText}` : variableText);
      } else if (targetField === 'from') {
        const currentFrom = documentStore.formData.from || '';
        documentStore.setField('from', currentFrom ? `${currentFrom} ${variableText}` : variableText);
      } else if (targetField === 'paragraph') {
        // Add a new paragraph with the variable
        documentStore.addParagraph(variableText, 0);
      }
    }

    // Reset selection
    setSelectedVariable('');
    setTargetField('');
  }, [selectedVariable, targetField, isFormsMode, formType, formStore, documentStore]);

  const hasNoPlaceholders = detectedPlaceholders.length === 0;

  // Get the appropriate placeholder suggestions based on mode
  const suggestedPlaceholders = useMemo(() => {
    if (isFormsMode) {
      if (formType === 'navmc_10274') return NAVMC_10274_PLACEHOLDERS;
      if (formType === 'navmc_118_11') return NAVMC_118_11_PLACEHOLDERS;
    }
    return BATCH_PLACEHOLDERS;
  }, [isFormsMode, formType]);

  // Get the tip text based on mode
  const tipText = useMemo(() => {
    if (isFormsMode) {
      if (formType === 'navmc_10274') {
        return 'Tip: Add variables to the "To" field like "LCpl {{LAST_NAME}}, {{FIRST_NAME}} {{MI}}\\n{{EDIPI}}\\n{{MOS}}"';
      }
      if (formType === 'navmc_118_11') {
        return 'Tip: Add variables to the remarks like "On {{ENTRY_DATE}}, {{NAME}} failed to meet PFT standards..."';
      }
    }
    return 'Tip: Add a variable to your Subject line like "PROMOTION OF {{NAME}} TO {{RANK}}"';
  }, [isFormsMode, formType]);

  return (
    <>
      <Dialog open={batchModalOpen} onOpenChange={setBatchModalOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="bg-background px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Batch Generation {isFormsMode && '(Forms)'}
              {!isReadyToGenerate && (
                <Badge variant="secondary" className="ml-2">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  {isFormsMode ? 'Loading templates...' : 'Engine loading...'}
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

          <div className="flex-1 min-h-0 overflow-auto">
            <div className="p-6 space-y-4 min-w-0">
              {hasNoPlaceholders ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
                    <Lightbulb className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium mb-1">No placeholders detected yet</p>
                      <p className="text-muted-foreground">
                        Type <code className="bg-muted px-1 rounded">@</code> in any text field to insert variables,
                        which will appear as <code className="bg-muted px-1 rounded">{'{{NAME}}'}</code> format.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">
                      {isFormsMode
                        ? `${formType === 'navmc_10274' ? 'NAVMC 10274' : 'NAVMC 118(11)'} Variables (click to copy)`
                        : 'Common Variables (click to copy)'}
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {suggestedPlaceholders.slice(0, 8).map((p) => (
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
                    <p className="text-xs text-muted-foreground">{tipText}</p>
                  </div>

                  {/* Add Variable to Document */}
                  <div className="space-y-3 border-t pt-4 mt-4">
                    <div className="flex items-center gap-2">
                      <Plus className="h-4 w-4 text-primary" />
                      <Label>Add Variable to Document</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Quickly insert a variable into your document without leaving this modal.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <Select value={selectedVariable} onValueChange={setSelectedVariable}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Select variable..." />
                        </SelectTrigger>
                        <SelectContent>
                          {suggestedPlaceholders.map((p) => (
                            <SelectItem key={p.name} value={p.name}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={targetField} onValueChange={setTargetField}>
                        <SelectTrigger className="w-[160px]">
                          <SelectValue placeholder="Add to field..." />
                        </SelectTrigger>
                        <SelectContent>
                          {isFormsMode ? (
                            formType === 'navmc_10274' ? (
                              <>
                                <SelectItem value="to">To Field</SelectItem>
                                <SelectItem value="from">From Field</SelectItem>
                                <SelectItem value="natureOfAction">Nature of Action</SelectItem>
                              </>
                            ) : (
                              <>
                                <SelectItem value="lastName">Last Name</SelectItem>
                                <SelectItem value="firstName">First Name</SelectItem>
                                <SelectItem value="remarksText">Remarks</SelectItem>
                              </>
                            )
                          ) : (
                            <>
                              <SelectItem value="subject">Subject Line</SelectItem>
                              <SelectItem value="to">To Field</SelectItem>
                              <SelectItem value="from">From Field</SelectItem>
                              <SelectItem value="paragraph">New Paragraph</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={handleAddVariable}
                        disabled={!selectedVariable || !targetField}
                        size="sm"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
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

                  {/* Column Mapping UI */}
                  {showColumnMapping && columnHeaders.length > 0 && (
                    <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
                      <div className="flex items-center gap-2">
                        <Settings className="h-4 w-4 text-primary" />
                        <Label>Column Mapping</Label>
                        <span className="text-xs text-muted-foreground">
                          (Detected {rawPastedData.length - 1} data rows)
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Headers detected in your pasted data. Map each column to a variable:
                      </p>
                      <div className="grid gap-2">
                        {columnHeaders.map((header, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-sm font-mono bg-muted px-2 py-1 rounded min-w-[100px] truncate">
                              {header || `Column ${idx + 1}`}
                            </span>
                            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            <Select
                              value={columnMappings[idx] || ''}
                              onValueChange={(v) => updateColumnMapping(idx, v)}
                            >
                              <SelectTrigger className="h-8 flex-1">
                                <SelectValue placeholder="Select variable..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="">— Skip —</SelectItem>
                                {detectedPlaceholders.map((p) => (
                                  <SelectItem key={p} value={p}>{`{{${p}}}`}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" onClick={applyColumnMappings}>
                          Apply Mapping
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowColumnMapping(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between sticky top-0 bg-background z-10 py-1">
                      <Label>Documents to Generate ({rows.length})</Label>
                      <Button variant="outline" size="sm" onClick={addRow}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add Row
                      </Button>
                    </div>

                    <div className="border rounded-lg overflow-x-auto">
                      <table className="text-sm w-full">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="px-2 py-2 text-left font-medium w-8 whitespace-nowrap">#</th>
                              {detectedPlaceholders.map((placeholder) => (
                                <th key={placeholder} className="px-1 py-2 text-left font-medium whitespace-nowrap text-xs">
                                  {placeholder}
                                </th>
                              ))}
                              <th className="px-1 py-2 text-left font-medium w-14"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row, idx) => (
                              <tr key={row.id} className={`border-t ${row.status === 'error' ? 'bg-destructive/10' : row.status === 'success' ? 'bg-green-500/10' : ''}`}>
                                <td className="px-2 py-1 text-muted-foreground">
                                  <div className="flex items-center gap-1">
                                    {row.status === 'success' && <CheckCircle className="h-4 w-4 text-green-500" />}
                                    {row.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                                    {row.status === 'generating' && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {(!row.status || row.status === 'pending') && <span>{idx + 1}</span>}
                                  </div>
                                </td>
                                {detectedPlaceholders.map((placeholder) => (
                                  <td key={placeholder} className="px-1 py-1">
                                    <Input
                                      value={row.values[placeholder] || ''}
                                      onChange={(e) =>
                                        updateRowValue(row.id, placeholder, e.target.value)
                                      }
                                      placeholder={placeholder.substring(0, 8)}
                                      className="h-7 w-24 text-xs"
                                      disabled={isGenerating}
                                    />
                                  </td>
                                ))}
                                <td className="px-1 py-2">
                                  <div className="flex items-center gap-0.5">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => handlePreview(row)}
                                      disabled={!isReadyToGenerate || isGenerating || previewingRow === row.id}
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
                                      className="h-7 w-7 text-destructive"
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
          </div>

          <DialogFooter className="bg-background px-6 py-4 border-t shrink-0">
            <Button variant="outline" onClick={() => setBatchModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleGenerateBatch}
              disabled={hasNoPlaceholders || isGenerating || rows.length === 0 || !isReadyToGenerate}
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
