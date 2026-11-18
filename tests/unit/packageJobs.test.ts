import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createBlankSession } from '@/stores/documentStore';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, renameActionPackage } from '@/lib/actionPackages';
import { discardPackageJob, listPackageJobs, preparePackageJob, runPreparedPackageJob } from '@/lib/packageJobs';
import { getBatchOutput, idbComparePackageJob, idbGetAllAttachments } from '@/lib/documentsDb';
import { resolveExportDeploymentPolicy, type PolicyResolution } from '@/lib/exportDeploymentPolicy';
import { packageJobSchema, PACKAGE_JOB_LEASE_MS } from '@/lib/packageJobModel';
import { updatePackageAssemblySettings } from '@/lib/packageAssemblySettings';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { composeBasicLetterId } from '@/lib/endorsement';
import * as classification from '@/config/classification';
import * as packageTransfer from '@/lib/actionPackageTransfer';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
let currentPolicy: PolicyResolution = policy;
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => currentPolicy, getExportDeploymentPolicySync: () => currentPolicy }));
async function pdfBytes(pages = 1) { const pdf = await PDFDocument.create(); for (let i = 0; i < pages; i++) pdf.addPage([612, 792]); return new Uint8Array(await pdf.save()).buffer; }
async function fixture(nativeCount = 2, original = false) {
  const members = [];
  for (let i = 0; i < nativeCount; i++) {
    const session = createBlankSession();
    const snapshot = { ...session, endItems: [], publicationTables: {}, formData: { ...session.formData, unitLine1: 'FICTIONAL UNIT', subject: 'SYNTHETIC JOB', from: 'Training Office', to: 'Training Officer', sigLast: 'Example', classLevel: 'unclassified' as const, date: '17 Nov 26' }, paragraphs: [{ id: 'p', text: `Fictional member ${i}.`, level: 0 }] };
    members.push(await capturePackageMember(captureDocumentRevision({ documentId: `source-${i}`, epoch: 0, editSequence: 1, capturedAt: 1 }, snapshot), `Training ${i}`, i ? 'supporting-document' : 'basic-letter'));
  }
  if (original) members.push(await captureOriginalPackageMember({ name: 'Original.pdf', data: await pdfBytes() }, nativeCount ? 'enclosure' : 'basic-letter', false));
  return reviseActionPackage(await createActionPackage(`Job ${crypto.randomUUID()}`), members);
}
const ports = () => ({ compile: vi.fn(async () => new Uint8Array(await pdfBytes())), convertDocx: vi.fn(), waitForReady: async () => true });
async function clearDb() {
  // Opening a package initializes the full v2 schema before clearing the isolated test database.
  await createActionPackage('Initialize');
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction([...db.objectStoreNames], 'readwrite'); for (const name of db.objectStoreNames) transaction.objectStore(name).clear(); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
}
async function rawPut(key: string, value: unknown) {
  const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); });
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction('app', 'readwrite'); transaction.objectStore('app').put({ key, value }); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
}
beforeEach(async () => { currentPolicy = policy; await clearDb(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('saved package assembly', () => {
  it('uses actual generated PDFs, original bytes, per-member progress, and atomic completion; a second run cannot duplicate output', async () => {
    const record = await fixture(2, true), renderer = ports(), progress = vi.fn();
    const prepared = await preparePackageJob(record, record.currentRevisionId, policy);
    const result = await runPreparedPackageJob(prepared, policy, true, renderer, { onProgress: progress });
    expect(renderer.compile).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.map(([value]) => value.completed)).toEqual([0, 1, 2, 3]);
    const output = getPackageRevision(result).outputs[0]; expect((await PDFDocument.load(await readPackageAsset(output.asset))).getPageCount()).toBe(3);
    const [job] = await listPackageJobs(record.id); expect(job.status).toBe('complete'); expect(job.output?.id).toBe(output.id);
    for (const checkpoint of job.checkpoints) expect(await getBatchOutput(checkpoint.outputId)).toBeNull();
    expect(job.checkpoints).toHaveLength(2);
    const original = getPackageRevision(record).members[2]; if (original.kind !== 'original') throw new Error('fixture');
    const retained = getPackageRevision(result).members[2]; if (retained.kind !== 'original') throw new Error('fixture');
    expect(await readPackageAsset(original.original)).toEqual(await readPackageAsset(retained.original));
    await expect(runPreparedPackageJob(prepared, policy, true, renderer)).rejects.toThrow(/Review this exact/);
    await expect(preparePackageJob(result, job.revisionId, policy, { resumeJobId: job.id })).rejects.toThrow(/already published/);
  });

  it('pauses after real member work, reloads job state, requires a new acknowledgement, reuses only its checked PDF, and preserves newer revisions', async () => {
    const record = await fixture(), first = ports(), abort = new AbortController();
    const prepared = await preparePackageJob(record, record.currentRevisionId, policy);
    await expect(runPreparedPackageJob(prepared, policy, true, first, { signal: abort.signal, onProgress: progress => { if (progress.completed === 1) abort.abort(); } })).rejects.toThrow();
    expect(first.compile).toHaveBeenCalledTimes(1);
    const [paused] = await listPackageJobs(record.id); expect(paused.status).toBe('paused'); expect(paused.completed).toBe(1); expect(paused.checkpoints).toHaveLength(1);
    expect(await getBatchOutput(paused.checkpoints[0].outputId)).not.toBeNull();
    const newer = await reviseActionPackage(record, getPackageRevision(record).members);
    const resume = await preparePackageJob(newer, record.currentRevisionId, policy, { resumeJobId: paused.id });
    const second = ports();
    await expect(runPreparedPackageJob(resume, policy, false, second)).rejects.toThrow(/Review this exact/);
    const result = await runPreparedPackageJob(resume, policy, true, second);
    expect(second.compile).toHaveBeenCalledTimes(1); expect(result.currentRevisionId).toBe(newer.currentRevisionId);
    expect(getPackageRevision(result).outputs).toHaveLength(0); expect(getPackageRevision(result, record.currentRevisionId).outputs).toHaveLength(1);
  });

  it('rejects a changed source, build or policy rather than applying old checkpoints', async () => {
    const record = await fixture(), abort = new AbortController();
    await expect(runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy), policy, true, ports(), { signal: abort.signal, onProgress: progress => { if (progress.completed === 1) abort.abort(); } })).rejects.toThrow();
    const [job] = await listPackageJobs(record.id);
    await expect(preparePackageJob(await renameActionPackage(record, 'Changed name'), record.currentRevisionId, policy, { resumeJobId: job.id })).rejects.toThrow(/inputs.*changed/);
    currentPolicy = resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } });
    await expect(preparePackageJob(record, record.currentRevisionId, currentPolicy, { resumeJobId: job.id })).rejects.toThrow(/inputs.*changed/);
    await rawPut(`package-job:${job.id}`, { ...job, buildSha256: 'a'.repeat(64) });
    await expect(preparePackageJob(record, record.currentRevisionId, policy, { resumeJobId: job.id })).rejects.toThrow(/inputs.*changed/);
  });

  it('rejects a corrupt checkpoint without treating it as an original or silently dropping it', async () => {
    const record = await fixture(), abort = new AbortController();
    await expect(runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy), policy, true, ports(), { signal: abort.signal, onProgress: progress => { if (progress.completed === 1) abort.abort(); } })).rejects.toThrow();
    const [job] = await listPackageJobs(record.id); await rawPut(`batch:${job.checkpoints[0].outputId}`, new Uint8Array([1, 2, 3]));
    const renderer = ports();
    await expect(runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy, { resumeJobId: job.id }), policy, true, renderer)).rejects.toThrow(/missing or corrupt/);
    expect(renderer.compile).not.toHaveBeenCalled(); expect(getPackageRevision((await listActionPackages()).find(value => value.id === record.id)!).outputs).toHaveLength(0);
    await discardPackageJob((await listPackageJobs(record.id))[0]); expect(await getBatchOutput(job.checkpoints[0].outputId)).toBeNull(); expect(await listPackageJobs(record.id)).toEqual([]);
  });

  it('rejects a fabricated private preparation, pre-aborted request and stale current context before any durable job write', async () => {
    const record = await fixture(), prepared = await preparePackageJob(record, record.currentRevisionId, policy), renderer = ports();
    await expect(runPreparedPackageJob(structuredClone(prepared), policy, true, renderer)).rejects.toThrow(/Review this exact/);
    const abort = new AbortController(); abort.abort();
    await expect(runPreparedPackageJob(prepared, policy, true, renderer, { signal: abort.signal })).rejects.toThrow();
    await expect(runPreparedPackageJob(prepared, policy, true, renderer, { isCurrent: () => false })).rejects.toThrow(/no longer current/);
    expect(await listPackageJobs()).toEqual([]); expect(renderer.compile).not.toHaveBeenCalled();
  });

  it('does not publish output or orphan an output attachment when the package changes during actual rendering', async () => {
    const record = await fixture(1), renderer = ports(), before = await idbGetAllAttachments();
    const prepared = await preparePackageJob(record, record.currentRevisionId, policy);
    renderer.compile.mockImplementationOnce(async () => { await renameActionPackage(record, 'Changed during render'); return new Uint8Array(await pdfBytes()); });
    await expect(runPreparedPackageJob(prepared, policy, true, renderer)).rejects.toThrow(/package changed/);
    expect((await idbGetAllAttachments())?.length).toBe(before?.length);
    const current = (await listActionPackages()).find(value => value.id === record.id)!;
    expect(current.name).toBe('Changed during render'); expect(getPackageRevision(current).outputs).toHaveLength(0);
    expect((await listPackageJobs(record.id))[0].status).toBe('failed');
  });

  it('blocks policy changes during actual rendering and preserves a resumable job with no publication', async () => {
    const record = await fixture(1), renderer = ports();
    renderer.compile.mockImplementationOnce(async () => { currentPolicy = { status: 'not-ready', message: 'Loading' }; return new Uint8Array(await pdfBytes()); });
    await expect(runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy), policy, true, renderer)).rejects.toThrow(/policy changed/);
    expect((await listPackageJobs(record.id))[0].status).toBe('failed');
    expect(getPackageRevision((await listActionPackages()).find(value => value.id === record.id)!).outputs).toHaveLength(0);
  });

  it('does not let a stolen or expired tab publish despite retaining its previous acknowledgement', async () => {
    const record = await fixture(1), renderer = ports(), before = await idbGetAllAttachments();
    renderer.compile.mockImplementationOnce(async () => {
      const [job] = await listPackageJobs(record.id);
      const stolen = packageJobSchema.parse({ ...job, sequence: job.sequence + 1, lease: { token: crypto.randomUUID(), expiresAt: Date.now() + PACKAGE_JOB_LEASE_MS } });
      await rawPut(`package-job:${job.id}`, stolen);
      return new Uint8Array(await pdfBytes());
    });
    await expect(runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy), policy, true, renderer)).rejects.toThrow(/checkpoint could not be saved/);
    expect((await idbGetAllAttachments())?.length).toBe(before?.length); expect((await listPackageJobs(record.id))[0].status).toBe('running');
    expect(getPackageRevision((await listActionPackages()).find(value => value.id === record.id)!).outputs).toHaveLength(0);
  });

  it('serializes acquisition so only one of two fresh preparations can run, and protects active job removal', async () => {
    const record = await fixture(1), first = await preparePackageJob(record, record.currentRevisionId, policy);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), renderer = ports();
    renderer.compile.mockImplementationOnce(async () => { await gate; return new Uint8Array(await pdfBytes()); });
    const running = runPreparedPackageJob(first, policy, true, renderer);
    let job;
    for (let i = 0; i < 100; i++) { [job] = await listPackageJobs(record.id); if (job?.status === 'running') break; await new Promise(resolve => setTimeout(resolve, 1)); }
    expect(job?.status).toBe('running');
    await expect(preparePackageJob(record, record.currentRevisionId, policy, { resumeJobId: job!.id })).rejects.toThrow(/active in another tab/);
    await expect(discardPackageJob(job!)).rejects.toThrow(/still running/);
    release(); await running;
  });

  it('bounds preparation by declared source bytes before reading corrupted or oversized assets', async () => {
    const record = await fixture(4), oversized = structuredClone(record);
    const revision = oversized.revisions.find(value => value.id === record.currentRevisionId)!;
    revision.members.forEach(member => { if (member.kind === 'native') member.draft.size = 25 * 1024 * 1024; });
    await expect(preparePackageJob(oversized, oversized.currentRevisionId, policy)).rejects.toThrow(/75 MB captured-input/);
    expect(await listPackageJobs()).toEqual([]);
  });

  it('does not checkpoint or rerender original PDFs', async () => {
    const record = await fixture(0, true), renderer = ports();
    const result = await runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy), policy, true, renderer);
    expect(renderer.compile).not.toHaveBeenCalled(); expect((await listPackageJobs(record.id))[0].checkpoints).toEqual([]);
    expect(getPackageRevision(result).outputs).toHaveLength(1);
  });
  it('uses the real configured-form renderer and its retained templates, without a compile stub', async () => {
    const page = await fixturePage(), instance = fixtureInstance(); instance.definition.pages[0].sha256 = page.sha256;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(page.bytes))));
    try {
      const session = { ...createBlankSession(), endItems: [], publicationTables: {}, documentCategory: 'forms' as const, formType: 'fixture', genericForm: instance };
      const member = await capturePackageMember(captureDocumentRevision({ documentId: 'form', epoch: 0, editSequence: 0, capturedAt: 1 }, session), 'Configured form', 'basic-letter');
      const record = await reviseActionPackage(await createActionPackage('Configured assembly'), [member]);
      const renderer = ports(), result = await runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy), policy, true, renderer);
      expect(renderer.compile).not.toHaveBeenCalled();
      expect((await PDFDocument.load(await readPackageAsset(getPackageRevision(result).outputs[0].asset))).getPageCount()).toBe(1);
      expect((await listPackageJobs(record.id))[0].checkpoints).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('keys trial and fallback endorsement renders separately, including their actual starting page', async () => {
    let record = await fixture(1);
    const first = getPackageRevision(record).members[0]; if (first.kind !== 'native') throw new Error('fixture');
    const session = { ...first.session, endItems: first.session.endItems ?? [], publicationTables: first.session.publicationTables ?? {}, docType: 'new_page_endorsement' as const, formData: { ...first.session.formData, endorsementOrdinal: 'FIRST', basicLetterId: composeBasicLetterId(first.session) } };
    const endorsement = await capturePackageMember(captureDocumentRevision({ documentId: 'endorsement', epoch: 0, editSequence: 0, capturedAt: 1 }, session), 'Endorsement', 'endorsement');
    // The real geometry qualification cannot find a printed signature in these blank renderer-port PDFs, so it must use the new-page fallback.
    record = await reviseActionPackage(record, [first, endorsement]);
    record = await updatePackageAssemblySettings(record, { version: 1, profile: 'letter-led', cover: false, contents: false, samePageEndorsements: true }, policy);
    const prepared = await preparePackageJob(record, record.currentRevisionId, policy);
    expect(prepared.readiness.findings.filter(finding => finding.severity === 'error')).toEqual([]);
    const renderer = ports();
    const result = await runPreparedPackageJob(prepared, policy, true, renderer);
    expect(renderer.compile).toHaveBeenCalledTimes(3);
    const [job] = await listPackageJobs(record.id); expect(job.checkpoints.filter(entry => entry.memberId === endorsement.id)).toHaveLength(2); expect(new Set(job.checkpoints.map(entry => entry.key)).size).toBe(3);
    expect(getPackageRevision(result).outputs[0].assembly?.placements?.[0].placement).toBe('new-page');
  });

  it('blocks expired-owner renewal until a fresh acquisition with a new token', async () => {
    const record = await fixture(1), renderer = ports();
    let observed = false;
    renderer.compile.mockImplementationOnce(async () => {
      const [job] = await listPackageJobs(record.id);
      // Exercise real storage compare with an expired capture; it cannot extend its old lease.
      const expired = { ...job, lease: { ...job.lease!, expiresAt: Date.now() - 1 } };
      await rawPut(`package-job:${job.id}`, expired);
      expect(await idbComparePackageJob(expired, { ...expired, sequence: expired.sequence + 1, updatedAt: Date.now(), lease: { token: expired.lease.token, expiresAt: Date.now() + PACKAGE_JOB_LEASE_MS } }, { token: expired.lease.token })).toBe(false);
      expect(await idbComparePackageJob(expired, { ...expired, sequence: expired.sequence + 1, updatedAt: Date.now(), lease: { token: crypto.randomUUID(), expiresAt: Date.now() + PACKAGE_JOB_LEASE_MS } })).toBe(true);
      // Acquisition with a new token is allowed only after expiry; the old running renderer still loses exact CAS.
      observed = true; return new Uint8Array(await pdfBytes());
    });
    await expect(runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy), policy, true, renderer)).rejects.toThrow(/checkpoint could not be saved/);
    expect(observed).toBe(true);
  });

  it('checks the job lease atomically at final publication after the last member has completed', async () => {
    const record = await fixture(1), before = await idbGetAllAttachments(); let calls = 0, stolen = false;
    vi.spyOn(classification, 'getExportDeploymentPolicy').mockImplementation(async () => {
      calls++;
      const [job] = await listPackageJobs(record.id);
      if (!stolen && job?.status === 'running' && job.completed === job.total) {
        stolen = true;
        await rawPut(`package-job:${job.id}`, { ...job, sequence: job.sequence + 1, lease: { token: crypto.randomUUID(), expiresAt: Date.now() + PACKAGE_JOB_LEASE_MS } });
      }
      return policy;
    });
    await expect(runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy), policy, true, ports())).rejects.toThrow(/package changed/);
    expect(calls).toBeGreaterThanOrEqual(2); expect(stolen).toBe(true); expect((await idbGetAllAttachments())?.length).toBe(before?.length);
    expect(getPackageRevision((await listActionPackages()).find(value => value.id === record.id)!).outputs).toHaveLength(0);
  });

  it('rolls back checkpoint metadata and bytes together when browser quota rejects the binary write', async () => {
    const record = await fixture(1), originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (value && typeof value === 'object' && 'key' in value && String(value.key).startsWith('batch:')) throw new DOMException('Storage full', 'QuotaExceededError');
      return originalPut.call(this, value, key);
    });
    await expect(runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy), policy, true, ports())).rejects.toThrow();
    const [job] = await listPackageJobs(record.id); expect(job.status).toBe('failed'); expect(job.checkpoints).toEqual([]);
    expect(getPackageRevision((await listActionPackages()).find(value => value.id === record.id)!).outputs).toHaveLength(0);
  });

  it('renews ownership while the real rendering pipeline is waiting on its engine', async () => {
    const record = await fixture(1), renderer = ports();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    let renewed = false;
    renderer.compile.mockImplementationOnce(async () => {
      const [before] = await listPackageJobs(record.id);
      await vi.advanceTimersByTimeAsync(10_001);
      for (let attempt = 0; attempt < 100; attempt++) {
        const [after] = await listPackageJobs(record.id);
        if (after.sequence > before.sequence) { expect(after.lease!.expiresAt).toBeGreaterThan(before.lease!.expiresAt); renewed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      return new Uint8Array(await pdfBytes());
    });
    const result = await runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy), policy, true, renderer);
    expect(renewed).toBe(true); expect(getPackageRevision(result).outputs).toHaveLength(1);
  });

  it('rolls back the staged output, package and completion receipt together when final attachment storage fails', async () => {
    const record = await fixture(1), before = await idbGetAllAttachments(), originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'attachments') throw new DOMException('Output storage full', 'QuotaExceededError');
      return originalPut.call(this, value, key);
    });
    await expect(runPreparedPackageJob(await preparePackageJob(record, record.currentRevisionId, policy), policy, true, ports())).rejects.toThrow(/package changed/);
    expect((await idbGetAllAttachments())?.length).toBe(before?.length);
    const [job] = await listPackageJobs(record.id); expect(job.status).toBe('failed'); expect(job.output).toBeUndefined();
    expect(await getBatchOutput(job.checkpoints[0].outputId)).not.toBeNull();
    expect(getPackageRevision((await listActionPackages()).find(value => value.id === record.id)!).outputs).toHaveLength(0);
  });

  it('checks deployment inside the final job publication transaction after all async review checks', async () => {
    const record = await fixture(1), prepared = await preparePackageJob(record, record.currentRevisionId, policy), attachments = await idbGetAllAttachments();
    const get = IDBObjectStore.prototype.get; let changed = false;
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === 'app' && typeof key === 'string' && key.startsWith('package-job:')) {
        changed = true; currentPolicy = { status: 'not-ready', message: 'Deployment changed before publication' };
      }
      return get.call(this, key);
    });
    await expect(runPreparedPackageJob(prepared, policy, true, ports())).rejects.toThrow(/package changed|policy|deployment/i);
    expect(changed).toBe(true);
    expect(await idbGetAllAttachments()).toEqual(attachments);
    expect(getPackageRevision((await listActionPackages()).find(value => value.id === record.id)!).outputs).toEqual([]);
    const [job] = await listPackageJobs(record.id); expect(job.status).toBe('failed'); expect(job.output).toBeUndefined();
    expect(await getBatchOutput(job.checkpoints[0].outputId)).not.toBeNull();
  });

  it('retains job ownership while final asynchronous package resource validation is still running', async () => {
    const record = await fixture(1), prepared = await preparePackageJob(record, record.currentRevisionId, policy);
    const validate = packageTransfer.validateActionPackageResources; let delayed = false;
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.spyOn(packageTransfer, 'validateActionPackageResources').mockImplementation(async (...args) => {
      const [job] = await listPackageJobs(record.id);
      if (!delayed && job?.status === 'running' && job.completed === job.total) {
        delayed = true;
        await vi.advanceTimersByTimeAsync(PACKAGE_JOB_LEASE_MS + 1);
      }
      return validate(...args);
    });
    const result = await runPreparedPackageJob(prepared, policy, true, ports());
    expect(delayed).toBe(true); expect(getPackageRevision(result).outputs).toHaveLength(1);
  });

});
