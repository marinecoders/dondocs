import type { PackageTemplateQuestion } from './packageTemplateProgram';
import { equals, question, letter, worksheetSession, native, program, headerLinks, type NativeBlueprint } from './packageRecipeMembers';
import type { OfficialFormMembership } from './packageOfficialForms';
import { ADMINISTRATIVE_REQUEST_BODY } from './administrativeRequest';
import { administrativeRequestWorksheet } from './administrativeRequestWorksheet';
import { evidenceSubmissionWorksheet, trainingActivityWorksheet, trainingCostWorksheet, trainingParticipationWorksheet } from './maintainedPackageWorksheets';
import type { PackageTemplateV2 } from './packageTemplateSchema';
import { validatePackageTemplate } from './packageTemplateLibrary';

interface ActionListing {
  build: () => Promise<MaintainedRecipe>;
  id: string; name: string; description: string; kind: string; startWithDocuments?: boolean; startLabel?: string;
}

const actions = [
  { id: 'conditional-release', build: async () => (await import('./recipes/conditionalRelease')).conditionalRelease(),
    name: 'Conditional release', startLabel: 'Start conditional release', startWithDocuments: true, kind: 'Letter-led',
    description: 'Prepare an active-duty Marine transfer request for MMSR-2 with DD Form 368, a naval letter and a command endorsement. Keep the decision and final return with the request.' },
  { id: 'administrative-request', build: administrative, name: 'Administrative request', description: 'A forwarding letter and request worksheet, with supporting evidence when needed.', kind: 'Letter-led' },
  { id: 'training-participation', build: training, name: 'Training participation', description: 'Participant worksheets with attendance details and optional cost estimates.', kind: 'Forms-led' },
  { id: 'evidence-submission', build: evidence, name: 'Evidence submission', description: 'A transmittal letter, submission index and original supporting PDF.', kind: 'Mixed evidence' },
] as const satisfies readonly ActionListing[];
export const maintainedPackageActions: ReadonlyArray<ActionListing & { id: MaintainedPackageActionId }> = actions;
export type MaintainedPackageActionId = typeof actions[number]['id'];
async function administrative(): Promise<PackageTemplateV2> {
  const sheet = await administrativeRequestWorksheet();
  return { kind: 'dondocs-package-template', version: 2, id: 'dondocs_administrative_request', name: 'Administrative request', createdAt: 0,
    program: program([question('requester', 'Requester'), question('organization', 'Organization'), question('recipient', 'Recipient'),
      question('subject', 'Request subject'), question('date', 'Request date', 'date'), question('ssic', 'SSIC', 'identifier'),
      question('details', 'Requested action and justification'), question('supportingEvidence', 'Include a supporting PDF?', 'boolean')],
    { requirements: [{ id: 'supporting-record', label: 'Supporting PDF', kind: 'document', operations: ['review', 'pdf'],
      memberKey: 'supporting-record', when: equals('supportingEvidence', true) }] }),
    members: [await native('letter', 'Request letter', letter(ADMINISTRATIVE_REQUEST_BODY), headerLinks),
      await native('request-details', 'DonDocs request details worksheet', worksheetSession(sheet),
        { requester: 'requester', organization: 'organization', recipient: 'recipient', subject: 'subject', requestDate: 'date', ssic: 'ssic', details: 'details' }, { worksheet: sheet }),
      { key: 'supporting-record', kind: 'attachment', label: 'Supporting PDF', role: 'supporting-document', required: true, when: equals('supportingEvidence', true) }],
  };
}
async function training(): Promise<PackageTemplateV2> {
  const remote = await trainingParticipationWorksheet('remote'), inPerson = await trainingParticipationWorksheet('in-person'), estimate = await trainingCostWorksheet();
  const activity = await trainingActivityWorksheet();
  const groupId = 'participants';
  const grouped = (id: string, label: string, kind: PackageTemplateQuestion['kind'] = 'text', extra: Partial<PackageTemplateQuestion> = {}) => question(id, label, kind, { groupId, ...extra });
  const shared = { course: 'course', date: 'date', name: 'name', reference: 'reference', attendance: 'attendance' };
  return { kind: 'dondocs-package-template', version: 2, id: 'dondocs_training_participation', name: 'Training participation', createdAt: 0,
    program: program([question('course', 'Course or activity'), question('date', 'Training date', 'date'), question('purpose', 'Activity purpose'), grouped('name', 'Participant name'),
      grouped('reference', 'Local participant reference', 'identifier'), grouped('attendance', 'Attendance', 'choice', { options: [
        { id: 'remote', label: 'Remote' }, { id: 'in-person', label: 'In person' },
      ] }), grouped('location', 'In-person location', 'text', { when: equals('attendance', 'in-person') }),
      grouped('includeEstimate', 'Include an estimated cost?', 'boolean'), grouped('estimate', 'Estimated amount (USD)', 'decimal', { when: equals('includeEstimate', true) })],
    { participantGroups: [{ id: groupId, label: 'Participants', role: 'subject', min: 1, max: 10 }] }),
    members: [await native('activity', 'DonDocs training activity', worksheetSession(activity), { course: 'course', date: 'date', purpose: 'purpose' }, { worksheet: activity, main: true }),
    await native('remote-participant', 'Remote participation worksheet', worksheetSession(remote), shared,
      { worksheet: remote, repeatGroupId: groupId, when: equals('attendance', 'remote') }),
    await native('in-person-participant', 'In-person participation worksheet', worksheetSession(inPerson), { ...shared, location: 'location' },
      { worksheet: inPerson, repeatGroupId: groupId, when: equals('attendance', 'in-person') }),
    await native('cost-estimate', 'Training cost estimate', worksheetSession(estimate), { course: 'course', name: 'name', reference: 'reference', estimate: 'estimate' },
      { worksheet: estimate, repeatGroupId: groupId, when: equals('includeEstimate', true) })],
  };
}
async function evidence(): Promise<PackageTemplateV2> {
  const sheet = await evidenceSubmissionWorksheet();
  return { kind: 'dondocs-package-template', version: 2, id: 'dondocs_evidence_submission', name: 'Evidence submission', createdAt: 0,
    program: program([question('requester', 'Submitter'), question('organization', 'Organization'), question('recipient', 'Recipient'),
      question('subject', 'Submission subject'), question('date', 'Submission date', 'date'), question('ssic', 'SSIC', 'identifier'),
      question('category', 'Supporting record category', 'choice', { options: [{ id: 'supporting-record', label: 'Supporting record' }, { id: 'returned-document', label: 'Returned document' }] }),
      question('notes', 'Record description')],
    { requirements: [{ id: 'supporting-record', label: 'Original supporting PDF', kind: 'document', operations: ['review', 'pdf'], memberKey: 'supporting-record' }] }),
    members: [await native('letter', 'Transmittal letter', letter('Please consider the documents described in the accompanying DonDocs submission index.'), headerLinks),
      await native('submission-index', 'DonDocs submission index', worksheetSession(sheet), { subject: 'subject', submitter: 'requester', organization: 'organization', recipient: 'recipient', date: 'date', ssic: 'ssic', category: 'category', notes: 'notes' }, { worksheet: sheet }),
      { key: 'supporting-record', kind: 'attachment', label: 'Original supporting PDF', role: 'supporting-document', required: true, multipleFiles: true }],
  };
}
export type MaintainedRecipe = Omit<PackageTemplateV2, 'members'> & {
  members: Array<PackageTemplateV2['members'][number] | (OfficialFormMembership & { kind: 'official-form' })>;
};

