import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SignatureGraphicPicker } from '@/components/SignatureGraphicPicker';

const decode = vi.hoisted(() => vi.fn());
vi.mock('@/lib/signatureGraphic', () => ({ readSignatureGraphic: decode }));
vi.mock('@/components/editor/SignatureDrawingDialog', () => ({
  SignatureDrawingDialog: ({ onOpenChange, onUse }: { onOpenChange(open: boolean): void; onUse(file: File): Promise<void> }) =>
    <div><button onClick={() => void onUse(new File([], 'drawing.png'))}>Use drawing</button>
      <button onClick={() => onOpenChange(false)}>Cancel drawing</button></div>,
}));

it('keeps the current graphic when a cancelled drawing finishes decoding', async () => {
  let finish!: (value: string) => void;
  decode.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  const change = vi.fn();
  render(<SignatureGraphicPicker value="current" onChange={change} />);
  fireEvent.click(screen.getByText('Draw'));
  fireEvent.click(screen.getByText('Use drawing'));
  fireEvent.click(screen.getByText('Cancel drawing'));
  await act(async () => finish('cancelled'));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByText('Draw')).toBeEnabled();
});
