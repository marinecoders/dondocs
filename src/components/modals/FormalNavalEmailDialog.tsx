import { useId, useRef, useState, type ChangeEvent } from 'react';
import { flushSync } from 'react-dom';
import { Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { triggerDownload } from '@/lib/encoding';
import {
  EMPTY_FORMAL_EMAIL,
  FORMAL_EMAIL_LIMITS,
  FORMAL_EMAIL_MANUAL,
  prepareFormalNavalEmail,
  type FormalNavalEmailDraft,
} from '@/services/messages/formalNavalEmail';

type Field = keyof FormalNavalEmailDraft;
type Delivery = 'copy' | 'download';

export default function FormalNavalEmailDialog({ open, onOpenChange, onCloseAutoFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [draft, setDraft] = useState(EMPTY_FORMAL_EMAIL);
  const [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState('');
  const prefix = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const preview = useRef<HTMLTextAreaElement>(null);
  const deliveryAttempt = useRef(0);
  const { text, issues } = prepareFormalNavalEmail(draft);

  function field(name: Field, label: string, { placeholder, rows, help }: {
    placeholder?: string; rows?: number; help?: string;
  } = {}) {
    const id = `${prefix}-${name}`;
    const error = reviewed ? issues[name] : undefined;
    const props = {
      id, name, placeholder, value: draft[name], required: name !== 'via',
      maxLength: name === 'letterhead' || name === 'body' ? FORMAL_EMAIL_LIMITS[name] : FORMAL_EMAIL_LIMITS.line,
      'aria-invalid': Boolean(error),
      'aria-describedby': [help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(' ') || undefined,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const value = event.currentTarget.value;
        deliveryAttempt.current++;
        setNotice('');
        setDraft(current => ({ ...current, [name]: value }));
      },
    };
    return (
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        {rows ? <Textarea {...props} rows={rows} className="field-sizing-fixed" /> : <Input {...props} />}
        {help && <p id={`${id}-help`} className="text-xs text-muted-foreground">{help}</p>}
        {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  async function deliver(method: Delivery) {
    const attempt = ++deliveryAttempt.current;
    const firstError = Object.keys(issues)[0];
    setNotice('');
    if (firstError) {
      flushSync(() => setReviewed(true));
      const input = form.current?.elements.namedItem(firstError);
      if (input instanceof HTMLElement) input.focus();
      return;
    }

    if (method === 'download') {
      try {
        triggerDownload(new TextEncoder().encode(text), 'formal-naval-email.txt', 'text/plain;charset=utf-8');
      } catch {
        setNotice('The download could not start. Copy the email text or try again.');
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      if (attempt === deliveryAttempt.current) setNotice('Email text copied.');
    } catch {
      if (attempt !== deliveryAttempt.current) return;
      preview.current?.focus();
      preview.current?.select();
      setNotice('Automatic copying is unavailable. Copy the selected text or download it.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => {
      if (!next) {
        deliveryAttempt.current++;
        setNotice('');
      }
      onOpenChange(next);
    }}>
      <DialogContent className="sm:max-w-3xl" onCloseAutoFocus={onCloseAutoFocus} onOpenAutoFocus={event => {
        event.preventDefault();
        title.current?.focus();
      }}>
        <DialogHeader className="pr-9 text-left">
          <DialogTitle ref={title} tabIndex={-1}>Formal naval email</DialogTitle>
          <DialogDescription>Draft a formal email in naval-letter format. Your draft stays here until you reload or close the tab.</DialogDescription>
        </DialogHeader>
        <form ref={form} noValidate onSubmit={event => event.preventDefault()} className="min-w-0 space-y-4">
          {field('letterhead', 'Typed letterhead', { rows: 3, help: 'Enter the originating department, command and address as they appear on your letterhead.' })}
          <div className="grid gap-4 sm:grid-cols-3">
            {field('ssic', 'SSIC', { placeholder: '5216' })}
            {field('serial', 'Serial number', { placeholder: 'N7/010' })}
            {field('date', 'Date', { placeholder: '23 Nov 26' })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('from', 'From')}
            {field('to', 'To')}
            {field('via', 'Via (optional)')}
            {field('subject', 'Subject')}
          </div>
          {field('body', 'Body', { rows: 6, help: 'Use naval-letter paragraph numbering when required.' })}
          <div className="grid gap-4 sm:grid-cols-3">
            {field('closing', 'Complimentary closing', { placeholder: 'Respectfully,', help: 'Reserve abbreviations such as V/r for replies.' })}
            {field('signer', 'Signer name', { placeholder: 'A. B. EXAMPLE' })}
            {field('authority', 'Signature authority', { rows: 2, placeholder: 'By direction', help: 'Use the signer’s actual title, acting capacity or delegation.' })}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-preview`}>Email preview</Label>
            <Textarea ref={preview} id={`${prefix}-preview`} readOnly rows={8} className="field-sizing-fixed font-mono" value={text} />
          </div>
          <p className="text-xs text-muted-foreground">Follow your chain of command and release authority. Send from your authorized address, request a receipt if required, and retain a file copy of the email you send.</p>
          {reviewed && Object.keys(issues).length > 0 && <p role="alert" className="text-sm text-destructive">Complete the highlighted fields before copying or downloading.</p>}
          {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a href={FORMAL_EMAIL_MANUAL} target="_blank" rel="noreferrer" className="text-sm text-primary underline underline-offset-2">SECNAV M-5216.5, Chapter 4</a>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void deliver('download')}><Download aria-hidden="true" />Download text</Button>
              <Button type="button" onClick={() => void deliver('copy')}><Copy aria-hidden="true" />Copy email text</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
