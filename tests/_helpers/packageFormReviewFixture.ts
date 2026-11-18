import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, reviseActionPackage } from '@/lib/actionPackages';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { preparePackageReviewMember } from '@/lib/packageMemberReviews';
import { fixtureInstance, fixturePage } from './formFixture';
import { retainPortableFormTemplates } from '@/services/forms/portableTemplates';
export async function packageFormFixture(templatePage?: Awaited<ReturnType<typeof fixturePage>>) {
  const page = templatePage ?? await fixturePage(), session = createBlankSession();
  session.documentCategory = 'forms'; session.formType = 'fixture'; session.genericForm = fixtureInstance();
  session.genericForm.definition.pages[0].sha256 = page.sha256;
  session.genericForm.rows.roster = [{ id: 'first', answers: { grade: 'e1', date: '2026-11-17' } }, { id: 'second', answers: { grade: 'e2' } }];
  if (!await retainPortableFormTemplates([{ definition: session.genericForm.definition, pages: { 'page1.pdf': page.bytes } }])) throw new Error('Synthetic page could not be retained.');
  const member = await capturePackageMember(captureDocumentRevision({ documentId: `source_${crypto.randomUUID()}`, capturedAt: 123, editSequence: 1, epoch: 0 },
    { ...session, endItems: [], publicationTables: {} }), 'Synthetic configured form', 'supporting-document');
  let record = await startPackageReview(await reviseActionPackage(await createActionPackage(`Form review ${crypto.randomUUID()}`), [member]));
  const round = record.reviewRounds![0];
  const prepared = await preparePackageReviewMember(record, round.id, member.id); record = prepared.record;
  return { record, round: record.reviewRounds![0], member, child: prepared.child };
}
