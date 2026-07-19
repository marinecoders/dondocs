/**
 * Component tests for <AbbreviationHelper>. The data module is mocked to a tiny
 * set so these stay fast and deterministic; the real lookup lib does the work.
 * They lock in: it's silent off recordkeeping forms and when nothing applies,
 * lists the applicable abbreviations once loaded, and only edits on a click.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/data/abbreviations', () => ({
  abbrevSetForForm: (formType: string | undefined) =>
    formType === 'navmc_11811'
      ? {
          id: 'iram',
          label: 'IRAM recordkeeping abbreviations',
          authority: 'MCO P1070.12K, ch. 6',
          load: async () => [
            { word: 'commanding officer', abbr: 'CO' },
            { word: 'headquarters', abbr: 'hq' },
            { word: 'battalion', abbr: 'Bn' },
          ],
        }
      : null,
  // A tiny common-word guard so the fuzzy pass has something to load.
  loadCommonWords: async () => ['personnel', 'battalion'],
}));

import { AbbreviationHelper } from '@/components/editor/AbbreviationHelper';

describe('AbbreviationHelper', () => {
  it('renders nothing on a form with no abbreviation set', () => {
    const { container } = render(
      <AbbreviationHelper value="the commanding officer" onChange={vi.fn()} formType="naval_letter" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('lists the applicable abbreviations once the set loads', async () => {
    render(
      <AbbreviationHelper
        value="the commanding officer at headquarters"
        onChange={vi.fn()}
        formType="navmc_11811"
      />
    );
    expect(await screen.findByText('CO')).toBeTruthy();
    expect(screen.getByText('hq')).toBeTruthy();
    expect(screen.getByText(/MCO P1070.12K/)).toBeTruthy();
  });

  it('applies one abbreviation on click', async () => {
    const onChange = vi.fn();
    render(
      <AbbreviationHelper
        value="the commanding officer at headquarters"
        onChange={onChange}
        formType="navmc_11811"
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /Replace "commanding officer" with "CO"/i }));
    expect(onChange).toHaveBeenCalledWith('the CO at headquarters');
  });

  it('applies every abbreviation with Apply all', async () => {
    const onChange = vi.fn();
    render(
      <AbbreviationHelper
        value="the commanding officer at headquarters"
        onChange={onChange}
        formType="navmc_11811"
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /Apply all/i }));
    expect(onChange).toHaveBeenCalledWith('the CO at hq');
  });

  it('shows nothing when the text has no applicable abbreviation', async () => {
    const { container } = render(
      <AbbreviationHelper value="nothing to shorten here" onChange={vi.fn()} formType="navmc_11811" />
    );
    // Give the async load a tick; still nothing to show.
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('button')).toBeNull();
  });

  it('offers a "did you mean" correction for a misspelled approved word', async () => {
    const onChange = vi.fn();
    render(<AbbreviationHelper value="the battaion stood up" onChange={onChange} formType="navmc_11811" />);
    // The fuzzy channel appears once the common-word guard has loaded.
    expect(await screen.findByText('Did you mean?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Correct "battaion" to "battalion"/i }));
    expect(onChange).toHaveBeenCalledWith('the Bn stood up');
  });
});
