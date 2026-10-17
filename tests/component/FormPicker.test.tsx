import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { FormPicker } from '@/components/editor/FormPicker';
import { useFormStore } from '@/stores/formStore';
import { useDocumentStore } from '@/stores/documentStore';
import { fixtureInstance } from '../_helpers/formFixture';

const catalog = [
  { formType: 'alpha', name: 'FORM 1 - Alpha', number: 'FORM 1', title: 'Alpha', category: 'General', keywords: ['first'], verified: true },
  { formType: 'beta', name: 'FORM 2 - Beta', number: 'FORM 2', title: 'Beta', category: 'General', keywords: ['second'], verified: true },
];
vi.mock('@/services/formCatalog', () => ({ useFormCatalog: () => catalog }));
beforeEach(() => {
  useFormStore.setState({ favoriteForms: [], recentForms: [] });
  useDocumentStore.setState({ genericForm: undefined });
});

it('searches and selects with arrow keys and Enter while exposing the active option', async () => {
  const onSelect = vi.fn();
  render(<FormPicker value="alpha" onSelect={onSelect} />);
  fireEvent.click(screen.getByRole('button', { name: 'Form type' }));
  const search = screen.getByRole('combobox', { name: 'Search forms' });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  const active = document.getElementById(search.getAttribute('aria-activedescendant')!);
  expect(active).toHaveTextContent('Beta');
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(onSelect).toHaveBeenCalledWith('beta');
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Form type' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'first' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  expect(onSelect).toHaveBeenLastCalledWith('alpha');
  await act(async () => {});
});

it('puts favorites and recent forms first even when every form has been reviewed', () => {
  useFormStore.setState({ favoriteForms: ['beta'], recentForms: ['alpha'] });
  render(<FormPicker value="alpha" onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Form type' }));
  expect(within(screen.getByRole('group', { name: 'Favorites' })).getByRole('option')).toHaveTextContent('Beta');
  expect(within(screen.getByRole('group', { name: 'Recent' })).getByRole('option')).toHaveTextContent('Alpha');
});

it('names an open saved form even when it has been retired from the catalog', () => {
  useDocumentStore.setState({ genericForm: fixtureInstance() });
  render(<FormPicker value="fixture" onSelect={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Form type' })).toHaveTextContent('Fixture form');
});
