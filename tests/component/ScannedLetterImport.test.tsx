import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/scannedImport', () => ({ recognizeScannedFile: vi.fn() }));
import { recognizeScannedFile, type ScanPage } from '@/lib/scannedImport';
import { ScannedLetterImport } from '@/components/modals/ScannedLetterImport';
const recognize = vi.mocked(recognizeScannedFile);
const page = (number: number, text = `Subj: PAGE ${number}`): ScanPage => ({ page: number, text, confidence: 90, preview: new Blob(['x']) });
const select = () => fireEvent.change(screen.getByLabelText('Scanned PDF or image'), { target: { files: [new File(['x'], 'scan.png')] } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1, height: 1, close: vi.fn() }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
});

describe('scanned source correction', () => {
  it('requires comparison of every page and rechecks edited text before returning one reviewed letter', async () => {
    recognize.mockResolvedValue([page(1), page(2)]);
    const onRead = vi.fn();
    render(<ScannedLetterImport onRead={onRead} onBack={vi.fn()} />);
    select();
    expect(await screen.findByLabelText('Corrected text for page 1')).toHaveValue('Subj: PAGE 1');
    const review = screen.getByRole('button', { name: 'Review recognized letter' });
    expect(review).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
    fireEvent.click(screen.getByRole('checkbox'));
    expect(review).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Corrected text for page 2'), { target: { value: '2. Corrected body.' } });
    expect(review).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(review);
    expect(onRead).toHaveBeenCalledWith('Subj: PAGE 1\n\n2. Corrected body.');
  });

  it('discards a cancelled result even when a recognizer resolves late', async () => {
    let resolve: (value: ScanPage[]) => void = () => {};
    recognize.mockReturnValue(new Promise(done => { resolve = done; }));
    render(<ScannedLetterImport onRead={vi.fn()} onBack={vi.fn()} />);
    select();
    const signal = recognize.mock.calls[0][1];
    fireEvent.click(screen.getByRole('button', { name: 'Cancel recognition' }));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve([page(1)]));
    expect(screen.queryByLabelText('Corrected text for page 1')).not.toBeInTheDocument();
  });

  it('keeps only the newest selected source and handles recognition errors without importing', async () => {
    let first: (value: ScanPage[]) => void = () => {};
    recognize.mockReturnValueOnce(new Promise(done => { first = done; }));
    recognize.mockResolvedValueOnce([page(1, 'Subj: NEW SOURCE')]);
    const onRead = vi.fn();
    const { unmount } = render(<ScannedLetterImport onRead={onRead} onBack={vi.fn()} />);
    select(); select();
    expect(await screen.findByLabelText('Corrected text for page 1')).toHaveValue('Subj: NEW SOURCE');
    await act(async () => first([page(1, 'STALE')]));
    expect(screen.getByLabelText('Corrected text for page 1')).toHaveValue('Subj: NEW SOURCE');
    expect(onRead).not.toHaveBeenCalled();
    unmount();
    recognize.mockRejectedValueOnce(new Error('Corrupt or protected PDF.'));
    render(<ScannedLetterImport onRead={onRead} onBack={vi.fn()} />); select();
    expect(await screen.findByRole('alert')).toHaveTextContent('Corrupt or protected PDF.');
    expect(onRead).not.toHaveBeenCalled();
  });

  it('aborts active work when unmounted', () => {
    recognize.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<ScannedLetterImport onRead={vi.fn()} onBack={vi.fn()} />);
    select(); const signal = recognize.mock.calls[0][1]; unmount(); expect(signal.aborted).toBe(true);
  });
  it('does not permit review until the source page has actually drawn', async () => {
    let finish: (value: { width: number; height: number; close: () => void }) => void = () => {};
    vi.mocked(createImageBitmap).mockReturnValue(new Promise(resolve => { finish = value => resolve(value as ImageBitmap); }));
    recognize.mockResolvedValue([page(1)]);
    render(<ScannedLetterImport onRead={vi.fn()} onBack={vi.fn()} />); select();
    await screen.findByLabelText('Corrected text for page 1');
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review recognized letter' })).toBeDisabled();
    await act(async () => finish({ width: 1, height: 1, close: vi.fn() }));
    expect(screen.getByRole('checkbox')).toBeEnabled();
  });

  it.each(['decode', 'context'])('blocks review after a failed source %s', async failure => {
    if (failure === 'decode') vi.mocked(createImageBitmap).mockRejectedValue(new Error('cannot decode'));
    else vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    recognize.mockResolvedValue([page(1)]);
    const onRead = vi.fn(); render(<ScannedLetterImport onRead={onRead} onBack={vi.fn()} />); select();
    expect(await screen.findByRole('alert')).toHaveTextContent('source preview could not be displayed');
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review recognized letter' })).toBeDisabled();
    expect(onRead).not.toHaveBeenCalled();
  });

});
