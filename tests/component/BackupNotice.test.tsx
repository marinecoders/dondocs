// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BackupNotice } from '@/components/BackupNotice';
import { useBackupStore, type BackupStatus } from '@/stores/backupStore';

function setStatus(status: BackupStatus, fileName: string | null = 'dondocs-library.json') {
  useBackupStore.setState({ status, fileName });
}

beforeEach(() => {
  useBackupStore.setState({
    status: 'off',
    fileName: null,
    reconnect: vi.fn(async () => {}),
    setupBackup: vi.fn(async () => {}),
  });
});

describe('BackupNotice', () => {
  it('is silent when backup is healthy or was never set up', () => {
    for (const s of ['off', 'connected', 'unsupported'] as BackupStatus[]) {
      setStatus(s);
      const { container, unmount } = render(<BackupNotice />);
      expect(container.firstChild).toBeNull();
      unmount();
    }
  });

  it('shows a Reconnect strip when permission was dropped on restart', () => {
    setStatus('needs-permission');
    render(<BackupNotice />);
    expect(screen.getByRole('status').textContent).toContain('Auto-backup is paused');
    expect(screen.getByText('(dondocs-library.json)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(useBackupStore.getState().reconnect).toHaveBeenCalledOnce();
  });

  it('shows a write-failure strip that offers to re-pick the file', () => {
    setStatus('error');
    render(<BackupNotice />);
    // A failed write silently stales the backup — announce it assertively.
    expect(screen.getByRole('alert').textContent).toContain("couldn't write");
    fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
    expect(useBackupStore.getState().setupBackup).toHaveBeenCalledOnce();
  });

  it('escalates only the write-failure to role=alert; the expected permission drop stays polite', () => {
    setStatus('needs-permission');
    const { rerender } = render(<BackupNotice />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();

    setStatus('error');
    rerender(<BackupNotice />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('dismissal is per-status: hiding needs-permission still lets a later error surface', () => {
    setStatus('needs-permission');
    const { rerender, container } = render(<BackupNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss backup notice' }));
    rerender(<BackupNotice />);
    expect(container.firstChild).toBeNull(); // dismissed for this status

    setStatus('error');
    rerender(<BackupNotice />);
    expect(screen.getByRole('alert').textContent).toContain("couldn't write"); // new status re-surfaces
  });
});
