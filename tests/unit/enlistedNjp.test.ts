import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { listConditionalPackageInstances } from '@/lib/packageConditional';
import { captureTemplateSource, restoreTemplateSource } from '@/lib/packageTemplateResources';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { maintainedPackageAction } from '@/lib/maintainedPackageActions';

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

it('selects the official forms and appeal records for the NJP stage in package order', async () => {
  serveOfficialForms();
  const template = await maintainedPackageAction('njp');
  expect(template.members.find(member => member.key === 'draft-endorsement')).toMatchObject({ role: 'endorsement', draft: { docType: 'new_page_endorsement' } });
  expect(template.members[0]).toMatchObject({ kind: 'native', role: 'supporting-document', required: true, draft: { formType: 'navmc10132' } });
  expect(template.members.find(member => member.key === 'page-11')).toMatchObject({ kind: 'native', draft: { formType: 'navmc_118_11' } });
  expect(template.members.find(member => member.key === 'draft-endorsement')).toMatchObject({ endorses: 'draft-appeal' });
  const members = (stage: string, page11: boolean, appeal: boolean, service: boolean, decided = false, page11Source = 'draft') =>
    listConditionalPackageInstances(template, { version: 1, groups: {}, values: {
      page11Source, appealDecisionIssued: decided, caseStage: stage, includePage11: page11, appealStatus: appeal ? 'filed' : 'pending', includeRecordOfService: service,
    } }).filter(member => member.condition === true).map(member => member.memberKey);
  expect(members('preparing', true, true, true, true)).toEqual(['upb', 'rights-notice', 'allied-papers']);
  const hearing = ['upb', 'draft-proceedings', 'rights-notice', 'appeal-rights'];
  const forwarding = [...hearing, 'draft-appeal', 'draft-endorsement', 'additional-endorsements'];
  expect(members('punishment-imposed', true, false, true, true)).toEqual([...hearing, 'page-11', 'allied-papers']);
  expect(members('punishment-imposed', true, false, false, false, 'original')).toEqual([...hearing, 'received-page-11', 'allied-papers']);
  expect(members('punishment-imposed', false, true, false)).toEqual([...forwarding, 'existing-page-11', 'allied-papers']);
  expect(members('punishment-imposed', true, true, true, true)).toEqual([...forwarding, 'page-11', 'existing-page-11', 'record-of-service', 'allied-papers', 'draft-decision']);
});

it('uses the recorded grade for a filed appeal and asks only when that grade is ambiguous', async () => {
  serveOfficialForms();
  const template = await maintainedPackageAction('njp');
  const { evaluatePackageTemplateCondition } = await import('@/lib/packageTemplateProgram');
  const fallback = template.program.questions.find(q => q.id === 'includeRecordOfService')!.when!;
  const requirement = template.members.find(m => m.key === 'record-of-service')!.when!;
  const scope = template.deliveryChoices!.find(choice => choice.id === 'forward-appeal')!;
  expect(scope.memberKeys?.slice(0, 5)).toEqual(['additional-endorsements', 'draft-endorsement', 'draft-appeal', 'appeal', 'upb']);
  expect(scope.confirmationIds).toContain('appeal-enclosures');
  for (const [grade, ask, required] of [
    [' Cpl/E4 ', false, true], ['lance corporal', false, true], ['E-4', false, true],
    ['sGt', false, false], ['E5', false, false], ['', true, true], ['Cpl/E5', true, true],
  ] as const) {
    const answers = { version: 1 as const, groups: {}, values: {
      caseStage: 'punishment-imposed', appealStatus: 'filed', appealDecisionIssued: false, grade,
      includeRecordOfService: ask || !required,
    } };
    expect(evaluatePackageTemplateCondition(template.program, answers, fallback)).toBe(ask);
    expect(evaluatePackageTemplateCondition(template.program, answers, requirement)).toBe(required);
    expect(evaluatePackageTemplateCondition(template.program, answers, scope.when!)).toBe(true);
  }
});

