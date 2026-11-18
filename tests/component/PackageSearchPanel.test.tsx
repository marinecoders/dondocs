import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageSearchPanel } from '@/components/PackageSearchPanel';
import { createActionPackage, getPackageRevision } from '@/lib/actionPackages';
import { updatePackageInformation } from '@/lib/packageInformation';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
afterEach(cleanup);
it('opens the exact saved fact from a real captured search result', async () => {
  const record = await updatePackageInformation(await createActionPackage(`Search UI ${crypto.randomUUID()}`), { version: 1, participants: [], facts: [{ id: 'control', label: 'Control number', kind: 'identifier', value: '00042', source: { kind: 'entered' } }] });
  const user = userEvent.setup(), navigate = vi.fn();
  render(<PackageSearchPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={false} run={async action => action()} signal={() => undefined} isCurrent={() => true} onNavigate={navigate} />);
  await user.type(screen.getByLabelText('Search captured package text'), '00042'); await user.click(screen.getByRole('button', { name: 'Search captured text' }));
  expect(await screen.findByRole('status')).toHaveTextContent('1 captured match');
  await user.click(screen.getByRole('button', { name: 'Open Confirmed package value' }));
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ factId: 'control', revisionId: record.currentRevisionId }));
});
