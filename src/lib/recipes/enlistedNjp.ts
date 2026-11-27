import type { MaintainedRecipe } from '../maintainedPackageActions';
import type { PackageTemplateCondition } from '../packageTemplateProgram';
import { answeredEquals, writtenCorrespondence, documentSource, documentSourceCondition, equals, program, question, receivedDocument } from '../packageRecipeMembers';
import { namedPdfChoices } from '@/services/forms/officialFormDefinition';
import { packageFormFields } from '../packageFormFields';
import { USMC_RANKS } from '@/data/ranks';
import { enlistedGradeRange } from '../packageRankConditions';

const unrecognizedGrade = (): PackageTemplateCondition => ({
  op: 'not', condition: enlistedGradeRange('grade', USMC_RANKS, 1, 9),
});

export async function enlistedNjp(): Promise<MaintainedRecipe> {
  const upb = { id: 'navmc10132', edition: '2023-08' };
  const administrativeAction = { id: 'navmc_10274', edition: '2020-07' };
  const appendixEdition = '5800.7G-CH2';
  const rights = { id: 'jagman_a1d', edition: '5800.7G-CH2.1' };
  const education = { id: 'jagman_a1e', edition: '5800.7G-CH2.1' };
  const appealNotice = { id: 'jagman_a1g', edition: '5800.7G-CH2.1' };
  const [upbField, rightsField, educationField, appealField, electionChoice] = await Promise.all([
    packageFormFields(upb), packageFormFields(rights), packageFormFields(education),
    packageFormFields(appealNotice), namedPdfChoices(upb, '2_demand'),
  ]);
  const election = upbField('2_demand');
  const item2Signature = upbField('2_acc_election_and_rights_signature');
  const rightsAttestation = upbField('3_rights_attest_signature');
  const authoritySignature = upbField('9_njp_authority_signature');
  const finalSignature = upbField('16_final_admin_init');
  const advisementSignature = upbField('11_appeal_advisement_signature');
  const intentSignature = upbField('12_appeal_intent_signature');
  const appealSignature = upbField('14_appeal_decision_signature');
  // Later publisher signatures also lock earlier entries, even if the earlier signature was skipped.
  const locksAppeal = [appealSignature, finalSignature];
  const locksIntent = [intentSignature, ...locksAppeal];
  const locksAdvisement = [advisementSignature, ...locksIntent];
  const locksPunishment = [authoritySignature, ...locksAdvisement];
  const locksAttestation = [rightsAttestation, ...locksPunishment];
  const locksIdentity = [item2Signature, ...locksAttestation];
  const allegationRows = ['a', 'b', 'c', 'd', 'e'].map(row => ({
    article: upbField('1' + row + '_article'), summary: upbField('1' + row + '_summary'), finding: upbField('1' + row + '_finding'),
  }));
  const appealDate = upbField('13_date_of_appeal_if_any');
  const notAppealed = upbField('13_not_appealed');
  const refusalMarker = upbField('2_acc_refuse_to_sign');
  const refused = equals('caseStage', 'refused');
  const refusedSignature: PackageTemplateCondition = { op: 'all', conditions: [refused, equals('refusedSignature', true)] };
  const imposed = equals('caseStage', 'punishment-imposed');
  const page11: PackageTemplateCondition = { op: 'all', conditions: [imposed, equals('includePage11', true)] };
  const appeal: PackageTemplateCondition = { op: 'all', conditions: [imposed, equals('appealStatus', 'filed')] };
  const decided: PackageTemplateCondition = { op: 'all', conditions: [appeal, equals('appealDecisionIssued', true)] };
  const recordOfService: PackageTemplateCondition = { op: 'all', conditions: [appeal, { op: 'any', conditions: [enlistedGradeRange('grade', USMC_RANKS, 1, 4), { op: 'all', conditions: [unrecognizedGrade(), equals('includeRecordOfService', true)] }] }] };
  return {
    kind: 'dondocs-package-template', version: 2, id: 'dondocs_njp', primaryMemberKey: 'upb', name: 'Nonjudicial punishment (NJP)', createdAt: 0,
    deliveryChoices: [
      { id: 'command-file', label: 'Command file' },
      { id: 'forward-appeal', label: 'Forward appeal', when: appeal, confirmationIds: ['appeal-enclosures'],
        memberKeys: ['additional-endorsements', 'draft-endorsement', 'draft-appeal', 'appeal', 'upb', 'proceedings', 'draft-proceedings',
          'page-11', 'received-page-11', 'existing-page-11', 'record-of-service', 'rights-notice', 'education-notice',
          'suspect-statement', 'written-matters', 'draft-matters', 'written-censure', 'appeal-rights', 'allied-papers', 'suspension'] },
    ],
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
      question('appealStatus', 'Appeal status', 'choice', { when: imposed, options: [
        { id: 'pending', label: 'Appeal period open, none filed' }, { id: 'filed', label: 'Filed' },
        { id: 'closed', label: 'Closed without appeal' },
      ] }),
      question('appealDecisionIssued', 'Has the appeal authority issued its decision?', 'boolean', { when: appeal }),
      question('includeRecordOfService', 'Is the appeal for a corporal or below?', 'boolean', { when: { op: 'all', conditions: [appeal, unrecognizedGrade()] } }),
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
    ], { revision: '19', requirements: [
      { id: 'closed-without-award', label: 'UPB disposition', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: equals('caseStage', 'closed-no-punishment'),
        completion: { deliveryBlockReason: 'No punishment was imposed. NAVMC 10132 item 6 directs destruction of the UPB. Do not deliver it or enter it in the Marine’s record.' } },
      { id: 'rights-election', label: 'Signed NJP election', memberKey: 'rights-notice', kind: 'document', operations: ['pdf'],
        when: { op: 'not', condition: refusedSignature }, completion: { expectedForm: rights, signatureFields: [rightsField('Election_Marine'), rightsField('Election_witness')] } },
      { id: 'rights-refusal', label: 'Refusal on the rights notice', memberKey: 'rights-notice', kind: 'document', operations: ['pdf'], when: refused,
        completion: { expectedForm: rights, pdfSelections: [{ field: rightsField('election'), expected: ['refuse'],
          label: 'Review the NJP election on JAGMAN A-1-d. The case is recorded as refused.' }] } },
      { id: 'rights-acceptance', label: 'Acceptance on the rights notice', memberKey: 'rights-notice', kind: 'document', operations: ['pdf'], when: imposed,
        completion: { expectedForm: rights, pdfSelections: [{ field: rightsField('election'), expected: ['accept'],
          label: 'Review the NJP election on JAGMAN A-1-d. The case is recorded as punishment imposed.' }] } },
      { id: 'refusal', label: 'Signed UPB item 2 for referral', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: refused,
        completion: { expectedForm: upb,
          pdfSelections: [{ field: election, expected: [electionChoice('refuse')], initialize: true, label: 'Select refusal of NJP in UPB item 2 to match the saved case stage.' }] } },
      { id: 'refusal-marker', label: 'Refusal to sign recorded by the CO', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: refusedSignature,
        completion: { expectedForm: upb, signatureFields: [item2Signature], signatureLabels: { [item2Signature]: 'CO signs item 2' },
          pdfSelections: [{ field: refusalMarker, expected: true, label: 'Mark the refusal to sign in UPB item 2.' }] } },
      { id: 'refusal-signed', label: 'UPB item 2 signed by the Marine', memberKey: 'upb', kind: 'document', operations: ['pdf'],
        when: { op: 'all', conditions: [refused, equals('refusedSignature', false)] },
        completion: { expectedForm: upb, signatureFields: [item2Signature], signatureLabels: { [item2Signature]: 'Marine signs item 2' },
          pdfSelections: [{ field: refusalMarker, expected: false, label: 'Clear the refusal-to-sign box in UPB item 2 to match the saved answer.' }] } },
      { id: 'appeal-pending', label: 'UPB item 13 while the appeal period is open', memberKey: 'upb', kind: 'document', operations: ['pdf'],
        when: { op: 'all', conditions: [imposed, equals('appealStatus', 'pending')] },
        completion: { expectedForm: upb, pdfSelections: [
          { field: notAppealed, expected: false, label: 'Clear Not appealed while the appeal period is open.' },
          { field: appealDate, expected: null, label: 'Review the appeal date in UPB item 13. No appeal is recorded as filed.' },
        ] } },
      { id: 'appeal-date', label: 'Date of appeal in UPB item 13', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: appeal,
        completion: { expectedForm: upb, requiredPdfFields: [appealDate],
          pdfSelections: [{ field: notAppealed, expected: false, label: 'Clear Not appealed in UPB item 13 for a filed appeal.' }] } },
      { id: 'appeal-closed', label: 'No appeal in UPB item 13', memberKey: 'upb', kind: 'document', operations: ['pdf'],
        when: { op: 'all', conditions: [imposed, equals('appealStatus', 'closed')] },
        completion: { expectedForm: upb, pdfSelections: [{ field: notAppealed, expected: true, label: 'Mark Not appealed in UPB item 13 before closing without an appeal.' },
          { field: appealDate, expected: null, label: 'Review the appeal date in UPB item 13. The case is recorded as closed without appeal.' }] } },
      { id: 'upb-appeal-decision', label: 'Appeal authority decision in UPB item 14', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: decided,
        completion: { expectedForm: upb, signatureFields: [appealSignature], answerGroups: [{
          label: 'Enter the appeal filing date, decision and decision date in UPB items 13–14.',
          alternatives: [[appealDate, upbField('14_appeal_decision'), upbField('14_appeal_decision_date')]],
          beforeSignatures: locksAppeal,
        }] } },
      { id: 'upb-authority', label: 'UPB punishment and rights acknowledgments', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: imposed,
        completion: { expectedForm: upb, pdfSelections: [{ field: election, expected: [electionChoice('accept')], label: 'Review UPB item 2. Its election must agree with the punishment-imposed case stage.' },
            { field: refusalMarker, expected: false, label: 'Review the refusal-to-sign box in UPB item 2. The case is recorded as punishment imposed.' }],
          answerGroups: [
            { label: 'Enter the certification date in UPB item 3.', alternatives: [[upbField('3_rights_attest_date')]],
              beforeSignatures: locksAttestation },
            { label: 'Record a finding for each allegation in UPB items 1 and 5.', eachStartedRow: true,
              alternatives: allegationRows.map(row => [row.article, row.summary, row.finding]), beforeSignatures: locksPunishment },
            { label: 'Complete the punishment, date, suspension terms (or NONE) and imposing officer details in UPB items 6–8.',
              alternatives: [['6_punishment_imposed', '6_punishment_imposition_date', '7_suspension_if_any', '8_njp_authority_name_title_service', '8a_njp_authority_grade', '8b_njp_authority_edipi'].map(upbField)],
              beforeSignatures: locksPunishment },
            { label: 'Enter the notice dates in UPB items 10 and 11.',
              alternatives: [[upbField('10_date_of_disposition_notice'), upbField('11_appeal_advisement_date')]],
              beforeSignatures: locksAdvisement },
            { label: 'Record the appeal intent and date in UPB item 12.',
              alternatives: [[upbField('12_intend_appeal'), upbField('12_appeal_intent_date')]],
              beforeSignatures: locksIntent },
          ],
          signatureFields: [item2Signature, rightsAttestation, authoritySignature, advisementSignature, intentSignature] } },
      { id: 'legal-review', label: 'Confirm applicable legal review', kind: 'confirmation', operations: ['review'] },
      { id: 'appeal-enclosures', label: 'Check the appeal enclosures against all applicable Page 11 entries and allied papers', kind: 'confirmation', operations: ['review', 'pdf'], when: appeal },
      { id: 'notice-date', label: 'Notice of appeal decision in UPB item 15', memberKey: 'upb', kind: 'document', operations: ['pdf'], when: decided,
        completion: { expectedForm: upb, answerGroups: [{ label: 'Enter the date the Marine was notified of the appeal decision in UPB item 15.',
          alternatives: [[upbField('15_date_of_notice_of_appeal_decision')]], beforeSignatures: [finalSignature] }] } },
      { id: 'appeal-notified', label: 'Confirm delivery of the appeal decision to the Marine and completion of UPB item 15', kind: 'confirmation', operations: ['review', 'pdf'], when: decided },
      { id: 'finance-handoff', label: 'Confirm the separate finance or IPAC handoff', kind: 'confirmation', operations: ['review'], when: { op: 'all', conditions: [imposed, equals('financeHandoff', true)] } },
      { id: 'victim-notice', label: 'Confirm DD Form 2701 issuance in the victim and witness workflow', kind: 'confirmation', operations: ['review'], when: equals('victimNotice', true) },
    ] }),
    // Command record filing order. MCO 5800.16, vol. 14, ¶¶ 011106–011107.
    members: [
      { key: 'upb', kind: 'official-form', formId: 'navmc10132', completion: { expectedForm: upb, answerGroups: [
        { label: 'Complete the Marine’s unit, name, rank/grade and EDIPI in UPB items 17–20.',
          alternatives: [['17_unit', '18_accused_full_name', '19_accused_rank_grade', '20_accused_edipi'].map(upbField)], beforeSignatures: locksIdentity },
        { label: 'Enter each article and its summary on the same line in UPB item 1.', eachStartedRow: true,
          alternatives: allegationRows.map(row => [row.article, row.summary]), beforeSignatures: locksIdentity },
        { label: 'Enter the election date in UPB item 2.', alternatives: [[upbField('2_acc_election_and_rights_date')]], beforeSignatures: locksIdentity },
      ] }, facts: { '2_acc_refuse_to_sign': 'refusedSignature', '18_accused_full_name': 'marineName', '17_unit': 'unit', '19_accused_rank_grade': 'grade', '20_accused_edipi': 'edipi', '1a_summary': 'allegations' }, role: 'supporting-document', required: true },
      { key: 'proceedings', kind: 'attachment', reference: { id: 'jagman_a1f', edition: appendixEdition }, label: 'Summary of proceedings', role: 'supporting-document', required: true, when: documentSourceCondition(imposed, 'proceedingsSource', 'original') },
      await writtenCorrespondence({ key: 'draft-proceedings', label: 'Record of NJP proceedings', when: documentSourceCondition(imposed, 'proceedingsSource', 'draft') }),
      { key: 'rights-notice', kind: 'official-form', formId: 'jagman_a1d', facts: { marine: 'marineName', accused_name: 'marineName', unit: 'unit', allegation: 'allegations', evidence: 'evidenceIndex' }, reference: { id: 'jagman_a1d', edition: appendixEdition }, completion: { expectedForm: rights }, role: 'supporting-document', required: true },
      { key: 'education-notice', kind: 'official-form', formId: 'jagman_a1e', reference: { id: 'jagman_a1e', edition: appendixEdition }, completion: { expectedForm: education, signatureFields: [educationField('Education_Marine'), educationField('Education_witness')] }, role: 'supporting-document', required: true, when: answeredEquals('educationNotice', true) },
      { key: 'suspect-statement', kind: 'official-form', formId: 'jagman_a1o', facts: { marine: 'marineName', rank: 'grade', unit: 'unit', allegation: 'allegations' }, reference: { id: 'jagman_a1o', edition: appendixEdition }, completion: { expectedForm: { id: 'jagman_a1o', edition: '5800.7G-CH2.1' } }, role: 'supporting-document', required: true, when: answeredEquals('suspectStatement', true) },
      { key: 'written-matters', kind: 'attachment', label: 'Written matters submitted by the Marine', role: 'supporting-document', required: true, when: receivedDocument('mattersSource') },
      await writtenCorrespondence({ key: 'draft-matters', label: 'Written matters from the Marine', when: answeredEquals('mattersSource', 'draft') }),
      { ...await writtenCorrespondence({ key: 'written-censure', label: 'Written punitive censure', requireAuthoritySignature: true, when: { op: 'all', conditions: [imposed, answeredEquals('writtenCensure', true)] } }), reference: { id: 'jagman_a1h', edition: appendixEdition } },
      { key: 'appeal-rights', kind: 'official-form', formId: 'jagman_a1g', facts: { marine: 'marineName', unit: 'unit', hearing: 'hearingDate', authority: 'appealAuthority' }, reference: { id: 'jagman_a1g', edition: appendixEdition }, completion: { expectedForm: appealNotice, signatureFields: [appealField('Appeal_Marine'), appealField('Appeal_witness')] }, role: 'supporting-document', required: true, when: imposed },
      { key: 'appeal', kind: 'attachment', label: 'Appeal letter and endorsements', role: 'supporting-document', required: true, when: documentSourceCondition(appeal, 'appealSource', 'original') },
      await writtenCorrespondence({ key: 'draft-appeal', label: 'Appeal of nonjudicial punishment', when: documentSourceCondition(appeal, 'appealSource', 'draft'), facts: { from: 'marineName', to: 'appealAuthority' } }),
      await writtenCorrespondence({ key: 'draft-endorsement', label: 'Forwarding endorsement on NJP appeal', when: documentSourceCondition(appeal, 'appealSource', 'draft'), docType: 'new_page_endorsement', endorses: 'draft-appeal' }),
      { key: 'additional-endorsements', kind: 'attachment', label: 'Subsequent forwarding endorsements (newest first)', role: 'supporting-document', required: false, multipleFiles: true, when: documentSourceCondition(appeal, 'appealSource', 'draft') },
      { key: 'page-11', kind: 'official-form', formId: 'navmc_118_11', completion: { expectedForm: { id: 'navmc_118_11', edition: '2014-05' } }, facts: { edipi: 'edipi' }, role: 'supporting-document', required: true,
        when: documentSourceCondition(page11, 'page11Source', 'draft') },
      { key: 'received-page-11', kind: 'attachment', label: 'Applicable Page 11 entry', role: 'supporting-document', required: true, when: documentSourceCondition(page11, 'page11Source', 'original') },
      { key: 'existing-page-11', kind: 'attachment', label: 'Additional Page 11 entries for the appeal', role: 'supporting-document', required: false, multipleFiles: true, when: appeal },
      { key: 'record-of-service', kind: 'attachment', label: 'Record of Service', role: 'supporting-document', required: true, when: recordOfService },
      { key: 'allied-papers', kind: 'attachment', label: 'Supporting evidence and allied papers', role: 'supporting-document', required: false, multipleFiles: true },
      { key: 'appeal-decision', kind: 'attachment', completion: { reviewedScan: true }, label: 'Signed appeal decision correspondence to the Marine', role: 'supporting-document', required: true, when: documentSourceCondition(decided, 'decisionSource', 'original') },
      await writtenCorrespondence({ key: 'draft-decision', label: 'Decision on NJP appeal', requireAuthoritySignature: true,
        when: documentSourceCondition(decided, 'decisionSource', 'draft') }),
      { key: 'suspension', kind: 'attachment', label: 'Suspension or vacation documents', role: 'supporting-document', required: true, when: { op: 'all', conditions: [imposed, equals('includeSuspension', true)] } },
      { key: 'admin-action', kind: 'official-form', formId: administrativeAction.id, reference: administrativeAction, completion: { expectedForm: administrativeAction }, role: 'supporting-document', required: true, when: equals('adminAction', true) },
    ],
  };
}
