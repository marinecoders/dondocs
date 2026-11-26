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
  const onOpen = vi.fn();
  const first = make('first', 'TRAIN-01'), second = make('second', 'TRAIN-02');
  render(<PackageLibrary records={[first, second]} loaded disabled={false} onOpen={onOpen} onCreate={vi.fn()} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'train-02' } });
  const match = within(screen.getByRole('list', { name: 'Saved packages' })).getByRole('button');
  expect(match).toHaveTextContent('TRAIN-02');
  fireEvent.click(match);
  expect(onOpen).toHaveBeenCalledWith(second);
});
