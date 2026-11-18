import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { PackageCitations } from '@/components/PackageCitations';
import { PackageReviewControls } from '@/components/PackageReviewControls';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import * as citations from '@/lib/packageCitations';
import { focusPackageDestination, type PackageDestinationRequest } from '@/lib/packageDestinations';
import { startPackageReview } from '@/lib/packageReviewRounds';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); });

async function fixture() {
  const session = createBlankSession();
  session.references = [{ letter: 'a', title: 'First synthetic authority' }, { letter: 'b', title: 'Second synthetic authority' }];
  session.paragraphs = [{ id: 'destination-body', text: 'Use reference (a).', level: 0 }];
  const member = await capturePackageMember(captureDocumentRevision({ documentId: `source_${crypto.randomUUID()}`, epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...session, endItems: [], publicationTables: {} }), 'Synthetic destination letter', 'basic-letter');
  let record = await citations.initializePackageCitationTargets(await reviseActionPackage(await createActionPackage(`Citation destination ${crypto.randomUUID()}`), [member]));
  const revision = getPackageRevision(record), source = (await citations.packageCitationOccurrences(revision))[0].source;
  record = await citations.linkPackageCitation(record, source, revision.citations!.targets[0].id);
  return record;
}

it('waits for loaded exact citation identities before focusing a target or linked occurrence', async () => {
  const record = await fixture(), revision = getPackageRevision(record), target = revision.citations!.targets[1], link = revision.citations!.links[0];
  const stored = JSON.stringify((await listActionPackages()).find(item => item.id === record.id));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), resolve = citations.resolvePackageCitations;
  vi.spyOn(citations, 'resolvePackageCitations').mockImplementation(async captured => { await gate; return resolve(captured); });
  const destination = { packageId: record.id, revisionId: revision.id, requestId: 1, citationId: target.id, memberId: target.memberId };
  const props = { record, revision, editable: false, onChange: vi.fn() };
  const view = render(<><button>Focus sentinel</button><PackageCitations {...props} destination={destination} /></>);
  const sentinel = screen.getByRole('button', { name: 'Focus sentinel' }); sentinel.focus();
  expect(screen.getByText('Reading citation identities…')).toBeVisible();
  expect(screen.queryByRole('list', { name: 'Identified citation targets' })).toBeNull();
  expect(sentinel).toHaveFocus();
  await act(async () => { release(); });
  const targets = await screen.findByRole('list', { name: 'Identified citation targets' });
  await waitFor(() => expect(within(targets).getByText(/Second synthetic authority/)).toHaveFocus());
  expect(within(targets).getByText(/First synthetic authority/)).not.toHaveFocus();
  view.rerender(<><button>Focus sentinel</button><PackageCitations {...props}
    destination={{ ...destination, requestId: 2, citationId: link.id, memberId: link.source.memberId }} /></>);
  const links = screen.getByRole('list', { name: 'Linked citation occurrences' });
  await waitFor(() => expect(within(links).getByRole('listitem')).toHaveFocus());
  expect(within(links).getByRole('listitem')).toHaveAttribute('data-package-citation-id', link.id);
  expect(JSON.stringify((await listActionPackages()).find(item => item.id === record.id))).toBe(stored);
});

it('ignores another owner, revision, member or missing identity without guessing a destination', async () => {
  const record = await fixture(), revision = getPackageRevision(record), target = revision.citations!.targets[0];
  const base: PackageDestinationRequest = { packageId: record.id, revisionId: revision.id, requestId: 0, citationId: target.id, memberId: target.memberId };
  const props = { record, revision, editable: false, onChange: vi.fn() };
  const view = render(<><button>Focus sentinel</button><PackageCitations {...props} /></>);
  await screen.findByRole('list', { name: 'Identified citation targets' });
  const sentinel = screen.getByRole('button', { name: 'Focus sentinel' }); sentinel.focus();
  const requests = [
    { ...base, requestId: 1, packageId: 'another-package' },
    { ...base, requestId: 2, revisionId: record.revisions[0].id },
    { ...base, requestId: 3, memberId: 'another-member' },
    { ...base, requestId: 4, citationId: 'missing-citation' },
  ];
  for (const destination of requests) {
    view.rerender(<><button>Focus sentinel</button><PackageCitations {...props} destination={destination} /></>);
    expect(sentinel).toHaveFocus();
  }
});

it('keeps the historical owner read-only and ignores citation loading from a previously selected revision', async () => {
  const initial = await fixture(), historical = getPackageRevision(initial);
  const record = await reviseActionPackage(initial, historical.members), current = getPackageRevision(record), target = historical.citations!.targets[1];
  const snapshot = JSON.stringify(record), resolve = citations.resolvePackageCitations;
  let release!: () => void;
  const gate = new Promise<void>(value => { release = value; });
  vi.spyOn(citations, 'resolvePackageCitations').mockImplementation(async captured => {
    if (captured.id === current.id) await gate;
    return resolve(captured);
  });
  const props = { record, editable: true, onChange: vi.fn() };
  const view = render(<PackageCitations {...props} revision={current} />);
  expect(screen.getByText('Reading citation identities…')).toBeVisible();
  view.rerender(<PackageCitations {...props} revision={historical}
    destination={{ packageId: record.id, revisionId: historical.id, requestId: 1, citationId: target.id }} />);
  const targets = await screen.findByRole('list', { name: 'Identified citation targets' });
  await waitFor(() => expect(within(targets).getByText(/Second synthetic authority/)).toHaveFocus());
  expect(screen.queryByRole('button', { name: 'Identify current references and enclosures' })).toBeNull();
  expect(screen.queryByLabelText('Link to repair')).toBeNull();
  await act(async () => { release(); });
  expect(screen.queryByText('Reading citation identities…')).toBeNull();
  expect(within(screen.getByRole('list', { name: 'Identified citation targets' })).getByText(/Second synthetic authority/)).toHaveFocus();
  expect(props.onChange).not.toHaveBeenCalled();
  expect(JSON.stringify((await listActionPackages()).find(item => item.id === record.id))).toBe(snapshot);
});

it('provides one focusable exact wrapper for each saved review round', async () => {
  let record = await startPackageReview(await fixture(), undefined, 'First synthetic review');
  record = await startPackageReview(record, undefined, 'Second synthetic review');
  const view = render(<PackageReviewControls record={record} disabled={false} opened={null}
    onStart={vi.fn()} onOpen={vi.fn()} onTransition={vi.fn()} onExit={vi.fn()} />);
  const second = record.reviewRounds![1];
  expect(focusPackageDestination(view.container, 'data-package-review-id', second.id)).toBe(true);
  expect(screen.getByText(/Second synthetic review · active/).parentElement).toHaveFocus();
  expect(screen.getByText(/First synthetic review · active/).parentElement).not.toHaveFocus();
});
