import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PackageLibrary } from '@/components/PackageLibrary';
import type { ActionPackage } from '@/lib/actionPackages';

it('distinguishes identically named packages by their current case reference', () => {
  const make = (id: string, value: string): ActionPackage => ({
    id, kind: 'dondocs-action-package-record', version: 1, name: 'Request', sequence: 0, archived: false, currentRevisionId: id,
    revisions: [{ id, createdAt: 1, members: [], outputs: [], information: { version: 1, participants: [],
      facts: [{ id: 'reference', kind: 'identifier', label: 'Case reference', source: { kind: 'entered' }, value }] } }],
  });
  const onOpen = vi.fn(), onContinue = vi.fn();
  const first = make('first', 'TRAIN-01'), second = make('second', 'TRAIN-02');
  const location = {version: 1, packageId: 'second', revisionId: 'second', memberId: null, section: 'review'} as const;
  const view = render(<PackageLibrary lastWorkspace={location} onContinue={onContinue} records={[first, second]} loaded disabled={false} onOpen={onOpen} onCreate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue Request · TRAIN-02' }));
  expect(onContinue).toHaveBeenCalledWith(second, location);
  expect(screen.getByText('Review')).toBeVisible();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'train-02' } });
  const match = within(screen.getByRole('list', { name: 'Saved packages' })).getByRole('button');
  expect(match).toHaveTextContent('TRAIN-02');
  fireEvent.click(match);
  expect(onOpen).toHaveBeenCalledWith(second);
  const newer = make('second-new', 'TRAIN-03').revisions[0];
  const updated = { ...second, currentRevisionId: newer.id, revisions: [...second.revisions, newer] };
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  view.rerender(<PackageLibrary lastWorkspace={location} onContinue={onContinue} records={[updated]} loaded disabled={false} onOpen={onOpen} onCreate={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Continue Request · TRAIN-02' })).toBeVisible();
  expect(screen.getByText('Review · Saved version 1')).toBeVisible();
  expect(within(screen.getByRole('list', { name: 'Saved packages' })).getByRole('button')).toHaveTextContent('TRAIN-03');
});
