import type { MaintainedRecipe } from '../maintainedPackageActions';
import { equals, program, question } from '../packageRecipeMembers';

export function dependencyApplication(): MaintainedRecipe {
  return {
    kind: 'dondocs-package-template', version: 2, id: 'dondocs_dependency_application',
    name: 'Dependency application', primaryMemberKey: 'application', createdAt: 0,
    program: program([
      question('event', 'What changed?', 'choice', { options: [
        { id: 'marriage', label: 'Marriage' }, { id: 'birth', label: 'Birth of a child' },
        { id: 'loss', label: 'Loss of a dependent' },
      ] }),
      question('supportOrder', 'Is there an applicable support or custody order?', 'boolean'),
    ], { requirements: [
      { id: 'certification', kind: 'confirmation', operations: ['review', 'pdf'],
        label: 'Confirm the claimant signed and a different administrative official with by-direction authority attested the application' },
    ] }),
    members: [
      { key: 'application', kind: 'attachment', role: 'supporting-document', required: true,
        label: 'Completed and signed NAVMC 10922', reference: { id: 'navmc10922', edition: '2021-07' },
        completion: { reviewedScan: true } },
      { key: 'marriage', kind: 'attachment', role: 'supporting-document', required: true,
        label: 'Marriage certificate', when: equals('event', 'marriage') },
      { key: 'birth', kind: 'attachment', role: 'supporting-document', required: true,
        label: 'Birth certificate', when: equals('event', 'birth') },
      { key: 'loss', kind: 'attachment', role: 'supporting-document', required: true,
        label: 'Record substantiating loss of dependency', when: equals('event', 'loss') },
      { key: 'order', kind: 'attachment', role: 'supporting-document', required: true,
        label: 'Applicable support or custody order', when: equals('supportOrder', true) },
    ],
  };
}
