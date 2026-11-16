import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '@/lib/documentsDb';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore, commitCurrentDocument, flushDocumentWrites, captureDocumentScope, changeDocumentHistory, recordDocumentHistory } from '@/stores/documentsStore';
import { useProfileStore } from '@/stores/profileStore';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { startReviewRound } from '@/lib/reviewRoundActions';
import { decideReviewSuggestion, submitReviewSuggestion, loadReviewSuggestionWorkspace } from '@/lib/reviewSuggestionActions';
import { createParagraphStructureSuggestion, emptyReviewSuggestionState, appendReviewSuggestions, planReviewSuggestionDecision } from '@/lib/reviewSuggestions';
import { planReviewSuggestionWrite, reviewSuggestionRecordSchema, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import { captureTextRange } from '@/lib/reviewTextRanges';
import { listReviewRounds } from '@/lib/reviewRounds';
import { createSuggestionReviewReturn, parseReviewReturn } from '@/lib/reviewReturns';
import { buildBackup } from '@/lib/backup';
import { captureReviewDecisionSummary, prepareReviewDecisionSummary, renderReviewDecisionSummary } from '@/lib/reviewDecisionSummary';

vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
vi.mock('@/lib/documentsDb', async original => {
  const actual = await original<typeof import('@/lib/documentsDb')>();
  return { ...actual, idbApplyReviewSuggestions: vi.fn(actual.idbApplyReviewSuggestions) };
});
const actualDb = await vi.importActual<typeof db>('@/lib/documentsDb');
const write = vi.mocked(db.idbApplyReviewSuggestions);
beforeEach(async () => {
  vi.mocked(getExportDeploymentPolicy).mockResolvedValue(policy);
  await flushDocumentWrites();write.mockReset().mockImplementation(actualDb.idbApplyReviewSuggestions);
  for (const round of await listReviewRounds()) await db.idbDeleteReviewRound(round.id,round.baselineDigest);
  for (const document of await db.idbGetAllDocuments() ?? []) await db.idbDeleteDocument(document.id);
  sessionStorage.clear();useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ paragraphs: [{ id:crypto.randomUUID(),text:'First body.',level:0 },{ id:crypto.randomUUID(),text:'**Second body.** {{unitName}}',level:0 },{ id:crypto.randomUUID(),text:'Third body.',level:0 }] });
  await commitCurrentDocument();
});
afterEach(async () => { write.mockImplementation(actualDb.idbApplyReviewSuggestions);await flushDocumentWrites();vi.restoreAllMocks(); });
async function fixture(kind:'insert-paragraph'|'delete-paragraph'='insert-paragraph') {
  const round=await startReviewRound('Synthetic paragraph review');
  const proposal=createParagraphStructureSuggestion(round,{author:'Synthetic reviewer',operation:kind==='insert-paragraph'
    ?{kind,index:3,text:'Inserted Équipe 👩🏽‍✈️.',level:0}:{kind,paragraphId:round.baseline.session.paragraphs[1].id!}});
  expect((await submitReviewSuggestion(proposal)).status).toBe('committed');
  return {round,proposal,id:round.ownerDocumentId!};
}
const saved=async(id:string)=>(await db.idbGetAllDocuments())!.find(document=>document.id===id)!;

