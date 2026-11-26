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
  render(<PackageMemberNavigation revision={{ id: "rev", createdAt: 1, members: [], outputs: [] }} members={[{ id: 'original', revisionId: 'original-rev', kind: 'original', label: 'Synthetic original', role: 'enclosure',
    required: true, signedOriginal: true, original: { id: 'asset', name: 'original.pdf', type: 'application/pdf', size: 1, sha256: '0'.repeat(64) } }]}
    selectedId="original" disabled={false} onSelect={select} />);
  const button = screen.getByRole('button', { name: /1\. Synthetic original/ });
  expect(button).toHaveTextContent('Marked signed · original PDF');
  expect(button).not.toHaveTextContent('Editable');
  await userEvent.setup().click(button);
  expect(select).toHaveBeenCalledWith('original');
});

it('keeps the copy number when identical documents are reordered', () => {
  const original = { id: 'first', revisionId: 'one', kind: 'original' as const, label: 'Statement', role: 'enclosure' as const, required: true, signedOriginal: false,
    original: { id: 'file', name: 'blank.pdf', type: 'application/pdf' as const, size: 1, sha256: '0'.repeat(64) } };
  const duplicate = { ...original, id: 'second', revisionId: 'two' };
  const baseline = { id: 'baseline', createdAt: 1, members: [original, duplicate], outputs: [] };
  const revision = { ...baseline, id: 'reordered', members: [duplicate, original] };
  render(<PackageMemberNavigation revision={revision} history={[baseline, revision]} members={revision.members} disabled={false} onSelect={vi.fn()} />);
  expect(screen.getByRole('button', { name: /1\. Statement · Copy 2/ })).toBeVisible();
  expect(screen.getByRole('button', { name: /2\. Statement · Copy 1/ })).toBeVisible();
});
