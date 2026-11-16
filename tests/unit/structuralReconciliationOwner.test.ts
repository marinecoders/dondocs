import 'fake-indexeddb/auto';
import { captureReconciledReviewStructure } from '@/lib/reconcileReviewStructure';
import { structureSuggestionText } from '@/lib/reviewStructureSuggestions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '@/lib/documentsDb';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore, commitCurrentDocument, flushDocumentWrites, captureDocumentScope, changeDocumentHistory } from '@/stores/documentsStore';
import { useProfileStore } from '@/stores/profileStore';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { startReviewRound, transitionReviewRound } from '@/lib/reviewRoundActions';
import { decideReviewSuggestion, submitReviewSuggestion, loadReviewSuggestionWorkspace } from '@/lib/reviewSuggestionActions';
import { createParagraphStructureSuggestion, planReviewSuggestionDecision } from '@/lib/reviewSuggestions';
import { reviewSuggestionRecordSchema, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import { captureTextRange } from '@/lib/reviewTextRanges';
import { useHistoryStore } from '@/stores/historyStore';
import { listReviewRounds } from '@/lib/reviewRounds';
import { buildBackup } from '@/lib/backup';

vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
const saved=async(id:string)=>(await db.idbGetAllDocuments())!.find(document=>document.id===id)!;
beforeEach(async()=>{
  vi.mocked(getExportDeploymentPolicy).mockResolvedValue(policy);await flushDocumentWrites();
  for(const round of await listReviewRounds())await db.idbDeleteReviewRound(round.id,round.baselineDigest);
  for(const document of await db.idbGetAllDocuments()??[])await db.idbDeleteDocument(document.id);
  sessionStorage.clear();useProfileStore.setState({profiles:{},selectedProfile:null});
  useDocumentsStore.setState({docs:{},trash:{},currentId:null,hydrated:true,baseline:null});useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({paragraphs:[{id:'move-source',text:'**Équipe 👩🏽‍✈️** {{unitName}}',level:0,header:'Heading',referenceId:'native-reference'},
    {id:'move-child',text:'Child with reference',level:1},
    {id:'move-destination',text:'Destination',level:0}, {id:'move-destination-child',text:'Destination child',level:1},
    {id:'move-tail',text:'Independent tail',level:0}]});
  const baseline=getSerializedSession();
  useDocumentStore.setState({reviewComments:{version:3,threads:[{id:crypto.randomUUID(),anchor:captureTextRange(baseline,'move-child',0,5)!,resolved:false,
    messages:[{id:crypto.randomUUID(),author:'Synthetic reviewer',text:'Keep this discussion on its paragraph.',createdAt:new Date().toISOString()}]}]}});
  await commitCurrentDocument();
});
afterEach(async()=>{await flushDocumentWrites();vi.restoreAllMocks();});
async function fixture(){
  const round=await startReviewRound('Synthetic movement review');
  const proposal=createParagraphStructureSuggestion(round,{author:'Synthetic reviewer',operation:{kind:'move-paragraph',paragraphId:'move-source',destinationId:'move-destination',placement:'after'}});
  expect((await submitReviewSuggestion(proposal)).status).toBe('committed');
  return{round,proposal,id:round.ownerDocumentId!};
}
async function reconciledDbFixture(){
  const f=await fixture();useDocumentStore.getState().updateParagraph(0,{header:'Current edited heading'});await commitCurrentDocument();const before=await saved(f.id);
  const state=reviewSuggestionRecordSchema.parse(await db.idbReadReviewSuggestions(f.id,f.round.id)).state;const plan=planReviewSuggestionDecision(f.round,before.session,state,f.proposal.id,'accepted'),decision=plan.state.decisions[0];
  const operation:ReviewSuggestionWrite={kind:'suggestion-write',version:1,id:`suggestion-write_${crypto.randomUUID()}`,documentId:f.id,createdAt:Date.now(),round:{id:f.round.id,baselineDigest:f.round.baselineDigest},before:state,after:plan.state,intent:{kind:'decide',proposalId:f.proposal.id,action:'accepted',record:{id:decision.id,decidedAt:decision.decidedAt},resolutions:decision.resolutions}};
  return {...f,before,operation,after:{...structuredClone(before),meta:{...before.meta,updatedAt:before.meta.updatedAt+1,nativeReviewText:true as const},session:plan.session}};
}
describe('structural reconciliation through actual source and database writes',()=>{
  it('reloads and reverses a move retaining an earlier accepted insertion identity',async()=>{
    const {round,proposal,id}=await fixture();
    const insertion=createParagraphStructureSuggestion(round,{author:'Reviewer',operation:{kind:'insert-paragraph',index:2,text:'Accepted independent sibling.',level:0,paragraphId:'accepted-independent'}});
    await submitReviewSuggestion(insertion);
    expect((await decideReviewSuggestion(round.id,insertion.id,'accepted')).status).toBe('committed');
    const inserted=getSerializedSession();
    expect((await decideReviewSuggestion(round.id,proposal.id,'accepted')).status).toBe('committed');
    const moved=getSerializedSession();
    expect(moved.paragraphs.map(p=>p.id)).toEqual(['accepted-independent','move-destination','move-destination-child','move-source','move-child','move-tail']);
    expect((await saved(id)).session.paragraphs).toEqual(moved.paragraphs);
    const workspace=await loadReviewSuggestionWorkspace(round.id);
    expect(workspace.state!.decisions.map(decision=>decision.action)).toEqual(['accepted','accepted']);
    expect(changeDocumentHistory('undo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect(getSerializedSession().paragraphs).toEqual(inserted.paragraphs);
    expect(changeDocumentHistory('redo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect((await saved(id)).session.paragraphs).toEqual(moved.paragraphs);
    expect(JSON.parse(await buildBackup()).reviewSuggestions.some((record:{state:{roundId:string}})=>record.state.roundId===round.id)).toBe(true);
  });
  it('merges newer moved-node content and inserted siblings, then persists exact Undo/Redo scopes',async()=>{
    const {round,proposal,id}=await fixture();useDocumentStore.getState().updateParagraph(0,{text:'**New current source** {{UNIT}}',header:'Current heading'});
    useDocumentStore.setState(s=>({paragraphs:[...s.paragraphs.slice(0,2),{id:'independent-sibling',text:'Independent insertion',level:0},...s.paragraphs.slice(2)]}));
    await commitCurrentDocument();const before=getSerializedSession();
    expect((await decideReviewSuggestion(round.id,proposal.id,'accepted')).status).toBe('committed');
    const accepted=getSerializedSession();expect(accepted.paragraphs.map(p=>p.id)).toEqual(['independent-sibling','move-destination','move-destination-child','move-source','move-child','move-tail']);
    for(const node of accepted.paragraphs)expect(node).toEqual(before.paragraphs.find(p=>p.id===node.id));expect(accepted.reviewComments).toEqual(before.reviewComments);
    expect((await saved(id)).session.paragraphs).toEqual(accepted.paragraphs);
    expect(changeDocumentHistory('undo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect(getSerializedSession().paragraphs).toEqual(before.paragraphs);
    expect(changeDocumentHistory('redo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect(getSerializedSession().paragraphs).toEqual(accepted.paragraphs);
    expect((await loadReviewSuggestionWorkspace(round.id)).state!.decisions.map(d=>d.action)).toEqual(['accepted','reversed','restored']);
    expect(JSON.parse(await buildBackup()).reviewSuggestions.some((r:{state:{decisions:Array<{resolutions?:Array<{structure?:unknown}>}>}})=>r.state.decisions.some(d=>d.resolutions?.some(v=>v.structure)))).toBe(true);
  });
  it('reserves IDs retained only by a rebased decision after ordinary history is cleared', async () => {
    const { round, proposal, id } = await fixture();
    useDocumentStore.setState(state => ({ paragraphs: [...state.paragraphs.slice(0, 2), { id: 'rebased-only-id', text: 'Newer independent sibling.', level: 0 }, ...state.paragraphs.slice(2)] }));
    await commitCurrentDocument();
    expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted')).status).toBe('committed');
    const accepted = reviewSuggestionRecordSchema.parse(await db.idbReadReviewSuggestions(id, round.id)).state;
    expect(accepted.proposals[0].changes[0].target.kind === 'structure' && accepted.proposals[0].changes[0].target.operation.before.some(node => node.id === 'rebased-only-id')).toBe(false);
    expect(accepted.decisions[0].resolutions![0].structure!.operation.before.some(node => node.id === 'rebased-only-id')).toBe(true);
    useDocumentStore.setState(state => ({ paragraphs: state.paragraphs.filter(node => node.id !== 'rebased-only-id') }));
    await commitCurrentDocument();
    useHistoryStore.setState({ past: [], future: [], currentSnapshot: null });
    const later = await startReviewRound('Synthetic later review');
    const reused = createParagraphStructureSuggestion(later, { author: 'Reviewer', operation: { kind: 'insert-paragraph', index: 0, level: 0, text: 'Different new content.', paragraphId: 'rebased-only-id' } });
    await expect(submitReviewSuggestion(reused)).rejects.toThrow(/identity.*reserved/);
    expect(await db.idbReadReviewSuggestions(id, later.id)).toBeNull();
    expect((await saved(id)).session.paragraphs.some(node => node.id === 'rebased-only-id')).toBe(false);
  });
  it('requires visible current delete confirmation and protects changed content and comments across Undo/Redo',async()=>{
    const round=await startReviewRound('Synthetic deletion reconciliation'),proposal=createParagraphStructureSuggestion(round,{author:'Reviewer',operation:{kind:'delete-paragraph',paragraphId:'move-child'}});await submitReviewSuggestion(proposal);
    useDocumentStore.getState().updateParagraph(1,{text:'New current child'});await commitCurrentDocument();const before=getSerializedSession();
    await expect(decideReviewSuggestion(round.id,proposal.id,'accepted')).rejects.toThrow();
    const target=proposal.changes[0].target;if(target.kind!=='structure')throw new Error();const structure=captureReconciledReviewStructure(before,target);
    const resolution={changeId:proposal.changes[0].id,structure,expectedCurrent:structureSuggestionText(structure.operation.before),value:structureSuggestionText(structure.operation.after)};
    expect((await decideReviewSuggestion(round.id,proposal.id,'accepted',[resolution])).status).toBe('committed');expect(getSerializedSession().paragraphs.some(p=>p.id==='move-child')).toBe(false);
    expect(changeDocumentHistory('undo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect(getSerializedSession().paragraphs).toEqual(before.paragraphs);expect(getSerializedSession().reviewComments).toEqual(before.reviewComments);
    expect(changeDocumentHistory('redo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect(getSerializedSession().paragraphs.some(p=>p.id==='move-child')).toBe(false);
  });
  it.each(['metadata','target','source','scope'] as const)('rejects forged rebased %s at the database boundary',async kind=>{
    const {round,proposal,id}=await fixture();useDocumentStore.getState().updateParagraph(0,{header:'Current heading'});await commitCurrentDocument();const before=await saved(id);
    const state=reviewSuggestionRecordSchema.parse(await db.idbReadReviewSuggestions(id,round.id)).state,plan=planReviewSuggestionDecision(round,before.session,state,proposal.id,'accepted'),decision=plan.state.decisions[0];
    const resolutions=structuredClone(decision.resolutions!);const structure=resolutions[0].structure!;
    if(kind==='metadata')structure.operation.after[0].portionMarking='S';if(kind==='target'&&structure.operation.kind==='move-paragraph')structure.operation.paragraphId='move-tail';if(kind==='source')structure.operation.before[0].text='Hidden baseline';if(kind==='scope')structure.operation.gap.after=null;
    const operation:ReviewSuggestionWrite={kind:'suggestion-write',version:1,id:`suggestion-write_${crypto.randomUUID()}`,documentId:id,createdAt:Date.now(),round:{id:round.id,baselineDigest:round.baselineDigest},before:state,after:plan.state,intent:{kind:'decide',proposalId:proposal.id,action:'accepted',record:{id:decision.id,decidedAt:decision.decidedAt},resolutions}};
    const after={...structuredClone(before),meta:{...before.meta,updatedAt:before.meta.updatedAt+1,nativeReviewText:true as const},session:plan.session};
    expect(await db.idbApplyReviewSuggestions(before,after,operation)).not.toBe('committed');expect(await saved(id)).toEqual(before);expect(await db.idbReadReviewSuggestionReceipt(operation.id)).toBeNull();
  });
  it('keeps exact rebased decisions atomic under owner, cancellation, stale CAS, duplicate and closed-round guards',async()=>{
    const f=await reconciledDbFixture(),foreign=structuredClone(f.operation);foreign.documentId='foreign';expect(await db.idbApplyReviewSuggestions(f.before,f.after,foreign)).toBe('conflict');
    expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation,()=>false)).toBe('stale');
    const newer=structuredClone(f.before);newer.session.formData.subject='Other tab edit';await db.idbPutDocument(newer);expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('conflict');await db.idbPutDocument(f.before);
    expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('committed');expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('already-committed');
  });
  it('refuses closed reviews and rolls back rebased content, decisions and receipts on quota failure',async()=>{
    const f=await reconciledDbFixture(),put=IDBObjectStore.prototype.put;
    const fail=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
      if(value&&typeof value==='object'&&'key'in value&&String(value.key).startsWith('review-suggestions:'))throw new DOMException('Synthetic quota','QuotaExceededError');
      return key===undefined?put.call(this,value):put.call(this,value,key);
    });expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('failed');fail.mockRestore();expect(await saved(f.id)).toEqual(f.before);expect(await db.idbReadReviewSuggestionReceipt(f.operation.id)).toBeNull();
    await transitionReviewRound(f.round,'close');expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation)).not.toBe('committed');expect((await saved(f.id)).session).toEqual(f.before.session);
  });
  it.each(['split-paragraph','join-paragraphs'] as const)('requires current review and persists exact %s content across Undo/Redo',async kind=>{
    useDocumentStore.setState({paragraphs:[{id:'left',text:'Reviewed alpha',level:0},{id:'right',text:'Reviewed beta',level:0},{id:'tail',text:'Retained tail',level:0}]});await commitCurrentDocument();
    const round=await startReviewRound('Synthetic split join overlap');const operation=kind==='split-paragraph'?{kind,paragraphId:'left',splitAt:8,newParagraphId:'owned-split'}:{kind,paragraphId:'left',nextParagraphId:'right',separator:' ' as const};
    const proposal=createParagraphStructureSuggestion(round,{author:'Reviewer',operation});await submitReviewSuggestion(proposal);useDocumentStore.getState().updateParagraph(0,{text:'**New alpha content**'});await commitCurrentDocument();const before=getSerializedSession();
    await expect(decideReviewSuggestion(round.id,proposal.id,'accepted')).rejects.toThrow();const target=proposal.changes[0].target;if(target.kind!=='structure')throw new Error();
    const structure=captureReconciledReviewStructure(before,target,kind==='split-paragraph'?6:undefined);const resolution={changeId:proposal.changes[0].id,structure,expectedCurrent:structureSuggestionText(structure.operation.before),value:structureSuggestionText(structure.operation.after)};
    expect((await decideReviewSuggestion(round.id,proposal.id,'accepted',[resolution])).status).toBe('committed');const accepted=getSerializedSession();
    expect(accepted.paragraphs[0].text).toBe(kind==='split-paragraph'?'**New **':'**New alpha content** Reviewed beta');
    expect(changeDocumentHistory('undo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect(getSerializedSession().paragraphs).toEqual(before.paragraphs);
    expect(changeDocumentHistory('redo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect(getSerializedSession().paragraphs).toEqual(accepted.paragraphs);
  });
  it('requires a deliberate competing-move decision and retains current content',async()=>{
    const {round,proposal}=await fixture();useDocumentStore.setState(s=>({paragraphs:[...s.paragraphs.slice(2,4),...s.paragraphs.slice(0,2),...s.paragraphs.slice(4)]}));await commitCurrentDocument();const before=getSerializedSession();
    // This exact move is already present: it cannot be silently reapplied.
    await expect(decideReviewSuggestion(round.id,proposal.id,'accepted')).rejects.toThrow();expect(getSerializedSession().paragraphs).toEqual(before.paragraphs);
    expect((await decideReviewSuggestion(round.id,proposal.id,'rejected')).status).toBe('committed');
  });
});
