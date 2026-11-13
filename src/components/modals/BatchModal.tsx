import { documentCapabilities, capabilityAvailable } from '@/lib/documentCapabilities';
import { downloadPdfBlob, preOpenWindowForIOS } from '@/utils/downloadPdf';
import { DOC_TYPE_LABELS, FORM_TYPE_LABELS, formTypeLabel } from '@/types/document';
import { captureBatchRowIntent, renderPreparedBatchRow, type BatchRowContext } from '@/services/exports/batchRows';
import { getExportDeploymentPolicy } from '@/config/classification';
import { captureExportFormTemplates } from '@/services/exports/formTemplates';
import { runPreparedBatchRow } from '@/services/exports/batchExecution';
import { BatchExportReviewModal } from './BatchExportReviewModal';
import { detectBatchPII } from '@/services/pii/batchScan';
import { getPIITypeLabel, type PIIDetectionResult } from '@/services/pii/detector';
import { serializeDocumentSnapshot } from '@/lib/documentSerialization';
import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { ExcelRosterUpload } from './ExcelRosterUpload';
import { autoMapRosterColumns, mappedRosterRows, rosterHeaders, rosterDataRows, rosterRowWarnings, type RosterSelection, type RosterWarning } from '@/lib/excelRoster';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUIStore } from '@/stores/uiStore';
import { useBatchStore, runBatchJob, batchRowFilename, type BatchRow } from '@/stores/batchStore';
import { getBatchOutput } from '@/lib/documentsDb';
import { deriveTitle } from '@/stores/documentsStore';
import { showAppConfirm } from '@/stores/alertStore';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { debug } from '@/lib/debug';
import { BATCH_PLACEHOLDERS, NAVMC_10274_PLACEHOLDERS, NAVMC_118_11_PLACEHOLDERS } from '@/lib/constants';
import {
  detectSessionPlaceholders,
  type PlaceholderValues,
} from '@/lib/placeholders';

// Local alias retained for naming compatibility with the rest of this file.
type PlaceholderValue = PlaceholderValues;

// Human-readable labels for each dropdown target field, used by the
// "Added {{X}} to <field>" confirmation toast. Module-scope const (not
// useMemo) since it never changes. Keys must match the SelectItem values
// in the Add-Variable dropdown — adding/removing dropdown options means
// adding/removing a key here.
const FIELD_LABELS: Record<string, string> = {
  // Correspondence
  subject: 'Subject',
  to: 'To',
  from: 'From',
  via: 'Via',
  paragraph: 'New Paragraph',
  // NAVMC 10274
  orgStation: 'Org/Station',
  natureOfAction: 'Nature of Action',
  copyTo: 'Copy To',
  references: 'References',
  enclosures: 'Enclosures',
  supplementalInfo: 'Supplemental Info',
  proposedAction: 'Proposed Action',
  // NAVMC 118(11)
  lastName: 'Last Name',
  firstName: 'First Name',
  middleName: 'Middle Name',
  remarksText: 'Remarks (Left)',
  remarksTextRight: 'Remarks (Right)',
};

interface BatchModalProps {
  compile: (files: Record<string, string | Uint8Array>) => Promise<Uint8Array | null>;
  isEngineReady: boolean;
  waitForReady: (timeoutMs?: number) => Promise<boolean>;
}

// Sentinel for the column-mapping "skip this column" choice. Radix Select v2
// throws on <SelectItem value=""> (empty string is reserved for clearing),
// which crashed the whole app the moment the mapping dropdown opened.
const SKIP_COLUMN = '__skip__';

// Copy text to clipboard
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

function RosterChecks({ warnings, id }: { warnings: RosterWarning[]; id?: string }) {
  return <div id={id} className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm" role="status">
    <p className="font-medium">Roster checks ({warnings.length})</p>
    <p className="text-xs text-muted-foreground">Review flagged values before generation. Edit values in the rows below. Missing leading zeros cannot be recovered automatically.</p>
    <ul className="list-disc pl-4 space-y-1 text-xs max-h-40 overflow-auto">
      {warnings.slice(0, 20).map((warning, i) => <li key={i}>{warning.message}</li>)}
    </ul>
    {warnings.length > 20 && <p className="text-xs text-muted-foreground">Showing the first 20 checks. Remaining checks appear as earlier values are corrected.</p>}
  </div>;
}

interface BatchModalRowProps {
  row: BatchRow;
  idx: number;
  detectedPlaceholders: string[];
  isGenerating: boolean;
  isLocked: boolean;
  isPreviewing: boolean;
  isPreviewBusy: boolean;
  isReadyToGenerate: boolean;
  canRemove: boolean;
  updateRowValue: (rowId: string, placeholder: string, value: string) => void;
  removeRow: (id: string) => void;
  handlePreview: (row: BatchRow) => void;
}

