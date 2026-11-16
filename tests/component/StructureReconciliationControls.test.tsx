import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { StructureReconciliationControls } from '@/components/editor/StructureReconciliationControls';
import { createBlankSession } from '@/stores/documentStore';
import { captureReviewStructure } from '@/lib/reviewStructureSuggestions';
import { inspectReviewStructureReconciliation } from '@/lib/reconcileReviewStructure';
function fixture(){const source=createBlankSession();source.paragraphs=[{id:'a',text:'Reviewed paragraph',level:0},{id:'b',text:'Tail',level:0}];const target=captureReviewStructure(source,{kind:'delete-paragraph',paragraphId:'a'});source.paragraphs[0].text='Changed current paragraph';return{source,target,inspection:inspectReviewStructureReconciliation(source,target),changeId:crypto.randomUUID(),disabled:false,onDecide:vi.fn()};}
it('shows conflict and exact current preview, cancels without deciding and confirms only the captured structure',async()=>{
 const f=fixture();render(<StructureReconciliationControls {...f}/>);expect(screen.getByText(/delete vs edit/)).toBeVisible();
 await userEvent.click(screen.getByRole('button',{name:'Preview operation on current draft'}));expect(screen.getByText('Changed current paragraph')).toBeVisible();
 await userEvent.click(screen.getByRole('button',{name:'Cancel structural reconciliation'}));expect(f.onDecide).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole('button',{name:'Preview operation on current draft'}));await userEvent.click(screen.getByRole('button',{name:'Confirm operation on current draft'}));
 expect(f.onDecide).toHaveBeenCalledWith('accepted',expect.objectContaining({expectedCurrent:'Changed current paragraph',value:'',structure:expect.objectContaining({operation:expect.objectContaining({kind:'delete-paragraph',before:[expect.objectContaining({id:'a',text:'Changed current paragraph'})],after:[]})})}));
});
it('rejects to keep current structure and refuses a preview after the current source changes',async()=>{
 const f=fixture(),view=render(<StructureReconciliationControls {...f}/>);await userEvent.click(screen.getByRole('button',{name:'Keep current structure'}));expect(f.onDecide).toHaveBeenCalledWith('rejected');
 await userEvent.click(screen.getByRole('button',{name:'Preview operation on current draft'}));f.source.paragraphs[0].text='Changed again';view.rerender(<StructureReconciliationControls {...f} inspection={inspectReviewStructureReconciliation(f.source,f.target)}/>);
 expect(screen.getByRole('button',{name:'Confirm operation on current draft'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('The draft changed');
});
it('cannot resolve a missing original identity and disables all controls while busy',()=>{
 const f=fixture();f.source.paragraphs.shift();render(<StructureReconciliationControls {...f} disabled inspection={inspectReviewStructureReconciliation(f.source,f.target)}/>);
 expect(screen.queryByRole('button',{name:'Preview operation on current draft'})).toBeNull();expect(screen.getByRole('button',{name:'Keep current structure'})).toBeDisabled();expect(screen.getByText(/original identities or parent boundary/)).toBeVisible();
});
