import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DatePicker, type DateFormatType } from '@/components/ui/date-picker';

describe('date editing alongside formatting suggestions', () => {
  it.each(['2026-11-12', '03/04/2026', '31 Apr 2026'])('does not rewrite an unchanged saved value on blur: %s', value => {
    const onChange = vi.fn();
    render(<DatePicker value={value} onChange={onChange} />);
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue(value);
  });

  it.each(['03/04/2026', '11/12/26', '31 Apr 2026', 'February 30, 2026', '2026-02-29', 'tomorrow'])('preserves unclear or invalid typed dates for manual review: %s', value => {
    const onChange = vi.fn();
    render(<DatePicker value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onChange).toHaveBeenLastCalledWith(value);
    expect(screen.getByRole('textbox')).toHaveValue(value);
  });

  it.each([
    ['military', '2026-11-12', '12 Nov 26'],
    ['spelled', '2026-11-12', 'November 12, 2026'],
    ['iso', 'November 12, 2026', '2026-11-12'],
    ['military', '13/04/2026', '13 Apr 26'],
    ['military', '04/13/2026', '13 Apr 26'],
    ['iso', '2024-02-29', '2024-02-29'],
    ['iso', '28 Oct 26', '2026-10-28'],
  ] satisfies [DateFormatType, string, string][])('still formats an unambiguous edit as %s', (dateFormat, value, expected) => {
    const onChange = vi.fn();
    render(<DatePicker value="" dateFormat={dateFormat} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onChange).toHaveBeenLastCalledWith(expected);
    expect(screen.getByRole('textbox')).toHaveValue(expected);
  });

  it('clears a whitespace-only edit even when the saved value is already empty', () => {
    const onChange = vi.fn();
    render(<DatePicker value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
