import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ReviewRound } from '@/lib/reviewRounds';
import type { FeedbackCategory } from '@/lib/reviewFeedback';
import { captureTextRange, resolveTextRange } from '@/lib/reviewTextRanges';
import { createSelectedTextSuggestion, type ReviewSuggestion } from '@/lib/reviewSuggestions';
import { editReviewTypingDraft, emptyReviewTypingDraft, typingChangeKind, typingDeletion, plainTypingText } from '@/lib/reviewTypingDraft';
import type { SerializedSession } from '@/stores/documentStore';

export function ReviewTypingEditor({ round, current, author, category, disabled, quotaFull, onCreate, onDirtyChange }: {
  round: ReviewRound; current: SerializedSession; author: string; category: FeedbackCategory; disabled: boolean; quotaFull: boolean;
  onCreate: (proposal: ReviewSuggestion) => Promise<boolean>; onDirtyChange: (dirty: boolean) => void;
}) {
  const prefix = useId(), input = useRef<HTMLTextAreaElement>(null);
  const [paragraphId, setParagraphId] = useState('');
  const [draft, setDraft] = useState(() => emptyReviewTypingDraft(''));
  const [text, setText] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false), [composing, setComposing] = useState(false);
  const working = useRef(false), alive = useRef(true), composition = useRef<{ start: number; end: number } | null>(null);
  const selection = useRef({ start: 0, end: 0 });
  const restore = useRef<{ start: number; end: number } | null>(null);
  const kind = typingChangeKind(draft), dirty = !!kind || composing;
  const locked = disabled || saving;
  const target = paragraphId ? captureTextRange(round.baseline.session, paragraphId, 0, draft.baseline.length, { allowCaret: true }) : null;
  const stale = !!target && resolveTextRange(current, target).status !== 'current';
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange(dirty);return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => { if (restore.current && input.current) { input.current.setSelectionRange(restore.current.start, restore.current.end);selection.current = restore.current;restore.current = null; } });
  function remember() { if (input.current) selection.current = { start: input.current.selectionStart, end: input.current.selectionEnd }; }
  function edit(start: number, end: number, insert: string) {
    try {
      const next = editReviewTypingDraft(draft, start, end, insert);
      setDraft(next);setText(next.text);setError('');setNotice('');
      restore.current = { start: start + insert.length, end: start + insert.length };
    } catch (cause) {
      setText(draft.text);if (input.current) input.current.value = draft.text;
      restore.current = { start, end };setError((cause as Error).message);
    }
  }
  // Native beforeinput also covers mobile deletion and input methods without keydown.
  useEffect(() => {
    const element = input.current;if (!element) return;
    function before(event: InputEvent) {
      if (composition.current || event.isComposing) return;
      remember();
      if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') {
        event.preventDefault();const span = typingDeletion(draft.text, element!.selectionStart, element!.selectionEnd, event.inputType.endsWith('Backward'));
        edit(span.start, span.end, '');
      } else if (event.inputType && !['insertText', 'insertFromPaste', 'insertReplacementText', 'deleteByCut', 'insertCompositionText', 'insertFromComposition'].includes(event.inputType)) {
        event.preventDefault();setError('This operation is unsupported in Suggest Changes mode. Use plain typing, paste, Backspace or Delete; save or cancel before other editing.');
      }
    }
    element.addEventListener('beforeinput', before);
    return () => element.removeEventListener('beforeinput', before);
  });
  async function save() {
    if (locked || quotaFull || working.current || !kind || composing || stale) return;
    working.current = true;setSaving(true);setError('');setNotice('');
    try {
      const proposal = createSelectedTextSuggestion(round, { author, category, paragraphId, start: draft.start, end: draft.end,
        proposed: draft.proposed, label: `${kind} from typed changes` });
      if (await onCreate(proposal) && alive.current) {
        setDraft(emptyReviewTypingDraft(draft.baseline));setText(draft.baseline);setNotice('Typed suggestion submitted. The reviewed baseline is unchanged.');
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'The typed suggestion could not be saved.'); }
    finally { working.current = false;if (alive.current) setSaving(false); }
  }
  return <section aria-label="Suggest Changes editor" className="space-y-2">
    <p className="text-sm">Type in the reviewed paragraph below. Changes stay in this unsaved editor until you save one suggestion. The document and reviewed baseline stay unchanged.</p>
    <p className="text-xs text-muted-foreground">Plain native paragraphs only. Variables, formatting, line breaks and structures are unavailable. Separate edits are saved as one replacement of the entire displayed span. Save or cancel before closing this review.</p>
    <Label htmlFor={`${prefix}-paragraph`}>Paragraph for suggested typing</Label>
    <select id={`${prefix}-paragraph`} className="w-full rounded-md border bg-background p-2 text-sm" value={paragraphId} disabled={locked || quotaFull || dirty} onChange={event => {
      const id = event.target.value, value = round.baseline.session.paragraphs.find(item => item.id === id)?.text ?? '';
      setParagraphId(id);setDraft(emptyReviewTypingDraft(value));setText(value);setError('');setNotice('');
    }}>
      <option value="">Choose a reviewed paragraph</option>
      {round.baseline.session.paragraphs.map((paragraph, index) => {
        const supported = !!paragraph.id && plainTypingText(paragraph.text) && !!captureTextRange(round.baseline.session, paragraph.id, 0, paragraph.text.length, { allowCaret: true });
        return <option key={`${paragraph.id}:${index}`} value={paragraph.id ?? ''} disabled={!supported}>Paragraph {index + 1}{supported ? '' : ' (unsupported content)'}</option>;
      })}
    </select>
    {paragraphId && <>
      <Label htmlFor={`${prefix}-text`}>Suggested paragraph text</Label>
      <Textarea id={`${prefix}-text`} ref={input} value={text} disabled={locked || quotaFull || stale} rows={5} onSelect={remember} onFocus={remember}
        onKeyDown={event => {
          remember();if (composition.current || event.nativeEvent.isComposing) return;
          if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();if (event.ctrlKey || event.metaKey || event.altKey) { setError('Word deletion is unsupported. Select complete text and delete it.');return; }
            const span = typingDeletion(draft.text, selection.current.start, selection.current.end, event.key === 'Backspace');edit(span.start, span.end, '');
          } else if (event.key === 'Enter') {
            event.preventDefault();setError('Line breaks and structural edits are unsupported. The last valid suggested text is retained.');
          }
        }}
        onPaste={event => {
          event.preventDefault();
          if (event.clipboardData.types?.includes('text/html') && event.clipboardData.getData('text/html')) {
            setError('Formatted paste is unsupported. Paste plain text instead; the last valid suggested text is retained.');return;
          }
          remember();edit(selection.current.start, selection.current.end, event.clipboardData.getData('text/plain'));
        }}
        onDrop={event => { event.preventDefault();setError('Drag and drop is unsupported. Paste plain text at the caret instead.'); }}
        onCompositionStart={() => { remember();composition.current = { ...selection.current };setComposing(true); }}
        onCompositionEnd={event => {
          const span = composition.current;composition.current = null;setComposing(false);
          if (!span) return;
          const value = event.currentTarget.value, length = value.length - (draft.text.length - (span.end - span.start));
          if (length < 0 || !value.startsWith(draft.text.slice(0, span.start)) || !value.endsWith(draft.text.slice(span.end))) {
            setText(draft.text);setError('The input method changed text outside its selection. The last valid suggested text is retained.');return;
          }
          edit(span.start, span.end, value.slice(span.start, span.start + length));
        }}
        onChange={event => {
          const value = event.target.value;if (composition.current) { setText(value);return; }
          if (value === draft.text) return;
          const { start, end } = selection.current, length = value.length - (draft.text.length - (end - start));
          if (length < 0 || !value.startsWith(draft.text.slice(0, start)) || !value.endsWith(draft.text.slice(end))) {
            event.target.value = draft.text;setText(draft.text);setError('This input could not be located exactly. The last valid suggested text is retained. Select text or place the caret and retry.');return;
          }
          edit(start, end, value.slice(start, start + length));
        }} />
      {stale && <p role="alert" className="text-sm text-destructive">The current paragraph differs from the reviewed baseline. Cancel these typed changes; start a new review to suggest typing against the newer text.</p>}
      <p role="status" className="text-sm">{composing ? 'Composing unsaved suggested changes…' : kind ? `Unsaved suggested changes · ${kind}` : 'No unsaved suggested changes.'}</p>
      {kind && <div role="region" aria-label="Typed change comparison" tabIndex={0} className="space-y-2 rounded-md border p-2 text-sm whitespace-pre-wrap break-words">
        <p>Exact reviewed span ({draft.start}–{draft.end}): <del>{draft.baseline.slice(draft.start, draft.end) || '(Caret insertion)'}</del></p>
        <p>Proposed: <ins>{draft.proposed || '(Delete this span)'}</ins></p>
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={locked || quotaFull || !kind || !author.trim() || composing || stale} onClick={() => void save()}>Save typed suggestion</Button>
        <Button type="button" variant="outline" disabled={locked || composing || !kind} onClick={() => { setDraft(emptyReviewTypingDraft(draft.baseline));setText(draft.baseline);setError('');setNotice('Typed changes cancelled.'); }}>Cancel typed changes</Button>
      </div>
    </>}
    {quotaFull && <p role="alert" className="text-sm text-destructive">This review has reached its suggestion limit. Existing typed changes can be cancelled.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
