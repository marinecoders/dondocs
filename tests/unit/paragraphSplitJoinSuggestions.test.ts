import { describe, expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import { captureReviewStructure, validateReviewStructureTarget } from '@/lib/reviewStructureSuggestions';
import { appendReviewSuggestions, createParagraphStructureSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision, validateReviewSuggestion } from '@/lib/reviewSuggestions';
import { planReviewSuggestionWrite, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import { captureTextRange, resolveTextRange } from '@/lib/reviewTextRanges';
function fixture(text = 'Left words. Right words.') {
  const session = createBlankSession();session.paragraphs = [{ id: 'first', text, level: 0 }, { id: 'second', text: 'Second paragraph.', level: 0 }, { id: 'last', text: 'Unrelated.', level: 0 }];
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 1, label: 'Example', sourceDocumentId: 'source', baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session: structuredClone(session) } };
  const make = (operation: Parameters<typeof createParagraphStructureSuggestion>[1]['operation']) => createParagraphStructureSuggestion(round, { author: 'Reviewer', operation });
  const accept = (proposal: ReturnType<typeof make>, source = session) => planReviewSuggestionDecision(round, source, appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]), proposal.id, 'accepted');
  return { session, round, make, accept };
}
function history(round: ReviewRound, state: ReturnType<typeof emptyReviewSuggestionState>, direction: 'undo' | 'redo'): ReviewSuggestionWrite {
  return { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: 'source', createdAt: 2, round: { id: round.id, baselineDigest: round.baselineDigest }, before: state, after: state,
    intent: { kind: 'history', acceptanceId: state.decisions[0].id, direction, record: { id: crypto.randomUUID(), decidedAt: 2 } } };
}
describe('split/join through the shared review planner and scoped history writer', () => {
  it('splits across a formatted run preserving metadata and unrelated newer work without requiring an owner ID', () => {
    const { session, round, make, accept } = fixture('Before **marked words** after');
    Object.assign(session.paragraphs[0], { header: 'Heading', referenceId: 'reference', portionMarking: 'U' });round.baseline.session = structuredClone(session);
    const proposal = make({ kind: 'split-paragraph', paragraphId: 'first', splitAt: 16, newParagraphId: 'fresh' });
    session.paragraphs[2].text = 'Newer unrelated work.';session.formData.subject = 'NEWER';
    const plan = accept(proposal);expect(plan.status).toBe('ready');
    expect(plan.session.paragraphs.slice(0, 2)).toEqual([{ ...session.paragraphs[0], text: 'Before **marked **' }, { id: 'fresh', level: 0, portionMarking: 'U', text: '**words** after' }]);
    expect(plan.session.paragraphs.at(-1)?.text).toBe('Newer unrelated work.');expect(plan.session.formData.subject).toBe('NEWER');
    expect(round.baseline.session.paragraphs[0].text).toBe('Before **marked words** after');expect(round.ownerDocumentId).toBeUndefined();
    const undo = planReviewSuggestionWrite(round, plan.session, history(round, plan.state, 'undo'), session);
    expect(undo.session).toEqual(session);
    expect(planReviewSuggestionWrite(round, undo.session, history(round, undo.state, 'redo'), plan.session).session).toEqual(plan.session);
  });
  it('maps known left/right discussions, retains crossing quote and full reattachment history, and proves Undo replay', () => {
    const { session, round, make, accept } = fixture();
    session.reviewComments = { version: 3, threads: [[0,4], [12,17], [5,17]].map(([start,end]) => ({ id: crypto.randomUUID(), anchor: captureTextRange(session, 'first', start, end)!, resolved: false,
      messages: [{ id: crypto.randomUUID(), author: 'Reviewer', text: 'Comment', createdAt: '2026-11-15T00:00:00Z' }] })) };
    session.reviewComments.threads[1].anchorHistory = [{ anchor: captureTextRange(session,'first',0,4)!, reattachedAt:'2026-11-15T01:00:00Z' }];
    round.baseline.session = structuredClone(session);
    const plan = accept(make({ kind:'split-paragraph', paragraphId:'first', splitAt:12, newParagraphId:'fresh' }));
    const right = plan.session.reviewComments!.threads[1];expect(right.anchor).toMatchObject({ paragraphId:'first', tracking:{paragraphId:'fresh',start:0,end:5} });
    expect(resolveTextRange(plan.session,right.anchor as never)).toMatchObject({status:'current',text:'Right'});
    expect(plan.session.reviewComments!.threads[2].anchor).toMatchObject({detached:true});expect(right.anchorHistory).toEqual(session.reviewComments.threads[1].anchorHistory);
    const undo = planReviewSuggestionWrite(round,plan.session,history(round,plan.state,'undo'),session);expect(undo.session).toEqual(session);
    const forged = structuredClone(session);forged.reviewComments!.threads[0].messages[0].text='Forged';
    expect(() => planReviewSuggestionWrite(round,plan.session,history(round,plan.state,'undo'),forged)).toThrow(/discussion/);
  });
  it('joins explicitly selected adjacent paragraphs with Unicode/variables/marks and exact separator', () => {
    const { session, round, make, accept } = fixture('Équipe 😀 **bold** {{NAME}} ');
    session.paragraphs[1].text = '*italic* __underlined__';round.baseline.session=structuredClone(session);
    const plan=accept(make({kind:'join-paragraphs',paragraphId:'first',nextParagraphId:'second',separator:' '}));
    expect(plan.session.paragraphs[0]).toEqual({...session.paragraphs[0],text:'Équipe 😀 **bold** {{NAME}}  *italic* __underlined__'});
    const undo=planReviewSuggestionWrite(round,plan.session,history(round,plan.state,'undo'),session);expect(undo.session).toEqual(session);
    expect(planReviewSuggestionWrite(round,undo.session,history(round,undo.state,'redo'),plan.session).session).toEqual(plan.session);
  });
  it('maps a joined second-paragraph range by an explicit offset and restores its reserved identity on Undo', () => {
    const {session,round,make,accept}=fixture();session.reviewComments={version:3,threads:[{id:crypto.randomUUID(),anchor:captureTextRange(session,'second',0,6)!,resolved:false,messages:[{id:crypto.randomUUID(),author:'Reviewer',text:'Retain ID',createdAt:'2026-11-15T00:00:00Z'}]}]};round.baseline.session=structuredClone(session);
    const plan=accept(make({kind:'join-paragraphs',paragraphId:'first',nextParagraphId:'second',separator:' '}));
    const anchor=plan.session.reviewComments!.threads[0].anchor;expect(anchor).toMatchObject({paragraphId:'second',tracking:{paragraphId:'first',start:25,end:31}});expect(resolveTextRange(plan.session,anchor as never).status).toBe('current');
    expect(planReviewSuggestionWrite(round,plan.session,history(round,plan.state,'undo'),session).session).toEqual(session);
  });
  it.each(['portionMarking','header','referenceId','level','figure'] as const)('rejects forged after metadata %s in validation and writer', field => {
    const {round,session,make}=fixture(),proposal=make({kind:'split-paragraph',paragraphId:'first',splitAt:12,newParagraphId:'fresh'});
    const target=proposal.changes[0].target;if(target.kind!=='structure')throw new Error();
    Object.assign(target.operation.after[1],{[field]:field==='level'?1:field==='figure'?{name:'hidden'}:'FORGED'});
    expect(() => validateReviewSuggestion(round,proposal)).toThrow();
    const state={...emptyReviewSuggestionState(round),proposals:[proposal]};
    expect(() => planReviewSuggestionWrite(round,session,{kind:'suggestion-write',version:1,id:`suggestion-write_${crypto.randomUUID()}`,documentId:'source',createdAt:2,round:{id:round.id,baselineDigest:round.baselineDigest},before:null,after:state,intent:{kind:'propose',proposals:[proposal]}})).toThrow();
  });
  it('blocks descendants, nonadjacent selections, mixed labels and reused identities', () => {
    const {session}=fixture();session.paragraphs[2].level=1;
    expect(() => captureReviewStructure(session,{kind:'join-paragraphs',paragraphId:'first',nextParagraphId:'second',separator:' '})).toThrow(/child/);
    expect(() => captureReviewStructure(session,{kind:'split-paragraph',paragraphId:'second',splitAt:6})).toThrow(/child/);
    expect(() => captureReviewStructure(session,{kind:'join-paragraphs',paragraphId:'first',nextParagraphId:'last',separator:' '})).toThrow(/adjacent/);
    session.paragraphs[2].level=0;
    expect(() => captureReviewStructure(session,{kind:'split-paragraph',paragraphId:'first',splitAt:12,newParagraphId:'first'})).toThrow();
    expect(() => captureReviewStructure(session,{kind:'split-paragraph',paragraphId:'first',splitAt:12,newParagraphId:'second'})).toThrow(/reserved/);
    session.paragraphs[1].header='Retained label';expect(() => captureReviewStructure(session,{kind:'join-paragraphs',paragraphId:'first',nextParagraphId:'second',separator:' '})).toThrow(/heading/);
  });
  it.each(['text','missing','parent'] as const)('blocks stale %s and retains the document', kind => {
    const {session,make,accept}=fixture(),proposal=make({kind:'split-paragraph',paragraphId:'first',splitAt:12});
    if(kind==='text')session.paragraphs[0].text+=' newer';if(kind==='missing')session.paragraphs[0].id='other';if(kind==='parent')session.paragraphs[0].level=1;
    const plan=accept(proposal);expect(plan.status).toBe('stale');expect(plan.session).toEqual(session);expect(plan.state.decisions).toEqual([]);
  });
  it('rejects after text, unknown fields, malformed graphemes and duplicate replay', () => {
    const {session,round,make,accept}=fixture(),proposal=make({kind:'split-paragraph',paragraphId:'first',splitAt:12});const plan=accept(proposal);
    expect(planReviewSuggestionDecision(round,plan.session,plan.state,proposal.id,'accepted').status).toBe('decided');
    const target=proposal.changes[0].target;if(target.kind!=='structure')throw new Error();target.operation.after[0].text+='changed';expect(() => validateReviewStructureTarget(session,target)).toThrow();
  });
});
