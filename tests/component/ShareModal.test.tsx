/**
 * Component tests for <ShareModal> (share path).
 *
 * The encrypt-and-share / paste-and-import round trip is the user-facing
 * surface of the client-side crypto. shareCrypto's primitives are unit
 * tested separately; here we lock in that the modal wires them correctly:
 * generating a link encrypts the session and copies it, and importing
 * decrypts the payload and loads it (surfacing a friendly error on a bad
 * password rather than throwing).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareModal } from '@/components/modals/ShareModal';
import {
  encryptSharePayload,
  decryptSharePayload,
  buildShareUrl,
} from '@/lib/shareCrypto';
import {
  getSerializedSessionForShare,
  loadSharedSession,
} from '@/stores/documentStore';

vi.mock('@/lib/shareCrypto', () => ({
  encryptSharePayload: vi.fn(),
  decryptSharePayload: vi.fn(),
  buildShareUrl: vi.fn((p: string) => `https://dondocs.app/#s=${p}`),
  parseShareUrl: vi.fn((s: string) => (s.includes('#s=') ? s.split('#s=')[1] : null)),
}));
vi.mock('@/stores/documentStore', () => ({
  getSerializedSessionForShare: vi.fn(() => ({ docType: 'naval_letter' })),
  loadSharedSession: vi.fn(),
  // The share flow scans the live document for PII before building a link;
  // a clean (empty) document lets the happy path generate straight through.
  useDocumentStore: { getState: vi.fn(() => ({ formData: {}, paragraphs: [], copyTos: [], references: [] })) },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// userEvent.setup() installs its own clipboard stub, so any spy must be
// assigned AFTER it to win — this helper returns the writeText spy.
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('ShareModal — share mode', () => {
  it('encrypts the session, builds a link, and copies it to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    vi.mocked(encryptSharePayload).mockResolvedValue('ENCRYPTED');

    render(<ShareModal open mode="share" onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText('Password for this link'), 'hunter2');
    await user.click(screen.getByRole('button', { name: /generate link/i }));

    expect(encryptSharePayload).toHaveBeenCalledWith({ docType: 'naval_letter' }, 'hunter2');
    expect(buildShareUrl).toHaveBeenCalledWith('ENCRYPTED');
    expect(writeText).toHaveBeenCalledWith('https://dondocs.app/#s=ENCRYPTED');
    expect(getSerializedSessionForShare).toHaveBeenCalledTimes(1);
    // The generated link is surfaced for the user to copy/share.
    expect(await screen.findByDisplayValue('https://dondocs.app/#s=ENCRYPTED')).toBeInTheDocument();
  });

  it('disables Generate link until a password is entered', () => {
    render(<ShareModal open mode="share" onOpenChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /generate link/i })).toBeDisabled();
  });
});

describe('ShareModal — import mode', () => {
  it('decrypts the payload, loads the session, and closes', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onImportComplete = vi.fn();
    vi.mocked(decryptSharePayload).mockResolvedValue({ docType: 'naval_letter' });

    render(
      <ShareModal
        open
        mode="import"
        initialPayload="PAYLOAD"
        onOpenChange={onOpenChange}
        onImportComplete={onImportComplete}
      />
    );

    await user.type(screen.getByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: /open document/i }));

    expect(decryptSharePayload).toHaveBeenCalledWith('PAYLOAD', 'hunter2');
    expect(loadSharedSession).toHaveBeenCalledWith({ docType: 'naval_letter' });
    expect(onImportComplete).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces a friendly error on a bad password instead of throwing', async () => {
    const user = userEvent.setup();
    vi.mocked(decryptSharePayload).mockRejectedValue(new Error('decryption failed'));

    render(<ShareModal open mode="import" initialPayload="PAYLOAD" onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText('Password'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /open document/i }));

    expect(await screen.findByText('decryption failed')).toBeInTheDocument();
    expect(loadSharedSession).not.toHaveBeenCalled();
  });
});
