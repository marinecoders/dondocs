import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateAvailableButton } from '@/components/layout/UpdateAvailableButton';
import { UpdatePromptModal } from '@/components/modals/UpdatePromptModal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useServiceWorker } from '@/hooks/useServiceWorker';
import { flushDocumentWrites } from '@/stores/documentsStore';
import { useAlertStore } from '@/stores/alertStore';

vi.mock('@/stores/documentsStore', () => ({ flushDocumentWrites: vi.fn(async () => {}) }));

const worker = vi.hoisted(() => ({
  available: false,
  update: vi.fn(async () => {}),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [worker.available],
    offlineReady: [false],
    updateServiceWorker: worker.update,
  }),
}));

function UpdateFlow() {
  const { updateAvailable, promptUpdate, showUpdatePrompt, confirmUpdate, dismissUpdatePrompt } = useServiceWorker();
  return (
    <TooltipProvider delayDuration={0}>
      <input aria-label="Document subject" />
      {updateAvailable && <UpdateAvailableButton onClick={promptUpdate} />}
      <UpdatePromptModal open={showUpdatePrompt} onConfirm={confirmUpdate} onDismiss={dismissUpdatePrompt} />
    </TooltipProvider>
  );
}

beforeEach(() => {
  worker.available = false;
  worker.update.mockClear();
  vi.mocked(flushDocumentWrites).mockReset().mockResolvedValue();
  useAlertStore.setState({ open: false, current: null, queue: [] });
});

afterEach(() => vi.useRealTimers());

describe('passive update action', () => {
  it('does not activate or open a prompt when an update is waiting on a fresh visit', async () => {
    vi.useFakeTimers();
    worker.available = true;
    render(<UpdateFlow />);

    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });

    expect(screen.getByRole('button', { name: 'Update Available' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(worker.update).not.toHaveBeenCalled();
  });

  it('keeps editing focused when an update arrives', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<UpdateFlow />);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    vi.useRealTimers();
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'Update Available' })).not.toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Document subject' });
    await user.type(input, 'KEEP WRITING');

    worker.available = true;
    rerender(<UpdateFlow />);

    expect(input).toHaveFocus();
    expect(input).toHaveValue('KEEP WRITING');
    expect(screen.getByRole('button', { name: 'Update Available' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(worker.update).not.toHaveBeenCalled();
  });

  it('shows the update tooltip on hover and keyboard focus', async () => {
    worker.available = true;
    const user = userEvent.setup();
    render(<UpdateFlow />);
    const button = screen.getByRole('button', { name: 'Update Available' });

    await user.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Update Available');
    await user.unhover(button);
    act(() => button.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Update Available');
  });

  it('opens confirmation only on click and leaves the action available after Later', async () => {
    worker.available = true;
    const user = userEvent.setup();
    render(<UpdateFlow />);

    await user.click(screen.getByRole('button', { name: 'Update Available' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(worker.update).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Update Available' }));
    await user.click(screen.getByRole('button', { name: 'Update Now' }));
    await waitFor(() => expect(worker.update).toHaveBeenCalledExactlyOnceWith(true));
  });

  it('waits for pending saves before accepting the update', async () => {
    worker.available = true;
    let finishSave!: () => void;
    vi.mocked(flushDocumentWrites).mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));
    const user = userEvent.setup();
    render(<UpdateFlow />);

    await user.click(screen.getByRole('button', { name: 'Update Available' }));
    await user.click(screen.getByRole('button', { name: 'Update Now' }));
    expect(flushDocumentWrites).toHaveBeenCalledOnce();
    expect(worker.update).not.toHaveBeenCalled();

    await act(async () => { finishSave(); });
    expect(worker.update).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('leaves the update available when saving fails', async () => {
    worker.available = true;
    vi.mocked(flushDocumentWrites).mockRejectedValueOnce(new Error('Storage unavailable'));
    const user = userEvent.setup();
    render(<UpdateFlow />);

    await user.click(screen.getByRole('button', { name: 'Update Available' }));
    await user.click(screen.getByRole('button', { name: 'Update Now' }));

    await waitFor(() => expect(useAlertStore.getState().current).toMatchObject({
      title: 'Update paused', message: 'Error: Storage unavailable',
    }));
    expect(worker.update).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Update Available' })).toBeInTheDocument();
  });
});
