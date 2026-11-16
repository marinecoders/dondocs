import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ParagraphMoveProposalsPanel } from '@/components/editor/ParagraphMoveProposalsPanel';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import { parseReviewRound } from '@/lib/reviewRounds';
function fixture(){
 const session=createBlankSession();session.paragraphs=[{id:'source',level:0,text:'**Source** {{UNIT}}'},{id:'child',level:1,text:'Child'},{id:'destination',level:0,text:'Destination'}];
 const round:ReviewRound={kind:'dondocs-review-round',version:1,id:`review_${crypto.randomUUID()}`,createdAt:1,label:'Example',sourceDocumentId:'source-document',ownerDocumentId:'source-document',baselineDigest:'a'.repeat(64),baseline:{ts:1,session}};
 return{round,author:'Synthetic reviewer',category:'edit' as const,busy:false,proposalCount:0,onCreate:vi.fn().mockResolvedValue(true)};
}
async function choose(){await userEvent.selectOptions(screen.getByLabelText('Reviewed paragraph to move'),'source');await userEvent.selectOptions(screen.getByLabelText('Destination sibling'),'destination');}
it('shows readable move identity and numbering explanation, submits complete native subtree and keeps baseline intact',async()=>{
 const props=fixture(),before=structuredClone(props.round.baseline.session);render(<ParagraphMoveProposalsPanel {...props}/>);await choose();
 expect(screen.getByRole('status')).toHaveTextContent('Move “**Source** {{UNIT}}” after “Destination” with all child paragraphs.');
 expect(screen.getByText(/Numbering is derived/)).toBeVisible();expect(screen.getByRole('region',{name:'Paragraph move context'})).toHaveTextContent('Child');
 await userEvent.click(screen.getByRole('button',{name:'Add move proposal'}));expect(props.onCreate).toHaveBeenCalledTimes(1);
 expect(props.onCreate.mock.calls[0][0].changes[0].target.operation).toMatchObject({kind:'move-paragraph',paragraphId:'source',destinationId:'destination',placement:'after',after:[{id:'destination'},{id:'source'},{id:'child'}]});
 expect(props.round.baseline.session).toEqual(before);
});
it('offers sibling destinations only and cancellation leaves no suggestion',async()=>{
 const props=fixture();render(<ParagraphMoveProposalsPanel {...props}/>);await userEvent.selectOptions(screen.getByLabelText('Reviewed paragraph to move'),'child');
 expect(screen.getByText(/No move is available/)).toBeVisible();expect(screen.getByRole('button',{name:'Add move proposal'})).toBeDisabled();
 await userEvent.click(screen.getByRole('button',{name:'Cancel move proposal'}));expect(props.onCreate).not.toHaveBeenCalled();
});
it('retries an identical captured move after an unsuccessful submission',async()=>{
 const props=fixture();props.onCreate.mockResolvedValueOnce(false);render(<ParagraphMoveProposalsPanel {...props}/>);await choose();const button=screen.getByRole('button',{name:'Add move proposal'});
 await userEvent.click(button);await waitFor(()=>expect(button).toBeEnabled());await userEvent.click(button);expect(props.onCreate.mock.calls[0][0]).toEqual(props.onCreate.mock.calls[1][0]);
});
it.each([{busy:true},{proposalCount:100}])('locks structural controls while busy, typing elsewhere, or quota full: %j',override=>{
 render(<ParagraphMoveProposalsPanel {...fixture()} {...override}/>);expect(screen.getByLabelText('Reviewed paragraph to move')).toBeDisabled();expect(screen.getByRole('button',{name:'Cancel move proposal'})).toBeDisabled();
});
it.each(['empty','selected','reviewer'] as const)('bounds baseline identity reads with %s move controls',async scenario=>{
 const props=fixture(),count=200;
 props.round.baseline.session.timestamp=1;
 props.round.baseline.session.paragraphs=Array.from({length:count},(_,index)=>({id:`bounded-${index}`,text:`Synthetic paragraph ${index}.`,level:0}));
 props.round=parseReviewRound(props.round);
 let reads=0;
 for(const paragraph of props.round.baseline.session.paragraphs){const id=paragraph.id;Object.defineProperty(paragraph,'id',{enumerable:true,get(){reads++;return id;}});}
 const view=render(<ParagraphMoveProposalsPanel {...props}/>);
 if(scenario!=='empty'){
  reads=0;await userEvent.selectOptions(screen.getByLabelText('Reviewed paragraph to move'),'bounded-0');
 }
 if(scenario==='reviewer'){
  reads=0;view.rerender(<ParagraphMoveProposalsPanel {...props} author="Updated reviewer"/>);
 }
 expect(screen.getByLabelText('Destination sibling').children).toHaveLength(scenario==='empty'?1:count);
 expect(reads).toBeLessThan(count*50);
});
