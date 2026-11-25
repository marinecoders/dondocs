import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Download } from 'lucide-react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { triggerDownload } from '@/lib/encoding';
import {
  EMPTY_GENADMIN_DRAFT,
  GENADMIN_FORMAT_SOURCE,
  prepareGenadmin,
  type GenadminDraft,
} from '@/services/messages/genadmin';
import { genadminDraftFieldLimit, readGenadminDraft, writeGenadminDraft } from '@/services/messages/genadminDraftStorage';

type Field = keyof GenadminDraft;

interface FieldOptions {
  optional?: boolean;
  rows?: number;
  help?: string;
  placeholder?: string;
}

export default function AmhsMessageDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [saved, setSaved] = useState(readGenadminDraft);
  const [draft, setDraft] = useState(saved.draft);
  const [draftPrompt, setDraftPrompt] = useState<'close' | 'discard' | null>(null);
  const [storageError, setStorageError] = useState('');
  const [storageBusy, setStorageBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const prefix = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const result = prepareGenadmin(draft);

  const hasContent = Object.values(draft).some(value => value.length > 0);
  const unreadable = saved.raw !== null && saved.draft === EMPTY_GENADMIN_DRAFT;
  const dirty = (Object.keys(draft) as Field[]).some(field => saved.draft[field] !== draft[field]);
  useEffect(() => {
    if (!open || !dirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [open, dirty]);

  useEffect(() => {
    if (!open || dirty || storageBusy) return;
    let current = true;
    const refresh = () => {
      if (!current) return;
      const latest = readGenadminDraft();
      if (latest.raw === saved.raw) return;
      setSaved(latest);
      setDraft(latest.draft);
    };
    queueMicrotask(refresh);
    window.addEventListener('storage', refresh);
    return () => {
      current = false;
      window.removeEventListener('storage', refresh);
    };
  }, [open, dirty, storageBusy, saved.raw]);

  function changeOpen(nextOpen: boolean) {
    if (storageBusy) return;
    setStorageError('');
    if (!nextOpen && dirty) {
      setDraftPrompt('close');
      return;
    }
    onOpenChange(nextOpen);
  }

  async function saveDraft() {
    setStorageBusy(true);
    try {
      setSaved(await writeGenadminDraft(saved, hasContent ? draft : null));
      if (draftPrompt === 'close') onOpenChange(false);
      setDraftPrompt(null);
      setStorageError('');
    } catch (error) {
      setStorageError(error instanceof Error && !(error instanceof DOMException)
        ? error.message : 'The draft could not be saved in this browser.');
    } finally {
      setStorageBusy(false);
    }
  }

  async function discardDraft() {
    if (draftPrompt === 'close') {
      setDraft(saved.draft);
      onOpenChange(false);
    } else {
      setStorageBusy(true);
      try {
        if (saved.raw !== null) setSaved(await writeGenadminDraft(saved, null));
      } catch (error) {
        setStorageError(error instanceof Error && !(error instanceof DOMException)
          ? error.message : 'The saved draft could not be removed in this browser.');
        return;
      } finally {
        setStorageBusy(false);
      }
      if (!unreadable) setDraft(EMPTY_GENADMIN_DRAFT);
    }
    setReviewed(false);
    setDownloadError(false);
    setStorageError('');
    setDraftPrompt(null);
  }

  function field(name: Field, label: string, options: FieldOptions = {}) {
    const id = prefix + '-' + name;
    const error = reviewed ? result.issues?.[name] : undefined;
    const props = {
      id,
      name,
      value: draft[name],
      placeholder: options.placeholder,
      maxLength: genadminDraftFieldLimit(name),
      disabled: storageBusy,
      required: !options.optional,
      'aria-invalid': !!error,
      'aria-describedby': [options.help && id + '-help', error && id + '-error'].filter(Boolean).join(' ') || undefined,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { value } = event.currentTarget;
        setDraft(current => ({ ...current, [name]: value }));
        setDownloadError(false);
      },
    };
    return (
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        {options.help && <p id={id + '-help'} className="text-xs text-muted-foreground">{options.help}</p>}
        {options.rows ? <Textarea {...props} rows={options.rows} className="field-sizing-fixed" /> : <Input {...props} />}
        {error && <p id={id + '-error'} className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDownloadError(false);
    if (result.issues) {
      flushSync(() => setReviewed(true));
      const first = event.currentTarget.elements.namedItem(Object.keys(result.issues)[0]);
      if (first instanceof HTMLElement) {
        const details = first.closest('details');
        if (details) details.open = true;
        first.focus();
      }
      return;
    }
    try {
      triggerDownload(new TextEncoder().encode(result.text), 'genadmin-draft.txt', 'text/plain;charset=utf-8');
    } catch {
      setDownloadError(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        className="sm:max-w-3xl"
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={event => {
          event.preventDefault();
          title.current?.focus();
        }}
      >
        <DialogHeader className="pr-9 text-left">
          <DialogTitle ref={title} tabIndex={-1}>AMHS message draft</DialogTitle>
          <DialogDescription>Prepare an unclassified GENADMIN for review by your message center. Save draft keeps one unfinished message in this browser. It is stored separately from your correspondence and workspace backups.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
          <p role="status" className="text-sm text-muted-foreground">
            {storageBusy ? 'Updating local draft…'
              : dirty ? 'Unsaved changes'
              : saved.raw === null ? 'No local draft saved'
              : unreadable ? 'Saved draft could not be read'
              : 'Saved in this browser'}
          </p>
          {storageError && !draftPrompt && <p role="alert" className="basis-full text-sm text-destructive">{storageError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={storageBusy || !dirty} onClick={() => void saveDraft()}>Save draft</Button>
            <Button type="button" variant="ghost" disabled={storageBusy || (!hasContent && saved.raw === null)} onClick={() => {
              setStorageError('');
              setDraftPrompt('discard');
            }}>{unreadable ? 'Discard saved copy' : 'Discard draft'}</Button>
          </div>
        </div>
        <form noValidate onSubmit={download} className="min-w-0 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field('from', 'From address', { help: 'Use the command’s plain-language address.' })}
            {field('to', 'To addresses', { rows: 2, help: 'One action addressee per line.' })}
            {field('info', 'Info addresses (optional)', { optional: true, rows: 2, help: 'One information addressee per line.' })}
            <div className="space-y-4">
              {field('ssic', 'SSIC', { placeholder: '05420' })}
              {field('month', 'Message month', { placeholder: 'APR' })}
            </div>
            {field('originator', 'Message originator')}
            {field('office', 'Originator office code')}
          </div>
          {field('subject', 'Subject')}
          <fieldset className="min-w-0 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Point of contact</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('contactName', 'Name')}
              {field('contactRank', 'Rank or title')}
              {field('contactOffice', 'Contact office')}
              {field('contactDetails', 'Commercial phone', { optional: true })}
              {field('contactDsn', 'DSN number', { optional: true })}
              {field('contactEmail', 'Email address', { optional: true })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Provide at least one way to contact this person.</p>
          </fieldset>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">Office routing and references (optional)</summary>
            <div className="mt-3 space-y-4">
              {field('passTo', 'Pass to office codes', {
                optional: true, rows: 2, help: 'Enter a To or Info address, a vertical bar (|), then its office code, one per line.',
              })}
              {field('references', 'Document references', {
                optional: true, rows: 2, help: 'Enter a document title, a vertical bar (|), then its date (DDMMMYYYY), one per line.',
              })}
            </div>
          </details>
          {field('remarks', 'Remarks', { rows: 5, help: 'Use plain text. Paragraph breaks and sentence case are preserved.' })}
          <div className="space-y-1.5">
            <Label htmlFor={prefix + '-preview'}>Message preview</Label>
            <Textarea id={prefix + '-preview'} readOnly rows={6} className="field-sizing-fixed font-mono" value={result.text ?? ''} placeholder="Complete the fields to preview the message." />
          </div>
          {reviewed && result.issues && <p role="alert" className="text-sm text-destructive">Review the highlighted fields before downloading.</p>}
          {downloadError && <p role="alert" className="text-sm text-destructive">The download could not start. You can copy the preview or try again.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a href={GENADMIN_FORMAT_SOURCE} target="_blank" rel="noreferrer" className="text-sm text-primary underline underline-offset-2">Navy GENADMIN format example</a>
            <Button type="submit" disabled={storageBusy}><Download aria-hidden="true" />Download text</Button>
          </div>
        </form>
      </DialogContent>
      <AlertDialog open={draftPrompt !== null} onOpenChange={nextOpen => {
        if (!nextOpen && !storageBusy) { setDraftPrompt(null); setStorageError(''); }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{draftPrompt === 'close' ? 'Save this draft before closing?'
              : unreadable ? 'Discard the unreadable saved copy?' : 'Discard this message draft?'}</AlertDialogTitle>
            <AlertDialogDescription>{draftPrompt === 'close'
              ? 'Keep your edits in this browser or close without saving them.'
              : unreadable ? 'This removes the unreadable copy from this browser. You can then save your current edits.'
              : 'This clears the current message and removes its saved copy from this browser.'}</AlertDialogDescription>
          </AlertDialogHeader>
          {storageError && <p role="alert" className="text-sm text-destructive">{storageError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={storageBusy}>Keep editing</AlertDialogCancel>
            <Button variant="destructive" disabled={storageBusy} onClick={() => void discardDraft()}>{draftPrompt === 'close' ? 'Discard changes' : unreadable ? 'Discard saved copy' : 'Discard draft'}</Button>
            {draftPrompt === 'close' && <Button disabled={storageBusy} onClick={() => void saveDraft()}>Save and close</Button>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
