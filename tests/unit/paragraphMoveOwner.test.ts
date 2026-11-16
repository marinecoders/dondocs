import 'fake-indexeddb/auto';
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
import { captureTextRange, resolveTextRange } from '@/lib/reviewTextRanges';
import { listReviewRounds } from '@/lib/reviewRounds';
import { createSuggestionReviewReturn, parseReviewReturn } from '@/lib/reviewReturns';
import { buildBackup } from '@/lib/backup';
import { persistAttachment, loadAttachment } from '@/lib/attachments';
import { base64ToUint8Array } from '@/lib/encoding';
import { loadReviewDecisionSummary, prepareReviewDecisionSummary, reviewDecisionSummaryPdfContent } from '@/lib/reviewDecisionSummary';

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
async function dbFixture(){
  const f=await fixture(),before=await saved(f.id),state=reviewSuggestionRecordSchema.parse(await db.idbReadReviewSuggestions(f.id,f.round.id)).state;
  const plan=planReviewSuggestionDecision(f.round,before.session,state,f.proposal.id,'accepted'),decision=plan.state.decisions[0];
  const operation:ReviewSuggestionWrite={kind:'suggestion-write',version:1,id:`suggestion-write_${crypto.randomUUID()}`,documentId:f.id,createdAt:Date.now(),round:{id:f.round.id,baselineDigest:f.round.baselineDigest},before:state,after:plan.state,
    intent:{kind:'decide',proposalId:f.proposal.id,action:'accepted',record:{id:decision.id,decidedAt:decision.decidedAt}}};
  const after={...structuredClone(before),meta:{...before.meta,updatedAt:before.meta.updatedAt+1,nativeReviewText:true as const},session:plan.session};
  return{...f,before,after,operation};
}
describe('paragraph movement through source actions and IndexedDB',()=>{
  it('reports a later identity reorder even when the accepted move has identical readable text',async()=>{
    useDocumentStore.setState({paragraphs:[{id:'move-source',text:'Repeated body.',level:0},{id:'move-destination',text:'Repeated body.',level:0}]});
    await commitCurrentDocument();const {round,proposal,id}=await fixture();
    expect(proposal.changes[0].expected).toBe(proposal.changes[0].proposed);
    await decideReviewSuggestion(round.id,proposal.id,'accepted');
    const summarize=async()=>reviewDecisionSummaryPdfContent(prepareReviewDecisionSummary(await loadReviewDecisionSummary(round.id),policy));
    expect((await summarize()).items[0].acceptedCurrentChanged).toBe(false);
    useDocumentStore.getState().reorderParagraphs(1,0);await commitCurrentDocument();
    expect((await saved(id)).session.paragraphs.map(paragraph=>paragraph.id)).toEqual(['move-source','move-destination']);
    const summary=await summarize();
    expect(summary.items[0].status).toBe('accepted');
    expect(summary.items[0].acceptedCurrentChanged).toBe(true);
  });
  it('persists exact native subtrees, stable discussions, unrelated work, Undo/Redo, reload, backup and portable return',async()=>{
    const {round,proposal,id}=await fixture();const baseline=structuredClone(round.baseline.session);
    expect(getSerializedSession().paragraphs).toEqual(baseline.paragraphs);
    useDocumentStore.getState().setField('subject','Newer subject');useDocumentStore.getState().updateParagraph(4,{text:'Newer independent tail'});
    const before=getSerializedSession();
    expect((await decideReviewSuggestion(round.id,proposal.id,'accepted')).status).toBe('committed');
    const accepted=getSerializedSession();expect(accepted.paragraphs.map(p=>p.id)).toEqual(['move-destination','move-destination-child','move-source','move-child','move-tail']);
    for(const node of accepted.paragraphs)expect(node).toEqual(before.paragraphs.find(p=>p.id===node.id));
    expect(accepted.formData.subject).toBe('Newer subject');expect(accepted.reviewComments).toEqual(before.reviewComments);
    expect(resolveTextRange(accepted,accepted.reviewComments!.threads[0].anchor as Parameters<typeof resolveTextRange>[1]).status).toBe('current');
    expect((await saved(id)).session.paragraphs).toEqual(accepted.paragraphs);expect(round.baseline.session).toEqual(baseline);
    expect(changeDocumentHistory('undo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect(getSerializedSession().paragraphs).toEqual(before.paragraphs);
    expect(changeDocumentHistory('redo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect(getSerializedSession().paragraphs).toEqual(accepted.paragraphs);
    expect((await saved(id)).session.reviewComments).toEqual(before.reviewComments);
    const workspace=await loadReviewSuggestionWorkspace(round.id);expect(workspace.state!.decisions.map(d=>d.action)).toEqual(['accepted','reversed','restored']);
    expect(JSON.parse(await buildBackup()).reviewSuggestions.some((r:{state:{proposals:Array<{id:string}>}})=>r.state.proposals.some(p=>p.id===proposal.id))).toBe(true);
    const returned=parseReviewReturn(createSuggestionReviewReturn(round.id,round.baselineDigest,{version:1,threads:[]},[proposal],{marking:'UNCLASSIFIED',customMarkings:[]}));
    expect(returned.version).toBe(2);if(returned.version===2)expect(returned.proposals[0]).toEqual(proposal);
  });
  it('moves native figures and enclosures with exact retained byte handles and visibly refuses a portable figure span',async()=>{
    const png=base64ToUint8Array('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
    const figure=await persistAttachment({name:'synthetic.png',size:png.byteLength,type:'image/png'},new Uint8Array(png).buffer);
    const bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic attachment');
    const enclosure=await persistAttachment({name:'synthetic.pdf',size:bytes.byteLength,type:'application/pdf'},new Uint8Array(bytes).buffer);
    useDocumentStore.setState(state=>({paragraphs:state.paragraphs.map(p=>p.id==='move-source'?{...p,figure:{name:'Synthetic figure',type:'image/png',fileRef:figure,width:100,height:60}}:p),enclosures:[{title:'Supporting document',fileRef:enclosure}]}));
    await commitCurrentDocument();const {round,proposal}=await fixture(),before=getSerializedSession();
    const portable=structuredClone(round);delete portable.ownerDocumentId;
    expect(()=>createParagraphStructureSuggestion(portable,{author:'Reviewer',operation:{kind:'move-paragraph',paragraphId:'move-source',destinationId:'move-destination',placement:'after'}})).toThrow(/Reviewer copies.*figure.*comment/);
    await decideReviewSuggestion(round.id,proposal.id,'accepted');
    expect(getSerializedSession().paragraphs.find(p=>p.id==='move-source')!.figure).toEqual(before.paragraphs[0].figure);
    expect(getSerializedSession().enclosures).toEqual(before.enclosures);expect(await loadAttachment(figure.id)).toEqual(png.buffer);expect(await loadAttachment(enclosure.id)).toEqual(bytes.buffer);
    expect(changeDocumentHistory('undo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect(getSerializedSession().paragraphs).toEqual(before.paragraphs);
    expect(changeDocumentHistory('redo',captureDocumentScope())).toBe('applied');await flushDocumentWrites();expect((await loadReviewSuggestionWorkspace(round.id)).current.paragraphs.find(p=>p.id==='move-source')!.figure!.fileRef).toEqual(figure);
  });
  it.each(['target','destination','child','parent','interposed','duplicate'] as const)('refuses changed %s with no source or decision mutation',async kind=>{
    const {round,proposal,id}=await fixture();const nodes=structuredClone(useDocumentStore.getState().paragraphs);
    if(kind==='target')nodes[0].header='Changed heading';if(kind==='destination')nodes[2].text='Changed destination';if(kind==='child')nodes[1].text='Changed child';
    if(kind==='parent')nodes[2].level=1;if(kind==='interposed')nodes.splice(2,0,{id:'newer-between',text:'Newer paragraph',level:0});if(kind==='duplicate')nodes.push({...nodes[0]});
    useDocumentStore.setState({paragraphs:nodes});await commitCurrentDocument();const before=await saved(id);
    await expect(decideReviewSuggestion(round.id,proposal.id,'accepted')).rejects.toThrow();expect(await saved(id)).toEqual(before);
    expect((await loadReviewSuggestionWorkspace(round.id)).state!.decisions).toEqual([]);
  });
  it('rejects a move without changing paragraph order',async()=>{
    const {round,proposal,id}=await fixture(),before=await saved(id);expect((await decideReviewSuggestion(round.id,proposal.id,'rejected')).status).toBe('committed');
    expect((await saved(id)).session).toEqual(before.session);
  });
  it.each(['text','marking','reference','figure'] as const)('rejects forged moved node %s at the actual database boundary',async kind=>{
    const f=await dbFixture(),forged=structuredClone(f.operation);const change=forged.before!.proposals[0].changes[0];if(change.target.kind!=='structure')throw new Error();
    const node=change.target.operation.after.find(p=>p.id==='move-source')!;
    if(kind==='text')node.text='Forged text';if(kind==='marking')node.portionMarking='S';if(kind==='reference')node.referenceId='forged';if(kind==='figure')node.figure={name:'forged'};
    expect(await db.idbApplyReviewSuggestions(f.before,f.after,forged)).not.toBe('committed');expect(await saved(f.id)).toEqual(f.before);
  });
  it('enforces owner, cancellation, stale CAS, exact destination snapshot and idempotent receipts',async()=>{
    const f=await dbFixture(),foreign=structuredClone(f.operation);foreign.documentId='foreign';
    expect(await db.idbApplyReviewSuggestions(f.before,f.after,foreign)).toBe('conflict');
    expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation,()=>false)).toBe('stale');
    const forged=structuredClone(f.after);forged.session.paragraphs.at(-1)!.text='Hidden overwrite';expect(await db.idbApplyReviewSuggestions(f.before,forged,f.operation)).toBe('conflict');
    const newer=structuredClone(f.before);newer.session.formData.subject='Other tab';await db.idbPutDocument(newer);expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('conflict');await db.idbPutDocument(f.before);
    expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('committed');expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('already-committed');
  });
  it('rolls back order, review decisions and receipt together on quota failure',async()=>{
    const f=await dbFixture(),put=IDBObjectStore.prototype.put;
    const fail=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
      if(value&&typeof value==='object'&&'key'in value&&String(value.key).startsWith('review-suggestions:'))throw new DOMException('Synthetic storage full','QuotaExceededError');
      return key===undefined?put.call(this,value):put.call(this,value,key);
    });expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation)).toBe('failed');fail.mockRestore();
    expect(await saved(f.id)).toEqual(f.before);expect(await db.idbReadReviewSuggestionReceipt(f.operation.id)).toBeNull();
  });
  it('blocks acceptance after the review is closed',async()=>{
    const f=await dbFixture();await transitionReviewRound(f.round,'close');expect(await db.idbApplyReviewSuggestions(f.before,f.after,f.operation)).not.toBe('committed');
    expect((await saved(f.id)).session.paragraphs).toEqual(f.before.session.paragraphs);
  });
});
