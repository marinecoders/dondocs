import { useState, useCallback } from 'react';
import { ClipboardPaste, FileUp, Loader2, AlertTriangle, FileText, Info, ShieldAlert } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { useUIStore } from '@/stores/uiStore';
import {
  parseLetterFile,
  parseLetterText,
  hasParsedContent,
  applyParsedLetter,
  isDocxFile,
  isLegacyDocFile,
  type ParsedImport,
} from '@/lib/importLetter';
import { IMPORTABLE_DOC_TYPES } from '@/lib/detectDocumentType';
import { CLASSIFICATION_LABELS } from '@/lib/detectClassification';
import { DOC_TYPE_LABELS } from '@/types/document';
import { abbreviatedSignatoryName } from '@/lib/signatoryName';
import { debug } from '@/lib/debug';

type ImportSource = 'file' | 'text';

type Phase =
  | { kind: 'idle' }
  | { kind: 'paste'; message?: string }
  | { kind: 'parsing' }
  | { kind: 'review'; result: ParsedImport; source: ImportSource }
  | { kind: 'error'; message: string; source: ImportSource };

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
 * Import an existing naval letter from pasted text, a PDF, or a Word document.
 * Read its text offline (via pdf.js for PDFs or pandoc WASM for DOCX), parse the
 * SECNAV structure, guess the document type, show what was recognized, and on
 * confirm open it as a new editable document. Best-effort — the review step
 * exists because parsing can't be perfect, and the letter opens for editing
 * either way. Scanned/image PDFs have no text to read (OCR is out of scope).
 */
export function ImportLetterModal() {
  const open = useUIStore((s) => s.importLetterModalOpen);
  // Each opening owns its draft and read results. Closing discards that session,
  // so an old asynchronous file read cannot overwrite a later pasted import.
  return open ? <ImportLetterDialog /> : null;
}

