import { describe, expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import { applyReviewStructure, captureReviewStructure, validateReviewStructureTarget } from '@/lib/reviewStructureSuggestions';
import { appendReviewSuggestions, createParagraphStructureSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision, reviewSuggestionText, validateReviewSuggestion } from '@/lib/reviewSuggestions';
function fixture(){
 const session=createBlankSession();session.paragraphs=[{id:'outer',text:'Outer parent',level:0},{id:'a',text:'Same text',level:1,header:'Heading',portionMarking:'CUI',referenceId:'reference'},{id:'aa',text:'{{UNIT}} **formatting**',level:2},{id:'b',text:'Same text',level:1},{id:'bb',text:'Destination child',level:2},{id:'tail',text:'Tail',level:0}];
 const round:ReviewRound={kind:'dondocs-review-round',version:1,id:`review_${crypto.randomUUID()}`,createdAt:1,label:'Synthetic',sourceDocumentId:'owner',ownerDocumentId:'owner',baselineDigest:'a'.repeat(64),baseline:{ts:1,session:structuredClone(session)}};
 const operation={kind:'move-paragraph' as const,paragraphId:'a',destinationId:'b',placement:'after' as const};
 return{session,round,operation};
}
describe('guarded paragraph move suggestions',()=>{
 it('uses explicit identities with repeated text and reorders complete formatted subtrees without renumbering stored text',()=>{
  const {session,round,operation}=fixture(),before=structuredClone(session),proposal=createParagraphStructureSuggestion(round,{author:'Reviewer',operation});
  const state=appendReviewSuggestions(round,emptyReviewSuggestionState(round),[proposal]);
  const plan=planReviewSuggestionDecision(round,session,state,proposal.id,'accepted');expect(plan.status).toBe('ready');expect(plan.changes[0].movement).toMatchObject({paragraphId:'a',destinationId:'b',placement:'after',paragraphIds:['a','aa']});
  expect(plan.session.paragraphs.map(p=>p.id)).toEqual(['outer','b','bb','a','aa','tail']);
  for(const p of plan.session.paragraphs)expect(p).toEqual(before.paragraphs.find(old=>old.id===p.id));expect(session).toEqual(before);expect(round.baseline.session).toEqual(before);
  expect(validateReviewSuggestion(round,JSON.parse(JSON.stringify(proposal)))).toEqual(proposal);
 });
 it.each(['text','level','id','mark','reference','footnote','figure'] as const)('rejects hidden after-node mutation: %s',kind=>{
  const {session,operation}=fixture(),target=captureReviewStructure(session,operation),node=target.operation.after.find(p=>p.id==='a')!;
  if(kind==='text')node.text='Forged';if(kind==='level')node.level=0;if(kind==='id')node.id='forged';if(kind==='mark')node.portionMarking='S';if(kind==='reference')node.referenceId='forged';if(kind==='footnote')node.tableFootnotes=[{id:'note',text:'Hidden'}];if(kind==='figure')node.figure={name:'Hidden',width:44};
  expect(()=>validateReviewStructureTarget(session,target)).toThrow();expect(()=>applyReviewStructure(session,target)).toThrow();
 });
 it('refuses a truncated source or destination subtree and any extraneous corridor authority',()=>{
  const {session,operation}=fixture(),target=captureReviewStructure(session,operation);
  const truncated=structuredClone(target);truncated.operation.before=truncated.operation.before.filter(p=>p.id!=='bb');truncated.operation.after=truncated.operation.after.filter(p=>p.id!=='bb');expect(()=>applyReviewStructure(session,truncated)).toThrow();
  const extra=structuredClone(target);extra.operation.before.push({...session.paragraphs.at(-1)!,id:'tail'});extra.operation.after.push({...session.paragraphs.at(-1)!,id:'tail'});expect(()=>applyReviewStructure(session,extra)).toThrow();
 });
 it.each(['source-parent','destination-parent','destination-descendant','boundary-position'] as const)('requires the exact current structural identities: %s',kind=>{
  const {session,operation}=fixture(),target=captureReviewStructure(session,operation);
  if(kind==='source-parent')session.paragraphs[0].id='new-parent';if(kind==='destination-parent')session.paragraphs[3].level=0;
  if(kind==='destination-descendant')session.paragraphs.splice(5,0,{id:'new-child',text:'New child',level:2});
  if(kind==='boundary-position')session.paragraphs.splice(1,0,{id:'interposed',text:'New sibling',level:1});
  expect(()=>applyReviewStructure(session,target)).toThrow();
 });
 it('retains unrelated newer nodes, fields and neighbor text while refusing changed captured nodes',()=>{
  const {session,operation}=fixture(),target=captureReviewStructure(session,operation);
  session.paragraphs[0].text='New parent text';session.paragraphs[5].text='New tail';session.paragraphs.push({id:'newer',text:'Other new work',level:0});session.formData.subject='New subject';
  const next=applyReviewStructure(session,target);expect(next.formData).toEqual(session.formData);expect(next.paragraphs[0]).toEqual(session.paragraphs[0]);expect(next.paragraphs.slice(-2)).toEqual(session.paragraphs.slice(-2));
  next.paragraphs.find(p=>p.id==='aa')!.text='New child text';expect(()=>applyReviewStructure(next,target,'reverse')).toThrow();
 });
 it('scans every nested retained string for privacy and limits',()=>{
  const {round,operation}=fixture();round.baseline.session.paragraphs[1].tableFootnotes=[{id:'synthetic-footnote',text:'Retained nested privacy content'}];
  const proposal=createParagraphStructureSuggestion(round,{author:'Reviewer',operation});expect(reviewSuggestionText([proposal]).some(field=>field.value==='Retained nested privacy content')).toBe(true);
  const target=proposal.changes[0].target;if(target.kind!=='structure')throw new Error();target.operation.after[0].header='x'.repeat(20_001);expect(()=>validateReviewSuggestion(round,proposal)).toThrow();
 });
});
