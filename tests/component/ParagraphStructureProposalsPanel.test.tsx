import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ReviewSuggestionsPanel } from '@/components/editor/ReviewSuggestionsPanel';
import { createParagraphStructureSuggestion, emptyReviewSuggestionState } from '@/lib/reviewSuggestions';
import { getSerializedSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
function props(){
  const current=getSerializedSession();current.documentCategory='correspondence';current.docType='naval_letter';current.paragraphs=[{id:'first',text:'First body',level:0},{id:'second',text:'Second body',level:0}];
  const round:ReviewRound={kind:'dondocs-review-round',version:1,id:`review_${crypto.randomUUID()}`,createdAt:1,label:'Review',sourceDocumentId:'source',ownerDocumentId:'source',baselineDigest:'a'.repeat(64),baseline:{ts:1,session:structuredClone(current)}};
  return {round,current,state:emptyReviewSuggestionState(round),owner:true,busy:false,onCreate:vi.fn().mockResolvedValue(true),onDecide:vi.fn().mockResolvedValue(true)};
}
it('submits a readable exact insertion without changing current or baseline, and cancels unsent input',async()=>{
  const input=props();render(<ReviewSuggestionsPanel {...input}/>);
  fireEvent.change(screen.getByLabelText('Reviewer name for suggestion'),{target:{value:'Synthetic reviewer'}});
  fireEvent.change(screen.getByLabelText('Insert at reviewed position'),{target:{value:'1'}});
  fireEvent.change(screen.getByLabelText('New paragraph text'),{target:{value:'Cancelled'}});
  fireEvent.click(screen.getByRole('button',{name:'Cancel paragraph proposal'}));expect(input.onCreate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Insert at reviewed position'),{target:{value:'1'}});
  fireEvent.change(screen.getByLabelText('New paragraph text'),{target:{value:'New 😀 paragraph'}});
  fireEvent.click(screen.getByRole('button',{name:'Add paragraph proposal'}));await waitFor(()=>expect(input.onCreate).toHaveBeenCalledOnce());
  expect(input.onCreate.mock.calls[0][0].changes[0]).toMatchObject({expected:'',proposed:'New 😀 paragraph',target:{kind:'structure',operation:{kind:'insert-paragraph',before:[],gap:{before:{id:'first',level:0},after:{id:'second',level:0}}}}});
  expect(input.current.paragraphs).toEqual(input.round.baseline.session.paragraphs);expect(input.current.paragraphs).toHaveLength(2);
});
it('visibly refuses unsupported rich insertion and deleting a parent without submitting a partial proposal',async()=>{
  const input=props();input.current.paragraphs[1].level=1;input.round.baseline.session=structuredClone(input.current);render(<ReviewSuggestionsPanel {...input}/>);
  fireEvent.change(screen.getByLabelText('Reviewer name for suggestion'),{target:{value:'Example'}});
  fireEvent.change(screen.getByLabelText('Insert at reviewed position'),{target:{value:'2'}});
  fireEvent.change(screen.getByLabelText('New paragraph text'),{target:{value:'**Unsupported**'}});
  fireEvent.click(screen.getByRole('button',{name:'Add paragraph proposal'}));expect(await screen.findByRole('alert')).toHaveTextContent('plain native paragraph');
  fireEvent.change(screen.getByLabelText('Paragraph operation'),{target:{value:'delete-paragraph'}});
  fireEvent.change(screen.getByLabelText('Reviewed paragraph to delete'),{target:{value:'first'}});
  fireEvent.click(screen.getByRole('button',{name:'Add paragraph proposal'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/child|nesting/));expect(input.onCreate).not.toHaveBeenCalled();
});
it('shows insertion/deletion comparisons and keeps stale structure out of text reconciliation',()=>{
  const input=props();const proposal=createParagraphStructureSuggestion(input.round,{author:'Example',operation:{kind:'delete-paragraph',paragraphId:'second'}});input.state.proposals=[proposal];input.current.paragraphs[1].header='Newer heading';render(<ReviewSuggestionsPanel {...input}/>);
  expect(screen.getByRole('region',{name:'Delete paragraph replacement comparison, suggestion 1'})).toHaveTextContent('Second body');
  expect(screen.getByRole('button',{name:'Accept suggestion'})).toBeDisabled();expect(screen.getByRole('button',{name:'Reject suggestion'})).toBeEnabled();expect(screen.queryByRole('button',{name:'Reconcile suggestion'})).toBeNull();
});
