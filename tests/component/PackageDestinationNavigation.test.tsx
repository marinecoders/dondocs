import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageInformationPanel } from '@/components/PackageInformationPanel';
import { PackageRequirementsPanel } from '@/components/PackageRequirementsPanel';
import { createActionPackage, getPackageRevision } from '@/lib/actionPackages';
import { updatePackageInformation } from '@/lib/packageInformation';
import { updatePackageRequirements } from '@/lib/packageRequirements';
import { focusPackageDestination, matchesPackageDestination } from '@/lib/packageDestinations';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(),
  getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const callbacks = { disabled: true, busy: false, onApply: vi.fn(), signal: () => undefined, isCurrent: () => true,
  run: async (action: () => Promise<void>) => action() };

it('focuses the exact saved value in a read-only panel and ignores another package’s request', async () => {
  const record = await updatePackageInformation(await createActionPackage(`Destination ${crypto.randomUUID()}`), { version: 1, participants: [], facts: [
    { id: 'first', label: 'Start date', kind: 'date', value: '2026-11-17', source: { kind: 'entered' } },
    { id: 'second', label: 'End date', kind: 'date', value: '2026-11-18', source: { kind: 'entered' } },
  ] });
  const revision = getPackageRevision(record), destination = { packageId: record.id, revisionId: revision.id, requestId: 1, factId: 'second' };
  const view = render(<><button>Focus sentinel</button><PackageInformationPanel {...callbacks} record={record} revision={revision} destination={destination} /></>);
  await waitFor(() => expect(screen.getByText('End date', { selector: 'legend' })).toHaveFocus());
  const sentinel = screen.getByRole('button', { name: 'Focus sentinel' }); sentinel.focus();
  view.rerender(<><button>Focus sentinel</button><PackageInformationPanel {...callbacks} record={record} revision={revision}
    destination={{ ...destination, packageId: 'another-package', requestId: 2, factId: 'first' }} /></>);
  expect(sentinel).toHaveFocus();
});

it('opens the correct requirement page before focusing its historical read-only item', async () => {
  const record = await updatePackageRequirements(await createActionPackage(`Paged destination ${crypto.randomUUID()}`), { version: 1,
    items: Array.from({ length: 30 }, (_, index) => ({ id: `criterion-${index}`, label: `Criterion ${index + 1}`, kind: 'confirmation' as const, operations: ['pdf' as const], condition: 'active' as const })) }, policy);
  const revision = getPackageRevision(record);
  const newer = await updatePackageRequirements(record, { ...revision.requirements!, items: revision.requirements!.items.map((item, index) => index === 0 ? { ...item, confirmed: true } : item) }, policy);
  const props = { ...callbacks, record: newer, revision, disabled: false };
  const view = render(<PackageRequirementsPanel {...props} destination={{ packageId: record.id, revisionId: revision.id, requestId: 1, requirementId: 'criterion-26' }} />);
  const heading = await screen.findByRole('heading', { name: 'Criterion 27' });
  await waitFor(() => expect(heading.closest('article')).toHaveFocus());
  expect(screen.getByText('Requirements 26–30 of 30')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: /User declaration for Criterion 27/ })).toBeDisabled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Previous requirements' }));
  expect(screen.getByRole('heading', { name: 'Criterion 1' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Criterion 27' })).toBeNull();
  view.rerender(<PackageRequirementsPanel {...props} destination={{ packageId: record.id, revisionId: revision.id, requestId: 2, requirementId: 'criterion-28' }} />);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Criterion 29' }).closest('article')).toHaveFocus());
  expect(getPackageRevision(record)).toEqual(revision);
});

it('opens containing details and scopes literal identifiers to the supplied panel', () => {
  const root = document.createElement('div'), details = document.createElement('details'), target = document.createElement('span');
  const identity = 'literal"][data-package-fact-id="other'; target.tabIndex = -1; target.setAttribute('data-package-fact-id', identity);
  details.append(target); root.append(details); document.body.append(root);
  const outside = document.createElement('span'); outside.tabIndex = -1; outside.setAttribute('data-package-fact-id', 'outside'); document.body.append(outside);
  try {
    expect(focusPackageDestination(root, 'data-package-fact-id', identity)).toBe(true); expect(target).toHaveFocus(); expect(details.open).toBe(true);
    expect(focusPackageDestination(root, 'data-package-fact-id', 'outside')).toBe(false); expect(target).toHaveFocus();
    expect(matchesPackageDestination(undefined, 'package', 'revision')).toBe(false);
    expect(matchesPackageDestination({ packageId: 'package', revisionId: 'old', requestId: 1 }, 'package', 'revision')).toBe(false);
  } finally { root.remove(); outside.remove(); }
});

it('reports rejected browser focus instead of marking the destination handled', () => {
  const root = document.createElement('div'), target = document.createElement('span');
  target.tabIndex = -1; target.dataset.packageFactId = 'new-value'; root.append(target); document.body.append(root);
  const attempted = vi.spyOn(target, 'focus');
  try {
    expect(focusPackageDestination(root, 'data-package-fact-id', 'new-value')).toBe(true);
    target.blur(); attempted.mockImplementation(() => {});
    expect(focusPackageDestination(root, 'data-package-fact-id', 'new-value')).toBe(false);
  } finally { root.remove(); }
});

it('focuses a destination after switching to another saved revision with different rows', async () => {
  const record = await updatePackageInformation(await createActionPackage(`Changed destination ${crypto.randomUUID()}`), { version: 1, participants: [], facts: [
    { id: 'first', label: 'Original value', kind: 'text', value: 'Original', source: { kind: 'entered' } },
  ] });
  const old = getPackageRevision(record);
  const newer = await updatePackageInformation(record, { ...old.information!, facts: [...old.information!.facts,
    { id: 'second', label: 'New value', kind: 'text', value: 'New', source: { kind: 'entered' } },
  ] });
  const revision = getPackageRevision(newer);
  const view = render(<PackageInformationPanel {...callbacks} record={newer} revision={old} />);
  view.rerender(<PackageInformationPanel {...callbacks} record={newer} revision={revision}
    destination={{ packageId: newer.id, revisionId: revision.id, requestId: 4, factId: 'second' }} />);
  await waitFor(() => expect(screen.getByText('New value', { selector: 'legend' })).toHaveFocus());
});

it('focuses a newly added requirement after switching the saved revision', async () => {
  const record = await createActionPackage(`Changed requirement destination ${crypto.randomUUID()}`);
  const old = getPackageRevision(record);
  const newer = await updatePackageRequirements(record, { version: 1, items: [
    { id: 'original', label: 'Original criterion', kind: 'confirmation', operations: ['pdf'], condition: 'active' },
    { id: 'added', label: 'New criterion', kind: 'confirmation', operations: ['pdf'], condition: 'active' },
  ] }, policy);
  const revision = getPackageRevision(newer);
  const view = render(<PackageRequirementsPanel {...callbacks} record={newer} revision={old} />);
  view.rerender(<PackageRequirementsPanel {...callbacks} record={newer} revision={revision}
    destination={{ packageId: newer.id, revisionId: revision.id, requestId: 5, requirementId: 'added' }} />);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'New criterion' }).closest('article')).toHaveFocus());
});
