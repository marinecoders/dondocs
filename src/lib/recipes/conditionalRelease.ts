import { packageFormFields } from '../packageFormFields';
import type { MaintainedRecipe } from '../maintainedPackageActions';
import { correspondenceMember, equals, program, question } from '../packageRecipeMembers';
import type { PackageTemplateCondition } from '../packageTemplateProgram';

const edition = { id: 'dd0368', edition: '2011-08.upd20241126' };
const approved = equals('stage', 'approved');
const disapproved = equals('stage', 'disapproved');
const completed = equals('stage', 'completed');
const hasDecision: PackageTemplateCondition = { op: 'any', conditions: [approved, disapproved, completed] };
const approvalOnFile: PackageTemplateCondition = { op: 'any', conditions: [approved, completed] };

export async function conditionalRelease(): Promise<MaintainedRecipe> {
  const field = await packageFormFields(edition);
  const memberIdentity = [
    { name: field('member_name'), label: 'Member name' },
    { name: field('edipi'), label: 'Member EDIPI', optional: true as const },
  ];
  const expiration = field('valid_until');
  const approvedMark = field('approved');
  const disapprovedMark = field('disapproved');
  return {
    kind: 'dondocs-package-template', version: 2, id: 'dondocs_conditional_release',
    name: 'Conditional release', primaryMemberKey: 'request-letter', createdAt: 0,
    program: program([
      question('memberName', 'Member name (last, first, middle initial)'),
      question('unit', 'Current unit or command'),
      question('destination', 'Requested service or component'),
      question('endorser', 'Endorsing command'),
      question('stage', 'Transfer status', 'choice', { options: [
        { id: 'request', label: 'Preparing the request' }, { id: 'approved', label: 'Release approved' },
        { id: 'disapproved', label: 'Release disapproved' }, { id: 'completed', label: 'Enlisted or appointed' },
      ] }),
    ], { revision: '2', requirements: [
      { id: 'endorsement-authority', kind: 'confirmation', label: 'Confirm the O-5 or O-6 commanding officer endorsed the request, or the general officer for a G-level command',
        operations: ['pdf'] },
      { id: 'request-signed', memberKey: 'request', kind: 'document', label: 'Member and recruiter signatures',
        operations: ['pdf'], completion: { expectedForm: edition, signatureFields: [
          field('member_signature'), field('recruiter_signature'),
        ] } },
      { id: 'approval', memberKey: 'decision-form', kind: 'document', label: 'Approved release and expiration',
        operations: ['pdf'], when: approvalOnFile, completion: { expectedForm: edition, requiredPdfFields: [approvedMark, expiration], uncheckedPdfFields: [disapprovedMark] } },
      { id: 'disapproval', memberKey: 'decision-form', kind: 'document', label: 'Disapproval and explanation in remarks',
        operations: ['pdf'], when: disapproved, completion: { expectedForm: edition, requiredPdfFields: [field('disapproved'), field('remarks')], uncheckedPdfFields: [field('approved')] } },
      { id: 'decision-match', kind: 'confirmation', label: 'Confirm the returned decision is for this member and request and exactly one decision is marked',
        operations: ['review', 'pdf'], when: hasDecision },
      { id: 'return', kind: 'confirmation', label: 'Confirm the form and oath went to the item 6.d address and the orders and completed form went to MMSR-2',
        operations: ['review'], when: completed },
    ] }),
    members: [
      { ...await correspondenceMember({ key: 'request-letter', label: 'Transfer request letter', docType: 'naval_letter',
        subject: 'REQUEST FOR CONDITIONAL RELEASE', role: 'basic-letter', facts: { from: 'memberName' } }), completion: { writtenContent: true } },
      { ...await correspondenceMember({ key: 'endorsement', label: 'Command endorsement', docType: 'new_page_endorsement',
        subject: 'REQUEST FOR CONDITIONAL RELEASE', role: 'endorsement', facts: { from: 'endorser' } }),
        completion: { writtenContent: true } },
      { key: 'request', kind: 'official-form', formId: edition.id, role: 'supporting-document', required: true,
        facts: { member_name: 'memberName', unit: 'unit', target_component: 'destination' },
        completion: { expectedForm: edition, requiredPdfFields: [field('member_name')] } },
      { key: 'decision-form', kind: 'attachment', label: 'Signed DD Form 368 decision', role: 'supporting-document', required: true,
        when: hasDecision, completion: { expectedForm: edition, matchingPdfFields: [{ memberKey: 'request', fields: memberIdentity }], signatureFields: [field('authority_signature')] } },
      { key: 'notification', kind: 'attachment', label: 'Completed DD Form 368 with Section III certification',
        role: 'supporting-document', required: true, when: completed, completion: { expectedForm: edition, signatureFields: [
            field('member_signature'), field('recruiter_signature'), field('authority_signature'), field('certifier_signature'),
          ],
          requiredPdfFields: [approvedMark, expiration, field('oath_component'), field('certifier_date')],
          uncheckedPdfFields: [disapprovedMark], matchingPdfFields: [
            { memberKey: 'request', fields: memberIdentity },
            { memberKey: 'decision-form', fields: [...memberIdentity, { name: expiration, label: 'Approval expiration' }] },
          ] } },
      { key: 'oath', kind: 'attachment', label: 'Oath of enlistment or appointment', role: 'supporting-document', required: true, when: completed },
      { key: 'orders', kind: 'attachment', label: 'Orders showing the enlistment or commissioning date', role: 'supporting-document', required: true, when: completed },
    ],
  };
}
