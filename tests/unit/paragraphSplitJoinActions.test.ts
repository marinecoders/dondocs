import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as db from '@/lib/documentsDb';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore, captureDocumentScope, changeDocumentHistory, commitCurrentDocument, flushDocumentWrites } from '@/stores/documentsStore';
import { createParagraphStructureSuggestion, planReviewSuggestionDecision } from '@/lib/reviewSuggestions';
import { decideReviewSuggestion, submitReviewSuggestion } from '@/lib/reviewSuggestionActions';
import { captureTextRange } from '@/lib/reviewTextRanges';
import { reviewSuggestionRecordSchema, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import type { ReviewRound } from '@/lib/reviewRounds';
import { transitionReviewRound } from '@/lib/reviewRoundActions';
vi.mock('@/config/classification', async original => ({...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy:vi.fn()}));
const policy=resolveExportDeploymentPolicy({hostname:'example.test',environment:null,runtime:{status:'absent'}});
beforeEach(() => {vi.clearAllMocks();vi.mocked(getExportDeploymentPolicy).mockResolvedValue(policy);sessionStorage.clear();useDocumentsStore.setState({docs:{},trash:{},currentId:null,hydrated:true,baseline:null});});
afterEach(async () => {await flushDocumentWrites();});
async function fixture(kind:'split-paragraph'|'join-paragraphs'='split-paragraph') {
  useDocumentsStore.getState().newDocument();useDocumentStore.setState({paragraphs:[{id:'left',text:'Left words. Right words.',level:0},{id:'right',text:'Second paragraph.',level:0},{id:'last',text:'Unrelated.',level:0}]});
  const range=captureTextRange(useDocumentStore.getState(),'left',12,17)!;
  useDocumentStore.setState({reviewComments:{version:3,threads:[{id:crypto.randomUUID(),anchor:range,resolved:false,messages:[{id:crypto.randomUUID(),author:'Reviewer',text:'Retained discussion',createdAt:'2026-11-15T00:00:00Z'}]}]}});
  await commitCurrentDocument();const owner=useDocumentsStore.getState().currentId!, source=structuredClone(useDocumentsStore.getState().docs[owner]);
  const round:ReviewRound={kind:'dondocs-review-round',version:1,id:`review_${crypto.randomUUID()}`,createdAt:source.session.timestamp,label:'Structural review',sourceDocumentId:owner,ownerDocumentId:owner,baselineDigest:'a'.repeat(64),baseline:{ts:source.session.timestamp,session:source.session}};
  expect(await db.idbAddReviewRound(round)).toBe('committed');
  const proposal=createParagraphStructureSuggestion(round,{author:'Reviewer',operation:kind==='split-paragraph'?{kind,paragraphId:'left',splitAt:12,newParagraphId:'fresh'}:{kind,paragraphId:'left',nextParagraphId:'right',separator:' '}});
  expect((await submitReviewSuggestion(proposal)).status).toBe('committed');
  const read=async () => (await db.idbGetAllDocuments())!.find(document=>document.id===owner)!;
  return {owner,round,proposal,source,read};
}
describe('source actions and atomic storage for paragraph split/join',()=>{
  it.each(['split-paragraph','join-paragraphs'] as const)('accepts %s with reload and persisted ordinary Undo/Redo',async kind=>{
    const {owner,round,proposal,source,read}=await fixture(kind);
    useDocumentStore.getState().setField('subject','NEWER SUBJECT');await commitCurrentDocument();
    expect((await decideReviewSuggestion(round.id,proposal.id,'accepted')).status).toBe('committed');
    const accepted=await read();expect(accepted.session.paragraphs.length).toBe(kind==='split-paragraph'?4:2);expect(accepted.session.formData.subject).toBe('NEWER SUBJECT');
    expect(changeDocumentHistory('undo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect((await read()).session.paragraphs).toEqual(source.session.paragraphs);expect((await read()).session.reviewComments).toEqual(source.session.reviewComments);
    expect(changeDocumentHistory('redo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect((await read()).session.paragraphs).toEqual(accepted.session.paragraphs);
    expect(reviewSuggestionRecordSchema.parse(await db.idbReadReviewSuggestions(owner,round.id)).state.decisions.map(item=>item.action)).toEqual(['accepted','reversed','restored']);
    useDocumentsStore.getState().newDocument();await commitCurrentDocument();useDocumentsStore.getState().switchTo(owner);expect(useDocumentStore.getState().paragraphs).toEqual(accepted.session.paragraphs);
  });
  it('blocks foreign owners, closed rounds, duplicate decisions and stale target changes',async()=>{
    const {round,proposal}=await fixture();useDocumentStore.getState().updateParagraph(0,{text:'Changed source'});await commitCurrentDocument();
    await expect(decideReviewSuggestion(round.id,proposal.id,'accepted')).rejects.toThrow(/target differs/);
    expect((await decideReviewSuggestion(round.id,proposal.id,'rejected')).status).toBe('committed');await expect(decideReviewSuggestion(round.id,proposal.id,'accepted')).rejects.toThrow(/already/);
    useDocumentsStore.getState().newDocument();await commitCurrentDocument();await expect(decideReviewSuggestion(round.id,proposal.id,'accepted')).rejects.toThrow(/source or linked/);
  });
  it('blocks decisions and new proposals once the source round is closed',async()=>{
    const {round,proposal}=await fixture();await transitionReviewRound(round,'close');
    await expect(decideReviewSuggestion(round.id,proposal.id,'accepted')).rejects.toThrow(/closed or superseded/);
    await expect(submitReviewSuggestion(proposal)).rejects.toThrow(/closed or superseded/);
  });
  it('cancels an acceptance when policy validation observes a newer draft',async()=>{
    const {round,proposal,read}=await fixture();let release!:(value:typeof policy)=>void;
    vi.mocked(getExportDeploymentPolicy).mockReturnValue(new Promise(resolve=>{release=resolve;}));
    const pending=decideReviewSuggestion(round.id,proposal.id,'accepted');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    useDocumentStore.getState().setField('subject','Newer during validation');release(policy);
    await expect(pending).rejects.toThrow(/draft changed/);await commitCurrentDocument();expect((await read()).session.paragraphs).toHaveLength(3);
  });
  it('atomically rejects forged metadata, stale CAS, cancelled and quota-failed writes with no receipt',async()=>{
    const {owner,round,proposal,read}=await fixture(),before=await read();
    const state=reviewSuggestionRecordSchema.parse(await db.idbReadReviewSuggestions(owner,round.id)).state;
    const plan=planReviewSuggestionDecision(round,before.session,state,proposal.id,'accepted'),decision=plan.state.decisions[0];
    const write:ReviewSuggestionWrite={kind:'suggestion-write',version:1,id:`suggestion-write_${crypto.randomUUID()}`,documentId:owner,createdAt:Date.now(),round:{id:round.id,baselineDigest:round.baselineDigest},before:state,after:plan.state,intent:{kind:'decide',proposalId:proposal.id,action:'accepted',record:{id:decision.id,decidedAt:decision.decidedAt}}};
    const after={...structuredClone(before),session:plan.session,meta:{...before.meta,updatedAt:Date.now(),nativeReviewText:true as const}};
    const forged=structuredClone(after);forged.session.paragraphs[1].header='Hidden metadata';expect(await db.idbApplyReviewSuggestions(before,forged,write)).toBe('conflict');
    expect(await db.idbApplyReviewSuggestions(before,after,write,()=>false)).toBe('stale');
    const late=structuredClone(before);late.session.formData.subject='Other tab';late.meta.updatedAt++;await db.idbPutDocument(late);expect(await db.idbApplyReviewSuggestions(before,after,write)).toBe('conflict');await db.idbPutDocument(before);
    const original=IDBObjectStore.prototype.put,spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value,key){if(value&&typeof value==='object'&&'key'in value&&String(value.key).startsWith('review-suggestions:'))throw new DOMException('Full','QuotaExceededError');return original.call(this,value,key);});
    try{expect(await db.idbApplyReviewSuggestions(before,after,write)).toBe('failed');}finally{spy.mockRestore();}
    expect(await read()).toEqual(before);expect(await db.idbReadReviewSuggestionReceipt(write.id)).toBeNull();expect(await db.idbApplyReviewSuggestions(before,after,write)).toBe('committed');expect(await db.idbApplyReviewSuggestions(before,after,write)).toBe('already-committed');
  });
});
