import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { triggerDownload } from '@/lib/encoding';
import {
  EMPTY_GENADMIN_DRAFT,
  GENADMIN_FORMAT_SOURCE,
  GENADMIN_LIMITS,
  prepareGenadmin,
  type GenadminDraft,
} from '@/services/messages/genadmin';

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState(EMPTY_GENADMIN_DRAFT);
  const [reviewed, setReviewed] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const prefix = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const result = prepareGenadmin(draft);

  function field(name: Field, label: string, options: FieldOptions = {}) {
    const id = prefix + '-' + name;
    const error = reviewed ? result.issues?.[name] : undefined;
    const props = {
      id,
      name,
      value: draft[name],
      placeholder: options.placeholder,
      maxLength: name === 'remarks' ? GENADMIN_LIMITS.remarks
        : options.rows ? GENADMIN_LIMITS.list : GENADMIN_LIMITS.line,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-3xl"
        onOpenAutoFocus={event => {
          event.preventDefault();
          title.current?.focus();
        }}
      >
        <DialogHeader className="pr-9 text-left">
          <DialogTitle ref={title} tabIndex={-1}>AMHS message draft</DialogTitle>
          <DialogDescription>Prepare an unclassified GENADMIN for review by your message center. This draft stays in the current tab until you reload or close it.</DialogDescription>
        </DialogHeader>
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
              {field('contactDetails', 'Phone or email', { help: 'Enter a phone number, DSN number, or email address.' })}
            </div>
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
            <Button type="submit"><Download aria-hidden="true" />Download text</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
