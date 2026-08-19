// @vitest-environment happy-dom
/**
 * The save indicator has to state the durability of the work, not just that it
 * was written. "Saved" alone reads as safe, and for the great majority of users
 * — no auto-backup configured — it isn't: the documents live in one browser
 * profile. That is the loss a field user actually took when an enterprise
 * Windows update wiped the profile.
 *
 * These tests pin the honesty, not the wording: every unbacked backup status
 * says "Local only", the one status where a backup exists does not, and the
 * offer to fix it appears only where the browser can honour it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveStatus } from '@/components/SaveStatus';
import { useBackupStore, type BackupStatus } from '@/stores/backupStore';
import { useUIStore } from '@/stores/uiStore';

beforeEach(() => {
  useUIStore.setState({ saveStatus: 'saved', lastSavedAt: Date.now() });
  useBackupStore.setState({
    status: 'off',
    fileName: null,
    lastBackupAt: null,
    fileMissing: false,
    setupBackup: vi.fn(async () => {}),
    reconnect: vi.fn(async () => {}),
    writeNow: vi.fn(async () => {}),
  });
});

describe('SaveStatus', () => {
  it('says "Local only" for every backup status that leaves no external copy', () => {
    for (const s of ['off', 'unsupported', 'needs-permission', 'error'] as BackupStatus[]) {
      useBackupStore.setState({ status: s });
      const { unmount } = render(<SaveStatus />);
      expect(screen.getByText('Local only'), `status "${s}" should admit it`).toBeTruthy();
      unmount();
    }
  });

  it('says "Backed up" and drops "Local only" once the mirror has written', () => {
    useBackupStore.setState({ status: 'connected', lastBackupAt: Date.now() });
    render(<SaveStatus />);
    expect(screen.getByText('Backed up')).toBeTruthy();
    expect(screen.queryByText('Local only')).toBeNull();
  });

  it('claims neither while a fresh connection has not written yet', () => {
    // Transient: the next save mirrors. "Local only" here would be alarming and
    // about to be wrong, "Backed up" would be a promise no file is keeping.
    useBackupStore.setState({ status: 'connected', lastBackupAt: null });
    render(<SaveStatus />);
    expect(screen.queryByText('Local only')).toBeNull();
    expect(screen.queryByText('Backed up')).toBeNull();
  });

  it('offers one-click setup where the browser supports it', () => {
    render(<SaveStatus />); // status: 'off'
    fireEvent.click(screen.getByRole('button', { name: /Local only/ }));
    expect(useBackupStore.getState().setupBackup).toHaveBeenCalledOnce();
  });

  it('carries the repair for a broken backup, which BackupNotice can be dismissed out of', () => {
    // The strip that explains these is dismissible; this isn't. It shares the
    // store's mapping, so the two can never offer different answers.
    useBackupStore.setState({ status: 'needs-permission' });
    const { rerender } = render(<SaveStatus />);
    fireEvent.click(screen.getByRole('button', { name: /Local only/ }));
    expect(useBackupStore.getState().reconnect).toHaveBeenCalledOnce();
    expect(useBackupStore.getState().setupBackup).not.toHaveBeenCalled();

    // A file that is really gone is the one case a new file fixes.
    useBackupStore.setState({ status: 'error', fileMissing: true });
    rerender(<SaveStatus />);
    fireEvent.click(screen.getByRole('button', { name: /Local only/ }));
    expect(useBackupStore.getState().setupBackup).toHaveBeenCalledOnce();

    // A write something else refused leaves the file good; re-picking is noise.
    useBackupStore.setState({ status: 'error', fileMissing: false });
    rerender(<SaveStatus />);
    fireEvent.click(screen.getByRole('button', { name: /Local only/ }));
    expect(useBackupStore.getState().writeNow).toHaveBeenCalledOnce();
    expect(useBackupStore.getState().setupBackup).toHaveBeenCalledOnce(); // still just the one
  });

  it('is plain text — not a dead button — where auto-backup is impossible', () => {
    // Safari/Firefox have no File System Access API. Advertising an action the
    // browser cannot perform is the failure mode the install banner avoids too.
    useBackupStore.setState({ status: 'unsupported' });
    render(<SaveStatus />);
    expect(screen.queryByRole('button', { name: /Local only/ })).toBeNull();
    expect(screen.getByTitle(/Download or Back up everything/)).toBeTruthy();
  });

  it('stays quiet until there is work to lose', () => {
    useUIStore.setState({ lastSavedAt: null });
    const { container } = render(<SaveStatus />);
    expect(container.firstChild).toBeNull();
  });
});
