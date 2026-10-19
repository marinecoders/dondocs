import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileManager } from '@/components/modals/ProfileManager';
import { ProfileModal } from '@/components/modals/ProfileModal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores/uiStore';
import { useProfileStore } from '@/stores/profileStore';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { showAppAlert, showAppConfirm } from '@/stores/alertStore';
import { readFileAsText, triggerDownload } from '@/lib/encoding';
import { parseProfileImport } from '@/lib/profileImport';

vi.mock('@/stores/alertStore', () => ({ showAppAlert: vi.fn(), showAppConfirm: vi.fn() }));
vi.mock('@/lib/encoding', async (importOriginal) => ({ ...await importOriginal<object>(), readFileAsText: vi.fn(), triggerDownload: vi.fn() }));
const alpha = { unitLine1: 'ALPHA', unitLine2: '', unitAddress: '', ssic: '1000', from: 'Alpha sender', sigFirst: '', sigMiddle: '', sigLast: '', sigRank: '', sigTitle: '' };
const beta = { ...alpha, unitLine1: 'BRAVO', from: 'Bravo sender' };
function mount() { render(<TooltipProvider><ProfileManager /><ProfileModal /></TooltipProvider>); }

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ profileManagerOpen: true, profileModalOpen: false, profileEditName: null });
  useProfileStore.setState({ profiles: { Alpha: alpha, Bravo: beta }, selectedProfile: 'Alpha' });
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState({ documentCategory: 'correspondence' });
});
afterEach(() => vi.restoreAllMocks());

it('creates and cancels without clearing the default or modifying the draft', () => {
  const before = getSerializedSession();
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
  expect(screen.getByRole('heading', { name: 'Create New Profile' })).toBeVisible();
  expect(useProfileStore.getState().selectedProfile).toBe('Alpha');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('heading', { name: 'Profiles' })).toBeVisible();
  expect(useProfileStore.getState().selectedProfile).toBe('Alpha');
  expect(getSerializedSession()).toMatchObject({ ...before, timestamp: expect.any(Number) });
});

it('edits a different profile without switching the default', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Bravo' }));
  expect(screen.getByDisplayValue('Bravo')).toBeDisabled();
  fireEvent.change(screen.getByDisplayValue('BRAVO'), { target: { value: 'UPDATED BRAVO' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Profiles' })).toBeVisible());
  expect(useProfileStore.getState().profiles.Bravo.unitLine1).toBe('UPDATED BRAVO');
  expect(useProfileStore.getState().selectedProfile).toBe('Alpha');
});

it('rejects a duplicate name rather than overwriting saved details', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
  fireEvent.change(screen.getByLabelText('Profile Name'), { target: { value: 'Alpha' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(showAppAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Name already used' }));
  expect(useProfileStore.getState().profiles.Alpha).toEqual(alpha);
});

it('reviews before applying, preserves document text, and requires a recovery version', async () => {
  const restore = vi.spyOn(useDocumentsStore.getState(), 'restoreSnapshot').mockResolvedValue(false);
  const before = getSerializedSession();
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Apply Bravo' }));
  expect(restore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to profiles' }));
  expect(useProfileStore.getState().selectedProfile).toBe('Alpha');
  fireEvent.click(screen.getByRole('button', { name: 'Apply Bravo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply profile' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Your document has not changed');
  expect(useProfileStore.getState().selectedProfile).toBe('Alpha');
  restore.mockResolvedValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Apply profile' }));
  await waitFor(() => expect(useProfileStore.getState().selectedProfile).toBe('Bravo'));
  expect(restore).toHaveBeenLastCalledWith(expect.objectContaining({ paragraphs: before.paragraphs, formData: expect.objectContaining({ from: 'Bravo sender' }) }));
  expect(screen.getByRole('status')).toHaveTextContent('Applied Bravo');
});

it('offers management, but no applying, when editing a form', () => {
  useDocumentStore.setState({ documentCategory: 'forms' });
  mount();
  expect(screen.queryByRole('button', { name: /^Apply/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Bravo' }));
  expect(screen.queryByText('Also apply to the current document')).not.toBeInTheDocument();
});

it('clears only the default when choosing to start blank', () => {
  const before = getSerializedSession();
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Start blank instead' }));
  expect(useProfileStore.getState().selectedProfile).toBeNull();
  expect(getSerializedSession()).toMatchObject({ ...before, timestamp: expect.any(Number) });
});

it('exports every profile in the existing portable format', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Export all' }));
  const data = vi.mocked(triggerDownload).mock.calls[0][0] as Uint8Array;
  expect(JSON.parse(new TextDecoder().decode(data))).toEqual({ version: '1.0', profiles: { Alpha: alpha, Bravo: beta } });
});

it('reports invalid imports and allows retrying the same file', async () => {
  mount();
  vi.mocked(readFileAsText).mockResolvedValue('{"profiles":[]}');
  const input = screen.getByLabelText('Import profiles');
  await act(async () => fireEvent.change(input, { target: { files: [new File(['bad'], 'profiles.json')] } }));
  expect(showAppAlert).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't import profiles" }));
  expect(useProfileStore.getState().profiles).toEqual({ Alpha: alpha, Bravo: beta });
  vi.mocked(readFileAsText).mockResolvedValue(JSON.stringify({ profiles: { Charlie: beta } }));
  await act(async () => fireEvent.change(input, { target: { files: [new File(['good'], 'profiles.json')] } }));
  expect(screen.getByRole('button', { name: 'Edit Charlie' })).toBeVisible();
});

it('does not replace matching imported profiles if the user cancels', async () => {
  vi.mocked(readFileAsText).mockResolvedValue(JSON.stringify({ profiles: { Alpha: beta } }));
  vi.mocked(showAppConfirm).mockResolvedValue(false);
  mount();
  await act(async () => fireEvent.change(screen.getByLabelText('Import profiles'), { target: { files: [new File(['x'], 'profiles.json')] } }));
  expect(showAppConfirm).toHaveBeenCalled();
  expect(useProfileStore.getState().profiles.Alpha).toEqual(alpha);
});

it.each([null, { profiles: [] }, { profiles: {} }, { profiles: { Broken: { unitLine1: 42 } } }])('rejects malformed profile files: %j', (value) => {
  expect(() => parseProfileImport(value)).toThrow('DonDocs profiles JSON');
});

it('asks before discarding an edited profile and keeps the default', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
  fireEvent.change(screen.getByLabelText('Profile Name'), { target: { value: 'Unsaved' } });
  fireEvent.keyDown(screen.getByLabelText('Profile Name'), { key: 'Escape' });
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('Discard unsaved changes?');
  expect(useUIStore.getState().profileModalOpen).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Continue Editing' }));
  expect(screen.getByDisplayValue('Unsaved')).toBeVisible();
  expect(useProfileStore.getState().selectedProfile).toBe('Alpha');
});