function ImportLetterDialog() {
  const setOpen = useUIStore((s) => s.setImportLetterModalOpen);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [letterText, setLetterText] = useState('');

  const handleFile = useCallback(async (file: File) => {
    // Legacy binary .doc can't be read by either engine — catch it up front with
    // a message that tells the drafter how to proceed, not a vague failure.
    if (isLegacyDocFile(file)) {
      setPhase({
        kind: 'error',
        source: 'file',
        message:
          'Legacy Word “.doc” files can’t be imported. Open it in Word and save as “.docx” (or print to PDF), then import that.',
      });
      return;
    }
    setPhase({ kind: 'parsing' });
    const docx = isDocxFile(file);
    try {
      const result = await parseLetterFile(file);
      if (!hasParsedContent(result.parsed)) {
        setPhase({
          kind: 'error',
          source: 'file',
          message: docx
            ? "Couldn't find any letter text in this Word document — it may be empty or hold only images."
            : "Couldn't find letter text in this PDF. If it's a scan or image, text import can't read it yet.",
        });
        return;
      }
      setPhase({ kind: 'review', result, source: 'file' });
    } catch (err) {
      // Surface the failure to the user and log the cause for diagnosis — a
      // failed DOCX read on an air-gapped host is usually the pandoc engine not
      // loading, which the generic "corrupt file" wording would hide.
      debug.error('Import', `Failed to read ${docx ? 'DOCX' : 'PDF'} for import`, err);
      setPhase({
        kind: 'error',
        source: 'file',
        message: docx
          ? 'This Word document could not be read. It may be corrupt or password-protected, or the document engine could not start.'
          : 'This PDF could not be read. It may be corrupt or password-protected.',
      });
    }
  }, []);

  const handleText = useCallback(() => {
    if (!letterText.trim()) return;
    try {
      const result = parseLetterText(letterText);
      if (!hasParsedContent(result.parsed)) {
        setPhase({
          kind: 'paste',
          message: "Couldn't recognize letter fields or body paragraphs. Check that you pasted the full letter, including its headings and paragraph numbers.",
        });
        return;
      }
      setPhase({ kind: 'review', result, source: 'text' });
    } catch (err) {
      debug.error('Import', 'Failed to read pasted letter text', err);
      setPhase({
        kind: 'paste',
        message: 'This letter text could not be read. Check the text and try again.',
      });
    }
  }, [letterText]);

  const doImport = useCallback(
    (result: ParsedImport, docType: string, source: ImportSource) => {
      try {
        if (applyParsedLetter(result.parsed, docType, result.classification) !== 'applied') throw new Error('The prepared letter could not be installed');
        setOpen(false);
      } catch (err) {
        debug.error('Import', 'Failed to apply the parsed letter to the editor', err);
        setPhase({
          kind: 'error',
          source,
          message: 'The letter was read, but could not be opened in the editor. Please try again.',
        });
      }
    },
    [setOpen]
  );

  return (
    <Dialog open onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5 text-primary" />
            Import a letter
          </DialogTitle>
          <DialogDescription>
            Open an existing letter from a PDF, Word document, or pasted text as a new editable document.
            Everything is read in your browser — nothing is uploaded.
          </DialogDescription>
        </DialogHeader>

        {phase.kind === 'idle' && (
          <div className="space-y-3">
            <label className="focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/50 hover:bg-secondary/30">
              <FileUp className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">Choose a PDF or Word file to import</span>
              <span className="text-xs text-muted-foreground">
                Text-based PDF (.pdf) or Word (.docx) — a scanned image can&apos;t be read yet.
              </span>
              <input
                type="file" aria-label="Choose a PDF or Word file"
                accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <Button variant="outline" className="w-full" onClick={() => setPhase({ kind: 'paste' })}>
              <ClipboardPaste className="h-4 w-4" />
              Paste letter text
            </Button>
          </div>
        )}

        {phase.kind === 'paste' && (
          <>
            <div className="space-y-2">
              <label htmlFor="import-letter-text" className="text-sm font-medium">
                Paste letter text
              </label>
              <p id="import-letter-text-help" className="text-xs text-muted-foreground">
                Paste the full letter, including headings, references, body paragraphs, and signature.
                Only the text is imported; fonts, images, and page layout are not preserved.
              </p>
              <Textarea
                id="import-letter-text"
                autoFocus
                value={letterText}
                onChange={(e) => {
                  setLetterText(e.target.value);
                  if (phase.message) setPhase({ kind: 'paste' });
                }}
                aria-describedby={`import-letter-text-help${phase.message ? ' import-letter-text-error' : ''}`}
                aria-invalid={Boolean(phase.message)}
                placeholder={'From: …\nTo: …\nSubj: …\n\n1. …'}
                className="h-64 field-sizing-fixed resize-y"
              />
              {phase.message && (
                <p id="import-letter-text-error" role="alert" className="text-sm text-warning">
                  {phase.message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPhase({ kind: 'idle' })}>
                Back
              </Button>
              <Button onClick={handleText} disabled={!letterText.trim()}>
                Read letter
              </Button>
            </DialogFooter>
          </>
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
            <Button variant="outline" size="sm" onClick={() => setPhase({ kind: phase.source === 'text' ? 'paste' : 'idle' })}>
              {phase.source === 'text' ? 'Edit pasted text' : 'Choose a different file'}
            </Button>
          </div>
        )}

        {phase.kind === 'review' && (
          <ReviewBody
            result={phase.result}
            backLabel={phase.source === 'text' ? 'Edit pasted text' : 'Choose a different file'}
            onBack={() => setPhase({ kind: phase.source === 'text' ? 'paste' : 'idle' })}
            onImport={(docType) => doImport(phase.result, docType, phase.source)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewBody({
  result,
  backLabel,
  onBack,
  onImport,
}: {
  result: ParsedImport;
  backLabel: string;
  onBack: () => void;
  onImport: (docType: string) => void;
}) {
  const { parsed, detection, classification } = result;
  const [docType, setDocType] = useState(detection.docType);
  const lowConfidence = detection.confidence === 'low';
  // Surface a classification marking when one was read from the source, and
  // treat anything above Unclassified as needing the drafter's eye.
  const classified = classification.found && classification.classLevel !== 'unclassified';

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
        <Row
          label="Classification"
          value={classification.found ? CLASSIFICATION_LABELS[classification.classLevel] : undefined}
        />
        <Row label="Classified by" value={classification.classifiedBy} />
        <Row label="Derived from" value={classification.derivedFrom} />
        <Row label="Declassify on" value={classification.declassifyOn} />
      </div>

      {parsed.paragraphs.length === 0 && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          No body paragraphs were recognized. Check the source text and paragraph numbers before importing.
        </p>
      )}

      {/* Classification is safety-critical: when the source was marked, call it
          out explicitly and note that the drafter still owns the marking. */}
      {classification.found && (
        <p
          className={`flex items-start gap-1.5 text-xs ${classified ? 'text-warning' : 'text-muted-foreground'}`}
        >
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {classification.reason}
          {classified && ' It carries into the Classification section — verify it there before you export.'}
        </p>
      )}

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
          {backLabel}
        </Button>
        <Button onClick={() => onImport(docType)}>Import into editor</Button>
      </DialogFooter>
    </>
  );
}
