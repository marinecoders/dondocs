import 'fake-indexeddb/auto';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageReviewApplicationPanel } from '@/components/PackageReviewApplicationPanel';
import { createActionPackage, getPackageRevision, reviseActionPackage, listActionPackages, type ActionPackage } from '@/lib/actionPackages';
import { capturePackageMember, captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createBlankSession } from '@/stores/documentStore';
import { PDFDocument } from 'pdf-lib';
import { mutateReviewComments } from '@/lib/reviewCommentActions';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { createPackageMemberReview, savePackageMemberReview } from '@/lib/packageMemberReviews';
import { appendReviewSuggestions, createReviewSuggestion, createParagraphStructureSuggestion } from '@/lib/reviewSuggestions';
import { buildPackageReviewReturn, packageReviewTransferFile } from '@/lib/packageReviewTransfer';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
const { currentPolicy } = vi.hoisted(() => ({ currentPolicy: { value: undefined as unknown } }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => currentPolicy.value,
  getExportDeploymentPolicySync: () => currentPolicy.value }));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
function View({ initial }: { initial: ActionPackage }) {
  const [record, setRecord] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <><p role="status">{error}</p><PackageReviewApplicationPanel key={record.sequence} record={record} round={record.reviewRounds![0]} busy={busy}
    signal={() => undefined} isCurrent={() => true} onApply={setRecord} run={async action => { setBusy(true); try { await action(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }} /></>;
}
it('shows exact conflict context, requires explicit choices and applies one revision; policy failure invalidates the displayed plan safely', async () => {
  currentPolicy.value = policy;
  const session = createBlankSession(); session.formData.subject = 'SYNTHETIC REVIEWED SUBJECT'; session.paragraphs = [{ id: 'application-body', text: 'Synthetic paragraph unchanged.', level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'application-ui-source', epoch: 0, editSequence: 0, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), 'Synthetic reviewed member', 'basic-letter');
  let owner = await startPackageReview(await reviseActionPackage(await createActionPackage('Synthetic application UI'), [native]));
  const round = owner.reviewRounds![0], child = await createPackageMemberReview(round, native.id), proposal = createReviewSuggestion(child.nativeRound!, { author: 'Synthetic reviewer', label: 'Replace reviewed subject', changes: [{ target: { kind: 'field', field: 'subject', docType: native.session.docType }, proposed: 'SYNTHETIC RETURNED SUBJECT' }] });
  owner = await savePackageMemberReview(owner, round.id, { ...child, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [proposal]) });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, round.id, policy), policy);
  session.formData.subject = 'SYNTHETIC LATEST SUBJECT';
  const updated = await capturePackageMember(captureDocumentRevision({ documentId: 'application-ui-source', epoch: 0, editSequence: 1, capturedAt: 200 }, { ...session, endItems: [], publicationTables: {} }), native.label, native.role, native);
  const latest = await reviseActionPackage(owner, [updated]);
  const user = userEvent.setup(); render(<View initial={latest} />);
  const file = new File([json], 'synthetic-return.json', { type: 'application/json' });
  await user.upload(screen.getByLabelText('Import package feedback return'), file);
  await screen.findByText('Latest saved content: SYNTHETIC LATEST SUBJECT');
  expect(screen.getByText('Reviewed baseline: SYNTHETIC REVIEWED SUBJECT')).toBeVisible(); expect(screen.getByText('Returned proposal: SYNTHETIC RETURNED SUBJECT')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Review new package revision' })).toBeDisabled();
  currentPolicy.value = { status: 'loading', message: 'Synthetic changed deployment policy' };
  await user.selectOptions(screen.getByLabelText(`Discussion decision ${native.label}`), 'merge');
  await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('Synthetic changed deployment policy');
  expect(screen.queryByRole('button', { name: 'Review new package revision' })).toBeNull();
  currentPolicy.value = policy;
  await user.upload(screen.getByLabelText('Import package feedback return'), file); await screen.findByText('Latest saved content: SYNTHETIC LATEST SUBJECT');
  await user.selectOptions(screen.getByLabelText(`Discussion decision ${native.label}`), 'merge');
  await user.selectOptions(screen.getByLabelText(`Proposal decision ${proposal.label}`), 'accepted');
  expect(screen.getByRole('button', { name: 'Review new package revision' })).toBeDisabled();
  await user.type(screen.getByLabelText(`Resolved replacement ${proposal.changes[0].id}`), 'SYNTHETIC DELIBERATE SUBJECT');
  await user.click(screen.getByRole('button', { name: 'Review new package revision' }));
  const apply = await screen.findByRole('button', { name: 'Apply feedback as new package revision' }); expect(apply).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the baseline/ })); await user.click(apply);
  await waitFor(async () => {
    const saved = (await listActionPackages()).find(item => item.id === owner.id)!;
    expect(saved.revisions).toHaveLength(latest.revisions.length + 1); expect(saved.reviewApplications).toHaveLength(1);
    const member = getPackageRevision(saved).members[0]; expect(member.kind === 'native' && member.session.formData.subject).toBe('SYNTHETIC DELIBERATE SUBJECT');
  });
});

