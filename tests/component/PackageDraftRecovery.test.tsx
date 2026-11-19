import 'fake-indexeddb/auto';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePackageEditDraft } from '@/hooks/usePackageEditDraft';
import { openPackageEditDraft, packageEditDraftScope } from '@/lib/packageEditDrafts';
import * as editDrafts from '@/lib/packageEditDrafts';

afterEach(() => vi.restoreAllMocks());

function Editor({ scope, editable = true }: { scope: string; editable?: boolean }) {
  const [text, setText] = useState('');
  const recovery = usePackageEditDraft({ scope, value: { text }, dirty: text !== '', enabled: editable,
    restore(value) { if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string') throw Error('Unreadable text draft'); setText(value.text); } });
  return <><label>Draft<input value={text} disabled={!editable || recovery.status === 'loading'} onChange={event => setText(event.target.value)} /></label><p role="status">{recovery.status}</p>{recovery.error && <p role="alert">{recovery.error}</p>}<button onClick={async () => { await recovery.clear(); setText(''); }}>Discard draft</button></>;
}

it('restores unapplied input after the editor is closed and reopened', async () => {
  const scope = packageEditDraftScope(crypto.randomUUID(), 'version-1', 'information'), user = userEvent.setup();
  const first = render(<Editor scope={scope} />);
  await waitFor(() => expect(screen.getByLabelText('Draft')).toBeEnabled());
  await user.type(screen.getByLabelText('Draft'), '000123');
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('saved'));
  first.unmount(); render(<Editor scope={scope} />);
  await waitFor(() => expect(screen.getByLabelText('Draft')).toHaveValue('000123'));
  await user.click(screen.getByRole('button', { name: 'Discard draft' }));
  await waitFor(() => expect(screen.getByLabelText('Draft')).toHaveValue(''));
  expect((await openPackageEditDraft(scope)).value).toBeNull();
});

it('keeps historical views read-only and does not delete an unreadable recovery value', async () => {
  const scope = packageEditDraftScope(crypto.randomUUID(), 'version-1', 'information');
  await (await openPackageEditDraft(scope)).save({ wrong: 'retain for recovery' });
  const view = render(<Editor scope={scope} />);
  await screen.findByRole('alert');
  expect((await openPackageEditDraft(scope)).value).toEqual({ wrong: 'retain for recovery' });
  view.unmount(); render(<Editor scope={scope} editable={false} />);
  expect(screen.getByLabelText('Draft')).toBeDisabled();
  expect(screen.getByLabelText('Draft')).toHaveValue('');
  expect((await openPackageEditDraft(scope)).value).toEqual({ wrong: 'retain for recovery' });
});

it('keeps a newer recovery write active when an older write fails', async () => {
  let rejectFirst!: (cause: Error) => void, finishSecond!: () => void;
  const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
  const second = new Promise<void>(resolve => { finishSecond = resolve; });
  const save = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  vi.spyOn(editDrafts, 'openPackageEditDraft').mockResolvedValue({ value: null, error: '', save });
  const user = userEvent.setup();
  render(<Editor scope="overlapping-recovery-writes" />);
  await waitFor(() => expect(screen.getByLabelText('Draft')).toBeEnabled());
  await user.type(screen.getByLabelText('Draft'), 'ab');
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => rejectFirst(new Error('An earlier write failed')));
  expect(screen.getByRole('status')).toHaveTextContent('saving');
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => finishSecond());
  expect(screen.getByRole('status')).toHaveTextContent('saved');
  expect(screen.getByLabelText('Draft')).toHaveValue('ab');
  expect(screen.queryByRole('alert')).toBeNull();
});

for (const transition of ['enable', 'scope'] as const) it(`reports recovery loading immediately on ${transition} changes`, async () => {
  const statuses: string[] = [];
  vi.spyOn(editDrafts, 'openPackageEditDraft').mockResolvedValue({ value: null, error: '', save: vi.fn() });
  const view = renderHook(({ scope, enabled }) => {
    const recovery = usePackageEditDraft({ scope, enabled, value: {}, dirty: false, restore() {} });
    statuses.push(recovery.status);
    return recovery;
  }, { initialProps: { scope: 'first', enabled: transition !== 'enable' } });
  await waitFor(() => expect(view.result.current.status).toBe('idle'));
  statuses.length = 0;
  view.rerender({ scope: transition === 'scope' ? 'second' : 'first', enabled: true });
  expect(statuses[0]).toBe('loading');
  await waitFor(() => expect(view.result.current.status).toBe('idle'));
});

it('does not report newer input as saved before its recovery write finishes', async () => {
  let finish!: () => void;
  const save = vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  vi.spyOn(editDrafts, 'openPackageEditDraft').mockResolvedValue({ value: null, error: '', save });
  const statuses: string[] = [];
  const view = renderHook(({ text }) => {
    const recovery = usePackageEditDraft({ scope: 'current-saved-content', enabled: true, value: { text }, dirty: !!text, restore() {} });
    statuses.push(recovery.status);
    return recovery;
  }, { initialProps: { text: '' } });
  await waitFor(() => expect(view.result.current.status).toBe('idle'));
  statuses.length = 0;
  view.rerender({ text: 'First saved answer' });
  expect(statuses[0]).toBe('saving');
  await waitFor(() => expect(view.result.current.status).toBe('saved'));
  statuses.length = 0;
  view.rerender({ text: 'Newer unsaved answer' });
  expect(statuses[0]).toBe('saving');
  expect(view.result.current.status).toBe('saving');
  await act(async () => finish());
  expect(view.result.current.status).toBe('saved');
  expect(save).toHaveBeenLastCalledWith({ text: 'Newer unsaved answer' });
});
