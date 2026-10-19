import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccordionStaticProvider } from '@/components/ui/accordion';
import { UnitLookupModal } from '@/components/modals/UnitLookupModal';
import { SSICLookupModal } from '@/components/modals/SSICLookupModal';
import { loadUnitDirectory } from '@/data/unitDirectory';
import { loadSsicCategories } from '@/data/ssicCodes';

vi.mock('@/data/unitDirectory', () => ({ loadUnitDirectory: vi.fn(), formatUnitAddress: () => '' }));
vi.mock('@/data/ssicCodes', () => ({ loadSsicCategories: vi.fn() }));

describe('lookup recovery', () => {
  it('retries SSIC loading without showing an empty result during loading or failure', async () => {
    const user = userEvent.setup();
    vi.mocked(loadSsicCategories).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([
      { range: '1000-1999', name: 'Personnel', codes: [{ code: '1000', title: 'Personnel overview' }] },
    ]);
    const onSelect = vi.fn();
    render(<AccordionStaticProvider><SSICLookupModal open onOpenChange={vi.fn()} onSelect={onSelect} /></AccordionStaticProvider>);
    expect(screen.getByText('Loading SSIC codes…')).toBeInTheDocument();
    expect(screen.queryByText(/No SSIC codes found/)).not.toBeInTheDocument();
    await screen.findByRole('alert');
    expect(screen.queryByText('Loading SSIC codes…')).not.toBeInTheDocument();
    expect(screen.queryByText(/No SSIC codes found/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Search SSIC codes' })).toBeEnabled());
    const category = screen.getByRole('button', { name: /1000-1999 Personnel/ });
    expect(category).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '1000 Personnel overview' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Search SSIC codes' }), '1000');
    await user.click(screen.getByRole('button', { name: '1000 Personnel overview' }));
    expect(onSelect).toHaveBeenCalledWith('1000');
  });

  it('clears the unit failure after a successful retry', async () => {
    const user = userEvent.setup();
    vi.mocked(loadUnitDirectory).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      ALL_UNITS: [], UNIT_CATEGORIES: [],
      UNIT_DATABASE_INFO: { source: 'test', totalUnits: 0, version: 'test', lastUpdated: '2026-10-17' },
    });
    render(<UnitLookupModal open onOpenChange={vi.fn()} onSelect={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Loading unit directory…')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Search unit directory' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Search unit directory' }), 'missing');
    expect(screen.getByText('No units found matching "missing"')).toBeInTheDocument();
  });
});
