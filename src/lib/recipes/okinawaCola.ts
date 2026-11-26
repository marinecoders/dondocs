import type { MaintainedRecipe } from '../maintainedPackageActions';
import { packageFormFields } from '../packageFormFields';
import { equals, program, question } from '../packageRecipeMembers';

export async function okinawaCola(): Promise<MaintainedRecipe> {
  const edition = { id: 'navmc11106', edition: '1989-01' };
  const field = await packageFormFields(edition);
  const dependents = { op: 'any' as const, conditions: [equals('coverage', 'both'), equals('coverage', 'dep')] };
  return {
    kind: 'dondocs-package-template', version: 2, id: 'dondocs_okinawa_cola',
    name: 'Okinawa overseas COLA', primaryMemberKey: 'application', createdAt: 0,
    program: program([
      question('member', 'Member name (last, first, middle initial)'), question('station', 'Permanent duty station'),
      question('coverage', 'Who is the claim for?', 'choice', { options: [
        { id: 'mem', label: 'Member only' }, { id: 'both', label: 'Member and dependents' }, { id: 'dep', label: 'Dependents only' },
      ] }),
    ], { requirements: [
      { id: 'certification', memberKey: 'application', kind: 'document', label: 'Member and commanding officer certifications',
        operations: ['pdf'], completion: { expectedForm: edition, requiredPdfFields: [field('NameComndOffcr'), field('DateApplcEffct')],
          signatureFields: [field('SigMem'), field('SigCO')] } },
    ] }),
    members: [
      { key: 'application', kind: 'official-form', formId: edition.id, role: 'supporting-document', required: true,
        facts: { NameApplc: 'member', DutyStatn: 'station', RadA1: 'coverage' }, completion: { expectedForm: edition } },
      { key: 'orders', kind: 'attachment', role: 'supporting-document', required: true, label: 'Orders and reporting endorsement' },
      { key: 'dependent-arrival', kind: 'attachment', role: 'supporting-document', required: true,
        label: 'Dependent arrival and command sponsorship evidence', when: dependents },
    ],
  };
}
