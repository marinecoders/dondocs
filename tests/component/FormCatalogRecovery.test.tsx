import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FormCatalogModal } from '@/components/modals/FormCatalogModal';

it('keeps built-ins available and retries a failed published catalog without hiding the failure', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, json: async () => ({ templates: [
    { id: 'future-form', name: 'NAVMC 999 - Sample', directory: 'sample/revisions/v1', config: true, status: 'published' },
    { id: 'unreviewed', name: 'Unreviewed sample', directory: 'candidate', config: true, status: 'candidate' },
  ] }) });
  vi.stubGlobal('fetch', fetcher);
  try {
    const select = vi.fn();
    render(<FormCatalogModal open onOpenChange={() => {}} onSelect={select} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not load');
    expect(screen.getByText('Administrative Action')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry library' }));
    fireEvent.click(await screen.findByRole('button', { name: /NAVMC 999 Sample/ }));
    expect(select).toHaveBeenCalledWith('future-form');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Unreviewed sample')).not.toBeInTheDocument();
  } finally { vi.unstubAllGlobals(); }
});
