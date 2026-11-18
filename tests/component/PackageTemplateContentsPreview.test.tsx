import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageTemplateContentsPreview } from '@/components/PackageTemplateContentsPreview';
import { configuredMaintenanceFixture, maintenanceFixture } from '../_helpers/packageTemplateMaintenance';
vi.mock('@/components/pdf/PdfViewer', () => ({ default: ({ pdfUrl }: { pdfUrl: string }) => <div>Exact PDF: {pdfUrl}</div> }));
const create = vi.fn((_blob: Blob) => 'blob:synthetic-template-preview'), revoke = vi.fn();
beforeEach(() => { vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('qualifies and opens an exact retained form background, then revokes its owned URL', async () => {
  const template = await configuredMaintenanceFixture(), user = userEvent.setup(), view = render(<PackageTemplateContentsPreview template={template} />);
  await user.click(screen.getByText('Inspect retained starter text and assets', { selector: 'summary' }));
  await user.click(screen.getByRole('button', { name: 'Inspect Synthetic letter background page1.pdf' }));
  expect(await screen.findByText('Exact PDF: blob:synthetic-template-preview')).toBeVisible(); expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
  await user.click(screen.getByRole('button', { name: 'Close template asset preview' })); await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:synthetic-template-preview'));
  view.rerender(<PackageTemplateContentsPreview template={maintenanceFixture()} />); expect(screen.queryByLabelText('Exact template PDF asset')).toBeNull();
});
it('does not crash or open a raw malformed draft before qualification', async () => {
  const template = maintenanceFixture(); if (template.members[0].kind === 'native') template.members[0].draft.paragraphs = [null, { figure: { data: 12, type: 'application/pdf' } }];
  render(<PackageTemplateContentsPreview template={template} />); expect(create).not.toHaveBeenCalled(); expect(screen.getByText('Inspect retained starter text and assets', { selector: 'summary' })).toBeInTheDocument();
});
