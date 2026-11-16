import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { ReviewRound } from '@/lib/reviewRounds';
import type { FeedbackCategory } from '@/lib/reviewFeedback';
import { createParagraphStructureSuggestion, REVIEW_SUGGESTION_LIMITS, type ReviewSuggestion } from '@/lib/reviewSuggestions';
import { availableReviewParagraphMoveDestinations, reviewParagraphMoveDescription } from '@/lib/reviewParagraphMoves';
import { paragraphSubtreeEnd } from '@/lib/paragraphUtils';
import { paragraphCommentContext } from '@/lib/reviewCommentTargets';

interface Props { round: ReviewRound; author: string; category: FeedbackCategory; busy: boolean; proposalCount: number; onCreate: (proposal: ReviewSuggestion) => Promise<boolean> }
export function ParagraphMoveProposalsPanel({ round, author, category, busy, proposalCount, onCreate }: Props) {
  const prefix=useId(),working=useRef(false),alive=useRef(true);
  const captured=useRef<{ key: string; proposal: ReviewSuggestion } | null>(null);
  const [paragraphId,setParagraphId]=useState(''),[destinationId,setDestinationId]=useState('');
  const [placement,setPlacement]=useState<'before'|'after'>('after');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const paragraphs=round.baseline.session.paragraphs,full=proposalCount>=REVIEW_SUGGESTION_LIMITS.proposals;
  const intent={paragraphId,destinationId,placement};
  const available=useMemo(()=>availableReviewParagraphMoveDestinations(paragraphs,paragraphId,placement),[paragraphs,paragraphId,placement]);
  const names=useMemo(()=>new Map(paragraphs.map((paragraph,index)=>[paragraph.id,`Paragraph ${index+1}: ${(paragraph.header||paragraph.text||'(Empty)').slice(0,65)}`])),[paragraphs]);
  const valid=available.some(paragraph=>paragraph.id===destinationId);
  const index=paragraphs.findIndex(paragraph=>paragraph.id===paragraphId);
  const moved=index<0?[]:paragraphs.slice(index,paragraphSubtreeEnd(paragraphs,index));
  async function submit(){
    if(busy||working.current||full||!valid)return;
    working.current=true;setPending(true);setError('');setNotice('');
    try{
      const key=JSON.stringify([round.id,author,category,intent]);
      if(captured.current?.key!==key)captured.current={key,proposal:createParagraphStructureSuggestion(round,{author,category,operation:{kind:'move-paragraph',...intent}})};
      const proposal=captured.current.proposal;
      if(await onCreate(proposal)&&alive.current){captured.current=null;setParagraphId('');setDestinationId('');setNotice('Move proposal submitted. The reviewed document is unchanged.');}
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'The move proposal could not be created.');}
    finally{working.current=false;if(alive.current)setPending(false);}
  }
  const name=(id:string|undefined)=>names.get(id);
  return <section aria-label="Paragraph movement" className="space-y-2 rounded-md border p-3">
    <h4 className="text-sm font-medium">Propose a paragraph move</h4>
    <p className="text-xs text-muted-foreground">Move a paragraph and all its children beside a sibling under the same parent. Text, formatting, resources and discussions stay on their paragraph identities. Numbering is derived from the resulting order; it is not a separate text edit.</p>
    {!round.ownerDocumentId&&paragraphs.some(paragraph=>paragraph.figure)&&<p className="text-sm">Reviewer copies cannot propose a move whose captured span includes a figure. Keep its resources and describe the move in a review comment. The original source can propose moves with its retained figures.</p>}
    <fieldset disabled={busy||pending||full} className="space-y-2">
      <Label htmlFor={`${prefix}-source`}>Reviewed paragraph to move</Label>
      <select id={`${prefix}-source`} value={paragraphId} className="w-full rounded-md border bg-background p-2 text-sm" onChange={event=>{setParagraphId(event.target.value);setDestinationId('');setError('');setNotice('');}}>
        <option value="">Choose a stable paragraph and its subtree</option>
        {paragraphs.map(paragraph=><option key={paragraph.id} value={paragraph.id}>{name(paragraph.id)}</option>)}
      </select>
      <Label htmlFor={`${prefix}-placement`}>Move placement</Label>
      <select id={`${prefix}-placement`} value={placement} className="w-full rounded-md border bg-background p-2 text-sm" onChange={event=>{setPlacement(event.target.value as typeof placement);setDestinationId('');}}>
        <option value="before">Before sibling and its children</option><option value="after">After sibling and its children</option>
      </select>
      <Label htmlFor={`${prefix}-destination`}>Destination sibling</Label>
      <select id={`${prefix}-destination`} value={destinationId} className="w-full rounded-md border bg-background p-2 text-sm" onChange={event=>setDestinationId(event.target.value)}>
        <option value="">Choose a different valid position</option>
        {available.map(paragraph=><option key={paragraph.id} value={paragraph.id}>{name(paragraph.id)}</option>)}
      </select>
      {paragraphId&&!available.length&&<p className="text-sm">No move is available for this placement. Choose another paragraph or placement. Use a review comment for reparenting requests.</p>}
      {moved.length>0&&<div role="region" aria-label="Paragraph move context" tabIndex={0} className="max-h-48 space-y-2 overflow-auto whitespace-pre-wrap break-words rounded-md border p-2 text-sm">
        {moved.map(paragraph=><p key={paragraph.id}>{paragraphCommentContext(paragraph)||'(Empty paragraph)'}</p>)}
      </div>}
      {valid&&<p role="status" className="break-words text-sm">{reviewParagraphMoveDescription(paragraphs,intent)} Acceptance requires the exact captured source, destination, parent and surrounding positions.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!author.trim()||!valid} onClick={()=>void submit()}>Add move proposal</Button>
        <Button type="button" variant="outline" onClick={()=>{captured.current=null;setParagraphId('');setDestinationId('');setError('');setNotice('');}}>Cancel move proposal</Button>
      </div>
    </fieldset>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice&&<p role="status" className="text-sm">{notice}</p>}
  </section>;
}
