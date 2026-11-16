import { useId, useRef, useState } from 'react';
import { PARAGRAPH } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ReviewRound } from '@/lib/reviewRounds';
import type { FeedbackCategory } from '@/lib/reviewFeedback';
import { createParagraphStructureSuggestion, REVIEW_SUGGESTION_LIMITS, type ReviewSuggestion } from '@/lib/reviewSuggestions';
import { paragraphCommentContext } from '@/lib/reviewCommentTargets';

interface Props { round: ReviewRound; author: string; category: FeedbackCategory; busy: boolean; proposalCount: number; onCreate: (proposal: ReviewSuggestion) => Promise<boolean> }
/** Uses the parent workspace's native proposal, return and owner decision path. */
export function ParagraphStructureProposalsPanel({ round, author, category, busy, proposalCount, onCreate }: Props) {
  const prefix = useId(), working = useRef(false);
  const [kind, setKind] = useState<'insert-paragraph'|'delete-paragraph'>('insert-paragraph');
  const [index, setIndex] = useState(''), [paragraphId, setParagraphId] = useState(''), [text, setText] = useState(''), [level, setLevel] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState(false);
  const paragraphs = round.baseline.session.paragraphs;
  const selected = paragraphs.find(paragraph => paragraph.id === paragraphId);
  const full = proposalCount >= REVIEW_SUGGESTION_LIMITS.proposals;
  async function submit() {
    if (busy || working.current || full) return;
    working.current = true;setPending(true);setError('');setNotice('');
    try {
      const proposal = createParagraphStructureSuggestion(round, { author, category, operation: kind === 'insert-paragraph'
        ? { kind, index: Number(index), text, level } : { kind, paragraphId } });
      if (await onCreate(proposal)) { setIndex('');setParagraphId('');setText('');setNotice('Paragraph proposal submitted. The reviewed document is unchanged.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The paragraph proposal could not be created.'); }
    finally { working.current = false;setPending(false); }
  }
  return <section aria-label="Paragraph insertion and deletion" className="space-y-2 rounded-md border p-3">
    <h4 className="text-sm font-medium">Propose paragraph insertion or deletion</h4>
    <p className="text-xs text-muted-foreground">Use the reviewer name above. New paragraphs support plain text. Delete one leaf paragraph at a time. Use a comment for figure or structured-block deletions; paragraphs with children and the final remaining paragraph are kept. Numbering updates from the resulting outline.</p>
    <fieldset disabled={busy || pending || full} className="space-y-2">
      <Label htmlFor={`${prefix}-kind`}>Paragraph operation</Label>
      <select id={`${prefix}-kind`} value={kind} className="w-full rounded-md border bg-background p-2 text-sm" onChange={event => { setKind(event.target.value as typeof kind);setError('');setNotice(''); }}>
        <option value="insert-paragraph">Insert a new paragraph</option><option value="delete-paragraph">Delete a paragraph</option>
      </select>
      {kind === 'insert-paragraph' ? <>
        <Label htmlFor={`${prefix}-position`}>Insert at reviewed position</Label>
        <select id={`${prefix}-position`} value={index} className="w-full rounded-md border bg-background p-2 text-sm" onChange={event => setIndex(event.target.value)}>
          <option value="">Choose an exact paragraph gap</option>
          {Array.from({ length: paragraphs.length + 1 }, (_, position) => <option key={position} value={String(position)}>{position === 0 ? 'Before paragraph 1' : position === paragraphs.length ? `After paragraph ${position} (end)` : `Between paragraphs ${position} and ${position + 1}`}</option>)}
        </select>
        {index !== '' && <div className="space-y-1 text-xs text-muted-foreground" aria-label="Insertion context">
          <p>Before: {paragraphs[Number(index) - 1]?.text || '(Start of document)'}</p>
          <p>After: {paragraphs[Number(index)]?.text || '(End of document)'}</p>
        </div>}
        <Label htmlFor={`${prefix}-level`}>New paragraph level</Label>
        <select id={`${prefix}-level`} value={level} className="rounded-md border bg-background p-2 text-sm" onChange={event => setLevel(Number(event.target.value))}>
          {Array.from({ length: PARAGRAPH.MAX_DEPTH + 1 }, (_, depth) => <option key={depth} value={depth}>{depth === 0 ? 'Top level' : `Subparagraph level ${depth}`}</option>)}
        </select>
        <Label htmlFor={`${prefix}-text`}>New paragraph text</Label>
        <Textarea id={`${prefix}-text`} value={text} maxLength={REVIEW_SUGGESTION_LIMITS.value} rows={3} onChange={event => setText(event.target.value)} />
      </> : <>
        <Label htmlFor={`${prefix}-delete`}>Reviewed paragraph to delete</Label>
        <select id={`${prefix}-delete`} value={paragraphId} className="w-full rounded-md border bg-background p-2 text-sm" onChange={event => setParagraphId(event.target.value)}>
          <option value="">Choose a stable paragraph</option>
          {paragraphs.map((paragraph, position) => <option key={paragraph.id} value={paragraph.id}>Paragraph {position + 1}: {paragraph.text.slice(0, 65) || '(Empty)'}</option>)}
        </select>
        {selected && <div role="region" aria-label="Paragraph deletion context" tabIndex={0} className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border p-2 text-sm">
          {paragraphCommentContext(selected) || '(Empty paragraph)'}
          {selected.figure && <p>Figure deletion is unsupported. Keep its resource and describe the requested deletion in a review comment.</p>}
          {selected.tableKey && <p>Structured table paragraph. Keep its resources and describe the requested deletion in a review comment.</p>}
        </div>}
      </>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!author.trim() || (kind === 'insert-paragraph' ? index === '' || !text.trim() : !paragraphId)} onClick={() => void submit()}>Add paragraph proposal</Button>
        <Button type="button" variant="outline" onClick={() => { setIndex('');setParagraphId('');setText('');setError('');setNotice(''); }}>Cancel paragraph proposal</Button>
      </div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
