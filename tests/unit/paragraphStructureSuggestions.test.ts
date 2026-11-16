import { describe, expect, it } from 'vitest';
import type { SerializedSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import { applyReviewStructure, captureReviewStructure } from '@/lib/reviewStructureSuggestions';
import { appendReviewSuggestions, createParagraphStructureSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision,
  reviewSuggestionText, validateReviewSuggestion, validateReviewSuggestionState } from '@/lib/reviewSuggestions';
import { planReviewSuggestionWrite, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import { captureTextRange } from '@/lib/reviewTextRanges';

function fixture() {
  const session: SerializedSession = { documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formType: 'navmc_10274', formData: { subject: 'EXAMPLE', classLevel: 'unclassified' },
    paragraphs: [{ id: 'first', text: 'First body.', level: 0 }, { id: 'second', text: 'Second body.', level: 0 }, { id: 'third', text: 'Third body.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 1 };
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 1,
    label: 'Example review', sourceDocumentId: 'source', ownerDocumentId: 'source', baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session: structuredClone(session) } };
  const make = (operation: Parameters<typeof createParagraphStructureSuggestion>[1]['operation']) => createParagraphStructureSuggestion(round, { author: 'Example reviewer', operation });
  const stateFor = (proposal: ReturnType<typeof make>) => appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
  return { session, round, make, stateFor };
}
function history(round: ReviewRound, before: ReturnType<typeof emptyReviewSuggestionState>, acceptanceId: string, direction: 'undo'|'redo'): ReviewSuggestionWrite {
  return { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: 'source', createdAt: 2,
    round: { id: round.id, baselineDigest: round.baselineDigest }, before, after: before,
    intent: { kind: 'history', acceptanceId, direction, record: { id: crypto.randomUUID(), decidedAt: 2 } } };
}

describe('paragraph insertion/deletion suggestions', () => {
  it('creates one stable new identity, accepts scoped insertion, and leaves the baseline unchanged', () => {
    const { session, round, make, stateFor } = fixture(), original = structuredClone(session);
    const proposal = make({ kind: 'insert-paragraph', index: 1, level: 0, text: 'New 😀 paragraph.' });
    const target = proposal.changes[0].target;if (target.kind !== 'structure') throw new Error();
    session.formData.subject = 'Newer subject';session.paragraphs[2].text = 'Independent newer body.';
    session.enclosures.push({ title: 'Retained', fileRef: { id: 'asset', name: 'example.pdf', size: 42, type: 'application/pdf' } });
    const plan = planReviewSuggestionDecision(round, session, stateFor(proposal), proposal.id, 'accepted');
    expect(plan.status).toBe('ready');expect(plan.session.paragraphs.map(p => p.id)).toEqual(['first', target.operation.after[0].id, 'second', 'third']);
    expect(plan.session.formData).toEqual(session.formData);expect(plan.session.enclosures).toEqual(session.enclosures);
    expect(plan.session.paragraphs[3].text).toBe('Independent newer body.');expect(round.baseline.session).toEqual(original);
    expect(validateReviewSuggestion(round, JSON.parse(JSON.stringify(proposal)))).toEqual(proposal);
    expect(planReviewSuggestionDecision(round, plan.session, plan.state, proposal.id, 'accepted').status).toBe('decided');
  });
  it('deletes a complete formatted/variable/marked leaf and inversely restores every node field', () => {
    const { session, round, make, stateFor } = fixture();
    session.paragraphs[1] = { ...session.paragraphs[1], text: '**Keep formatting** {{unitName}}', header: 'Heading', portionMarking: 'CUI', referenceId: 'native-crossref' };
    round.baseline.session = structuredClone(session);
    const proposal = make({ kind: 'delete-paragraph', paragraphId: 'second' });
    const plan = planReviewSuggestionDecision(round, session, stateFor(proposal), proposal.id, 'accepted');
    expect(plan.session.paragraphs.map(p => p.id)).toEqual(['first','third']);
    const undo = planReviewSuggestionWrite(round, plan.session, history(round, plan.state, plan.state.decisions[0].id, 'undo'), session);
    expect(undo.session).toEqual(session);expect(undo.state.decisions.at(-1)?.action).toBe('reversed');
    const redo = planReviewSuggestionWrite(round, undo.session, history(round, undo.state, plan.state.decisions[0].id, 'redo'), plan.session);
    expect(redo.session).toEqual(plan.session);expect(redo.state.decisions.at(-1)?.action).toBe('restored');
  });
  it('refuses resource-bearing figure deletion explicitly, preserving all original resources', () => {
    const { session, round, make } = fixture();
    session.paragraphs[1].figure = { name: 'Synthetic figure', fileRef: { id: 'figure-file', name: 'example.png', size: 8, type: 'image/png' }, portionMarking: 'U' };
    round.baseline.session = structuredClone(session);const before=structuredClone(session);
    expect(() => make({ kind: 'delete-paragraph', paragraphId: 'second' })).toThrow(/Structured paragraphs.*add a comment/);
    expect(session).toEqual(before);
  });
  it.each([{ tableKey: 'existing-table' }, { procedure: true }, { appendix: true }, { callout: 'warning' as const }, { publicationSection: 'purpose' as const }])('refuses structured deletion with comment recovery: %j', metadata => {
    const { session, round, make } = fixture();Object.assign(session.paragraphs[1], metadata);round.baseline.session=structuredClone(session);
    expect(() => make({kind:'delete-paragraph',paragraphId:'second'})).toThrow(/Structured paragraphs.*add a comment/);
  });
  it('detaches removed range anchors without losing paragraph discussion context and verifies full discussion replay on Undo', () => {
    const { session, round, make, stateFor } = fixture();
    session.reviewComments = { version: 3, threads: [{ id: crypto.randomUUID(), anchor: captureTextRange(session, 'second', 0, 6)!, resolved: false,
      messages: [{ id: crypto.randomUUID(), author: 'Example', text: 'Retain this discussion.', createdAt: '2026-11-15T00:00:00Z' }] },
      { id: crypto.randomUUID(), anchor: { kind: 'paragraph', paragraphId: 'second', context: 'Second body.', docType: 'naval_letter' }, resolved: true,
      messages: [{ id: crypto.randomUUID(), author: 'Example', text: 'Whole paragraph.', createdAt: '2026-11-15T00:00:00Z' }] }] };
    round.baseline.session = structuredClone(session);
    const proposal = make({ kind: 'delete-paragraph', paragraphId: 'second' });
    const plan = planReviewSuggestionDecision(round, session, stateFor(proposal), proposal.id, 'accepted');
    expect(plan.session.reviewComments?.threads[0].anchor).toMatchObject({ paragraphId: 'second', detached: true, context: 'Second body.' });
    expect(plan.session.reviewComments?.threads[1]).toEqual(session.reviewComments.threads[1]);
    const operation = history(round, plan.state, plan.state.decisions[0].id, 'undo');
    expect(planReviewSuggestionWrite(round, plan.session, operation, session).session).toEqual(session);
    const forged = structuredClone(session);forged.reviewComments!.threads[0].messages[0].text = 'Forged restoration';
    expect(() => planReviewSuggestionWrite(round, plan.session, operation, forged)).toThrow(/discussion content/);
  });
  it.each(['edit','indent'] as const)('blocks a stale target: %s', kind => {
    const { session, round, make, stateFor } = fixture();
    const proposal = make({ kind: 'delete-paragraph', paragraphId: 'second' });
    if (kind === 'edit') session.paragraphs[1].text = 'Edited second';
    if (kind === 'indent') session.paragraphs[0].level = 1;
    const plan = planReviewSuggestionDecision(round, session, stateFor(proposal), proposal.id, 'accepted');
    expect(plan.status).toBe('stale');expect(plan.session).toEqual(session);expect(plan.state.decisions).toEqual([]);
    expect(planReviewSuggestionDecision(round, session, stateFor(proposal), proposal.id, 'rejected').session).toEqual(session);
  });
  it.each(['delete','move','interpose'] as const)('reconciles independent neighbor changes without rewriting current nodes: %s', kind => {
    const { session, round, make, stateFor } = fixture();
    const proposal = make({ kind: 'delete-paragraph', paragraphId: 'second' });
    if (kind === 'delete') session.paragraphs.shift();
    if (kind === 'move') session.paragraphs.reverse();
    if (kind === 'interpose') session.paragraphs.splice(1, 0, { id: 'interposed', text: 'Newer work', level: 0 });
    // The original strict operation is stale, but the116 identity-based planner
    // safely derives deletion of the unchanged stable leaf at its current gap.
    expect(() => applyReviewStructure(session, proposal.changes[0].target as Parameters<typeof applyReviewStructure>[1])).toThrow();
    const plan = planReviewSuggestionDecision(round, session, stateFor(proposal), proposal.id, 'accepted');
    expect(plan.status).toBe('ready');
    expect(plan.session.paragraphs).toEqual(session.paragraphs.filter(node => node.id !== 'second'));
    expect(plan.state.decisions[0].resolutions?.[0].structure?.operation.before).toEqual([session.paragraphs.find(node => node.id === 'second')]);
  });
  it('allows independent neighbor text edits while guarding their stable position and parent', () => {
    const { session, round, make, stateFor } = fixture();
    const proposal = make({ kind: 'insert-paragraph', index: 1, text: 'Inserted', level: 0 });session.paragraphs[0].text = 'Newer first';
    expect(planReviewSuggestionDecision(round, session, stateFor(proposal), proposal.id, 'accepted').session.paragraphs[0].text).toBe('Newer first');
  });
  it('refuses deletion of parents, invalid insertion nesting, child stealing, and deletion of the last paragraph', () => {
    const { session } = fixture();session.paragraphs[1].level = 1;
    expect(() => captureReviewStructure(session, { kind:'delete-paragraph',paragraphId:'first' })).toThrow(/child|nesting/);
    expect(() => captureReviewStructure(session, { kind:'insert-paragraph',index:1,text:'New parent',level:0 })).toThrow(/child|reparent/);
    expect(() => captureReviewStructure(session, { kind:'insert-paragraph',index:0,text:'Orphan',level:1 })).toThrow(/nesting/);
    const nested = captureReviewStructure(session,{kind:'insert-paragraph',index:2,text:'Another child',level:1});
    expect(applyReviewStructure(session,nested).paragraphs[2].level).toBe(1);
    session.paragraphs = [session.paragraphs[0]];
    expect(() => captureReviewStructure(session,{kind:'delete-paragraph',paragraphId:'first'})).toThrow(/at least one/);
  });
  it.each(['**rich**', '{{variable}}', '\\textbf{legacy}', 'two\nparagraphs', '\uD800'])('refuses unsupported new paragraph: %s', text => {
    const { make } = fixture();expect(() => make({kind:'insert-paragraph',index:1,text,level:0})).toThrow();
  });
  it('refuses paragraph ID collisions in baseline, current, detached anchor history and other review operations', () => {
    const { session, round, make, stateFor } = fixture();
    expect(() => make({kind:'insert-paragraph',index:1,text:'New',level:0,paragraphId:'first'})).toThrow(/identity/);
    const proposal = make({kind:'insert-paragraph',index:1,text:'New',level:0,paragraphId:'reserved-new'});
    session.paragraphs.push({id:'reserved-new',text:'Other node',level:0});
    expect(planReviewSuggestionDecision(round,session,stateFor(proposal),proposal.id,'accepted').status).toBe('stale');
    const clone = structuredClone(proposal);clone.id=`proposal_${crypto.randomUUID()}`;clone.changes[0].id=crypto.randomUUID();
    expect(() => appendReviewSuggestions(round,stateFor(proposal),[clone])).toThrow(/reuse/);
    session.paragraphs.pop();session.reviewComments={version:3,threads:[{id:crypto.randomUUID(),anchor:{...captureTextRange(session,'second',0,6)!,paragraphId:'reserved-new',detached:true},resolved:false,
      anchorHistory:[{anchor:{...captureTextRange(session,'second',0,6)!,paragraphId:'tombstone'},reattachedAt:'2026-11-15T00:00:00Z'}],
      messages:[{id:crypto.randomUUID(),author:'Example',text:'Retained',createdAt:'2026-11-15T00:00:00Z'}]}]};
    expect(planReviewSuggestionDecision(round,session,stateFor(proposal),proposal.id,'accepted').status).toBe('stale');
    round.baseline.session=structuredClone(session);
    expect(() => make({kind:'insert-paragraph',index:1,text:'New',level:0,paragraphId:'tombstone'})).toThrow(/reserved/);
  });
  it('allows an initial top-level paragraph in an empty document and refuses a nested orphan', () => {
    const { session } = fixture();session.paragraphs=[];
    expect(applyReviewStructure(session,captureReviewStructure(session,{kind:'insert-paragraph',index:0,text:'First paragraph',level:0})).paragraphs).toHaveLength(1);
    expect(() => captureReviewStructure(session,{kind:'insert-paragraph',index:0,text:'Orphan',level:1})).toThrow(/nesting/);
  });
  it('rejects arbitrary retained node mutations and counts all retained metadata for limits and handling', () => {
    const { round, make, stateFor } = fixture();const proposal=make({kind:'delete-paragraph',paragraphId:'second'});
    const target=proposal.changes[0].target;if(target.kind!=='structure') throw new Error();
    target.operation.before[0].text='Forged body';expect(() => validateReviewSuggestion(round,proposal)).toThrow();
    target.operation.before[0].text='Second body.';target.operation.before[0].header='SECRET metadata';
    expect(reviewSuggestionText([proposal]).some(value=>value.value==='SECRET metadata')).toBe(true);
    delete target.operation.before[0].header;
    const state=stateFor(proposal);const change=state.proposals[0].changes[0];if(change.target.kind!=='structure')throw new Error();
    change.target.operation.before[0].tableFootnotes=Array.from({length:20},(_,i)=>({id:`note-${i}`,text:'x'.repeat(20_000)}));
    expect(() => validateReviewSuggestionState(round,state)).toThrow();
  });
});
