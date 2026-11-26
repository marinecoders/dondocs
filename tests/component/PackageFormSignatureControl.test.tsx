import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FormAnswerControl } from '@/components/editor/FormAnswerControl';

it('opens the package signing action without writing a signature as a form answer', () => {
  const onSign = vi.fn(), onChange = vi.fn();
  const props = { field: { kind: 'signature' as const, label: 'Member signature' }, value: undefined, onChange };
  const view = render(<FormAnswerControl {...props} onSign={onSign} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign Member signature' }));
  expect(onSign).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
  view.rerender(<FormAnswerControl {...props} />);
  expect(screen.getByText('Sign after export.')).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
});
