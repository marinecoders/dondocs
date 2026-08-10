// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConnectivityModal } from '@/components/modals/ConnectivityModal';
import { useUIStore } from '@/stores/uiStore';

// This dialog gets read where its working cannot be inspected, so what it says
// has to be about the run in front of the reader. What the probe's own tests
// cannot see is the lifecycle around it: closing is not always the dialog's
// doing, and a run that outlives the dialog lands its verdict on whoever opens
// it next, under an address they never asked about.

const openDialog = () => useUIStore.getState().setConnectivityModalOpen(true);
const closeElsewhere = () => useUIStore.getState().setConnectivityModalOpen(false);

/** A request that neither resolves nor rejects until its signal says so. */
function hangingFetch() {
  const seen: RequestInit[] = [];
  const impl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init) seen.push(init);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    });
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(impl as unknown as typeof fetch);
  return seen;
}

/** Let React flush; a negative assertion inside waitFor would pass on tick 0. */
const settle = () => new Promise((r) => setTimeout(r, 50));

async function startRun(user: ReturnType<typeof userEvent.setup>, address: string) {
  await user.type(screen.getByLabelText(/address/i), address);
  await user.click(screen.getByRole('button', { name: /check/i }));
}

beforeEach(() => {
  useUIStore.getState().setConnectivityModalOpen(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ConnectivityModal', () => {
  it('refuses to run against an address the probe could not send', async () => {
    const user = userEvent.setup();
    openDialog();
    render(<ConnectivityModal />);

    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/address/i), 'not a url');
    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
  });

  it('ends the run when the dialog closes, whoever closed it', async () => {
    const user = userEvent.setup();
    const seen = hangingFetch();
    openDialog();
    render(<ConnectivityModal />);
    await startRun(user, 'https://example.test/v1');

    closeElsewhere();
    await settle();

    expect(seen[0]?.signal?.aborted).toBe(true);
  });

  it('does not land a verdict on the reader who opens it next', async () => {
    const user = userEvent.setup();
    hangingFetch();
    openDialog();
    render(<ConnectivityModal />);
    await startRun(user, 'https://example.test/v1');

    closeElsewhere();
    await settle();
    openDialog();
    await settle();

    // Any verdict at all, not one particular wording — an abandoned run that
    // times out reports "No answer", and asserting on the happy title alone
    // would let exactly that through. The Time row exists only in the result
    // panel, so its absence is the panel's absence.
    expect(screen.queryByText('Time')).not.toBeInTheDocument();
    // And it is asking a fresh question rather than sitting mid-run: the
    // address is blank and the button has stopped spinning. It is disabled
    // again because there is nothing to check yet, which is the same state a
    // first-time opener sees.
    expect(screen.getByLabelText(/address/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /check/i })).toHaveTextContent(/run check/i);
  });

  it('forgets the token when the dialog closes', async () => {
    const user = userEvent.setup();
    openDialog();
    render(<ConnectivityModal />);

    await user.type(screen.getByLabelText(/bearer token/i), 'secret-value');
    expect(screen.getByLabelText(/bearer token/i)).toHaveValue('secret-value');

    closeElsewhere();
    await settle();
    openDialog();
    await settle();

    expect(screen.getByLabelText(/bearer token/i)).toHaveValue('');
  });
});
