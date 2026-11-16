import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import {ParagraphSplitJoinProposalsPanel} from '@/components/editor/ParagraphSplitJoinProposalsPanel';
import {createBlankSession} from '@/stores/documentStore';
import type {ReviewRound} from '@/lib/reviewRounds';
function fixture(text='Before **marked words** after'){
 const session=createBlankSession();session.paragraphs=[{id:'first',level:0,text},{id:'second',level:0,text:'Second.'}];
 const round:ReviewRound={kind:'dondocs-review-round',version:1,id:`review_${crypto.randomUUID()}`,createdAt:1,label:'Example',sourceDocumentId:'source',baselineDigest:'a'.repeat(64),baseline:{ts:1,session}};
 return{round,disabled:false,quotaFull:false,onCreate:vi.fn().mockResolvedValue(true)};
}
function caret(position:number){const editor=screen.getByLabelText('Place the split in reviewed paragraph') as HTMLTextAreaElement;editor.focus();editor.setSelectionRange(position,position);fireEvent.select(editor);}
it('previews supported formatting, preserves the baseline and submits the exact selected split once',async()=>{
 const input=fixture();render(<ParagraphSplitJoinProposalsPanel {...input}/>);await userEvent.type(screen.getByLabelText('Reviewer name for paragraph split or join'),'Reviewer');await userEvent.selectOptions(screen.getByLabelText('Paragraph to split or first paragraph to join'),'first');caret(16);
 expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'Before **marked **\n\n**words** after')).toBeVisible();await userEvent.click(screen.getByRole('button',{name:'Add paragraph split or join suggestion'}));
 expect(input.onCreate).toHaveBeenCalledTimes(1);expect(input.onCreate.mock.calls[0][0].changes[0].target.operation).toMatchObject({kind:'split-paragraph',splitAt:16,before:[{text:input.round.baseline.session.paragraphs[0].text}]});expect(input.round.baseline.session.paragraphs).toHaveLength(2);
});
it('refuses splitting through variables and explains legacy recovery; cancel leaves no proposal',async()=>{
 const input=fixture('Before {{NAME}} after');render(<ParagraphSplitJoinProposalsPanel {...input}/>);await userEvent.type(screen.getByLabelText('Reviewer name for paragraph split or join'),'Reviewer');await userEvent.selectOptions(screen.getByLabelText('Paragraph to split or first paragraph to join'),'first');caret(10);
 expect(screen.getByText(/Place the split outside a variable chip/)).toBeVisible();expect(screen.getByRole('button',{name:'Add paragraph split or join suggestion'})).toBeDisabled();await userEvent.click(screen.getByRole('button',{name:'Cancel paragraph split or join'}));expect(input.onCreate).not.toHaveBeenCalled();
});
it('requires the explicit adjacent pair and preserves a chosen empty separator',async()=>{
 const input=fixture('First');render(<ParagraphSplitJoinProposalsPanel {...input}/>);await userEvent.type(screen.getByLabelText('Reviewer name for paragraph split or join'),'Reviewer');await userEvent.selectOptions(screen.getByLabelText('Split or join operation'),'join-paragraphs');await userEvent.selectOptions(screen.getByLabelText('Paragraph to split or first paragraph to join'),'first');
 expect(screen.getByText('Second selected paragraph: Paragraph 2: Second.')).toBeVisible();await userEvent.selectOptions(screen.getByLabelText('Space between joined paragraphs'),'');await userEvent.click(screen.getByRole('button',{name:'Add paragraph split or join suggestion'}));expect(input.onCreate.mock.calls[0][0].changes[0].proposed).toBe('FirstSecond.');
});
it('retries the same immutable proposal and new paragraph identity after a failed submission',async()=>{
 const input=fixture('First second');input.onCreate.mockResolvedValueOnce(false).mockResolvedValueOnce(true);render(<ParagraphSplitJoinProposalsPanel {...input}/>);await userEvent.type(screen.getByLabelText('Reviewer name for paragraph split or join'),'Reviewer');await userEvent.selectOptions(screen.getByLabelText('Paragraph to split or first paragraph to join'),'first');caret(6);
 const save=screen.getByRole('button',{name:'Add paragraph split or join suggestion'});await userEvent.click(save);await waitFor(()=>expect(save).toBeEnabled());await userEvent.click(save);expect(input.onCreate.mock.calls[1][0]).toEqual(input.onCreate.mock.calls[0][0]);
});
