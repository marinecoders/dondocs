import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignatureSection } from '@/components/editor/SignatureSection';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { formatRank } from '@/data/ranks';
import { OFFICE_CODES } from '@/data/officeCodes';

const initialFields = useDocumentStore.getState().formData;
const initialType = useDocumentStore.getState().docType;
const rank = formatRank('Capt', 'USMC');
const office = OFFICE_CODES[0].code;

beforeEach(() => {
  useDocumentStore.setState({ docType: 'business_letter', formData: { ...initialFields, sigRank: rank, officeCode: office } });
});
afterEach(() => useDocumentStore.setState({ docType: initialType, formData: initialFields }));

it.each([
  ['sigRank', 'Civilian / Other', 'Military', 'Rank / Title', rank],
  ['officeCode', 'Custom', 'Standard', 'Office Code', office],
] as const)('keeps the chosen custom mode through local clearing and follows external %s replacements', async (field, custom, standard, label, standardValue) => {
  const user = userEvent.setup();
  render(<TooltipProvider><SignatureSection config={DOC_TYPE_CONFIG.business_letter} /></TooltipProvider>);
  await user.click(screen.getByRole('button', { name: /^Signature Block/ }));
  await user.click(screen.getByRole('tab', { name: custom }));
  expect(screen.getByRole('tab', { name: custom })).toHaveAttribute('aria-selected', 'true');
  const input = screen.getByRole('textbox', { name: label });
  expect(input).not.toHaveAttribute('readonly');
  await user.type(input, 'Example custom value');
  await user.clear(input);
  expect(screen.getByRole('tab', { name: custom })).toHaveAttribute('aria-selected', 'true');
  expect(input).toHaveValue('');
  await user.type(input, `${standardValue} adviser`);
  expect(screen.getByRole('tab', { name: custom })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('textbox', { name: label })).toHaveValue(`${standardValue} adviser`);
  act(() => useDocumentStore.getState().setField(field, standardValue));
  expect(screen.getByRole('tab', { name: standard })).toHaveAttribute('aria-selected', 'true');
  act(() => useDocumentStore.getState().setField(field, 'External custom value'));
  expect(screen.getByRole('tab', { name: custom })).toHaveAttribute('aria-selected', 'true');
  act(() => useDocumentStore.getState().setField(field, ''));
  expect(screen.getByRole('tab', { name: standard })).toHaveAttribute('aria-selected', 'true');
});
