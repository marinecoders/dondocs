import { counselingWorksheet } from '../maintainedPackageWorksheets';
import type { MaintainedRecipe } from '../maintainedPackageActions';
import { equals, native, program, question, worksheetSession } from '../packageRecipeMembers';

export async function developmentalCounseling(): Promise<MaintainedRecipe> {
  const worksheet = await counselingWorksheet();
  return {
    kind: 'dondocs-package-template', version: 2, id: 'dondocs_developmental_counseling',
    name: 'Developmental counseling', primaryMemberKey: 'counseling', createdAt: 0,
    program: program([
      question('session', 'Session type', 'choice', { options: [
        { id: 'initial', label: 'Initial counseling' }, { id: 'follow-up', label: 'Follow-up counseling' },
      ] }),
      question('marine', 'Marine receiving counseling'), question('senior', 'Counselor'),
      question('date', 'Session date', 'date'),
      question('prior', 'Include a prior counseling record?', 'boolean', { when: equals('session', 'follow-up') }),
      question('signed', 'Include a signed acknowledgment?', 'boolean'),
    ]),
    members: [
      await native('counseling', 'Counseling worksheet', worksheetSession(worksheet),
        { marine: 'marine', senior: 'senior', date: 'date', session: 'session' }, { worksheet, main: true }),
      { key: 'prior-record', kind: 'attachment', role: 'supporting-document', label: 'Prior counseling record',
        required: true, when: { op: 'all', conditions: [equals('session', 'follow-up'), equals('prior', true)] } },
      { key: 'acknowledgment', kind: 'attachment', role: 'supporting-document', label: 'Signed acknowledgment',
        required: true, when: equals('signed', true), completion: { reviewedScan: true } },
    ],
  };
}