// Memoized row so typing in row N doesn't re-render rows 1..N-1.
//
// The parent passes a boolean `isPreviewing` (computed once per render as
// `previewingRow === row.id`) instead of the full `previewingRow` string, so
// switching which row is previewing only re-renders the two rows whose state
// actually changed — not every row in the table.
//
// Same idea for `canRemove` vs `rows.length`: a per-row boolean flips only
// at the 1↔2 boundary, not on every row add/remove.
const BatchModalRow = memo(function BatchModalRow({
  row,
  idx,
  detectedPlaceholders,
  isGenerating,
  isLocked,
  isPreviewing,
  isPreviewBusy,
  isReadyToGenerate,
  canRemove,
  updateRowValue,
  removeRow,
  handlePreview,
}: BatchModalRowProps) {
  const warnings = rosterRowWarnings(row, detectedPlaceholders);
  return (
    <tr className={`border-t ${row.status === 'error' ? 'bg-destructive/10' : row.status === 'success' ? 'bg-success/10' : ''}`}>
      <td className="px-2 py-1 text-muted-foreground">
        <div className="flex items-center gap-1">
          {row.status === 'success' && <CheckCircle className="h-4 w-4 text-success" />}
          {row.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
          {row.status === 'generating' && <Loader2 className="h-4 w-4 animate-spin" />}
          {(!row.status || row.status === 'pending') && <span>{idx + 1}</span>}
        </div>
      </td>
      {detectedPlaceholders.map((placeholder) => (
        <td key={placeholder} className="px-1 py-1">
          <Input
            aria-label={`Row ${idx + 1}: ${placeholder}`}
            aria-describedby={warnings.some(w => w.placeholder === placeholder) ? 'batch-roster-checks' : undefined}
            title={warnings.filter(w => w.placeholder === placeholder).map(w => w.message).join('\n') || undefined}
            value={row.values[placeholder] || ''}
            onChange={(e) => updateRowValue(row.id, placeholder, e.target.value)}
            placeholder={placeholder.substring(0, 8)}
            className={`h-7 w-36 text-xs ${warnings.some(w => w.placeholder === placeholder) ? 'border-warning' : ''}`}
            disabled={isGenerating || isLocked || row.status === 'success'}
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
            disabled={!isReadyToGenerate || isGenerating || isPreviewBusy}
            title="Preview document"
            aria-label={`Preview row ${idx + 1}`}
          >
            {isPreviewing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            aria-label={`Remove row ${idx + 1}`}
            onClick={() => removeRow(row.id)}
            disabled={!canRemove || isGenerating || isLocked || row.status === 'success'}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
});

export function BatchModal({ compile, isEngineReady, waitForReady }: BatchModalProps) {
  // Individual selectors — modal only re-renders on its own flag changing.
  const batchModalOpen = useUIStore((s) => s.batchModalOpen);
  const setBatchModalOpen = useUIStore((s) => s.setBatchModalOpen);
  const source = useBatchStore((s) => s.source);
  const jobStatus = useBatchStore((s) => s.status);
  const jobTitle = useBatchStore((s) => s.title);
  const savedPlaceholders = useBatchStore((s) => s.placeholders);
  const recoveryError = useBatchStore((s) => s.recoveryError);
  const rowCanCancel = useBatchStore((s) => s.rowCanCancel);
  const rowActive = useBatchStore((s) => s.rowActive);
  const exportReview = useBatchStore((s) => s.review);
  const stopRequested = useBatchStore((s) => s.stopRequested);

  // Read the complete active data for discovery; generation callbacks keep
  // stable command references and use the saved job source once it exists.
  const liveDocument = useDocumentStore();
  const liveForms = useFormStore();
  const documentCategory = source?.documentCategory ?? liveDocument.documentCategory;
  const formType = source?.formType ?? liveDocument.formType;
  const setDocField = liveDocument.setField;
  const addParagraph = liveDocument.addParagraph;
  const setNavmc10274Field = liveForms.setNavmc10274Field;
  const setNavmc11811Field = liveForms.setNavmc11811Field;

  const rows = useBatchStore((s) => s.rows);
  const setRows = useBatchStore((s) => s.setRows);
  const isGenerating = jobStatus === 'running';
  const lastResults = source ? {
    succeeded: rows.filter((r) => r.status === 'success').length,
    failed: rows.filter((r) => r.status === 'error').length,
    total: rows.length,
    errors: rows.flatMap((r, i) => r.error ? [{ index: i + 1, error: r.error }] : []),
  } : null;
  const previewRequest = useRef(0);
  const previewPending = useRef(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewingRow, setPreviewingRow] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [savedDownloadReview, setSavedDownloadReview] = useState<{
    filename: string; findings: PIIDetectionResult | null; download(): Promise<void>;
  } | null>(null);

  useEffect(() => () => { ++previewRequest.current; }, []);
  useEffect(() => () => { if (previewUrl) setTimeout(() => URL.revokeObjectURL(previewUrl), 5000); }, [previewUrl]);

  // Column mapping state
  const [columnHeaders, setColumnHeaders] = useState<string[]>([]);
  const [columnMappings, setColumnMappings] = useState<Record<number, string>>({});
  const [showColumnMapping, setShowColumnMapping] = useState(false);
  const [rawPastedData, setRawPastedData] = useState<string[][]>([]);
  const [mappingRoster, setMappingRoster] = useState<RosterSelection | null>(null);
  const [rosterUploadKey, setRosterUploadKey] = useState(0);
  const [rosterPending, setRosterPending] = useState(false);

  const closePanel = useCallback(() => {
    ++previewRequest.current;
    if (useBatchStore.getState().rowActive && useBatchStore.getState().status !== 'running') useBatchStore.getState().cancelCurrent();
    // Dialog content unmounts on close. Discard the transient import with it,
    // keeping the already-applied batch rows and any running job intact.
    setMappingRoster(null);setColumnHeaders([]);setColumnMappings({});setShowColumnMapping(false);setRawPastedData([]);setRosterPending(false);
    setPreviewUrl(null);setPreviewError(null);setSavedDownloadReview(null);setBatchModalOpen(false);
  }, [setBatchModalOpen, setSavedDownloadReview, setMappingRoster, setColumnHeaders, setColumnMappings, setShowColumnMapping, setRawPastedData, setRosterPending]);

  // Variable insertion state
  const [selectedVariable, setSelectedVariable] = useState<string>('');
  const [targetField, setTargetField] = useState<string>('');
  // Brief confirmation message after a successful "Add Variable" click.
  // Without this the user clicks Add, the variable IS inserted into the
  // document store, but `detectedPlaceholders` recalculates and the modal
  // body re-shapes around it — making the click look like a no-op. The
  // ref lets us cancel the timer on unmount or on a second click.
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const addStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFormsMode = documentCategory === 'forms';
  const isBuiltinForm = Object.hasOwn(FORM_TYPE_LABELS, formType);

  const detectedPlaceholders = useMemo(() => {
    if (source) return savedPlaceholders;
    if (!batchModalOpen) return [];
    if (isFormsMode && !isBuiltinForm) return [];
    const forms = liveDocument.formType === 'navmc_118_11'
      ? { includeCoverPage: liveForms.includeCoverPage, navmc11811: liveForms.navmc11811 }
      : { includeCoverPage: liveForms.includeCoverPage, navmc10274: liveForms.navmc10274 };
    const snapshot = serializeDocumentSnapshot({
      ...liveDocument,
      forms: liveDocument.documentCategory === 'forms' && !liveDocument.genericForm ? forms : undefined,
    }, 0);
    return detectSessionPlaceholders(snapshot);
  }, [liveDocument, liveForms, batchModalOpen, source, savedPlaceholders, isFormsMode, isBuiltinForm]);

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      { id: Date.now().toString(), values: {}, status: 'pending' },
    ]);
  }, [setRows]);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }, [setRows]);

  const updateRowValue = useCallback((rowId: string, placeholder: string, value: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? { ...row, values: { ...row.values, [placeholder]: value }, rosterWarnings: row.rosterWarnings?.filter(warning => warning.placeholder !== placeholder) }
          : row
      )
    );
  }, [setRows]);

  const generatePdfForRow = useCallback(async (values: PlaceholderValue, context: BatchRowContext): Promise<Uint8Array> => {
    const deliver = context.deliver;
    return runPreparedBatchRow(values, context, {
      resolvePolicy: retry => getExportDeploymentPolicy(undefined, retry || context.retryPolicy === true), captureResources: captureExportFormTemplates,
      render: (ready, signal) => renderPreparedBatchRow(ready, { compile, waitForReady, convertDocx: async () => { throw new Error('Batch output is PDF only.'); } }, signal),
      retainForRetry: !!deliver,
      deliver: deliver ? async artifact => { await deliver(new Uint8Array(await artifact.blob.arrayBuffer())); } : undefined,
      onActiveChange: rowActive => useBatchStore.setState({ rowActive }),
      onCancelableChange: rowCanCancel => useBatchStore.setState({ rowCanCancel }),
      onReview: review => useBatchStore.setState({ review }),
    });
  }, [compile, waitForReady]);

  // Templates are acquired by the row owner, where failures have a retry path.
  const batchCapability = documentCapabilities(source ?? liveDocument, { operation: 'batch', target: 'pdf' });
  const isReadyToGenerate = capabilityAvailable(batchCapability) === true && (isFormsMode || isEngineReady);

  // Preview a single row
  const handlePreview = useCallback(async (row: BatchRow) => {
    if (!isReadyToGenerate || rosterPending || showColumnMapping || previewPending.current || useBatchStore.getState().rowActive || useBatchStore.getState().status === 'running') return;

    previewPending.current = true;
    const generation = ++previewRequest.current;
    const rowValues = JSON.stringify(row.values);
    setPreviewingRow(row.id);
    setPreviewError(null);
    try {
      const pdf = row.outputId ? await getBatchOutput(row.outputId) : await generatePdfForRow(row.values, { source: structuredClone(useBatchStore.getState().source ?? getSerializedSession()), batchId: `preview-${row.id}-${Date.now()}`, preview: true, retryPolicy: true, rowId: row.id, filename: batchRowFilename(row, detectedPlaceholders), capturedAt: Date.now() });
      if (!pdf) throw new Error('The saved result is unavailable. Keep your downloaded copy.');
      if (generation !== previewRequest.current || !useUIStore.getState().batchModalOpen || JSON.stringify(useBatchStore.getState().rows.find(candidate => candidate.id === row.id)?.values) !== rowValues) return;
      const blob = new Blob([new Uint8Array(pdf)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      setPreviewUrl(url);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      debug.error('Batch', 'Preview failed', err);
      if (generation === previewRequest.current) setPreviewError(`Preview failed: ${errorMsg}`);
    } finally {
      previewPending.current = false;
      setPreviewingRow(null);
    }
  }, [isReadyToGenerate, generatePdfForRow, detectedPlaceholders, rosterPending, showColumnMapping]);

  // Close preview
  const closePreview = useCallback(() => {
    ++previewRequest.current;
    setPreviewUrl(null);
  }, []);

  const downloadResult = async (pdf: Uint8Array, filename: string) => {
    if (!await downloadPdfBlob(new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), filename)) throw new Error('The PDF could not be delivered. Use its saved result to try again.');
  };
  const handleGenerateBatch = (retryFailed = false) => {
    if (!isReadyToGenerate || isGenerating || previewPending.current || useBatchStore.getState().rowActive || showColumnMapping || rosterPending) return;
    const session = source ?? getSerializedSession();
    void runBatchJob({ source: session, title: deriveTitle(session), placeholders: detectedPlaceholders,
      retryFailed, generate: generatePdfForRow, download: downloadResult });
  };

  const handleDownloadResult = (row: BatchRow) => {
    // Capture the saved result identity and scan its frozen source/row before
    // reading bytes. Approval never rereads whichever batch is currently open.
    const saved = structuredClone(row);
    const batch = useBatchStore.getState();
    const session = batch.source;
    const download = async () => {
      const prepared = preOpenWindowForIOS();
      let transferred = false;
      try {
        const data = await getBatchOutput(saved.outputId!);
        if (!data) throw new Error('This result is no longer available in browser storage.');
        transferred = await downloadPdfBlob(new Blob([new Uint8Array(data)], { type: 'application/pdf' }), saved.filename!, prepared);
        if (!transferred) throw new Error('This result could not be downloaded. Try again.');
      } catch (error) {
        if (useBatchStore.getState().rows.some(row => row.id === saved.id && row.outputId === saved.outputId)) {
          useBatchStore.setState({ recoveryError: error instanceof Error ? error.message : 'This result could not be downloaded.' });
        }
      } finally { if (!transferred && prepared && !prepared.closed) prepared.close(); }
    };
    if (!session) {
      setSavedDownloadReview({ filename: saved.filename!, findings: null, download });
      return;
    }
    try {
      const intent = captureBatchRowIntent(saved.values, {
        source: session, batchId: batch.jobId ?? 'saved-result', rowId: saved.id,
        filename: saved.filename!, capturedAt: session.timestamp,
      });
      const findings = detectBatchPII(intent.captured, intent.placeholders);
      if (findings.found) setSavedDownloadReview({ filename: saved.filename!, findings, download });
      else void download();
    } catch (error) {
      debug.error('Batch', 'Saved result text review failed', error);
      setSavedDownloadReview({ filename: saved.filename!, findings: null, download });
    }
  };

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

  const handleRosterMapping = (selection: RosterSelection) => {
    if (useBatchStore.getState().source || useBatchStore.getState().status === 'running') return;
    const headers = rosterHeaders(selection);
    setMappingRoster(selection);
    setColumnHeaders(headers);
    setRawPastedData([headers, ...rosterDataRows(selection).map(row => row.cells.map(cell => cell.value))]);
    setColumnMappings(autoMapRosterColumns(headers, detectedPlaceholders));
    setShowColumnMapping(true);
  };
  const mappedTargets = Object.values(columnMappings).filter(Boolean);
  const duplicateMapping = new Set(mappedTargets).size !== mappedTargets.length;
  const mappedRoster = useMemo(() => mappingRoster ? mappedRosterRows(mappingRoster, columnMappings, detectedPlaceholders) : [], [mappingRoster, columnMappings, detectedPlaceholders]);
  const mappingWarnings = mappedRoster.flatMap(row => rosterRowWarnings({ ...row, rosterWarnings: row.warnings }, detectedPlaceholders));
  const rowWarnings = rows.flatMap(row => rosterRowWarnings(row, detectedPlaceholders));

  // Apply the current column mappings to create rows
  const applyColumnMappings = useCallback(() => {
    if (rawPastedData.length === 0 || duplicateMapping || !Object.values(columnMappings).some(Boolean) || useBatchStore.getState().source) return;

    // Skip header row if we detected headers
    const dataRows = columnHeaders.length > 0 ? rawPastedData.slice(1) : rawPastedData;

    const newRows: BatchRow[] = mappingRoster ? mappedRoster.map(row => ({
      id: crypto.randomUUID(), values: row.values, status: 'pending', worksheetRow: row.worksheetRow, rosterWarnings: row.warnings,
    })) : dataRows.map((columns, idx) => {
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
    setMappingRoster(null);
    setRawPastedData([]);
    setRosterPending(false);
    setRosterUploadKey(key => key + 1);
  }, [rawPastedData, columnHeaders, columnMappings, setRows, mappingRoster, mappedRoster, duplicateMapping, setShowColumnMapping, setMappingRoster, setRawPastedData, setRosterUploadKey, setRosterPending]);

  const handlePasteData = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const lines = pastedText.split('\n').filter((line) => line.trim());

    if (lines.length === 0) return;
    setMappingRoster(null);
    setShowColumnMapping(false);
    setRosterPending(false);
    setRosterUploadKey(key => key + 1);

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
      setColumnMappings(autoMapRosterColumns(firstRow, detectedPlaceholders));
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
  }, [detectedPlaceholders, looksLikeHeaders, setRows, setMappingRoster, setShowColumnMapping, setRosterUploadKey, setRawPastedData, setColumnHeaders, setColumnMappings, setRosterPending]);

  // Handle adding a variable to the document.
  // Reads live state via getState() at click time (not stale render-time snapshot),
  // and uses the stable setter refs bound at the top of the component.
  const handleAddVariable = useCallback(() => {
    if (useBatchStore.getState().source) { setAddStatus('Start a new batch to change its source document.'); return; }
    if (!selectedVariable || !targetField) return;

    const variableText = `{{${selectedVariable}}}`;
    // Track whether an applicable branch ran. If the user's targetField
    // doesn't match any case (shouldn't happen, but guards future
    // dropdown drift), we don't show a misleading "Added" message.
    let inserted = false;

    const appendInto = (current: string) =>
      current ? `${current} ${variableText}` : variableText;

    if (isFormsMode) {
      // Forms mode: Add to specific form fields.
      // hasOwnProperty.call instead of `key in obj` so a hypothetical
      // future dropdown drift adding e.g. `toString` as a value can't
      // resolve via Object.prototype and call a setter with garbage.
      if (formType === 'navmc_10274') {
        const currentData = useFormStore.getState().navmc10274;
        if (Object.prototype.hasOwnProperty.call(currentData, targetField)) {
          const fieldKey = targetField as keyof typeof currentData;
          const fieldValue = currentData[fieldKey];
          // signatureBlocks is structured (statement+name rows), not a text
          // field — the target dropdown never offers it, and this guard keeps
          // a drifted key from appending a variable into a non-string.
          if (typeof fieldValue === 'string') {
            setNavmc10274Field(
              fieldKey as Exclude<keyof typeof currentData, 'signatureBlocks'>,
              appendInto(fieldValue)
            );
            inserted = true;
          }
        }
      } else if (formType === 'navmc_118_11') {
        const currentData = useFormStore.getState().navmc11811;
        if (Object.prototype.hasOwnProperty.call(currentData, targetField)) {
          const fieldKey = targetField as keyof typeof currentData;
          const value = currentData[fieldKey];
          // Only text fields are batch targets — signatureBlocks is an array.
          if (typeof value === 'string') {
            setNavmc11811Field(fieldKey, appendInto(value));
            inserted = true;
          }
        }
      }
    } else {
      // Correspondence mode: Add to document fields
      const currentFormData = useDocumentStore.getState().formData;
      if (targetField === 'subject' || targetField === 'to' || targetField === 'from' || targetField === 'via') {
        const current = (currentFormData[targetField] as string | undefined) ?? '';
        setDocField(targetField, appendInto(current));
        inserted = true;
      } else if (targetField === 'paragraph') {
        // Add a new paragraph with the variable
        addParagraph(variableText, 0);
        inserted = true;
      }
    }

    if (inserted) {
      // Inline confirmation. Without this the modal's own UI may shift
      // (the rows table replaces the onboarding view as soon as a
      // placeholder is detected), making the click look like nothing
      // happened. The toast lives near the Add button itself.
      const fieldLabel = FIELD_LABELS[targetField] ?? targetField;
      setAddStatus(`Added {{${selectedVariable}}} to ${fieldLabel}`);
      if (addStatusTimerRef.current !== null) {
        clearTimeout(addStatusTimerRef.current);
      }
      addStatusTimerRef.current = setTimeout(() => {
        addStatusTimerRef.current = null;
        setAddStatus(null);
      }, 2500);
    }

    // Reset selection
    setSelectedVariable('');
    setTargetField('');
  }, [selectedVariable, targetField, isFormsMode, formType, setNavmc10274Field, setNavmc11811Field, setDocField, addParagraph]);

  // Clean up the add-status timer on unmount so we don't fire setState
  // on an unmounted component if the modal closes within 2.5s of a click.
  useEffect(() => {
    return () => {
      if (addStatusTimerRef.current !== null) {
        clearTimeout(addStatusTimerRef.current);
        addStatusTimerRef.current = null;
      }
    };
  }, []);

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
        return 'Tip: Add variables to the remarks like "On {{ENTRY_DATE}}, {{NAME}} failed to meet PFT standards…"';
      }
    }
    return 'Tip: Add a variable to your Subject line like "PROMOTION OF {{NAME}} TO {{RANK}}"';
  }, [isFormsMode, formType]);

  if (!capabilityAvailable(batchCapability) && !source && !exportReview) {
    return <Dialog open={batchModalOpen && !exportReview} onOpenChange={open => { if (open) setBatchModalOpen(true);else closePanel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Batch generation</DialogTitle>
          <DialogDescription>{batchCapability.status === 'supported' ? '' : batchCapability.message} For this library form, download an individual PDF or create a new copy from Form options.</DialogDescription>
        </DialogHeader>
        <Button onClick={() => setBatchModalOpen(false)}>Back to form</Button>
      </DialogContent>
    </Dialog>;
  }

  return (
    <>
      {isGenerating && !batchModalOpen && <button type="button" className="fixed bottom-6 right-4 z-50 rounded-md border border-border bg-card px-4 py-3 text-sm shadow-lg" onClick={() => setBatchModalOpen(true)}>Batch running · {lastResults?.succeeded ?? 0}/{rows.length} generated</button>}
      <Dialog open={batchModalOpen && !exportReview} onOpenChange={open => { if (open) setBatchModalOpen(true);else closePanel(); }}>
        <DialogContent className="sm:max-w-3xl max-h-[85dvh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="bg-card px-4 sm:px-6 py-4 pr-14 sm:pr-14 border-b border-border/50 shrink-0">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Batch generation {isFormsMode && '(Forms)'}
              {!isReadyToGenerate && (!source || rows.some((r) => r.status !== 'success')) && (
                <Badge variant="secondary" className="ml-2">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  {isFormsMode ? 'Loading templates...' : 'Engine loading...'}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Generate multiple documents with different placeholder values
            </DialogDescription>
            {source && <div className="space-y-1 text-sm">
              <p className="font-medium" role="status">
                {isGenerating ? 'Generating' : jobStatus === 'complete' ? 'Batch complete' : jobStatus === 'interrupted' ? 'Interrupted batch' : 'Paused batch'}
                {' · '}{lastResults?.succeeded}/{rows.length} generated{lastResults?.failed ? ` · ${lastResults.failed} failed` : ''}
              </p>
              <p className="truncate text-xs text-muted-foreground" title={jobTitle}>Source: {jobTitle}</p>
              <p className="text-xs text-muted-foreground">{isFormsMode ? formTypeLabel(formType) : DOC_TYPE_LABELS[source.docType]} · Saved when generation started</p>
            </div>}
          </DialogHeader>

          {/* Preview Error Alert */}
          {previewError && (
            <div className="mx-6 mt-4 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {previewError}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-auto">
            <div className="p-4 sm:p-6 space-y-4 min-w-0">
              {/* Add Variable stays visible throughout setup. Saved jobs freeze
                  their source and expose only the applicable row actions.
                  Add Variable to Document — always visible during setup.
                  Previously this lived inside the `hasNoPlaceholders` branch
                  below, which meant clicking Add caused `detectedPlaceholders`
                  to recalculate, `hasNoPlaceholders` to flip false, and the
                  whole UI to disappear — making the Add button look broken.
                  Lifting it here keeps it accessible whether or not the doc
                  already has placeholders, and the inline `addStatus` toast
                  surfaces the action's effect now that the UI no longer
                  visually changes around it. */}
              {!source && <div data-tour="batch-addvar" className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-4">
                <div className="flex items-center gap-2">
                  <Plus className="h-4 w-4 text-primary" />
                  <Label>Add a variable</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Choose what changes between documents and where it belongs.
                </p>
                <div className="flex gap-2 flex-wrap items-center">
                  <Select value={selectedVariable} onValueChange={setSelectedVariable}>
                    <SelectTrigger aria-label="Variable" className="w-full sm:w-[180px]">
                      <SelectValue placeholder="Select variable…" />
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
                    <SelectTrigger aria-label="Destination field" className="w-full sm:w-[180px]">
                      <SelectValue placeholder="Add to field…" />
                    </SelectTrigger>
                    <SelectContent>
                      {/*
                        Field choices are intentionally limited to ones that
                        (a) accept arbitrary text via a variable-aware input
                        (InputWithVariables / TextareaWithVariables /
                        VariableChipEditor), and (b) don't have tight length
                        limits that would truncate `{{NAME}}` (8 chars).

                        Excluded for forms:
                        - NAVMC 10274 actionNo / ssicFileNo: plain Input, fixed
                          formats ("001-25", numeric SSIC). Variables would
                          break those formats.
                        - NAVMC 10274 date / NAVMC 118(11) entryDate: HTML
                          type="date" inputs — appending text corrupts.
                        - NAVMC 118(11) edipi (maxLength=10) and box11
                          (maxLength=5): tight character limits. {{NAME}}
                          alone is 8 chars, would truncate or overflow.
                      */}
                      {isFormsMode ? (
                        formType === 'navmc_10274' ? (
                          <>
                            <SelectItem value="from">From</SelectItem>
                            <SelectItem value="via">Via</SelectItem>
                            <SelectItem value="orgStation">Org/Station</SelectItem>
                            <SelectItem value="to">To</SelectItem>
                            <SelectItem value="natureOfAction">Nature of Action</SelectItem>
                            <SelectItem value="copyTo">Copy To</SelectItem>
                            <SelectItem value="references">References</SelectItem>
                            <SelectItem value="enclosures">Enclosures</SelectItem>
                            <SelectItem value="supplementalInfo">Supplemental Info</SelectItem>
                            <SelectItem value="proposedAction">Proposed Action</SelectItem>
                          </>
                        ) : (
                          <>
                            <SelectItem value="lastName">Last Name</SelectItem>
                            <SelectItem value="firstName">First Name</SelectItem>
                            <SelectItem value="middleName">Middle Name</SelectItem>
                            <SelectItem value="remarksText">Remarks (Left)</SelectItem>
                            <SelectItem value="remarksTextRight">Remarks (Right)</SelectItem>
                          </>
                        )
                      ) : (
                        <>
                          <SelectItem value="subject">Subject Line</SelectItem>
                          <SelectItem value="to">To Field</SelectItem>
                          <SelectItem value="from">From Field</SelectItem>
                          <SelectItem value="via">Via Field</SelectItem>
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
                  {addStatus && (
                    <span role="status" className="text-xs text-success flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      {addStatus}
                    </span>
                  )}
                </div>
              </div>}

              {hasNoPlaceholders ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-muted/30">
                    <Lightbulb className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium mb-1">Start with a variable</p>
                      <p className="text-muted-foreground">
                        Type <code className="bg-muted px-1 rounded">@</code> in any text field to insert variables,
                        which will appear as <code className="bg-muted px-1 rounded">{'{{NAME}}'}</code> format.
                      </p>
                    </div>
                  </div>

                  <div data-tour="batch-commonvars" className="space-y-2">
                    <Label className="text-sm">
                      {isFormsMode
                        ? `${formType === 'navmc_10274' ? 'NAVMC 10274' : 'NAVMC 118(11)'} Variables (click to copy)`
                        : 'Common Variables (click to copy)'}
                    </Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {suggestedPlaceholders.slice(0, 8).map((p) => (
                        <div
                          key={p.name}
                          className="rounded-lg border border-border/50 hover:border-primary/30 transition-colors duration-150"
                        >
                          <button
                            onClick={() => copyToClipboard(`{{${p.name}}}`)}
                            className="flex items-center justify-between p-2 text-left text-sm w-full hover:bg-secondary/50 transition-colors duration-150 group rounded-lg"
                          >
                            <div>
                              <span className="font-medium">{p.label}</span>
                              <span className="text-xs text-muted-foreground ml-2">{p.example}</span>
                            </div>
                            <Copy className="h-3 w-3 text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{tipText}</p>
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

                  {!source && <ExcelRosterUpload key={rosterUploadKey} disabled={isGenerating} onMap={handleRosterMapping} onPendingChange={setRosterPending} onReset={() => {
                    setMappingRoster(null);setShowColumnMapping(false);setRawPastedData([]);
                  }} />}

                  {!source && <div className="space-y-2">
                    <Label>Paste Data (Tab-separated)</Label>
                    <Textarea
                      placeholder={`Paste tab-separated data here. Each row becomes a document.\nColumns should match: ${detectedPlaceholders.join(', ')}`}
                      rows={3}
                      onPaste={handlePasteData}
                      disabled={isGenerating || !!source}
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      Tip: Copy data from Excel or a spreadsheet and paste here.
                    </p>
                  </div>}

                  {/* Column Mapping UI */}
                  {!source && showColumnMapping && columnHeaders.length > 0 && (
                    <div className="space-y-3 border border-border/50 rounded-lg p-4 bg-muted/20 shadow-sm">
                      <div className="flex items-center gap-2">
                        <Settings className="h-4 w-4 text-primary" />
                        <Label>Column Mapping</Label>
                        <span className="text-xs text-muted-foreground">
                          (Detected {rawPastedData.length - 1} data rows)
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Map each column to a variable. Skip columns you do not need.
                      </p>
                      <div className="grid gap-2">
                        {columnHeaders.map((header, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-sm font-mono bg-muted px-2 py-1 rounded w-32 shrink-0 truncate" title={header}>
                              {header || `Column ${idx + 1}`}
                            </span>
                            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            <Select
                              value={columnMappings[idx] || SKIP_COLUMN}
                              onValueChange={(v) => updateColumnMapping(idx, v === SKIP_COLUMN ? '' : v)}
                            >
                              <SelectTrigger className="h-8 flex-1 min-w-0" aria-label={`Map column ${idx + 1}: ${header}`}>
                                <SelectValue placeholder="Select variable…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={SKIP_COLUMN}>— Skip —</SelectItem>
                                {detectedPlaceholders.map((p) => (
                                  <SelectItem key={p} value={p}>{`{{${p}}}`}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                      {duplicateMapping && <p role="alert" className="text-sm text-destructive">Each variable can use only one column. Skip or remap duplicate assignments.</p>}
                      {mappingWarnings.length > 0 && <RosterChecks warnings={mappingWarnings} />}
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" onClick={applyColumnMappings} disabled={duplicateMapping || mappedTargets.length === 0}>
                          Apply Mapping
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowColumnMapping(false)}
                        >
                          Close panel
                        </Button>
                      </div>
                    </div>
                  )}

                  {rowWarnings.length > 0 && <RosterChecks id="batch-roster-checks" warnings={rowWarnings} />}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between sticky top-0 bg-background z-10 py-1">
                      <Label>{source ? 'Batch rows' : 'Documents to generate'} ({rows.length})</Label>
                      {!source && <Button variant="outline" size="sm" onClick={addRow} disabled={isGenerating}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add Row
                      </Button>}
                    </div>

                    <div className="border border-border/50 rounded-lg overflow-x-auto shadow-sm">
                      <table className="text-sm w-full">
                          <thead className="bg-muted/50 border-b border-border/30">
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
                              <BatchModalRow
                                key={row.id}
                                row={row}
                                idx={idx}
                                detectedPlaceholders={detectedPlaceholders}
                                isGenerating={isGenerating}
                                isLocked={!!source}
                                isPreviewing={previewingRow === row.id}
                                isPreviewBusy={rowActive || !!previewingRow || rosterPending || showColumnMapping}
                                isReadyToGenerate={isReadyToGenerate}
                                canRemove={rows.length > 1}
                                updateRowValue={updateRowValue}
                                removeRow={removeRow}
                                handlePreview={handlePreview}
                              />
                            ))}
                          </tbody>
                        </table>
                    </div>

                    {/* Results Summary */}
                    {lastResults && lastResults.errors.length > 0 && (
                      <div className={`p-4 rounded-lg border shadow-sm transition-colors duration-300 ${lastResults.failed > 0 ? 'border-warning/30 bg-warning/10' : 'border-success/30 bg-success/10'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          {lastResults.failed === 0 ? (
                            <CheckCircle className="h-5 w-5 text-success" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-warning" />
                          )}
                          <span className="font-medium">
                            {jobStatus === 'running' ? 'Generating' : jobStatus === 'complete' ? 'Complete' : 'Paused'}: {lastResults.succeeded}/{lastResults.total} generated
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

          <div className="border-t border-border px-6 py-3 text-sm space-y-2" aria-live="polite">
            <p>Jobs and results are stored in this browser and are excluded from workspace backups. Download files you need to keep.</p>
            {isGenerating && <p>Closing this panel keeps the job running. Keep this tab open.</p>}
            {jobStatus === 'interrupted' && <p>Recovered after interruption. Completed rows are kept; review the interrupted row before retrying it.</p>}
            {recoveryError && <p role="alert" className="text-destructive">{recoveryError}</p>}
            {rows.some((r) => r.outputId) && <p className="font-medium">Generated files</p>}
            {rows.some((r) => r.outputId) && <div className="flex max-h-32 overflow-y-auto flex-wrap gap-2">
              {rows.filter((r) => r.outputId).map((r) => <Button key={r.id} size="sm" variant="outline" onClick={() => handleDownloadResult(r)}>Download {r.filename}</Button>)}
            </div>}
          </div>
          <DialogFooter className="bg-card px-6 py-4 border-t border-border/50 shrink-0">
            <Button variant="outline" onClick={closePanel}>
              Close panel
            </Button>
            {isGenerating && <Button variant="outline" disabled={!rowCanCancel} onClick={() => useBatchStore.getState().cancelCurrent()}>Cancel current row</Button>}
            {isGenerating && <Button variant="outline" disabled={stopRequested} onClick={() => useBatchStore.getState().stop()}>{stopRequested ? 'Stopping after this file…' : 'Stop after current file'}</Button>}
            {!isGenerating && rows.some((r) => r.status === 'error') && <Button variant="outline" disabled={!isReadyToGenerate || rowActive || !!previewingRow} onClick={() => handleGenerateBatch(true)}>Retry failed rows</Button>}
            {!isGenerating && source && <Button variant="ghost" onClick={async () => {
              if (await showAppConfirm({ title: 'Start a new batch?', message: 'The current job and saved results will be cleared. Download any files you need first.', confirmLabel: 'Start new batch' })) {
                useBatchStore.getState().reset();
                setMappingRoster(null);setShowColumnMapping(false);setRawPastedData([]);setRosterPending(false);setRosterUploadKey(key => key + 1);
              }
            }}>New batch</Button>}
            {(!source || isGenerating || rows.some((r) => !r.status || r.status === 'pending')) && <Button
              data-tour="batch-generate"
              onClick={() => handleGenerateBatch()}
              disabled={hasNoPlaceholders || isGenerating || rowActive || !!previewingRow || showColumnMapping || rosterPending || !rows.some((r) => !r.status || r.status === 'pending') || !isReadyToGenerate}
              className="tracking-wide"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  {source ? 'Resume remaining' : `Generate ${rows.length} PDF${rows.length === 1 ? '' : 's'}`}
                </>
              )}
            </Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BatchExportReviewModal review={exportReview} cancelLabel={isGenerating ? undefined : 'Cancel preview'}
        onConfirm={() => { if (exportReview) useBatchStore.getState().confirmReview(exportReview.job, exportReview.stage); }}
        onCancel={() => useBatchStore.getState().cancelCurrent()} />

      <Dialog open={!!savedDownloadReview} onOpenChange={open => { if (!open) setSavedDownloadReview(null); }}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review saved result</DialogTitle>
            <DialogDescription>{savedDownloadReview?.filename}</DialogDescription>
          </DialogHeader>
          <p>{savedDownloadReview?.findings ? 'Potential personal or sensitive data appears in this saved result. Confirm that this file is appropriate for its recipient.' : 'The source text for this saved result is unavailable or could not be inspected. Check the file before sharing.'}</p>
          <ul className="space-y-2">{savedDownloadReview?.findings?.findings.map((finding, index) => <li key={index}>{getPIITypeLabel(finding.type)} · {finding.field}</li>)}</ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavedDownloadReview(null)}>Cancel download</Button>
            <Button onClick={() => {
              const reviewed = savedDownloadReview;setSavedDownloadReview(null);
              if (reviewed) void reviewed.download();
            }}>{savedDownloadReview?.findings ? 'Download reviewed result' : 'Download without text review'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewUrl} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent className="sm:max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="bg-card px-6 py-4 border-b border-border/50 shrink-0">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
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
          <DialogFooter className="bg-card px-6 py-4 border-t border-border/50 shrink-0">
            <Button variant="outline" onClick={closePreview}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
