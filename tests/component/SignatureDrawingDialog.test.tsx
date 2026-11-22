import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { SignatureDrawingDialog } from '@/components/editor/SignatureDrawingDialog';
import { renderSignatureDrawing } from '@/lib/signatureDrawing';

vi.mock('@/lib/signatureDrawing', async original => ({ ...await original<typeof import('@/lib/signatureDrawing')>(), renderSignatureDrawing: vi.fn() }));
beforeEach(() => vi.mocked(renderSignatureDrawing).mockResolvedValue(new File(['png'], 'drawn-signature.png', { type: 'image/png' })));

async function keyboardStroke() {
  const area = screen.getByRole('application', { name: 'Signature drawing area' });
  area.focus();
  await userEvent.keyboard(' {ArrowRight}{ArrowDown}{ArrowRight} ');
}

it('supports keyboard drawing, Undo/Clear and an empty-pad guard', async () => {
  render(<SignatureDrawingDialog open onOpenChange={vi.fn()} onUse={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeDisabled();
  await keyboardStroke();
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Undo stroke' }));
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeDisabled();
  await keyboardStroke();
  await userEvent.click(screen.getByRole('button', { name: 'Clear drawing' }));
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeDisabled();
});

it('does not deliver a late PNG after cancellation', async () => {
  let complete!: (file: File) => void;
  vi.mocked(renderSignatureDrawing).mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const use = vi.fn(), change = vi.fn();
  const result = render(<SignatureDrawingDialog open onOpenChange={change} onUse={use} />);
  await keyboardStroke();
  await userEvent.click(screen.getByRole('button', { name: 'Use signature' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  result.rerender(<SignatureDrawingDialog open={false} onOpenChange={change} onUse={use} />);
  await act(async () => complete(new File(['png'], 'drawn-signature.png')));
  expect(use).not.toHaveBeenCalled();
});

it('keeps the drawing available when saving fails', async () => {
  const change = vi.fn();
  render(<SignatureDrawingDialog open onOpenChange={change} onUse={async () => { throw new Error('Storage is full'); }} />);
  await keyboardStroke();
  await userEvent.click(screen.getByRole('button', { name: 'Use signature' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage is full');
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeEnabled();
});

it('ignores a secondary pointer without disturbing the current stroke', () => {
  render(<SignatureDrawingDialog open onOpenChange={vi.fn()} onUse={vi.fn()} />);
  const area = screen.getByRole('application', { name: 'Signature drawing area' });
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 400 } as DOMRect);
  Object.assign(area, { setPointerCapture: vi.fn() });
  fireEvent.pointerDown(area, { pointerId: 1, button: 0, clientX: 40, clientY: 40 });
  fireEvent.pointerDown(area, { pointerId: 2, button: 0, clientX: 700, clientY: 350 });
  fireEvent.pointerMove(area, { pointerId: 1, clientX: 160, clientY: 100 });
  fireEvent.pointerUp(area, { pointerId: 1, button: 0, clientX: 160, clientY: 100 });
  expect(area.querySelectorAll('polyline')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeEnabled();
});

it('shows the keyboard pen position before starting a stroke and hides it on blur', () => {
  render(<SignatureDrawingDialog open onOpenChange={vi.fn()} onUse={vi.fn()} />);
  const area = screen.getByRole('application', { name: 'Signature drawing area' });
  fireEvent.focus(area);
  expect(area.querySelector('circle[stroke="#2563eb"]')).toHaveAttribute('cx', '400');
  expect(area.querySelector('circle[stroke="#2563eb"]')).toHaveAttribute('fill', 'none');
  fireEvent.keyDown(area, { key: 'ArrowRight' });
  expect(area.querySelector('circle[stroke="#2563eb"]')).toHaveAttribute('cx', '408');
  fireEvent.keyDown(area, { key: ' ' });
  expect(area.querySelector('circle[stroke="#2563eb"]')).toHaveAttribute('fill', '#2563eb');
  fireEvent.blur(area);
  expect(area.querySelector('circle[stroke="#2563eb"]')).toBeNull();
});

it('previews an isolated pen dot that is retained beside a valid signature', () => {
  render(<SignatureDrawingDialog open onOpenChange={vi.fn()} onUse={vi.fn()} />);
  const area = screen.getByRole('application', { name: 'Signature drawing area' });
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 400 } as DOMRect);
  Object.assign(area, { setPointerCapture: vi.fn() });
  fireEvent.pointerDown(area, { pointerId: 1, button: 0, clientX: 40, clientY: 60 });
  fireEvent.pointerUp(area, { pointerId: 1, button: 0, clientX: 40, clientY: 60 });
  expect(area.querySelector('circle[fill="#000"]')).toHaveAttribute('cx', '40');
  expect(area.querySelector('circle[fill="#000"]')).toHaveAttribute('cy', '60');
  expect(area.querySelector('circle[fill="#000"]')).toHaveAttribute('r', '3');
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeDisabled();
  fireEvent.pointerDown(area, { pointerId: 2, button: 0, clientX: 80, clientY: 100 });
  fireEvent.pointerMove(area, { pointerId: 2, clientX: 180, clientY: 100 });
  fireEvent.pointerUp(area, { pointerId: 2, button: 0, clientX: 180, clientY: 100 });
  expect(area.querySelector('circle[fill="#000"]')).toBeInTheDocument();
  expect(area.querySelectorAll('polyline')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeEnabled();
});

it('retains a final movement delivered with pointer release', () => {
  render(<SignatureDrawingDialog open onOpenChange={vi.fn()} onUse={vi.fn()} />);
  const area = screen.getByRole('application', { name: 'Signature drawing area' });
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 400 } as DOMRect);
  Object.assign(area, { setPointerCapture: vi.fn() });
  fireEvent.pointerDown(area, { pointerId: 1, button: 0, clientX: 40, clientY: 60 });
  fireEvent.pointerUp(area, { pointerId: 1, button: 0, clientX: 140, clientY: 60 });
  expect(area.querySelector('polyline')).toHaveAttribute('points', '40,60 140,60');
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeEnabled();
});

it.each(['pointerCancel', 'lostPointerCapture'] as const)('does not draw a final segment on %s', eventName => {
  render(<SignatureDrawingDialog open onOpenChange={vi.fn()} onUse={vi.fn()} />);
  const area = screen.getByRole('application', { name: 'Signature drawing area' });
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 400 } as DOMRect);
  Object.assign(area, { setPointerCapture: vi.fn() });
  fireEvent.pointerDown(area, { pointerId: 1, button: 0, clientX: 40, clientY: 60 });
  fireEvent[eventName](area, { pointerId: 1, clientX: 140, clientY: 60 });
  expect(area.querySelector('circle[fill="#000"]')).toHaveAttribute('cx', '40');
  expect(area.querySelector('polyline')).toBeNull();
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeDisabled();
});
