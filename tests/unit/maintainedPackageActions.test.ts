import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { listConditionalPackageInstances } from '@/lib/packageConditional';
import { maintainedPackageAction, maintainedPackageActions } from '@/lib/maintainedPackageActions';
import { listActionPackages } from '@/lib/actionPackages';
import { captureTemplateSource, restoreTemplateSource } from '@/lib/packageTemplateResources';
import { idbGetAllAttachments } from '@/lib/documentsDb';

vi.mock('react-pdf', async () => ({ pdfjs: await import('pdfjs-dist/legacy/build/pdf.mjs') }));
vi.mock('@/components/pdf/pdfConfig', async () => {
  const { GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  return { HARDENED_PDF_OPTIONS: { isEvalSupported: false } };
});

function serveOfficialForms() {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = decodeURIComponent(new URL(url, 'http://localhost').pathname);
    if (!path.startsWith('/templates/')) throw new Error('Unexpected template URL: ' + path);
    return new Response(new Uint8Array(await readFile(resolve('public', '.' + path))));
  });
}
afterEach(() => vi.unstubAllGlobals());

it('qualifies clean maintained actions without installing case records or assets', async () => {
  serveOfficialForms();
  const records = await listActionPackages(), assets = await idbGetAllAttachments();
  const templates = await Promise.all(maintainedPackageActions.map(action => maintainedPackageAction(action.id)));
  expect(templates).toHaveLength(maintainedPackageActions.length);
  for (const template of templates) {
    expect(template.version).toBe(2); expect(template.program.questions.length).toBeGreaterThan(0);
    expect(JSON.stringify(template)).not.toContain('{{');
    for (const member of template.members) if (member.kind === 'native') {
      if (template.id !== 'dondocs_njp') expect(member.links?.length).toBeGreaterThan(0);
      expect(member.draft.timestamp).toBe(0);
      const form = member.draft.formData as Record<string, unknown>;
      expect(form.sigLast ?? '').toBe('');
    }
  }
  const training = templates.find(template => template.id === 'dondocs_training_participation')!;
  expect(training.program.participantGroups).toEqual([{ id: 'participants', label: 'Participants', role: 'subject', min: 1, max: 10 }]);
  expect(training.members.find(member => member.key === 'remote-participant')?.when).toEqual({ op: 'equals', questionId: 'attendance', value: 'remote' });
  expect(training.members.find(member => member.key === 'cost-estimate')?.when).toEqual({ op: 'equals', questionId: 'includeEstimate', value: true });
  expect(await listActionPackages()).toEqual(records); expect(await idbGetAllAttachments()).toEqual(assets);
});

it('returns owned starters so one caller cannot change later actions', async () => {
  const first = await maintainedPackageAction('administrative-request');
  first.program.questions[0].label = 'Caller mutation'; first.name = 'Changed locally';
  const second = await maintainedPackageAction('administrative-request');
  expect(second.name).toBe('Administrative request'); expect(second.program.questions[0].label).toBe('Requester');
});

it('selects the official forms and appeal records for the NJP stage in package order', async () => {
  serveOfficialForms();
  const template = await maintainedPackageAction('njp');
  expect(template.members.find(member => member.key === 'draft-endorsement')).toMatchObject({ role: 'endorsement', draft: { docType: 'new_page_endorsement' } });
  expect(template.members[0]).toMatchObject({ kind: 'native', role: 'supporting-document', required: true, draft: { formType: 'navmc10132' } });
  expect(template.members.find(member => member.key === 'page-11')).toMatchObject({ kind: 'native', draft: { formType: 'navmc_118_11' } });
  const members = (stage: string, page11: boolean, appeal: boolean, service: boolean, decided = false, page11Source = 'draft') =>
    listConditionalPackageInstances(template, { version: 1, groups: {}, values: {
      page11Source, appealDecisionIssued: decided, caseStage: stage, includePage11: page11, appealFiled: appeal, includeRecordOfService: service,
    } }).filter(member => member.condition === true).map(member => member.memberKey);
  const core = ['upb', 'rights-notice'];
  expect(members('preparing', true, true, true, true)).toEqual([...core, 'allied-papers']);
  const imposed = [...core, 'draft-proceedings', 'allied-papers', 'appeal-rights'];
  expect(members('punishment-imposed', false, true, false, true)).toEqual([...imposed, 'existing-page-11', 'draft-appeal', 'draft-endorsement', 'draft-decision']);
  expect(members('punishment-imposed', true, false, true, true)).toEqual([...imposed, 'page-11']);
  expect(members('punishment-imposed', true, false, false, false, 'original')).toEqual([...imposed, 'received-page-11']);
  expect(members('punishment-imposed', false, true, false)).toEqual([...imposed, 'existing-page-11', 'draft-appeal', 'draft-endorsement']);
  expect(members('punishment-imposed', true, true, true)).toEqual([...imposed, 'page-11', 'existing-page-11', 'draft-appeal', 'draft-endorsement', 'record-of-service']);
});

