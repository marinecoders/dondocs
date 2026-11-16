import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ReviewRound } from '@/lib/reviewRounds';
import { createParagraphStructureSuggestion, type ReviewSuggestion } from '@/lib/reviewSuggestions';
import { captureReviewStructure, structureSuggestionText } from '@/lib/reviewStructureSuggestions';

export function ParagraphSplitJoinProposalsPanel({ round, disabled, quotaFull, onCreate }: {
  round: ReviewRound; disabled: boolean; quotaFull: boolean; onCreate: (proposal: ReviewSuggestion) => Promise<boolean>;
}) {
  const prefix = useId(), working = useRef(false);
  const [author, setAuthor] = useState(''), [mode, setMode] = useState<'split-paragraph' | 'join-paragraphs'>('split-paragraph');
  const [selected, setSelected] = useState(''), [splitAt, setSplitAt] = useState<number | null>(null), [separator, setSeparator] = useState<'' | ' '>(' ');
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const retry = useRef<{ key: string; proposal: ReviewSuggestion } | null>(null);
  const session = round.baseline.session, index = session.paragraphs.findIndex(paragraph => paragraph.id === selected), paragraph = session.paragraphs[index], next = session.paragraphs[index + 1];
  const operation = mode === 'split-paragraph' ? paragraph && splitAt !== null ? { kind: mode, paragraphId: selected, splitAt } : null
    : paragraph && next?.id ? { kind: mode, paragraphId: selected, nextParagraphId: next.id, separator } : null;
  let preview = '', unsupported = '';
  if (operation) try { preview = structureSuggestionText(captureReviewStructure(session, operation).operation.after); }
  catch (cause) { unsupported = cause instanceof Error ? cause.message : 'This paragraph change is unavailable.'; }
  const locked = disabled || pending;
  return <section aria-label="Paragraph split and join suggestions" className="min-w-0 space-y-2 rounded-md border p-3">
    <h4 className="text-sm font-medium">Propose a paragraph split or join</h4>
    <p className="text-xs text-muted-foreground">Balanced bold, italic and underline runs and whole variable chips are preserved. Existing spaces stay exactly as written. Child paragraphs stay with their current parent; choose leaf paragraphs. Legacy or complex formatting requires ordinary editing or a simpler new review.</p>
    <fieldset disabled={locked} className="min-w-0 space-y-2">
      <Label htmlFor={`${prefix}-author`}>Reviewer name for paragraph split or join</Label>
      <Input id={`${prefix}-author`} value={author} maxLength={100} onChange={event => setAuthor(event.target.value)} />
      <Label htmlFor={`${prefix}-mode`}>Paragraph operation</Label>
      <select id={`${prefix}-mode`} className="w-full rounded-md border bg-background p-2 text-sm" value={mode} onChange={event => { setMode(event.target.value as typeof mode);setSplitAt(null);setNotice(''); }}>
        <option value="split-paragraph">Split one paragraph</option><option value="join-paragraphs">Join two adjacent paragraphs</option>
      </select>
      <Label htmlFor={`${prefix}-paragraph`}>Paragraph to split or first paragraph to join</Label>
      <select id={`${prefix}-paragraph`} className="w-full rounded-md border bg-background p-2 text-sm" value={selected} onChange={event => { setSelected(event.target.value);setSplitAt(null);setNotice(''); }}>
        <option value="">Choose a reviewed paragraph</option>
        {session.paragraphs.map((item, position) => item.id && <option key={item.id} value={item.id}>Paragraph {position + 1}{item.header ? `: ${item.header}` : ''}</option>)}
      </select>
      {paragraph && mode === 'split-paragraph' && <>
        <Label htmlFor={`${prefix}-caret`}>Place the split in reviewed paragraph</Label>
        <p className="text-xs text-muted-foreground">Click or use the arrow keys to place a caret below. Formatting markers are shown so you can keep the split outside markers and variable chips.</p>
        <Textarea id={`${prefix}-caret`} readOnly value={paragraph.text} rows={4} onSelect={event => {
          const { selectionStart, selectionEnd } = event.currentTarget;setSplitAt(selectionStart === selectionEnd ? selectionStart : null);setNotice('');
        }} />
      </>}
      {paragraph && mode === 'join-paragraphs' && <>
        <p className="whitespace-pre-wrap break-words text-sm">Second selected paragraph: {next ? `Paragraph ${index + 2}: ${next.text}` : '(No adjacent paragraph)'}</p>
        <Label htmlFor={`${prefix}-separator`}>Space between joined paragraphs</Label>
        <select id={`${prefix}-separator`} value={separator} className="w-full rounded-md border bg-background p-2 text-sm" onChange={event => setSeparator(event.target.value as '' | ' ')}>
          <option value=" ">Add one space</option><option value="">Add no space</option>
        </select>
      </>}
      {unsupported && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{unsupported}</p>}
      {preview && <div className="space-y-1 text-sm"><p className="font-medium">Proposed paragraphs</p><p className="whitespace-pre-wrap break-words">{preview}</p></div>}
      <p className="text-xs text-muted-foreground">Discussion IDs and original quotes remain. Selected text wholly inside a known destination follows it; crossing or ambiguous selections detach with their context. Whole-paragraph discussions keep their original scope and may show changed or unavailable context. A split keeps the heading and reference label on the first paragraph.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-auto min-h-9 whitespace-normal text-left" disabled={!author.trim() || !operation || !!unsupported || quotaFull} onClick={() => void (async () => {
          if (!operation || working.current) return;
          working.current = true;setPending(true);setError('');setNotice('');
          try {
            const key = JSON.stringify({ operation, author, roundId: round.id });
            const proposal = retry.current?.key === key ? retry.current.proposal : createParagraphStructureSuggestion(round, { author, category: 'edit', operation });
            retry.current = { key, proposal };
            if (await onCreate(proposal)) { retry.current = null;setSelected('');setSplitAt(null);setNotice('Paragraph suggestion submitted. The reviewed baseline is unchanged.'); }
          } catch (cause) { setError(cause instanceof Error ? cause.message : 'The paragraph suggestion could not be saved.'); }
          finally { working.current = false;setPending(false); }
        })()}>Add paragraph split or join suggestion</Button>
        {paragraph && <Button type="button" variant="outline" className="h-auto min-h-9 whitespace-normal text-left" onClick={() => { setSelected('');setSplitAt(null);setError('');setNotice('');retry.current = null; }}>Cancel paragraph split or join</Button>}
      </div>
    </fieldset>
    {notice && <p role="status" className="text-sm">{notice}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