it('pins required NJP evidence slots to their original blank PDFs', async () => {
  serveOfficialForms();
  const template = await maintainedPackageAction('njp');
  const required = template.members.filter(member => member.required && member.blankPdf);
  expect(required.map(member => member.key)).toEqual(['proceedings', 'rights-notice', 'education-notice', 'suspect-statement', 'written-censure', 'appeal-rights', 'admin-action']);
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
  const item2 = '2 ACC ELECTION AND RIGHTS SIGNATURE';
  expect(active(refused).find(r => r.id === 'refusal-marker')?.completion?.signatureLabels?.[item2]).toBe('CO signs item 2');
  expect(active({ ...refused, refusedSignature: false }).find(r => r.id === 'refusal-signed')?.completion?.signatureLabels?.[item2]).toBe('Marine signs item 2');
  expect(active(refused).map(r => r.id)).not.toContain('rights-election');
  expect(active({ ...refused, refusedSignature: false }).map(r => r.id)).toContain('rights-election');
  const imposed = { caseStage: 'punishment-imposed', appealStatus: 'filed' };
  expect(active(imposed).map(r => r.id)).not.toContain('upb-appeal-decision');
  expect(active(imposed).find(r => r.id === 'appeal-enclosures')?.operations).toContain('pdf');
  expect(active(imposed).map(r => r.id)).toContain('rights-acceptance');
  expect(active(refused).map(r => r.id)).toContain('rights-refusal');
  for (const status of ['pending', 'filed', 'closed']) {
    const ids = active({ ...imposed, appealStatus: status }).map(r => r.id);
    expect(ids.includes('appeal-pending')).toBe(status === 'pending');
    expect(ids.includes('appeal-date')).toBe(status === 'filed');
    expect(ids.includes('appeal-closed')).toBe(status === 'closed');
  }
  const pending = active({ ...imposed, appealStatus: 'pending' }).find(r => r.id === 'appeal-pending');
  expect(pending?.completion?.pdfSelections).toEqual([
    expect.objectContaining({ field: '13 NOT APPEALED', expected: false }),
    expect.objectContaining({ field: '13 DATE OF APPEAL IF ANY_af_date', expected: null }),
  ]);
  expect(active(imposed).find(r => r.id === 'upb-authority')?.completion?.pdfSelections).toContainEqual(
    expect.objectContaining({ field: '2 ACC REFUSE TO SIGN', expected: false }),
  );
  const decision = active({ ...imposed, appealDecisionIssued: true }).find(r => r.id === 'upb-appeal-decision');
  expect(decision?.completion?.signatureFields).toEqual(['14 APPEAL DECISION SIGNATURE']);
  expect(decision?.completion?.answerGroups?.[0].alternatives[0]).toContain('14 APPEAL DECISION');
  expect(active({ caseStage: 'closed-no-punishment' }).find(r => r.id === 'closed-without-award')?.completion?.deliveryBlockReason).toContain('Do not deliver');
  expect(template.members.find(m => m.key === 'written-matters')?.required).toBe(true);
  for (const key of ['draft-decision', 'written-censure']) {
    expect(template.members.find(m => m.key === key)?.completion).toMatchObject({
      writtenContent: true, expectedForm: { id: 'package_correspondence', edition: '1' }, signatureFields: ['Signing_authority'],
    });
  }
  expect(template.members.find(m => m.key === 'appeal-decision')?.completion).toMatchObject({ reviewedScan: true });
});

it('fills the UPB and optional suspect statement from the same intake grade', async () => {
  serveOfficialForms();
  const { prepareConditionalPackage, applyPreparedConditionalPackage, startConditionalPackage } = await import('@/lib/packageConditional');
  const { getPackageRevision } = await import('@/lib/actionPackages');
  const classification = await import('@/config/classification');
  const { resolveExportDeploymentPolicy } = await import('@/lib/exportDeploymentPolicy');
  const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy);
  vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
  try {
    const template = await maintainedPackageAction('njp');
    const record = await startConditionalPackage(template, policy, undefined, () => true);
    const answers = { version: 1 as const, groups: {}, values: { caseReference: 'TEST-15', caseStage: 'preparing',
      unit: 'Training unit', allegations: 'Synthetic case', grade: 'Cpl', suspectStatement: true, adminAction: false, victimNotice: false } };
    const plan = await prepareConditionalPackage({ template, record, answers }, policy);
    const revision = getPackageRevision((await applyPreparedConditionalPackage(plan, policy, true)).record);
    for (const [formId, field] of [['navmc10132', '19_accused_rank_grade'], ['jagman_a1o', 'rank']]) {
      const member = revision.members.find(m => m.kind === 'native' && m.session.formType === formId);
      expect(member).toMatchObject({ kind: 'native', session: { genericForm: { answers: { [field]: 'Cpl' } } } });
    }
  } finally { vi.restoreAllMocks(); }
});

it('opens each editable appendix from the same catalog edition standalone and in the package', async () => {
  serveOfficialForms();
  const { createOfficialFormMember } = await import('@/lib/packageOfficialForms');
  const template = await maintainedPackageAction('njp');
  for (const [key, formId] of [
    ['rights-notice', 'jagman_a1d'], ['education-notice', 'jagman_a1e'],
    ['appeal-rights', 'jagman_a1g'], ['suspect-statement', 'jagman_a1o'],
  ]) {
    const standalone = await createOfficialFormMember(formId, 'supporting-document');
    const member = template.members.find(item => item.key === key);
    const definition = standalone.session.genericForm?.definition;
    expect(definition?.formId).toBe(formId);
    expect(member).toMatchObject({
      kind: 'native', completion: { expectedForm: { id: formId, edition: definition?.nativePdfEdition } },
      draft: { genericForm: { definition, answers: {} } },
    });
  }
});

