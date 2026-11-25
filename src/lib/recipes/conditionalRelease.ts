import type { MaintainedRecipe } from '../maintainedPackageActions';
import { correspondenceMember, equals, program, question } from '../packageRecipeMembers';
import type { PackageTemplateCondition } from '../packageTemplateProgram';

const edition = { id: 'dd0368', edition: '2011-08.upd20241126' };
const firstPage = 'form1[0].#subform[0].';
const approved = equals('stage', 'approved');
const disapproved = equals('stage', 'disapproved');
const completed = equals('stage', 'completed');
const hasDecision: PackageTemplateCondition = { op: 'any', conditions: [approved, disapproved, completed] };
const approvalOnFile: PackageTemplateCondition = { op: 'any', conditions: [approved, completed] };

export async function conditionalRelease(): Promise<MaintainedRecipe> {
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
    ], { requirements: [
      { id: 'endorsement-authority', kind: 'confirmation', label: 'Confirm the O-5 or O-6 commanding officer endorsed the request, or the general officer for a G-level command',
        operations: ['pdf'] },
      { id: 'request-signed', memberKey: 'request', kind: 'document', label: 'Member and recruiter signatures',
        operations: ['pdf'], completion: { expectedForm: edition, signatureFields: [
          firstPage + 'member[0]', firstPage + 'recruiter[0]',
        ] } },
      { id: 'approval', memberKey: 'decision-form', kind: 'document', label: 'Approved release and expiration',
        operations: ['pdf'], when: approvalOnFile, completion: { expectedForm: edition, requiredPdfFields: [firstPage + 'a5[0]', firstPage + 'TextField2[18]'], uncheckedPdfFields: [firstPage + 'b5[0]'] } },
      { id: 'disapproval', memberKey: 'decision-form', kind: 'document', label: 'Disapproval and explanation in remarks',
        operations: ['pdf'], when: disapproved, completion: { expectedForm: edition, requiredPdfFields: [firstPage + 'b5[0]', 'form1[0].#subform[5].TextField2[35]'], uncheckedPdfFields: [firstPage + 'a5[0]'] } },
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
        completion: { expectedForm: edition, requiredPdfFields: [firstPage + 'TextField2[0]'] } },
      { key: 'decision-form', kind: 'attachment', label: 'Signed DD Form 368 decision', role: 'supporting-document', required: true,
        when: hasDecision, completion: { expectedForm: edition, signatureFields: [firstPage + 'ao[0]'] } },
      { key: 'notification', kind: 'attachment', label: 'Completed DD Form 368 with Section III certification',
        role: 'supporting-document', required: true, when: completed, completion: { expectedForm: edition, signatureFields: [firstPage + 'SignatureField1[0]'],
          requiredPdfFields: [firstPage + 'TextField2[26]'] } },
      { key: 'oath', kind: 'attachment', label: 'Oath of enlistment or appointment', role: 'supporting-document', required: true, when: completed },
      { key: 'orders', kind: 'attachment', label: 'Orders showing the enlistment or commissioning date', role: 'supporting-document', required: true, when: completed },
    ],
  };
}
