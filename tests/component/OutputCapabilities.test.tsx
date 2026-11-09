import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from '@/components/layout/Header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';

beforeEach(() => useDocumentStore.setState({ documentCategory: 'correspondence', docType: 'naval_letter', documentMode: 'compliant', formType: 'navmc_10274', genericForm: undefined }));
async function menu() {
  render(<TooltipProvider><Header /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Download' }));
}
it('offers supported letter formats and explains the configuration-fragment limitation', async () => {
  await menu();
  expect(screen.getByRole('menuitem', { name: 'Download Word (.docx)' })).toBeEnabled();
  expect(screen.getByRole('menuitem', { name: 'Download Flat LaTeX (Pandoc)' })).toBeEnabled();
  expect(screen.getByRole('note')).toHaveTextContent('configuration fragments');
});
it('offers publication configuration fragments while withholding unsupported Word and flat output', async () => {
  useDocumentStore.setState({ docType: 'sl3' });await menu();
  expect(screen.getByRole('menuitem', { name: 'Download LaTeX' })).toBeEnabled();
  expect(screen.queryByRole('menuitem', { name: /Word|Flat LaTeX/ })).not.toBeInTheDocument();
});
it('keeps configured-form batch unavailable while allowing its loaded PDF', async () => {
  const form = fixtureInstance();form.definition.pages[0].sha256 = (await fixturePage()).sha256;useDocumentStore.setState({ documentCategory: 'forms', formType: form.definition.formId, genericForm: form });
  await menu();expect(screen.getByRole('menuitem', { name: /^Download PDF/ })).toBeEnabled();
  expect(screen.queryByRole('menuitem', { name: /Word|LaTeX/ })).not.toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Batch' })).toBeDisabled();
});
it('does not promise PDF output before the selected form definition is loaded', async () => {
  useDocumentStore.setState({ documentCategory: 'forms', formType: 'fixture', genericForm: undefined });await menu();
  expect(screen.getByRole('menuitem', { name: /^Download PDF/ })).toHaveAttribute('data-disabled');
  expect(screen.getByRole('menuitem', { name: /^Download PDF/ })).toHaveAttribute('title', 'Load the selected form definition before continuing.');
});
