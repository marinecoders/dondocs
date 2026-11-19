import { expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActionPackage } from '@/lib/actionPackages';

type User = ReturnType<typeof userEvent.setup>;
export async function openSavedPackage(dialog: HTMLElement, record: ActionPackage, user: User) {
  await waitFor(() => expect(within(dialog).queryByText('Loading packages…')).toBeNull());
  if (!within(dialog).queryByRole('heading', { name: 'Packages', level: 1 }))
    await user.click(within(dialog).getByRole('button', { name: 'Back to packages' }));
  const library = await within(dialog).findByRole('list', { name: 'Saved packages' });
  const row = await within(library).findByText(record.name, { exact: true });
  await user.click(row.closest('button')!);
  await within(dialog).findByRole('heading', { name: record.name, level: 1 });
}
export async function workspaceSection(dialog: HTMLElement, section: string, user: User) {
  const nav = await within(dialog).findByRole('navigation', { name: 'Package workspace' });
  const button = within(nav).getByRole('button', { name: section });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}
export async function expandDetails(root: HTMLElement, user: User) {
  for (const details of root.querySelectorAll('details')) {
    // Open the real disclosures, including nested advanced controls, as a user would.
    if (!details.open && !details.closest('[hidden]')) await user.click(details.querySelector('summary')!);
  }
}
export async function choosePackageVersion(dialog: HTMLElement, revisionId: string, user: User) {
  await user.click(within(dialog).getByRole('button', { name: 'Version history' }));
  const history = await screen.findByRole('dialog', { name: 'Version history' });
  const versions = within(history).getByLabelText('Package revision', { exact: true });
  await waitFor(() => expect(versions).toBeEnabled());
  await user.selectOptions(versions, revisionId);
  await waitFor(() => expect(history).not.toBeInTheDocument());
}
export async function startNewPackage(dialog: HTMLElement, user: User) {
  if (!within(dialog).queryByRole('button', { name: 'New package' }))
    await user.click(within(dialog).getByRole('button', { name: 'Back to packages' }));
  const create = await within(dialog).findByRole('button', { name: 'New package' });
  await waitFor(() => expect(create).toBeEnabled());
  await user.click(create);
  await within(dialog).findByRole('heading', { name: 'New package' });
}
