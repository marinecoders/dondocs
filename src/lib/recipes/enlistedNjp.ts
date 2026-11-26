import type { MaintainedRecipe } from '../maintainedPackageActions';
import type { PackageTemplateCondition } from '../packageTemplateProgram';
import { correspondenceMember, documentSource, documentSourceCondition, equals, program, question, receivedDocument } from '../packageRecipeMembers';
import { packageFormFields } from '../packageFormFields';

export async function enlistedNjp(): Promise<MaintainedRecipe> {
  const upb = { id: 'navmc10132', edition: '2023-08' };
  const appendixEdition = '5800.7G-CH2';
  const rights = { id: 'jagman_a1d', edition: '5800.7G-CH2.1' };
  const education = { id: 'jagman_a1e', edition: '5800.7G-CH2.1' };
  const appealNotice = { id: 'jagman_a1g', edition: '5800.7G-CH2.1' };
  const signedLetter = { id: 'package_correspondence', edition: '1' };
  const [upbField, rightsField, educationField, appealField, letterField] = await Promise.all([
    packageFormFields(upb), packageFormFields(rights), packageFormFields(education),
    packageFormFields(appealNotice), packageFormFields(signedLetter),
  ]);
  const election = upbField('2_demand');
  const demand = 'I demand trial and refuse non-judicial punishment.';
  const refusalMarker = upbField('2_acc_refuse_to_sign');
  const refused = equals('caseStage', 'refused');
  const refusedSignature: PackageTemplateCondition = { op: 'all', conditions: [refused, equals('refusedSignature', true)] };
  const imposed = equals('caseStage', 'punishment-imposed');
  const page11: PackageTemplateCondition = { op: 'all', conditions: [imposed, equals('includePage11', true)] };
  const appeal: PackageTemplateCondition = { op: 'all', conditions: [imposed, equals('appealFiled', true)] };
  const decided: PackageTemplateCondition = { op: 'all', conditions: [appeal, equals('appealDecisionIssued', true)] };
  const recordOfService: PackageTemplateCondition = { op: 'all', conditions: [appeal, equals('includeRecordOfService', true)] };
  const selected = (id: string): PackageTemplateCondition => ({ op: 'all', conditions: [
    { op: 'answered', questionId: id }, equals(id, true),
  ] });
  const writeMatters: PackageTemplateCondition = { op: 'all', conditions: [
    { op: 'answered', questionId: 'mattersSource' }, equals('mattersSource', 'draft'),
  ] };
  const letter = async (key: string, label: string, when: PackageTemplateCondition, docType = 'naval_letter', facts?: Record<string, string>) => ({
    ...await correspondenceMember({ key, label, when, docType, facts, subject: label.toUpperCase(),
      role: docType === 'new_page_endorsement' ? 'endorsement' : 'supporting-document' }),
    completion: { writtenContent: true as const },
  });
  return {
    kind: 'dondocs-package-template', version: 2, id: 'dondocs_njp', primaryMemberKey: 'upb', name: 'Nonjudicial punishment (NJP)', createdAt: 0,
    program: program([
      question('caseReference', 'Case reference', 'identifier'),
      question('marineName', 'Marine name (last, first middle)', 'text', { required: false }),
      question('grade', 'Marine grade', 'text', { required: false }),
      question('edipi', 'Marine EDIPI', 'identifier', { required: false }),
      question('hearingDate', 'Hearing date', 'date', { required: false }),
      question('appealAuthority', 'Appeal authority', 'text', { required: false }),
      question('unit', 'Unit'),
      question('allegations', 'Allegation summary'),
      question('evidenceIndex', 'Evidence index', 'text', { required: false }),
      question('caseStage', 'Case stage', 'choice', { options: [
        { id: 'preparing', label: 'Preparing for the hearing' },
        { id: 'punishment-imposed', label: 'Punishment imposed' },
        { id: 'refused', label: 'NJP refused' },
        { id: 'closed-no-punishment', label: 'Closed without punishment' },
      ] }),
      question('refusedSignature', 'Did the Marine also refuse to sign the UPB?', 'boolean', { when: refused }),
      question('includePage11', 'Is there an applicable Page 11 entry?', 'boolean', { when: imposed }),
      documentSource('page11Source', 'Applicable Page 11 entry', page11),
      question('appealFiled', 'Was an appeal filed?', 'boolean', { when: imposed }),
      question('appealDecisionIssued', 'Has the appeal authority issued its decision?', 'boolean', { when: appeal }),
      question('includeRecordOfService', 'Is the appeal for a corporal or below?', 'boolean', { when: appeal }),
      question('includeSuspension', 'Are there suspension or vacation documents?', 'boolean', { when: imposed }),
      question('financeHandoff', 'Is a finance or IPAC handoff needed?', 'boolean', { when: imposed }),
      question('educationNotice', 'Include an education assistance notice?', 'boolean', { required: false }),
      question('suspectStatement', 'Include a separate suspect statement?', 'boolean', { required: false }),
      question('writtenCensure', 'Include a written punitive censure?', 'boolean', { required: false, when: imposed }),
      documentSource('mattersSource', 'Written matters from the Marine'),
      documentSource('proceedingsSource', 'Hearing record', imposed),
      documentSource('appealSource', 'Appeal and forwarding endorsement', appeal),
      documentSource('decisionSource', 'Appeal decision', decided),
      question('adminAction', 'Does the command require a separate administrative action?', 'boolean'),
      question('victimNotice', 'Does DD Form 2701 issuance need tracking?', 'boolean'),
    ], { revision: '10', requirements: [
      { id: 'closed-without-award', label: 'UPB disposition', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: equals('caseStage', 'closed-no-punishment'),
        completion: { deliveryBlockReason: 'No punishment was imposed. NAVMC 10132 item 6 directs destruction of the UPB. Do not deliver it or enter it in the Marine’s record.' } },
      { id: 'rights-election', label: 'Signed NJP election', memberKey: 'rights-notice', kind: 'document', operations: ['pdf'],
        when: { op: 'not', condition: refusedSignature }, completion: { expectedForm: rights, signatureFields: [rightsField('Election_Marine'), rightsField('Election_witness')] } },
      { id: 'refusal', label: 'Signed UPB item 2 for referral', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: refused,
        completion: { expectedForm: upb, signatureFields: [upbField('2_acc_election_and_rights_signature')],
          pdfSelections: [{ field: election, expected: [demand], initialize: true, label: 'Select refusal of NJP in UPB item 2 to match the saved case stage.' }] } },
      { id: 'refusal-marker', label: 'Refusal to sign recorded by the CO', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: refusedSignature,
        completion: { expectedForm: upb, pdfSelections: [{ field: refusalMarker, expected: true, label: 'Mark the refusal to sign in UPB item 2.' }] } },
      { id: 'refusal-signed', label: 'UPB item 2 signed by the Marine', memberKey: 'upb', kind: 'document', operations: ['pdf'],
        when: { op: 'all', conditions: [refused, equals('refusedSignature', false)] },
        completion: { expectedForm: upb, pdfSelections: [{ field: refusalMarker, expected: false, label: 'Clear the refusal-to-sign box in UPB item 2 to match the saved answer.' }] } },
      { id: 'appeal-date', label: 'Date of appeal in UPB item 13', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: appeal,
        completion: { expectedForm: upb, requiredPdfFields: [upbField('13_date_of_appeal_if_any')] } },
      { id: 'upb-appeal-decision', label: 'Appeal authority decision in UPB item 14', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: decided,
        completion: { expectedForm: upb, signatureFields: [upbField('14_appeal_decision_signature')], requiredPdfFields: [upbField('14_appeal_decision'), upbField('14_appeal_decision_date')] } },
      { id: 'upb-authority', label: 'UPB punishment and rights acknowledgments', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: imposed,
        completion: { expectedForm: upb, pdfSelections: [{ field: election, expected: [
            'I do not demand trial and will accept non-judicial punishment, subject to my right of appeal.',
          ], label: 'Review UPB item 2. Its election must agree with the punishment-imposed case stage.' }],
          requiredPdfFields: [upbField('6_punishment_imposed'), upbField('6_punishment_imposition_date')],
          signatureFields: [upbField('2_acc_election_and_rights_signature'), upbField('3_rights_attest_signature'), upbField('9_njp_authority_signature'), upbField('11_appeal_advisement_signature'), upbField('12_appeal_intent_signature')] } },
      { id: 'legal-review', label: 'Confirm applicable legal review', kind: 'confirmation', operations: ['review'] },
      { id: 'appeal-enclosures', label: 'Check the appeal enclosures against all applicable Page 11 entries and allied papers', kind: 'confirmation', operations: ['review', 'pdf'], when: appeal },
      { id: 'appeal-notified', label: 'Confirm delivery of the appeal decision to the Marine and completion of UPB item 15', kind: 'confirmation', operations: ['review'], when: decided },
      { id: 'finance-handoff', label: 'Confirm the separate finance or IPAC handoff', kind: 'confirmation', operations: ['review'], when: { op: 'all', conditions: [imposed, equals('financeHandoff', true)] } },
      { id: 'victim-notice', label: 'Confirm DD Form 2701 issuance in the victim and witness workflow', kind: 'confirmation', operations: ['review'], when: equals('victimNotice', true) },
    ] }),
    members: [
      { key: 'upb', kind: 'official-form', formId: 'navmc10132', completion: { expectedForm: upb, requiredPdfFields: [upbField('18_accused_full_name')] }, facts: { '2_acc_refuse_to_sign': 'refusedSignature', '18_accused_full_name': 'marineName', '17_unit': 'unit', '19_accused_rank_grade': 'grade', '20_accused_edipi': 'edipi', '1a_summary': 'allegations' }, role: 'supporting-document', required: true },
      { key: 'rights-notice', kind: 'official-form', formId: 'jagman_a1d', facts: { marine: 'marineName', accused_name: 'marineName', unit: 'unit', allegation: 'allegations', evidence: 'evidenceIndex' }, reference: { id: 'jagman_a1d', edition: appendixEdition }, completion: { expectedForm: rights }, role: 'supporting-document', required: true },
      { key: 'education-notice', kind: 'official-form', formId: 'jagman_a1e', reference: { id: 'jagman_a1e', edition: appendixEdition }, completion: { expectedForm: education, signatureFields: [educationField('Education_Marine'), educationField('Education_witness')] }, role: 'supporting-document', required: true, when: selected('educationNotice') },
      { key: 'suspect-statement', kind: 'official-form', formId: 'jagman_a1o', facts: { marine: 'marineName', unit: 'unit', allegation: 'allegations' }, reference: { id: 'jagman_a1o', edition: appendixEdition }, completion: { expectedForm: { id: 'jagman_a1o', edition: '5800.7G-CH2.1' } }, role: 'supporting-document', required: true, when: selected('suspectStatement') },
      { key: 'written-matters', kind: 'attachment', label: 'Written matters submitted by the Marine', role: 'supporting-document', required: true, when: receivedDocument('mattersSource') },
      await letter('draft-matters', 'Written matters from the Marine', writeMatters),
      { key: 'proceedings', kind: 'attachment', reference: { id: 'jagman_a1f', edition: appendixEdition }, label: 'Summary of proceedings', role: 'supporting-document', required: true, when: documentSourceCondition(imposed, 'proceedingsSource', 'original') },
      await letter('draft-proceedings', 'Record of NJP proceedings', documentSourceCondition(imposed, 'proceedingsSource', 'draft')),
      { key: 'allied-papers', kind: 'attachment', label: 'Supporting evidence and allied papers', role: 'supporting-document', required: false },
      { ...await letter('written-censure', 'Written punitive censure', { op: 'all', conditions: [imposed, selected('writtenCensure')] }), reference: { id: 'jagman_a1h', edition: appendixEdition }, completion: { writtenContent: true } },
      { key: 'appeal-rights', kind: 'official-form', formId: 'jagman_a1g', facts: { marine: 'marineName', unit: 'unit', hearing: 'hearingDate', authority: 'appealAuthority' }, reference: { id: 'jagman_a1g', edition: appendixEdition }, completion: { expectedForm: appealNotice, signatureFields: [appealField('Appeal_Marine'), appealField('Appeal_witness')] }, role: 'supporting-document', required: true, when: imposed },
      { key: 'page-11', kind: 'official-form', formId: 'navmc_118_11', completion: { expectedForm: { id: 'navmc_118_11', edition: '2014-05' } }, facts: { edipi: 'edipi' }, role: 'supporting-document', required: true,
        when: documentSourceCondition(page11, 'page11Source', 'draft') },
      { key: 'received-page-11', kind: 'attachment', label: 'Applicable Page 11 entry', role: 'supporting-document', required: true, when: documentSourceCondition(page11, 'page11Source', 'original') },
      { key: 'existing-page-11', kind: 'attachment', label: 'Additional Page 11 entries for the appeal', role: 'supporting-document', required: false, when: appeal },
      { key: 'appeal', kind: 'attachment', label: 'Appeal letter and endorsements', role: 'supporting-document', required: true, when: documentSourceCondition(appeal, 'appealSource', 'original') },
      await letter('draft-appeal', 'Appeal of nonjudicial punishment', documentSourceCondition(appeal, 'appealSource', 'draft'), 'naval_letter', { from: 'marineName', to: 'appealAuthority' }),
      await letter('draft-endorsement', 'Forwarding endorsement on NJP appeal', documentSourceCondition(appeal, 'appealSource', 'draft'), 'new_page_endorsement'),
      { key: 'appeal-decision', kind: 'attachment', completion: { reviewedScan: true }, label: 'Signed appeal decision correspondence to the Marine', role: 'supporting-document', required: true, when: documentSourceCondition(decided, 'decisionSource', 'original') },
      { ...await letter('draft-decision', 'Decision on NJP appeal', documentSourceCondition(decided, 'decisionSource', 'draft')),
        completion: { writtenContent: true, expectedForm: signedLetter, signatureFields: [letterField('signing_authority')] } },
      { key: 'record-of-service', kind: 'attachment', label: 'Record of Service', role: 'supporting-document', required: true, when: recordOfService },
      { key: 'suspension', kind: 'attachment', label: 'Suspension or vacation documents', role: 'supporting-document', required: true, when: { op: 'all', conditions: [imposed, equals('includeSuspension', true)] } },
      { key: 'admin-action', kind: 'official-form', formId: 'navmc_10274', reference: { id: 'navmc_10274', edition: '2020-07' }, role: 'supporting-document', required: true, when: equals('adminAction', true) },
    ],
  };
}
