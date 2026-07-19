import { useState, useCallback } from 'react';
import { FileUp, Loader2, AlertTriangle, FileText, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { parseLetterFile, hasParsedContent, applyParsedLetter, type ParsedImport } from '@/lib/importLetter';
import { IMPORTABLE_DOC_TYPES } from '@/lib/detectDocumentType';
import { DOC_TYPE_LABELS } from '@/types/document';
import { abbreviatedSignatoryName } from '@/lib/signatoryName';

type Phase =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'review'; result: ParsedImport }
  | { kind: 'error'; message: string };

/** One "Label: value" row in the review summary; hidden when nothing parsed. */
function Row({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === '' || value === 0) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-28 shrink-0 font-medium text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

/**
 * Import an existing naval letter from a PDF or Word document: read its text
 * (offline, via the bundled pdf.js for PDFs or pandoc WASM for DOCX), parse the
 * SECNAV structure, guess the document type, show what was recognized, and on
 * confirm open it as a new editable document. Best-effort — the review step
 * exists because parsing can't be perfect, and the letter opens for editing
 * either way. Scanned/image PDFs have no text to read (OCR is out of scope).
 */
export function ImportLetterModal() {
  const open = useUIStore((s) => s.importLetterModalOpen);
  const setOpen = useUIStore((s) => s.setImportLetterModalOpen);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const reset = useCallback(() => setPhase({ kind: 'idle' }), []);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) reset(); // start fresh next time it opens
    },
    [setOpen, reset]
  );

  const handleFile = useCallback(async (file: File) => {
    setPhase({ kind: 'parsing' });
    try {
      const result = await parseLetterFile(file);
      if (!hasParsedContent(result.parsed)) {
        setPhase({
          kind: 'error',
          message:
            "Couldn't find letter text in this file. If it's a scan or image PDF, text import can't read it yet.",
        });
        return;
      }
      setPhase({ kind: 'review', result });
    } catch {
      setPhase({
        kind: 'error',
        message: 'This file could not be read. It may be corrupt, protected, or an unsupported format.',
      });
    }
  }, []);

  const doImport = useCallback(
    (result: ParsedImport, docType: string) => {
      applyParsedLetter(result.parsed, docType);
      onOpenChange(false);
    },
    [onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5 text-primary" />
            Import a letter
          </DialogTitle>
          <DialogDescription>
            Open an existing letter from a PDF or Word document as a new editable document.
            Everything is read in your browser — nothing is uploaded.
          </DialogDescription>
        </DialogHeader>

        {phase.kind === 'idle' && (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/50 hover:bg-secondary/30">
            <FileUp className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium">Choose a PDF or Word file to import</span>
            <span className="text-xs text-muted-foreground">
              Text-based PDF (.pdf) or Word (.docx) — a scanned image can&apos;t be read yet.
            </span>
            <input
              type="file"
              accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = '';
              }}
            />
          </label>
        )}

        {phase.kind === 'parsing' && (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            Reading the letter…
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertTriangle className="h-6 w-6 text-warning" />
            <p className="text-sm text-muted-foreground">{phase.message}</p>
            <Button variant="outline" size="sm" onClick={reset}>
              Choose a different file
            </Button>
          </div>
        )}

        {phase.kind === 'review' && (
          <ReviewBody
            result={phase.result}
            onBack={reset}
            onImport={(docType) => doImport(phase.result, docType)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewBody({
  result,
  onBack,
  onImport,
}: {
  result: ParsedImport;
  onBack: () => void;
  onImport: (docType: string) => void;
}) {
  const { parsed, detection } = result;
  const [docType, setDocType] = useState(detection.docType);
  const lowConfidence = detection.confidence === 'low';

  const sig = parsed.signature
    ? abbreviatedSignatoryName(parsed.signature.first, parsed.signature.middle, parsed.signature.last)
    : undefined;

  return (
    <>
      <div className="space-y-1.5 rounded-md border border-border bg-secondary/20 p-3">
        <Row label="From" value={parsed.from} />
        <Row label="To" value={parsed.to} />
        <Row label="Via" value={parsed.via} />
        <Row label="Subj" value={parsed.subject} />
        <Row label="SSIC" value={parsed.ssic} />
        <Row label="Serial" value={parsed.serial} />
        <Row label="Date" value={parsed.date} />
        <Row label="References" value={parsed.references.length} />
        <Row label="Enclosures" value={parsed.enclosures.length} />
        <Row label="Copy to" value={parsed.copyTos.length} />
        <Row label="Paragraphs" value={parsed.paragraphs.length} />
        <Row label="Signature" value={sig} />
      </div>

      {/* Document-type picker: pre-selected to the importer's guess. When the
          guess is uncertain we say so and ask the drafter to confirm. */}
      <div className="space-y-1.5">
        <label htmlFor="import-doc-type" className="text-sm font-medium">
          Document type
        </label>
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger id="import-doc-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IMPORTABLE_DOC_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {DOC_TYPE_LABELS[t] ?? t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p
          className={`flex items-start gap-1.5 text-xs ${
            lowConfidence ? 'text-warning' : 'text-muted-foreground'
          }`}
        >
          {lowConfidence ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          {detection.reason}
        </p>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        This is a best-effort read — check every field after importing. The letter opens as a new
        document, so your current one is kept.
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          Choose a different file
        </Button>
        <Button onClick={() => onImport(docType)}>Import into editor</Button>
      </DialogFooter>
    </>
  );
}
