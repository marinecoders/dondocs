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
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  type SerializedSession,
} from '@/stores/documentStore';
import { openSessionAsNew } from '@/stores/documentsStore';
import { fixtureInstance } from '../_helpers/formFixture';

vi.mock('@/lib/shareCrypto', () => ({
  encryptSharePayload: vi.fn(),
  decryptSharePayload: vi.fn(),
  buildShareUrl: vi.fn((p: string) => `https://dondocs.app/#s=${p}`),
  parseShareUrl: vi.fn((s: string) => (s.includes('#s=') ? s.split('#s=')[1] : null)),
}));
vi.mock('@/stores/documentsStore', () => ({ openSessionAsNew: vi.fn(() => 'applied') }));
vi.mock('@/stores/documentStore', () => ({
  getSerializedSessionForShare: vi.fn(() => ({ docType: 'naval_letter', formData: {}, paragraphs: [], copyTos: [], references: [] })),
  loadSharedSession: vi.fn(),
  // The share flow scans the live document for PII before building a link;
  // a clean (empty) document lets the happy path generate straight through.
  useDocumentStore: { getState: vi.fn(() => ({ formData: {}, paragraphs: [], copyTos: [], references: [] })) },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSerializedSessionForShare).mockImplementation(() => ({
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
    formData: {}, paragraphs: [], copyTos: [], references: [], enclosures: [], distributions: [], timestamp: 0,
  }));
});