export async function resolveMaintainedRecipe(recipe: MaintainedRecipe): Promise<PackageTemplateV2> {
  const members: PackageTemplateV2['members'] = [];
  const originals = new Map<string, NativeBlueprint>();
  for (const member of recipe.members) {
    if (member.kind !== 'official-form') {
      members.push(member);
      continue;
    }
    const { formId, facts, ...membership } = member;
    const original = originals.get(formId);
    if (original) {
      const { memberCompletion, memberFactLinks } = await import('./packageOfficialForms');
      const { validatePackageDraft } = await import('./actionPackageDraft');
      const session = (await validatePackageDraft(original.draft)).session;
      const links = facts ? await memberFactLinks(session, membership.links, facts) : membership.links;
      members.push({ ...membership, completion: memberCompletion(session, membership.completion), ...(links && { links }), kind: 'native', label: original.label, draft: structuredClone(original.draft),
        pages: {}, pagesFrom: original.key });
    } else {
      const { officialFormBlueprint } = await import('./packageOfficialForms');
      const blueprint = await officialFormBlueprint(member);
      originals.set(formId, blueprint);
      members.push(blueprint);
    }
  }
  return validatePackageTemplate({ ...recipe, members });
}

const loaded = new Map<MaintainedPackageActionId, Promise<PackageTemplateV2>>();
/** Catalog loading only constructs and qualifies owned clean starters. It never installs a template or saves a case. */
export async function maintainedPackageAction(id: MaintainedPackageActionId): Promise<PackageTemplateV2> {
  const entry = maintainedPackageActions.find(action => action.id === id);
  if (!entry) throw new Error('This maintained action is unavailable.');
  let promise = loaded.get(id);
  if (!promise) {
    promise = entry.build()
      .then(resolveMaintainedRecipe);
    loaded.set(id, promise);
    void promise.catch(() => { if (loaded.get(id) === promise) loaded.delete(id); });
  }
  return structuredClone(await promise);
}
