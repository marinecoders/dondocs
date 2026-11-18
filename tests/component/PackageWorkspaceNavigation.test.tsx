import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageMemberNavigation, PackageWorkspaceSummary } from '@/components/PackageWorkspaceNavigation';
import { actionPackageSchema } from '@/lib/actionPackages';

it('qualifies selected-revision imports instead of inventing source revision ordinals', () => {
  const record = actionPackageSchema.parse({ kind: 'dondocs-action-package-record', version: 1, id: 'package',
    name: 'Synthetic partial history', archived: false, sequence: 0, currentRevisionId: 'revision_abcdefgh', historyScope: 'selected-revision',
    revisions: [{ id: 'revision_abcdefgh', parentId: 'unavailable-parent', createdAt: 100, members: [], outputs: [] }] });
  render(<PackageWorkspaceSummary record={record} revision={record.revisions[0]}><p>Contextual package controls</p></PackageWorkspaceSummary>);
  expect(screen.getByRole('region', { name: 'Selected package' })).toHaveTextContent('Saved revision abcdefgh');
  expect(screen.getByRole('region', { name: 'Selected package' })).not.toHaveTextContent('Revision 1');
  expect(screen.getByText('Contextual package controls')).toBeVisible();
});

it('shows user-declared signing status and routes an original member without implying edit support', async () => {
  const select = vi.fn();
  render(<PackageMemberNavigation members={[{ id: 'original', revisionId: 'original-rev', kind: 'original', label: 'Synthetic original', role: 'enclosure',
    required: true, signedOriginal: true, original: { id: 'asset', name: 'original.pdf', type: 'application/pdf', size: 1, sha256: '0'.repeat(64) } }]}
    selectedId="original" disabled={false} onSelect={select} />);
  const button = screen.getByRole('button', { name: /1\. Synthetic original/ });
  expect(button).toHaveTextContent('Marked signed · original PDF');
  expect(button).not.toHaveTextContent('Editable');
  await userEvent.setup().click(button);
  expect(select).toHaveBeenCalledWith('original');
});