it('checks each UPB signature against the answers in the PDF that will be locked', async () => {
  serveOfficialForms();
  const { checkPackageSigningPrerequisites } = await import('@/lib/packageSigningPrerequisites');
  const { createOfficialFormMember } = await import('@/lib/packageOfficialForms');
  const { renderForm } = await import('@/services/forms/render');
  const template = await maintainedPackageAction('njp');
  const member = await createOfficialFormMember('navmc10132', 'supporting-document');
  const form = member.session.genericForm!;
  const original = await readFile(resolve('public/templates', form.definition.directory, 'original.pdf'));
  const rules = [
    template.members.find(m => m.key === 'upb')!,
    ...template.program.requirements.filter(r => ['upb-authority', 'upb-appeal-decision'].includes(r.id)),
  ];
  const revision: import('@/lib/actionPackages').PackageRevision = {
    id: 'revision', createdAt: 0, members: [member], outputs: [], requirements: { version: 1,
      items: rules.map((r, i) => ({ id: 'rule-' + i, kind: 'document', label: 'UPB', condition: 'active',
        operations: ['pdf'], memberId: member.id, completion: r.completion })) },
  };
  const answers: Record<string, string> = {
    '17_unit': 'Training unit', '18_accused_full_name': 'EXAMPLE, TEST', '19_accused_rank_grade': 'Cpl/E4',
    '20_accused_edipi': '0000000000', '2_acc_election_and_rights_date': '2026-01-10',
    '1b_article': 'Art. 80  Attempts', '1c_summary': 'Synthetic allegation',
  };
  const pdf = async () => Uint8Array.from((await renderForm({ ...form, answers }, 'preview', async () => original)).bytes).buffer;
  const check = (field: string, bytes: ArrayBuffer) => checkPackageSigningPrerequisites(revision, member.id, field, bytes);
  const split = await pdf();
  await expect(check('2 ACC ELECTION AND RIGHTS SIGNATURE', split)).rejects.toThrow('on the same line');
  delete answers['1c_summary'];
  answers['1b_summary'] = 'Synthetic allegation';
  const early = await pdf();
  await expect(check('2 ACC ELECTION AND RIGHTS SIGNATURE', early)).resolves.toBeUndefined();
  await expect(check('3 RIGHTS ATTEST SIGNATURE', early)).rejects.toThrow('certification date');
  await expect(check('9 NJP AUTHORITY SIGNATURE', early)).rejects.toThrow('punishment, date');
  await expect(check('11 APPEAL ADVISEMENT SIGNATURE', early)).rejects.toThrow('notice dates');
  await expect(check('12 APPEAL INTENT SIGNATURE', early)).rejects.toThrow('appeal intent and date');
  await expect(check('14 APPEAL DECISION SIGNATURE', early)).rejects.toThrow('appeal filing date');
  Object.assign(answers, {
    '3_rights_attest_date': '2026-01-10', '6_punishment_imposed': 'Synthetic entry', '6_punishment_imposition_date': '2026-01-11',
    '7_suspension_if_any': 'NONE', '8_njp_authority_name_title_service': 'Training officer', '8a_njp_authority_grade': 'Capt/O3',
    '8b_njp_authority_edipi': '0000000001', '10_date_of_disposition_notice': '2026-01-11', '11_appeal_advisement_date': '2026-01-11',
    '12_intend_appeal': 'I do intend to appeal.', '12_appeal_intent_date': '2026-01-11', '13_date_of_appeal_if_any': '2026-01-12',
    '14_appeal_decision': 'Synthetic decision', '14_appeal_decision_date': '2026-01-13',
  });
  answers['1a_finding'] = 'Guilty';
  await expect(check('9 NJP AUTHORITY SIGNATURE', await pdf())).rejects.toThrow('finding for each allegation');
  delete answers['1a_finding'];
  answers['1b_finding'] = 'Guilty';
  answers['1c_article'] = 'Art. 80  Attempts';
  await expect(check('2 ACC ELECTION AND RIGHTS SIGNATURE', await pdf())).rejects.toThrow('same line');
  answers['1c_summary'] = 'Second synthetic allegation';
  await expect(check('9 NJP AUTHORITY SIGNATURE', await pdf())).rejects.toThrow('finding for each allegation');
  answers['1c_finding'] = 'Not Guilty';
  const completed = await pdf();
  for (const signature of ['3 RIGHTS ATTEST SIGNATURE', '9 NJP AUTHORITY SIGNATURE', '11 APPEAL ADVISEMENT SIGNATURE',
    '12 APPEAL INTENT SIGNATURE', '14 APPEAL DECISION SIGNATURE']) {
    await expect(check(signature, completed)).resolves.toBeUndefined();
  }
});