describe('paragraph suggestions through the source owner and IndexedDB',()=>{
  it.each(['insert-paragraph','delete-paragraph'] as const)('persists %s with real Undo/Redo and preserves unrelated newer fields/body/attachments',async kind=>{
    const {round,proposal,id}=await fixture(kind);
    useDocumentStore.getState().setField('subject','Independent newer subject');
    useDocumentStore.getState().updateParagraph(2,{text:'Independent newer third.'});
    const before=getSerializedSession();
    expect((await decideReviewSuggestion(round.id,proposal.id,'accepted')).status).toBe('committed');
    const accepted=getSerializedSession();expect(accepted.paragraphs).toHaveLength(kind==='insert-paragraph'?4:2);
    expect((await saved(id)).session.paragraphs).toEqual(accepted.paragraphs);
    expect(changeDocumentHistory('undo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect(getSerializedSession().paragraphs).toEqual(before.paragraphs);
    expect(getSerializedSession().formData.subject).toBe('Independent newer subject');
    expect(changeDocumentHistory('redo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect(getSerializedSession().paragraphs).toEqual(accepted.paragraphs);
    const workspace=await loadReviewSuggestionWorkspace(round.id);expect(workspace.state?.decisions.map(decision=>decision.action)).toEqual(['accepted','reversed','restored']);
    const summary=await captureReviewDecisionSummary(workspace,new Date().toISOString());
    const html=renderReviewDecisionSummary(prepareReviewDecisionSummary(summary,policy));
    expect(html).toContain(kind==='insert-paragraph'?'Insert paragraph':'Delete paragraph');
    const backup=JSON.parse(await buildBackup());expect(backup.reviewSuggestions.some((record:{state:{proposals:Array<{id:string}>}})=>record.state.proposals.some(item=>item.id===proposal.id))).toBe(true);
    const returned=parseReviewReturn(createSuggestionReviewReturn(round.id,round.baselineDigest,{version:1,threads:[]},[proposal],{marking:'UNCLASSIFIED',customMarkings:[]}));
    expect(returned.version).toBe(2);if(returned.version===2)expect(returned.proposals[0]).toEqual(proposal);
  });
  it('keeps a pending storage failure and retries the exact paragraph change without losing later input',async()=>{
    const {round,proposal,id}=await fixture();write.mockResolvedValue('failed');
    expect((await decideReviewSuggestion(round.id,proposal.id,'accepted')).status).toBe('pending');
    expect((await saved(id)).session.paragraphs).toHaveLength(3);
    write.mockImplementation(actualDb.idbApplyReviewSuggestions);
    useDocumentStore.getState().updateParagraph(0,{text:'Later current work.'});useDocumentsStore.getState().syncCurrent();
    await flushDocumentWrites();
    expect((await saved(id)).session.paragraphs).toHaveLength(4);expect((await saved(id)).session.paragraphs[0].text).toBe('Later current work.');
  });
  it('rejects a stale structure without mutation and records an intentional rejection',async()=>{
    const {round,proposal,id}=await fixture('delete-paragraph');useDocumentStore.getState().updateParagraph(1,{header:'Newer heading'});await commitCurrentDocument();
    const before=await saved(id);await expect(decideReviewSuggestion(round.id,proposal.id,'accepted')).rejects.toThrow(/differs/);
    expect(await saved(id)).toEqual(before);expect((await decideReviewSuggestion(round.id,proposal.id,'rejected')).status).toBe('committed');
    expect((await saved(id)).session).toEqual(before.session);
  });
  it('reserves deleted/undone paragraph identities from ordinary source history',async()=>{
    const round=await startReviewRound('History identity review');const historyId=crypto.randomUUID();
    useDocumentStore.getState().addParagraph('History-only paragraph.',0);const last=useDocumentStore.getState().paragraphs.length-1;
    useDocumentStore.setState(state=>({paragraphs:state.paragraphs.map((paragraph,index)=>index===last?{...paragraph,id:historyId,text:'History-only paragraph.'}:paragraph)}));recordDocumentHistory(captureDocumentScope());await commitCurrentDocument();
    useDocumentStore.getState().removeParagraph(last);await commitCurrentDocument();
    const proposal=createParagraphStructureSuggestion(round,{author:'Example',operation:{kind:'insert-paragraph',index:3,text:'Other new content',level:0,paragraphId:historyId}});
    await expect(submitReviewSuggestion(proposal)).rejects.toThrow(/reserved/);
  });
});

async function dbFixture(){
  const {round,proposal,id}=await fixture();const before=await saved(id);
  const state=reviewSuggestionRecordSchema.parse(await db.idbReadReviewSuggestions(id,round.id)).state;
  const plan=planReviewSuggestionDecision(round,before.session,state,proposal.id,'accepted');const decision=plan.state.decisions[0];
  const operation:ReviewSuggestionWrite={kind:'suggestion-write',version:1,id:`suggestion-write_${crypto.randomUUID()}`,documentId:id,createdAt:Date.now(),round:{id:round.id,baselineDigest:round.baselineDigest},before:state,after:plan.state,
    intent:{kind:'decide',proposalId:proposal.id,action:'accepted',record:{id:decision.id,decidedAt:decision.decidedAt}}};
  const after={...structuredClone(before),meta:{...before.meta,updatedAt:before.meta.updatedAt+1,nativeReviewText:true as const},session:plan.session};
  return {round,proposal,id,before,after,operation};
}
describe('paragraph scoped transaction defenses',()=>{
  it('rejects forged queued unrelated fields/paragraphs, stale CAS, cancellation, wrong owner and duplicate replay',async()=>{
    const f=await dbFixture();
    const forged=structuredClone(f.after);forged.session.paragraphs[0].header='Forged overwrite';
    expect(await actualDb.idbApplyReviewSuggestions(f.before,forged,f.operation)).toBe('conflict');
    expect(await actualDb.idbApplyReviewSuggestions(f.before,f.after,f.operation,()=>false)).toBe('stale');
    const foreign=structuredClone(f.operation);foreign.documentId='foreign';expect(await actualDb.idbApplyReviewSuggestions(f.before,f.after,foreign)).toBe('conflict');
    const newer=structuredClone(f.before);newer.session.formData.subject='Other tab';await db.idbPutDocument(newer);
    expect(await actualDb.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('conflict');await db.idbPutDocument(f.before);
    expect(await actualDb.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('committed');
    expect(await actualDb.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('already-committed');expect((await saved(f.id)).session).toEqual(f.after.session);
  });
  it('rolls back document, decisions and receipt together when suggestion metadata hits quota',async()=>{
    const f=await dbFixture(),put=IDBObjectStore.prototype.put;
    const fail=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
      if(value&&typeof value==='object'&&'key'in value&&String(value.key).startsWith('review-suggestions:'))throw new DOMException('Synthetic storage full','QuotaExceededError');
      return key===undefined?put.call(this,value):put.call(this,value,key);
    });
    expect(await actualDb.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('failed');fail.mockRestore();
    expect(await saved(f.id)).toEqual(f.before);expect(await db.idbReadReviewSuggestionReceipt(f.operation.id)).toBeNull();
    expect(reviewSuggestionRecordSchema.parse(await db.idbReadReviewSuggestions(f.id,f.round.id)).state.decisions).toEqual([]);
  });
  it('reserves operation tombstones across rounds on the same source document',async()=>{
    const {round,proposal,id}=await fixture();const target=proposal.changes[0].target;if(target.kind!=='structure')throw new Error();
    const other=await startReviewRound('Another exact baseline');
    const duplicate=createParagraphStructureSuggestion(other,{author:'Example',operation:{kind:'insert-paragraph',index:3,level:0,text:'Conflicting identity',paragraphId:target.operation.after[0].id}});
    const before=await saved(id),state=appendReviewSuggestions(other,emptyReviewSuggestionState(other),[duplicate]);
    const op:ReviewSuggestionWrite={kind:'suggestion-write',version:1,id:`suggestion-write_${crypto.randomUUID()}`,documentId:id,createdAt:Date.now(),round:{id:other.id,baselineDigest:other.baselineDigest},before:null,after:state,intent:{kind:'propose',proposals:[duplicate]}};
    expect(await actualDb.idbApplyReviewSuggestions(before,{...before,meta:{...before.meta,updatedAt:before.meta.updatedAt+1}},op)).toBe('failed');
    expect(await db.idbReadReviewSuggestions(id,other.id)).toBeNull();expect(await db.idbReadReviewSuggestions(id,round.id)).not.toBeNull();
  });
  it('restores range comments on deletion Undo only with exact forward replay of the current discussion',async()=>{
    const commentsSession=getSerializedSession(),paragraphId=commentsSession.paragraphs[0].id!;
    useDocumentStore.setState({reviewComments:{version:3,threads:[{id:crypto.randomUUID(),anchor:captureTextRange(commentsSession,paragraphId,0,5)!,resolved:false,messages:[{id:crypto.randomUUID(),author:'Example',text:'Original message',createdAt:new Date().toISOString()}]}]}});await commitCurrentDocument();
    const round=await startReviewRound('Comment deletion review'),proposal=createParagraphStructureSuggestion(round,{author:'Example',operation:{kind:'delete-paragraph',paragraphId}});
    await submitReviewSuggestion(proposal);await decideReviewSuggestion(round.id,proposal.id,'accepted');
    const context=await loadReviewSuggestionWorkspace(round.id),acceptance=context.state!.decisions[0];const candidate=structuredClone(round.baseline.session);
    candidate.reviewComments!.threads[0].messages[0].text='Forged historical content';
    const op:ReviewSuggestionWrite={kind:'suggestion-write',version:1,id:`suggestion-write_${crypto.randomUUID()}`,documentId:round.ownerDocumentId!,createdAt:Date.now(),round:{id:round.id,baselineDigest:round.baselineDigest},before:context.state!,after:context.state!,intent:{kind:'history',acceptanceId:acceptance.id,direction:'undo',record:{id:crypto.randomUUID(),decidedAt:Date.now()}}};
    expect(()=>planReviewSuggestionWrite(round,context.current,op,candidate)).toThrow(/discussion/);
    expect(changeDocumentHistory('undo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect(getSerializedSession().reviewComments).toEqual(round.baseline.session.reviewComments);
  });
});
