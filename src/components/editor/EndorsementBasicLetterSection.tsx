import { useCallback, useMemo, useState } from 'react';
import { FileStack, Search, Upload, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { persistAttachment } from '@/lib/attachments';
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
import { composeBasicLetterId } from '@/lib/endorsement';

/** The basic letter's routing, surfaced read-only so the user can fill the
 *  endorsement's own From/To/Via chain by hand — we never guess the chain. */
interface AppliedSource {
  title: string;
  from: string;
  to: string;
  via: string;
  refs: number;
  encls: number;
}

/**
 * Basic Letter section — endorsement doc types only. The ordinal + basic-letter
 * identifier together produce the endorsement line per SECNAV M-5216.5 Ch 9
 * §2.1.b: "[ORDINAL] ENDORSEMENT on [basic letter id]". Also lets the user base
 * the endorsement on a saved correspondence document: it composes the
 * basic-letter id and carries the subject + references + enclosures forward,
 * while leaving the endorsement's own From/To/Via to the user (that's routing
 * judgment, not something to infer).
 */
export function EndorsementBasicLetterSection() {
  const { formData, setField } = useDocumentStore();
  const addReference = useDocumentStore((s) => s.addReference);
  const addEnclosure = useDocumentStore((s) => s.addEnclosure);
  const docs = useDocumentsStore((s) => s.docs);
  const currentId = useDocumentsStore((s) => s.currentId);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState<AppliedSource | null>(null);

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

    // 3. Merge references — carry the basic letter's forward, deduped by title,
    //    keeping any the endorser already added. (The store re-letters them.)
    const haveRefs = new Set(ds.references.map((r) => r.title.trim().toLowerCase()));
    for (const r of s.references ?? []) {
      const title = (r.title ?? '').trim();
      if (title && !haveRefs.has(title.toLowerCase())) {
        addReference(title, r.url);
        haveRefs.add(title.toLowerCase());
      }
    }

    // 4. Merge enclosure titles. Files aren't part of a saved session, so only
    //    the titles carry; the user re-attaches any files.
    const haveEncls = new Set(ds.enclosures.map((e) => e.title.trim().toLowerCase()));
    for (const e of s.enclosures ?? []) {
      const title = (e.title ?? '').trim();
      if (title && !haveEncls.has(title.toLowerCase())) {
        addEnclosure(title);
        haveEncls.add(title.toLowerCase());
      }
    }

    // 5. Record the basic letter's routing as read-only context.
    setApplied({
      title: meta.title,
      from: (fd.from ?? '').trim(),
      to: (fd.to ?? '').trim(),
      via: (fd.via ?? '').trim().split('\n').filter(Boolean).join(' → '),
      refs: (s.references ?? []).length,
      encls: (s.enclosures ?? []).length,
    });
    setPickerOpen(false);
    setQuery('');
  };

  // Upload the basic letter's PDF so the export can assemble it ahead of the
  // endorsement (Ch 9 Fig 9-3). Bytes go to the attachments store — survive a
  // reload, ride along in a backup — and only the fileRef is serialized.
  const handleBasicLetterFile = useCallback(
    async (file: File) => {
      const data = await file.arrayBuffer();
      const fileRef = await persistAttachment(
        { name: file.name, size: file.size, type: file.type },
        data
      );
      setField('basicLetterFile', { name: file.name, size: file.size, data });
      setField('basicLetterFileRef', fileRef);
    },
    [setField]
  );

  const removeBasicLetterFile = useCallback(() => {
    setField('basicLetterFile', undefined);
    setField('basicLetterFileRef', undefined);
  }, [setField]);

  const basicLetterFile = formData.basicLetterFile;

  return (
    <Accordion type="single" collapsible defaultValue="basic">
      <AccordionItem value="basic">
        <AccordionTrigger>Basic Letter</AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-2">
            {/* Upload the basic letter's PDF. On export DonDocs assembles it
                ahead of the endorsement (Ch 9 Fig 9-3, new-page assembly). */}
            <div className="space-y-2">
              <Label>Basic letter PDF</Label>
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
              <p className="text-xs text-muted-foreground">
                Assembled ahead of your endorsement in the exported PDF (SECNAV
                M-5216.5 Ch 9, Fig 9-3). PDF export only — the Word file contains
                the endorsement alone.
              </p>
            </div>

            {/* Base this endorsement on a saved correspondence document. */}
            <div className="space-y-2">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <FileStack className="mr-2 h-4 w-4" />
                    Base on a saved letter…
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
                    Composed the basic-letter ID and carried the subject
                    {applied.refs > 0 ? `, ${applied.refs} reference${applied.refs === 1 ? '' : 's'}` : ''}
                    {applied.encls > 0 ? `, and ${applied.encls} enclosure${applied.encls === 1 ? '' : 's'}` : ''}
                    {' '}forward.
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
                letter's numbering instead of opening its own (Ch 9 ¶3), but the
                basic letter is a separate document DonDocs can't read — so the
                user supplies where this one picks up. */}
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
