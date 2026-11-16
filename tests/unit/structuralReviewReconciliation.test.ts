import { describe, expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import { appendReviewSuggestions, createParagraphStructureSuggestion, emptyReviewSuggestionState, inspectReviewSuggestion, planReviewSuggestionDecision, reviewSuggestionResolutionText, validateReviewSuggestionState } from '@/lib/reviewSuggestions';
import { captureReconciledReviewStructure, inspectReviewStructureReconciliation } from '@/lib/reconcileReviewStructure';
import { structureSuggestionText, type CaptureReviewStructureInput } from '@/lib/reviewStructureSuggestions';
function fixture(operation: CaptureReviewStructureInput = {kind:'move-paragraph',paragraphId:'a',destinationId:'c',placement:'after'}) {
 const session=createBlankSession();session.paragraphs=[{id:'a',text:'Alpha bold',level:0},{id:'b',text:'Beta',level:0},{id:'c',text:'Charlie',level:0},{id:'tail',text:'Tail',level:0}];
 const round:ReviewRound={kind:'dondocs-review-round',version:1,id:`review_${crypto.randomUUID()}`,createdAt:1,label:'Synthetic',sourceDocumentId:'owner',ownerDocumentId:'owner',baselineDigest:'a'.repeat(64),baseline:{ts:1,session:structuredClone(session)}};
 const proposal=createParagraphStructureSuggestion(round,{author:'Reviewer',operation}),state=appendReviewSuggestions(round,emptyReviewSuggestionState(round),[proposal]);
 const target=proposal.changes[0].target;if(target.kind!=='structure')throw new Error();
 return {session,round,proposal,state,target};
}
function resolution(f:ReturnType<typeof fixture>,splitAt?:number) {const structure=captureReconciledReviewStructure(f.session,f.target,splitAt);return{changeId:f.proposal.changes[0].id,structure,expectedCurrent:structureSuggestionText(structure.operation.before),value:structureSuggestionText(structure.operation.after)};}
describe('three-way structural intent reconciliation',()=>{
 it('merges moves with newer native properties, comments, unrelated fields and inserted paragraphs by identity',()=>{
  const f=fixture();f.session.paragraphs[0]={...f.session.paragraphs[0],text:'**New alpha** {{UNIT}}',header:'New heading',referenceId:'New reference'};
  f.session.paragraphs.splice(1,0,{id:'newer',text:'Newer independent sibling',level:0});f.session.formData.subject='New subject';
  expect(inspectReviewStructureReconciliation(f.session,f.target).kind).toBe('independent');
  const p=planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted');expect(p.status).toBe('ready');
  expect(p.session.paragraphs.map(p=>p.id)).toEqual(['newer','b','c','a','tail']);
  for(const node of p.session.paragraphs)expect(node).toEqual(f.session.paragraphs.find(p=>p.id===node.id));expect(p.session.formData).toEqual(f.session.formData);
  expect(p.state.decisions[0].resolutions![0].structure!.operation.before[0].text).toBe('**New alpha** {{UNIT}}');
 });
 it('classifies delete-vs-edit and requires an exact current confirmation',()=>{
  const f=fixture({kind:'delete-paragraph',paragraphId:'b'});f.session.paragraphs[1].text='New beta';
  expect(inspectReviewStructureReconciliation(f.session,f.target).kind).toBe('delete-vs-edit');
  expect(planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted').status).toBe('stale');
  const r=resolution(f),plan=planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted',undefined,[r]);expect(plan.status).toBe('ready');expect(plan.session.paragraphs.map(p=>p.id)).toEqual(['a','c','tail']);
  f.session.paragraphs[1].text='Changed after preview';expect(()=>planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted',undefined,[r])).toThrow();
 });
 it('requires an explicit new split boundary for changed text and preserves current formatting',()=>{
  const f=fixture({kind:'split-paragraph',paragraphId:'a',splitAt:5,newParagraphId:'split-owned'});f.session.paragraphs[0].text='**New alpha content**';
  expect(inspectReviewStructureReconciliation(f.session,f.target).kind).toBe('split-join-overlap');
  expect(planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted').status).toBe('stale');
  const plan=planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted',undefined,[resolution(f,6)]);
  expect(plan.status).toBe('ready');expect(plan.session.paragraphs.slice(0,2).map(p=>[p.id,p.text])).toEqual([['a','**New **'],['split-owned','**alpha content**']]);
 });
 it('retains changed join text only after a deliberate current-node review',()=>{
  const f=fixture({kind:'join-paragraphs',paragraphId:'a',nextParagraphId:'b',separator:' '});f.session.paragraphs[1].text='**New beta**';
  expect(inspectReviewStructureReconciliation(f.session,f.target).kind).toBe('split-join-overlap');
  const plan=planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted',undefined,[resolution(f)]);expect(plan.session.paragraphs[0].text).toBe('Alpha bold **New beta**');
 });
 it('distinguishes competing moves and refuses automatic arrival-order decisions',()=>{
  const f=fixture();const b=f.session.paragraphs.splice(1,1)[0];f.session.paragraphs.unshift(b);
  expect(inspectReviewStructureReconciliation(f.session,f.target).kind).toBe('competing-move');expect(planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted').status).toBe('stale');
  expect(planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted',undefined,[resolution(f)]).session.paragraphs.map(p=>p.id)).toEqual(['b','c','a','tail']);
 });
 it.each(['missing','parent','duplicate','join-separated'] as const)('refuses unsafe %s without retargeting',kind=>{
  const f=fixture(kind==='join-separated'?{kind:'join-paragraphs',paragraphId:'a',nextParagraphId:'b',separator:' '} : undefined);
  if(kind==='missing')f.session.paragraphs.shift();if(kind==='parent')f.session.paragraphs[2].level=1;if(kind==='duplicate')f.session.paragraphs.push({...f.session.paragraphs[0]});if(kind==='join-separated')f.session.paragraphs.splice(1,0,{id:'newer',text:'Interposed',level:0});
  const view=inspectReviewStructureReconciliation(f.session,f.target);expect(view.canResolve).toBe(false);expect(view.kind).toBe(kind==='missing'?'missing-target':'changed-parent-boundary');expect(planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted').status).toBe('stale');
 });
 it.each(['text','metadata','kind','target','new-id','readable'] as const)('rejects forged resolution %s',kind=>{
  const f=fixture(kind==='new-id'?{kind:'split-paragraph',paragraphId:'a',splitAt:5,newParagraphId:'owned-new'}:undefined);f.session.paragraphs[0].text='Alpha changed';const r=resolution(f);
  if(kind==='text')r.structure.operation.after[0].text='Hidden overwrite';if(kind==='metadata')r.structure.operation.after[0].portionMarking='S';if(kind==='kind')Object.assign(r.structure.operation,{kind:'delete-paragraph',after:[]});if(kind==='target'&&r.structure.operation.kind==='move-paragraph')r.structure.operation.destinationId='tail';if(kind==='new-id')r.structure.operation.after[1].id='unrelated-id';if(kind==='readable')r.value='Fake comparison';
  expect(()=>planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted',undefined,[r])).toThrow();
 });
 it('supports multiple independent structural proposals without invalidating immutable baselines',()=>{
  const f=fixture();const deletion=createParagraphStructureSuggestion(f.round,{author:'Reviewer',operation:{kind:'delete-paragraph',paragraphId:'tail'}});const state=appendReviewSuggestions(f.round,f.state,[deletion]);
  const first=planReviewSuggestionDecision(f.round,f.session,state,f.proposal.id,'accepted');const second=planReviewSuggestionDecision(f.round,first.session,first.state,deletion.id,'accepted');expect(second.status).toBe('ready');expect(second.session.paragraphs.map(p=>p.id)).toEqual(['b','c','a']);
  expect(validateReviewSuggestionState(f.round,JSON.parse(JSON.stringify(second.state)))).toEqual(second.state);expect(f.round.baseline.session.paragraphs.map(p=>p.id)).toEqual(['a','b','c','tail']);
  expect(inspectReviewSuggestion(f.round,first.session,f.proposal,first.state.decisions[0].resolutions)[0].current).toBe(first.state.decisions[0].resolutions![0].value);
 });
 it('scans every nested resolved string and bounds metadata before durable acceptance',()=>{
  const f=fixture();f.session.paragraphs[0].figure={name:'Retained historic figure',fileRef:{id:'native-file',name:'Nested retained filename',size:42,type:'image/png'}};const r=resolution(f);
  expect(reviewSuggestionResolutionText([r]).some(field=>field.value==='Nested retained filename')).toBe(true);
  r.structure.operation.before[0].header='x'.repeat(20_001);expect(()=>planReviewSuggestionDecision(f.round,f.session,f.state,f.proposal.id,'accepted',undefined,[r])).toThrow();
 });
});
