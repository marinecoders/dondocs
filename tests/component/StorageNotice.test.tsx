import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { StorageNotice } from '@/components/StorageNotice';
import { useUIStore } from '@/stores/uiStore';

it('opens backup options and resurfaces a more serious storage problem after dismissal', async () => {
  useUIStore.setState({ storageHealth: 'evictable', storageNoticeDismissed: null, settingsOpen: false });
  render(<StorageNotice />);
  expect(screen.getByRole('status')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Backup options' }));
  expect(useUIStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'backup' });
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss storage notice' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  act(() => useUIStore.setState({ storageHealth: 'unavailable' }));
  expect(screen.getByRole('alert')).toHaveTextContent('blocking storage');
  act(() => useUIStore.setState({ storageHealth: 'unreadable' }));
  expect(screen.getByRole('alert')).toHaveTextContent('nothing was deleted');
  act(() => useUIStore.setState({ storageHealth: 'ok' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