it('shows retained returned original PDF discussion after keeping the current discussion and applying', async () => {
  currentPolicy.value = policy;
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = new Uint8Array(await pdf.save()).buffer;
  const original = await captureOriginalPackageMember({ name: 'synthetic-history-signed.pdf', data: bytes }, 'enclosure', true);
  if (original.kind !== 'original') throw new Error('Expected an original PDF');
  let owner = await startPackageReview(await reviseActionPackage(await createActionPackage('Synthetic PDF feedback history'), [original]));
  const round = owner.reviewRounds![0], child = await createPackageMemberReview(round, original.id);
  const comments = mutateReviewComments(child.comments, { kind: 'add', author: 'Synthetic PDF reviewer', text: 'Retain this original PDF discussion in the return history.' }, () => ({ kind: 'document' }))!;
  owner = await savePackageMemberReview(owner, round.id, { ...child, comments });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, round.id, policy), policy);
  const user = userEvent.setup(); render(<View initial={owner} />);
  await user.upload(screen.getByLabelText('Import package feedback return'), new File([json], 'synthetic-pdf-return.json', { type: 'application/json' }));
  await screen.findByText('Synthetic PDF reviewer: Retain this original PDF discussion in the return history.');
  await user.selectOptions(screen.getByLabelText(`Discussion decision ${original.label}`), 'skip');
  await user.click(screen.getByRole('button', { name: 'Review new package revision' }));
  const apply = await screen.findByRole('button', { name: 'Apply feedback as new package revision' });
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the baseline/ })); await user.click(apply);
  const history = await screen.findByText(new RegExp('Return package-feedback_'));
  await user.click(history);
  expect(screen.getByText(`Returned feedback for ${original.label}`)).toBeVisible();
  expect(screen.getByText('Synthetic PDF reviewer: Retain this original PDF discussion in the return history.')).toBeVisible();
  expect(await readPackageAsset(original.original)).toEqual(bytes);
  const saved = (await listActionPackages()).find(item => item.id === owner.id)!;
  expect(saved.revisions).toHaveLength(owner.revisions.length + 1);
  expect(getPackageRevision(saved).members[0]).toEqual(original);
  expect(saved.reviewApplications![0].outcomes[0].comments).toBeUndefined();
});


it('deliberately reconciles structural package feedback against current native nodes and persists one exact revision', async () => {
  currentPolicy.value = policy;
  const session = createBlankSession(); session.formData.subject = 'SYNTHETIC STRUCTURAL PACKAGE';
  session.paragraphs = [{ id: 'structure-first', text: 'First retained paragraph.', level: 0 }, { id: 'structure-delete', text: 'Reviewed deletion.', level: 0 }, { id: 'structure-tail', text: 'Independent tail.', level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'structure-package-source', epoch: 0, editSequence: 0, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), 'Synthetic structural member', 'basic-letter');
  let owner = await startPackageReview(await reviseActionPackage(await createActionPackage('Synthetic structural application'), [native]));
  const round = owner.reviewRounds![0], child = await createPackageMemberReview(round, native.id);
  const proposal = createParagraphStructureSuggestion(child.nativeRound!, { author: 'Synthetic reviewer', operation: { kind: 'delete-paragraph', paragraphId: 'structure-delete' } });
  owner = await savePackageMemberReview(owner, round.id, { ...child, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [proposal]) });
  const json = await packageReviewTransferFile(await buildPackageReviewReturn(owner, round.id, policy), policy);
  session.paragraphs[1] = { ...session.paragraphs[1], text: '**Newer owner content** {{UNIT}}', header: 'Current heading', referenceId: 'current-reference' };
  session.paragraphs[2].text = 'Independent newest tail.';
  const updated = await capturePackageMember(captureDocumentRevision({ documentId: 'structure-package-source', epoch: 0, editSequence: 1, capturedAt: 200 }, { ...session, endItems: [], publicationTables: {} }), native.label, native.role, native);
  const latest = await reviseActionPackage(owner, [updated]), user = userEvent.setup(); render(<View initial={latest} />);
  await user.upload(screen.getByLabelText('Import package feedback return'), new File([json], 'synthetic-structure-return.json', { type: 'application/json' }));
  await screen.findByText(/Latest saved content: Current heading/);
  await user.selectOptions(screen.getByLabelText(`Discussion decision ${native.label}`), 'skip');
  await user.selectOptions(screen.getByLabelText(`Proposal decision ${proposal.label}`), 'accepted');
  expect(screen.getByRole('button', { name: 'Review new package revision' })).toBeDisabled();
  expect(screen.queryByLabelText(`Resolved replacement ${proposal.changes[0].id}`)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Preview operation on current draft' }));
  await user.click(screen.getByRole('button', { name: 'Confirm operation on current draft' }));
  await user.click(screen.getByRole('button', { name: 'Review new package revision' }));
  await user.click(await screen.findByRole('checkbox', { name: /^I reviewed the baseline/ }));
  await user.click(screen.getByRole('button', { name: 'Apply feedback as new package revision' }));
  await waitFor(async () => {
    const saved = (await listActionPackages()).find(item => item.id === owner.id)!;
    expect(saved.revisions).toHaveLength(latest.revisions.length + 1);
    const member = getPackageRevision(saved).members[0]; if (member.kind !== 'native') throw new Error();
    expect(member.session.paragraphs).toEqual([session.paragraphs[0], session.paragraphs[2]]);
    const retained = saved.reviewApplications![0].outcomes[0].suggestions!.decisions[0].resolutions![0].structure!;
    expect(retained.operation.before).toEqual([session.paragraphs[1]]);
    expect(JSON.parse(new TextDecoder().decode(await readPackageAsset(member.draft))).paragraphs).toEqual(member.session.paragraphs);
  });
});
