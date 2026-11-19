import 'fake-indexeddb/auto';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePackageEditDraft } from '@/hooks/usePackageEditDraft';
import { openPackageEditDraft, packageEditDraftScope } from '@/lib/packageEditDrafts';

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
