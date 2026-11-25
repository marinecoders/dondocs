import { usePackageChecks } from '@/components/usePackageChecks';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackageNextActions } from '@/components/PackageNextActions';
import { type ActionPackage, getPackageRevision } from '@/lib/actionPackages';

vi.mock('@/lib/packageNextActions', () => ({ derivePackageNextActions: async () => ({
  operation: 'pdf', readyForOperation: true, actions: [], computedBlockers: 0, pendingTasks: 0,
}) }));

it.each([false, true])('respects PDF preparation authority in a review baseline: %s', async reviewBaseline => {
  const record: ActionPackage = { kind: 'dondocs-action-package-record', version: 1, id: 'package_fixture', name: 'Next actions authority',
    sequence: 0, archived: false, currentRevisionId: 'revision_fixture', revisions: [{ id: 'revision_fixture', createdAt: 1, members: [], outputs: [] }] };
  const revision = getPackageRevision(record);
  function Overview() {
    const checks = usePackageChecks(record, revision, reviewBaseline);
    return <PackageNextActions checks={checks} record={record} revision={getPackageRevision(record)} disabled={false}
    reviewBaseline={reviewBaseline} onNavigate={vi.fn()} onPrepare={vi.fn()} />;
  }
  render(<Overview />);
  const prepare = await screen.findByRole('button', { name: 'Review PDF' });
  if (reviewBaseline) expect(prepare).toBeDisabled();
  else expect(prepare).toBeEnabled();
});
