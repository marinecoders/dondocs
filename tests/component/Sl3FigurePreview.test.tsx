import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Sl3FigurePreview } from '@/components/editor/Sl3FigurePreview';
import { loadAttachment } from '@/lib/attachments';
import { printedDpi } from '@/lib/figures';

vi.mock('@/lib/attachments', () => ({ loadAttachment: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

it('shows the entire photo on white, reports print softness and releases replaced previews', async () => {
  vi.mocked(loadAttachment).mockResolvedValue(new ArrayBuffer(3));
  vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const figure = { fileRef: { id: 'one', name: 'phone.jpg', type: 'image/jpeg', size: 3 }, name: 'phone.jpg', type: 'image/jpeg', width: 92, height: 220 };
  const view = render(<Sl3FigurePreview figure={figure} title="Training adapter" printWidth={8} />);
  const image = await screen.findByRole('img', { name: 'Attached image: Training adapter' });
  expect(image).toHaveClass('object-contain', 'bg-white');
  expect(screen.getByText(/92 × 220 pixels/)).toHaveTextContent('51 dpi');
  expect(screen.getByRole('status')).toHaveTextContent('higher-resolution original');
  view.rerender(<Sl3FigurePreview figure={{ ...figure, fileRef: { ...figure.fileRef, id: 'two' }, width: 2400, height: 1600 }} title="Replacement" printWidth={8} />);
  await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:two'));
  expect(revoke).toHaveBeenCalledWith('blob:one');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:two');
});

it('uses the actual SL-3 image bounds and leaves single-page PDF previews in the document viewer', () => {
  expect(printedDpi(1200, 200, 6.5, 4.3)).toBeCloseTo(184.615);
  expect(printedDpi(1200, 200, 10.5, 4.3)).toBeCloseTo(114.286);
  expect(printedDpi(200, 1200, 10.5, 4.3)).toBeCloseTo(279.07);
  render(<Sl3FigurePreview figure={{ fileRef: { id: 'pdf', name: 'drawing.pdf', type: 'application/pdf', size: 3 } }} title="Drawing" printWidth={8} />);
  expect(screen.getByText(/Single-page PDF attached/)).toBeInTheDocument();
  expect(loadAttachment).not.toHaveBeenCalled();
});

it('does not show a previous photo when an attachment changes before loading finishes', async () => {
  let finish: (value: ArrayBuffer | null) => void = () => {};
  vi.mocked(loadAttachment).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(new ArrayBuffer(3));
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:new');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const figure = { fileRef: { id: 'old', name: 'old.png', type: 'image/png', size: 3 }, type: 'image/png' };
  const view = render(<Sl3FigurePreview figure={figure} title="Old" printWidth={8} />);
  view.rerender(<Sl3FigurePreview figure={{ ...figure, fileRef: { ...figure.fileRef, id: 'new' } }} title="New" printWidth={8} />);
  await screen.findByRole('img', { name: 'Attached image: New' });
  await act(async () => { finish(new ArrayBuffer(8)); });
  expect(create).toHaveBeenCalledOnce();
  fireEvent.load(screen.getByRole('img'));
});
