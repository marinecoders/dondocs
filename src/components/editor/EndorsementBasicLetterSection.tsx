import { useCallback, useMemo, useState } from 'react';
import { FileStack, Search, Upload, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { persistAttachment } from '@/lib/attachments';
import { validateBasicLetter } from '@/services/pdf/assembleEndorsement';
import { formatFileSize } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore, searchableText, type DocumentMeta } from '@/stores/documentsStore';
import { docTypeChip } from '@/types/document';
import {
  composeBasicLetterId,
  continuationEnclosureNumber,
  continuationReferenceLetter,
  enclosureStartNumber,
  referenceStartIndex,
} from '@/lib/endorsement';

/** The basic letter's routing, surfaced read-only so the user can fill the
 *  endorsement's own From/To/Via chain by hand — we never guess the chain. */
interface AppliedSource {
  title: string;
  from: string;
  to: string;
  via: string;
  /** Continuation actually applied ('' / null when the source adds none or
   *  the user had already supplied a start). */
  refStart: string;
  enclStart: number | null;
}

/** The applied-summary sentence for the sequence continuation, '' when the
 *  source added nothing (Ch 9 ¶3-4: never repeat, continue instead). */
function continuationSummary(applied: AppliedSource): string {
  const parts = [
    applied.refStart ? `references continue at (${applied.refStart})` : '',
    applied.enclStart != null ? `enclosures at (${applied.enclStart})` : '',
  ].filter(Boolean);
  return parts.length > 0
    ? ` Its references and enclosures are not repeated (Ch 9) — ${parts.join(' and ')}.`
    : '';
}

/**
 * Basic Letter section — endorsement doc types only. The ordinal + basic-letter
 * identifier together produce the endorsement line per SECNAV M-5216.5 Ch 9
 * §2.1.b: "[ORDINAL] ENDORSEMENT on [basic letter id]". Also lets the user base
 * the endorsement on a saved correspondence document: it composes the
 * basic-letter id, carries the subject forward, and points the continuation
 * fields just past the source's references and enclosures (Ch 9 ¶3-4 forbid
 * repeating them), while leaving the endorsement's own From/To/Via to the user
 * (that's routing judgment, not something to infer).
 */