// userEvent.setup() installs its own clipboard stub, so any spy must be
// assigned AFTER it to win — this helper returns the writeText spy.
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('ShareModal — share mode', () => {
  it('invalidates the generated link when its password changes', async () => {
    const user = userEvent.setup();
    stubClipboard();
    vi.mocked(encryptSharePayload).mockResolvedValue('FIRST');
    render(<ShareModal open mode="share" onOpenChange={vi.fn()} />);
    const password = screen.getByLabelText('Password for this link');
    await user.type(password, 'first-password');
    await user.click(screen.getByRole('button', { name: /generate link/i }));
    expect(screen.getByRole('textbox', { name: 'Share link (copied to clipboard)' })).toBeVisible();
    await user.type(password, '-changed');
    expect(screen.queryByRole('textbox', { name: /Share link/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate link' })).toBeEnabled();
  });

  it('keeps clipboard delivery owned until a manual copy finishes', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    vi.mocked(encryptSharePayload).mockResolvedValue('FIRST');
    render(<ShareModal open mode="share" onOpenChange={vi.fn()} />);
    const password = screen.getByLabelText('Password for this link');
    await user.type(password, 'test-password');
    await user.click(screen.getByRole('button', { name: /generate link/i }));
    let finish!: () => void;
    writeText.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Copy again' }));
    try {
      expect(password).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Copy again' })).toBeDisabled();
    } finally {
      await act(async () => { finish(); });
    }
    expect(password).toBeEnabled();
  });

  it('does not let an earlier copy timer clear a later copy acknowledgment', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      stubClipboard();
      vi.mocked(encryptSharePayload).mockResolvedValueOnce('FIRST').mockResolvedValueOnce('SECOND');
      render(<ShareModal open mode="share" onOpenChange={vi.fn()} />);
      const password = screen.getByLabelText('Password for this link');
      fireEvent.change(password, { target: { value: 'first-password' } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /generate link/i })); });
      act(() => { vi.advanceTimersByTime(1500); });
      fireEvent.change(password, { target: { value: 'changed-password' } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Generate link|Link copied/ })); });
      act(() => { vi.advanceTimersByTime(1001); });
      expect(screen.getByRole('textbox', { name: 'Share link (copied to clipboard)' })).toHaveValue('https://dondocs.app/#s=SECOND');
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks encryption and reports an inspection error for an unsupported form snapshot', async () => {
    const user = userEvent.setup();
    const form = fixtureInstance();
    Object.assign(form.definition, { schemaVersion: 999 });
    vi.mocked(getSerializedSessionForShare).mockReturnValueOnce({
      documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: 'fixture', genericForm: form,
      formData: {}, paragraphs: [], copyTos: [], references: [], enclosures: [], distributions: [], timestamp: 0,
    });
    render(<ShareModal open mode="share" onOpenChange={vi.fn()} />);
    await user.type(screen.getByLabelText('Password for this link'), 'test-password');
    await user.click(screen.getByRole('button', { name: /generate link/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not inspect this draft');
    expect(encryptSharePayload).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Share anyway' })).not.toBeInTheDocument();
  });

  it('reviews hidden serialized fields and shares the reviewed snapshot after the editor changes', async () => {
    const user = userEvent.setup();
    stubClipboard();
    const snapshot: SerializedSession = {
      documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
      formData: { seniorCommandName: 'SSN 123-45-6789' }, paragraphs: [], copyTos: [], references: [], enclosures: [], distributions: [], timestamp: 0,
    };
    vi.mocked(getSerializedSessionForShare).mockReturnValueOnce(structuredClone(snapshot));
    vi.mocked(encryptSharePayload).mockResolvedValue('REVIEWED');
    render(<ShareModal open mode="share" onOpenChange={vi.fn()} />);
    await user.type(screen.getByLabelText('Password for this link'), 'test-password');
    await user.click(screen.getByRole('button', { name: /generate link/i }));

    expect(encryptSharePayload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Share anyway' })).toBeVisible();
    // The editor now returns a different document, while the modal owns this snapshot.
    await user.click(screen.getByRole('button', { name: 'Share anyway' }));
    expect(encryptSharePayload).toHaveBeenCalledWith(expect.objectContaining({ ...snapshot, kind: 'dondocs-share', version: 1, documentKind: 'correspondence', formData: expect.objectContaining(snapshot.formData) }), 'test-password');
    expect(getSerializedSessionForShare).toHaveBeenCalledTimes(1);
  });

  it('encrypts the session, builds a link, and copies it to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    vi.mocked(encryptSharePayload).mockResolvedValue('ENCRYPTED');

    render(<ShareModal open mode="share" onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText('Password for this link'), 'hunter2');
    await user.click(screen.getByRole('button', { name: /generate link/i }));

    expect(encryptSharePayload).toHaveBeenCalledWith(expect.objectContaining({ ...vi.mocked(getSerializedSessionForShare).mock.results[0].value, kind: 'dondocs-share', version: 1, documentKind: 'correspondence', formData: expect.any(Object) }), 'hunter2');
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

  it.each(['initial copy', 'copy again'])('keeps the link usable after a failed %s and clears the error on retry', async (stage) => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    vi.mocked(encryptSharePayload).mockResolvedValue('ENCRYPTED');
    if (stage === 'initial copy') writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
    render(<ShareModal open mode="share" onOpenChange={vi.fn()} />);
    await user.type(screen.getByLabelText('Password for this link'), 'test-password');
    await user.click(screen.getByRole('button', { name: /generate link/i }));
    if (stage === 'copy again') {
      writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
      await user.click(screen.getByRole('button', { name: 'Copy again' }));
    }
    expect(await screen.findByRole('alert')).toHaveTextContent('Select and copy the share link manually.');
    expect(screen.getByRole('textbox', { name: 'Share link' })).toHaveValue('https://dondocs.app/#s=ENCRYPTED');
    await user.click(screen.getByRole('button', { name: 'Copy again' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Share link (copied to clipboard)' })).toHaveValue('https://dondocs.app/#s=ENCRYPTED');
    expect(encryptSharePayload).toHaveBeenCalledTimes(1);
  });
});

describe('ShareModal — import mode', () => {
  it('decrypts the payload, loads the session, and closes', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onImportComplete = vi.fn();
    const session = { docType: 'naval_letter', documentMode: 'compliant', documentCategory: 'correspondence', formType: 'navmc_10274', formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 0 };
    vi.mocked(decryptSharePayload).mockResolvedValue(session);

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
    await user.click(screen.getByRole('button', { name: /decrypt and review/i }));

    expect(decryptSharePayload).toHaveBeenCalledWith('PAYLOAD', 'hunter2');
    expect(loadSharedSession).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open as new document' }));
    expect(openSessionAsNew).toHaveBeenCalledWith({ ...session, endItems: [], publicationTables: {} });
    expect(loadSharedSession).not.toHaveBeenCalled();
    expect(onImportComplete).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces a friendly error on a bad password instead of throwing', async () => {
    const user = userEvent.setup();
    vi.mocked(decryptSharePayload).mockRejectedValue(new Error('decryption failed'));

    render(<ShareModal open mode="import" initialPayload="PAYLOAD" onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText('Password'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /decrypt and review/i }));

    expect(await screen.findByText('decryption failed')).toBeInTheDocument();
    expect(loadSharedSession).not.toHaveBeenCalled();
  });
});
