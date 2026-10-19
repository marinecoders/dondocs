import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompileErrorModal } from '@/components/modals/CompileErrorModal';
import { DownloadProgressModal } from '@/components/modals/DownloadProgressModal';
import { useLogStore } from '@/stores/logStore';

beforeEach(() => useLogStore.setState({ isOpen: false }));

describe('export and preview error recovery', () => {
  it('exposes the compile log and opens the log viewer without reporting externally', async () => {
    const close = vi.fn();
    render(<CompileErrorModal open error="Synthetic compile failure" compileLog="QA line 1\nQA line 2" onClose={close} />);
    expect(screen.getByRole('dialog', { name: 'Preview compile failed' })).toBeVisible();
    expect(screen.getByLabelText('Compile error log')).toHaveTextContent('QA line 1');
    await userEvent.click(screen.getByRole('button', { name: 'View all logs' }));
    expect(useLogStore.getState().isOpen).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it('allows dismissal and retry for a transient PDF download error', async () => {
    const close = vi.fn(), retry = vi.fn();
    render(<DownloadProgressModal phase={{ kind: 'error', target: 'pdf', title: 'Engine starting', message: 'Please retry.', retryable: true, reportable: false }} onClose={close} onRetry={retry} />);
    expect(screen.queryByRole('button', { name: /Report/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(retry).toHaveBeenCalledOnce();
    await userEvent.keyboard('{Escape}');
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps active exports open, then allows closing a failed DOCX export', async () => {
    const close = vi.fn();
    const { rerender } = render(<DownloadProgressModal phase={{ kind: 'docx-fetching-engine', loaded: 25, total: 100 }} onClose={close} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(close).not.toHaveBeenCalled();
    rerender(<DownloadProgressModal phase={{ kind: 'error', target: 'docx', title: 'Conversion failed', message: 'Check this document.', compileLog: 'Synthetic failure', retryable: false, reportable: true }} onClose={close} />);
    expect(screen.getByRole('dialog', { name: 'Conversion failed' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Report/ })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(close).toHaveBeenCalledOnce();
  });
});