export function EndorsementBasicLetterSection() {
  const { formData, setField } = useDocumentStore();
  const docType = useDocumentStore((s) => s.docType);
  // Assembly puts the endorsement on its own page after the letter — a new-page
  // endorsement. A same-page endorsement sits on the letter's signature page, so
  // uploading a letter to assemble only makes sense for new-page.
  const isNewPage = docType === 'new_page_endorsement';
  const docs = useDocumentsStore((s) => s.docs);
  const currentId = useDocumentsStore((s) => s.currentId);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState<AppliedSource | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Correspondence documents (never this one, never forms), newest first.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(docs)
      .filter((d) => d.meta.id !== currentId && d.session.documentCategory !== 'forms')
      .filter((d) => (q ? searchableText(d).includes(q) : true))
      .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  }, [docs, currentId, query]);

  const applyBasicLetter = (meta: DocumentMeta) => {
    const source = docs[meta.id];
    if (!source) return;
    const s = source.session;
    const fd = s.formData ?? {};
    const ds = useDocumentStore.getState();

    // 1. Compose the basic-letter identifier — the whole point (always replace).
    setField('basicLetterId', composeBasicLetterId(s));

    // 2. Carry the subject forward, but never clobber a subject already typed.
    const currentSubject = (ds.formData.subject ?? '').trim();
    const sourceSubject = (fd.subject ?? '').trim();
    if (sourceSubject && (!currentSubject || /^\[.*\]$/.test(currentSubject))) {
      setField('subject', sourceSubject);
    }

    // 3. Never copy the source's references or enclosures — Ch 9 ¶3: "Do not
    //    repeat a reference in the reference line of your endorsement that has
    //    already been identified in the reference line of the basic letter"
    //    (¶4 says the same for enclosures). The endorsement CONTINUES the
    //    sequences instead, so point the continuation fields just past the
    //    source's last item — unless the user already supplied a start.
    const refStart = continuationReferenceLetter(
      (s.references ?? []).filter((r) => (r.title ?? '').trim()).length,
      referenceStartIndex(s.docType, fd.startingReferenceLetter)
    );
    const applyRefStart = !!refStart && !(ds.formData.startingReferenceLetter ?? '').trim();
    if (applyRefStart) setField('startingReferenceLetter', refStart);

    const enclStart = continuationEnclosureNumber(
      (s.enclosures ?? []).filter((e) => (e.title ?? '').trim()).length,
      enclosureStartNumber(s.docType, fd.startingEnclosureNumber)
    );
    const applyEnclStart = enclStart != null && ds.formData.startingEnclosureNumber == null;
    if (applyEnclStart) setField('startingEnclosureNumber', enclStart);

    // 4. Record the basic letter's routing as read-only context.
    setApplied({
      title: meta.title,
      from: (fd.from ?? '').trim(),
      to: (fd.to ?? '').trim(),
      via: (fd.via ?? '').trim().split('\n').filter(Boolean).join(' → '),
      refStart: applyRefStart ? refStart : '',
      enclStart: applyEnclStart ? enclStart : null,
    });
    setPickerOpen(false);
    setQuery('');
  };

  // Upload the basic letter's PDF so the export can assemble it ahead of the
  // endorsement (Ch 9 — the endorsement continues the letter's page numbers).
  // Bytes go to the attachments store — survive a reload, ride along in a
  // backup — and only the fileRef is serialized.
  const handleBasicLetterFile = useCallback(
    async (file: File) => {
      const data = await file.arrayBuffer();
      // Validate before storing anything: a corrupt or encrypted PDF rejected
      // here gets feedback next to the control, instead of persisting bad bytes
      // that the preview silently skips and only the export reports.
      const check = await validateBasicLetter(data);
      if (!check.ok) {
        setUploadError(check.error);
        return;
      }
      setUploadError(null);
      const fileRef = await persistAttachment(
        { name: file.name, size: file.size, type: file.type },
        data
      );
      setField('basicLetterFile', { name: file.name, size: file.size, data });
      setField('basicLetterFileRef', fileRef);
      // The endorsement continues the letter's page sequence (Ch 9, Fig 9-2:
      // "Number each page of your endorsement and continue the sequence of
      // numbers from ... the basic letter"). The page count is in hand, so
      // default "First page number" from it — but never clobber a value the
      // user already set. Numbering must also actually print for the
      // continuation to exist, so a 'none' style steps up to 'simple'.
      const fd = useDocumentStore.getState().formData;
      if (!fd.startingPageNumber || fd.startingPageNumber <= 1) {
        setField('startingPageNumber', check.pageCount + 1);
        if (!fd.pageNumbering || fd.pageNumbering === 'none') {
          setField('pageNumbering', 'simple');
        }
      }
    },
    [setField]
  );

  const removeBasicLetterFile = useCallback(() => {
    setField('basicLetterFile', undefined);
    setField('basicLetterFileRef', undefined);
    setUploadError(null);
  }, [setField]);

  const basicLetterFile = formData.basicLetterFile;

  return (
    <Accordion type="single" collapsible defaultValue="basic">
      <AccordionItem value="basic">
        <AccordionTrigger>Basic Letter</AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-2">
            {/* Upload the basic letter's PDF — the UPLOAD affordance is new-page
                only, since assembly puts the endorsement on its own page after
                the letter (Ch 9). But an already-attached file always shows its
                chip: hiding it on a doc-type switch left an invisible,
                unremovable attachment. */}
            {(isNewPage || basicLetterFile) && (
            <div className="space-y-2">
              <Label>The basic letter (PDF)</Label>
              {basicLetterFile ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
                  <FileStack className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{basicLetterFile.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(basicLetterFile.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={removeBasicLetterFile}
                    aria-label="Remove basic-letter PDF"
                    className="shrink-0 rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border p-2 transition-colors hover:bg-secondary/30">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Upload the letter you&apos;re endorsing (optional)</span>
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleBasicLetterFile(file);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
              {uploadError && (
                <p role="alert" className="text-xs text-destructive">
                  Couldn&apos;t read that PDF: {uploadError}
                </p>
              )}
              {isNewPage ? (
                <p className="text-xs text-muted-foreground">
                  The pages get assembled ahead of your endorsement in the exported
                  PDF (SECNAV M-5216.5 Ch 9). PDF export only — the Word file
                  contains the endorsement alone.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A same-page endorsement doesn&apos;t use an uploaded letter — it is
                  typed onto the letter&apos;s own signature page. Switch to a
                  New-Page Endorsement to assemble this file, or remove it.
                </p>
              )}
            </div>
            )}

            {/* Autofill the metadata fields below from a saved DonDocs letter.
                This fills the ID / subject / references — it does not attach the
                letter's pages (that's what the PDF upload on a new-page
                endorsement is for). */}
            <div className="space-y-2">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <FileStack className="mr-2 h-4 w-4" />
                    Autofill from a saved letter…
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[22rem] p-0">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search your documents"
                      aria-label="Search documents to endorse"
                      className="w-full border-none bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <ul className="max-h-64 overflow-y-auto p-1">
                    {candidates.length === 0 ? (
                      <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                        {query ? 'No matching documents.' : 'No other documents to endorse yet.'}
                      </li>
                    ) : (
                      candidates.map((d) => (
                        <li key={d.meta.id}>
                          <button
                            type="button"
                            onClick={() => applyBasicLetter(d.meta)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >
                            <span className="inline-flex h-4 shrink-0 items-center justify-center rounded bg-muted px-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground" style={{ minWidth: '2.4rem' }}>
                              {docTypeChip(d.meta.docType)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{d.meta.title}</span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </PopoverContent>
              </Popover>

              {applied && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 font-medium text-foreground">
                      Based on <span className="text-primary">{applied.title}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setApplied(null)}
                      aria-label="Dismiss basic-letter summary"
                      className="shrink-0 rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Composed the basic-letter ID and carried the subject forward.
                    {continuationSummary(applied)}
                  </p>
                  {(applied.from || applied.to || applied.via) && (
                    <div className="mt-2 space-y-0.5 text-muted-foreground">
                      <p className="font-medium text-foreground/80">Its routing (fill your endorsement&apos;s From/To/Via to match):</p>
                      {applied.from && <p className="truncate">From: {applied.from}</p>}
                      {applied.to && <p className="truncate">To: {applied.to}</p>}
                      {applied.via && <p className="truncate">Via: {applied.via}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="endorsementOrdinal">
                Endorsement Number <span className="text-destructive">*</span>
              </Label>
              <Select
                value={formData.endorsementOrdinal || ''}
                onValueChange={(v) => setField('endorsementOrdinal', v)}
              >
                <SelectTrigger id="endorsementOrdinal" className="w-full">
                  <SelectValue placeholder="Select position in routing chain…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIRST">FIRST</SelectItem>
                  <SelectItem value="SECOND">SECOND</SelectItem>
                  <SelectItem value="THIRD">THIRD</SelectItem>
                  <SelectItem value="FOURTH">FOURTH</SelectItem>
                  <SelectItem value="FIFTH">FIFTH</SelectItem>
                  <SelectItem value="SIXTH">SIXTH</SelectItem>
                  <SelectItem value="SEVENTH">SEVENTH</SelectItem>
                  <SelectItem value="EIGHTH">EIGHTH</SelectItem>
                  <SelectItem value="NINTH">NINTH</SelectItem>
                  <SelectItem value="TENTH">TENTH</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pick this endorsement&apos;s position in the routing chain. Per SECNAV
                M-5216.5 Ch 9 §2.1.b: number each endorsement in the sequence in
                which it is added to the basic letter (1st added = FIRST, 2nd =
                SECOND, etc.).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="basicLetterId">
                Basic Letter ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="basicLetterId"
                value={formData.basicLetterId || ''}
                onChange={(e) => setField('basicLetterId', e.target.value)}
                placeholder="e.g., USS SCRANTON ltr 3000 Ser SSN 756/001 of 5 May 96"
              />
              <p className="text-xs text-muted-foreground">
                Identifies the document this endorses. Use reference-line style:
                [activity] [letter type] [SSIC] Ser [N/N] of [date].
              </p>
            </div>

            {/* Sequence continuation. An endorsement carries on the basic
                letter's sequences instead of opening its own — reference
                letters (Ch 9 ¶3), enclosure numbers (Ch 9 ¶4), page numbers
                (Fig 9-2 ¶1) — but the basic letter is a separate document
                DonDocs can't read, so the user supplies where this one picks
                up. */}
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1">
                <h4 className="text-sm font-medium">Continues from the basic letter</h4>
                <p className="text-xs text-muted-foreground">
                  An endorsement picks up where the basic letter left off — per SECNAV
                  M-5216.5 Ch 9 ¶3, if it ran to reference (f), this one starts at (g).
                  Leave these blank to start a fresh sequence.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="startingPageNumber">First page number</Label>
                  <Input
                    id="startingPageNumber"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={formData.startingPageNumber ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setField('startingPageNumber', v === '' ? 1 : Math.max(1, Number(v) || 1));
                    }}
                    placeholder="1"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="startingReferenceLetter">First reference</Label>
                  <Input
                    id="startingReferenceLetter"
                    value={formData.startingReferenceLetter || ''}
                    onChange={(e) => setField('startingReferenceLetter', e.target.value.trim().toLowerCase())}
                    placeholder="a"
                    maxLength={1}
                    aria-describedby="startingReferenceLetter-hint"
                  />
                  <p id="startingReferenceLetter-hint" className="sr-only">
                    A single letter, a through z.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="startingEnclosureNumber">First enclosure</Label>
                  <Input
                    id="startingEnclosureNumber"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={formData.startingEnclosureNumber ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setField(
                        'startingEnclosureNumber',
                        v === '' ? undefined : Math.max(1, Number(v) || 1)
                      );
                    }}
                    placeholder="1"
                  />
                </div>
              </div>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