it('pins required NJP evidence slots to their original blank PDFs', async () => {
  serveOfficialForms();
  const template = await maintainedPackageAction('njp');
  const required = template.members.filter(member => member.required && member.blankPdf);
  expect(required.map(member => member.key)).toEqual(['rights-notice', 'education-notice', 'suspect-statement', 'proceedings', 'written-censure', 'appeal-rights', 'admin-action']);
  for (const member of required) {
    if (!member.blankPdf) throw new Error('Missing reference PDF');
    const digest = createHash('sha256').update(Buffer.from(member.blankPdf.data, 'base64')).digest('hex');
    expect(member.completion?.blankSha256).toBe(digest);
  }
});

it('keeps all seven blank attachments in the portable resource list and restores the saved recipe', async () => {
  serveOfficialForms();
  const template = await maintainedPackageAction('njp');
  const files = new Map<string, ArrayBuffer>();
  const source = await captureTemplateSource(template, async (name, type, data) => {
    const sha256 = createHash('sha256').update(new Uint8Array(data)).digest('hex');
    files.set(sha256, data);
    return { id: sha256, name, type, sha256, size: data.byteLength };
  });
  const read = async ({ sha256 }: { sha256: string }) => files.get(sha256)!;
  const descriptor = JSON.parse(new TextDecoder().decode(await read(source)));
  const blanks = descriptor.members.filter((member: { blankPdf?: unknown }) => member.blankPdf);
  expect(blanks).toHaveLength(7);
  for (const { blankPdf } of blanks) {
    expect(blankPdf.name).toMatch(/\.pdf$/);
    // A working form and its reference can share the same publisher bytes.
    expect(source.resources?.pdfs.filter(asset => asset.sha256 === blankPdf.data)).toHaveLength(1);
  }
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected network read'); });
  expect(await restoreTemplateSource(source, read)).toEqual(template);
});

it('requires evidence appropriate to refusal, an imposed punishment, a decided appeal and closure', async () => {
  serveOfficialForms();
  const template = await maintainedPackageAction('njp');
  const { evaluatePackageTemplateCondition } = await import('@/lib/packageTemplateProgram');
  function active(values: Record<string, string | boolean>) {
    const answers = { version: 1 as const, groups: {}, values };
    return template.program.requirements.filter(r => !r.when || evaluatePackageTemplateCondition(template.program, answers, r.when) === true);
  }
  const refused = { caseStage: 'refused', refusedSignature: true };
  expect(active(refused).map(r => r.id)).toEqual(expect.arrayContaining(['refusal', 'refusal-marker']));
  expect(active(refused).map(r => r.id)).not.toContain('rights-election');
  expect(active({ ...refused, refusedSignature: false }).map(r => r.id)).toContain('rights-election');
  const imposed = { caseStage: 'punishment-imposed', appealFiled: true };
  expect(active(imposed).map(r => r.id)).not.toContain('upb-appeal-decision');
  expect(active(imposed).find(r => r.id === 'appeal-enclosures')?.operations).toContain('pdf');
  const decision = active({ ...imposed, appealDecisionIssued: true }).find(r => r.id === 'upb-appeal-decision');
  expect(decision?.completion?.signatureFields).toEqual(['14 APPEAL DECISION SIGNATURE']);
  expect(decision?.completion?.requiredPdfFields).toContain('14 APPEAL DECISION');
  expect(active({ caseStage: 'closed-no-punishment' }).find(r => r.id === 'closed-without-award')?.completion?.deliveryBlockReason).toContain('Do not deliver');
  expect(template.members.find(m => m.key === 'written-matters')?.required).toBe(true);
});

it('selects the required documents for dependency-application', async () => {
  serveOfficialForms();
  const template = await maintainedPackageAction('dependency-application');
  const selected = (values: Record<string, string | boolean>) => listConditionalPackageInstances(template, { version: 1, groups: {}, values })
    .filter(member => member.condition === true).map(member => member.memberKey);
  for (const event of ['marriage', 'birth', 'loss']) {
    expect(selected({ event, supportOrder: false })).toEqual(['application', event]);
  }
  expect(selected({ event: 'birth', supportOrder: true })).toEqual(['application', 'birth', 'order']);
  expect(template.members[0].completion?.blankSha256).toBe(createHash('sha256')
    .update(Buffer.from(template.members[0].blankPdf!.data, 'base64')).digest('hex'));
});
