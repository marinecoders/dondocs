import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageChangeImpactPanel } from '@/components/PackageChangeImpactPanel';
import { PackageChangeImpactSummary } from '@/components/PackageChangeImpactSummary';
import * as impact from '@/lib/packageChangeImpact';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, type ActionPackage } from '@/lib/actionPackages';
import { updatePackageInformation } from '@/lib/packageInformation';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
beforeEach(() => { useUIStore.setState({ storageHealth: 'ok' }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const session = createBlankSession(); session.formData.subject = 'Synthetic change impact';
  const member = await capturePackageMember(captureDocumentRevision({ documentId: `source_${crypto.randomUUID()}`, epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...session, endItems: [], publicationTables: {} }), 'Synthetic main letter', 'basic-letter');
  const initial = await reviseActionPackage(await createActionPackage(`Impact panel ${crypto.randomUUID()}`), [member]);
  return updatePackageInformation(initial, { version: 1, participants: [], facts: [{ id: 'request-date', label: 'Requested date', kind: 'date', value: '2026-11-17', source: { kind: 'entered' } }] });
}
function props(record: ActionPackage) {
  return { record, revision: getPackageRevision(record), disabled: false, busy: false, run: async (action: () => Promise<void>) => action(),
    signal: () => undefined, isCurrent: () => true };
}

it('compares actual saved history and navigates to the precise shared value without making a revision', async () => {
  const record = await fixture(), before = JSON.stringify((await listActionPackages()).find(item => item.id === record.id)), navigate = vi.fn(), user = userEvent.setup();
  render(<PackageChangeImpactPanel {...props(record)} onNavigate={navigate} />);
  await user.click(screen.getByRole('button', { name: 'Compare saved revisions' }));
  const report = await screen.findByRole('region', { name: 'Package impact details' });
  expect(within(report).getByText(/1 changed shared value/)).toBeVisible();
  await user.click(within(report).getByText('Shared values (1)', { exact: true }));
  await user.click(within(report).getByRole('button', { name: 'Inspect shared value · Requested date · location 1' }));
  expect(navigate).toHaveBeenCalledWith({ revisionId: record.currentRevisionId, factId: 'request-date' });
  expect(JSON.stringify((await listActionPackages()).find(item => item.id === record.id))).toBe(before);
});

it('drops a comparison that completes after the selected package changes', async () => {
  const first = await fixture(), second = await fixture(), beforeId = first.revisions.at(-2)!.id;
  const result = await impact.inspectPackageChangeImpact(first, beforeId);
  let resolve!: (value: impact.PackageChangeImpact) => void;
  vi.spyOn(impact, 'inspectPackageChangeImpact').mockReturnValueOnce(new Promise(value => { resolve = value; }));
  const user = userEvent.setup(), view = render(<PackageChangeImpactPanel {...props(first)} />);
  await user.click(screen.getByRole('button', { name: 'Compare saved revisions' }));
  view.rerender(<PackageChangeImpactPanel {...props(second)} />);
  await act(async () => { resolve(result); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Compare saved revisions' })).toBeEnabled());
  expect(screen.queryByRole('region', { name: 'Package impact details' })).toBeNull();
});

it('handles a rejected parent operation and keeps comparison controls recoverable', async () => {
  const record = await fixture(), user = userEvent.setup();
  render(<PackageChangeImpactPanel {...props(record)} run={async () => { throw new Error('The package operation is unavailable.'); }} />);
  await user.click(screen.getByRole('button', { name: 'Compare saved revisions' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The package operation is unavailable.');
  expect(screen.getByRole('button', { name: 'Compare saved revisions' })).toBeEnabled();
});

it('explains selected-revision history limits without comparing an unrelated revision', async () => {
  const complete = await fixture(), selected = getPackageRevision(complete);
  const record: ActionPackage = { ...complete, historyScope: 'selected-revision', revisions: [selected] };
  render(<PackageChangeImpactPanel {...props(record)} />);
  expect(screen.getByText(/No earlier saved revision is available/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Compare saved revisions' })).toBeNull();
});

it('does not present unknown evidence as an all-clear and bounds the initially rendered findings', async () => {
  const report: impact.PackageChangeImpact = { version: 1, beforeRevisionId: 'before', afterRevisionId: 'after', changed: false, limited: false,
    summary: { changedMembers: 0, movedMembers: 0, changedFacts: 0, affectedOutputs: 0, affectedReviews: 0, unknownEvidence: 40 }, notices: [],
    sections: [{ kind: 'output', label: 'Retained PDFs', items: Array.from({ length: 40 }, (_, index) => ({ id: `output${index}`, label: `Saved output ${index + 1}`, state: 'unknown', message: 'Inspect the source.', destinations: [] })) }] };
  const user = userEvent.setup(); render(<PackageChangeImpactSummary impact={report} />);
  expect(screen.getByText(/No changes were confirmed; inspect/)).toBeVisible();
  expect(screen.queryByText('No document or package-context changes were found in this comparison.')).toBeNull();
  await user.click(screen.getByText('Retained PDFs (40)', { exact: true }));
  expect(screen.queryByText('Saved output 26 · Needs inspection')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Show more retained pdfs' }));
  expect(screen.getByText('Saved output 40 · Needs inspection')).toBeVisible();
});
