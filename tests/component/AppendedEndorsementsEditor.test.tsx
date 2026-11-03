import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppendedEndorsementsEditor } from '@/components/editor/AppendedEndorsementsEditor';
import { serializeSession, useDocumentStore } from '@/stores/documentStore';
import { resolveAppendedEndorsements } from '@/lib/appendedEndorsement';

beforeEach(() => useDocumentStore.setState({
  docType: 'naval_letter',
  formData: { from: 'Officer', to: 'Recipient', appendEndorsement: true, endorsementBody: 'Original acknowledgement.' },
}));

describe('attached endorsements', () => {
  it('round-trips saved endorsements and clears them when a different template is loaded', () => {
    useDocumentStore.getState().setField('additionalEndorsements', [{ id: 'second', endorsementBody: 'Approved.' }]);
    const saved = JSON.parse(JSON.stringify(serializeSession(useDocumentStore.getState())));
    useDocumentStore.getState().loadTemplate({ formData: { subject: 'Another letter' } });
    expect(resolveAppendedEndorsements('naval_letter', useDocumentStore.getState().formData)).toEqual([]);
    useDocumentStore.getState().loadTemplate(saved);
    const restored = resolveAppendedEndorsements('naval_letter', useDocumentStore.getState().formData);
    expect(restored.map((entry) => entry.ordinal)).toEqual(['FIRST', 'SECOND']);
    expect(restored[0].paragraphs).toEqual(['Original acknowledgement.']);
    expect(restored[1].paragraphs).toEqual(['Approved.']);
  });
  it('adds, edits and removes independent endorsements while retaining the saved first one', async () => {
    const user = userEvent.setup();
    render(<AppendedEndorsementsEditor />);
    await user.click(screen.getByRole('button', { name: 'Add another endorsement' }));
    const second = within(screen.getByRole('region', { name: 'New endorsement' }));
    await user.type(second.getByLabelText('Endorsement text'), 'Forwarded for approval.');
    await user.type(second.getByLabelText('From (optional)'), 'Second endorser');
    expect(useDocumentStore.getState().formData.endorsementBody).toBe('Original acknowledgement.');
    expect(useDocumentStore.getState().formData.additionalEndorsements?.[0]).toMatchObject({
      endorsementBody: 'Forwarded for approval.', endorsementFrom: 'Second endorser',
    });
    await user.click(screen.getByRole('button', { name: 'Add another endorsement' }));
    const third = within(screen.getByRole('region', { name: 'New endorsement' }));
    await user.type(third.getByLabelText('Endorsement text'), 'Approved.');
    await user.click(screen.getByRole('button', { name: 'Remove SECOND endorsement' }));
    expect(within(screen.getByRole('region', { name: 'SECOND endorsement' })).getByLabelText('Endorsement text')).toHaveValue('Approved.');
    expect(useDocumentStore.getState().formData.additionalEndorsements).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'THIRD endorsement' })).not.toBeInTheDocument();
  });

  it('hides all blocks with the toggle off and restores their content when enabled again', async () => {
    const user = userEvent.setup();
    render(<AppendedEndorsementsEditor />);
    await user.click(screen.getByRole('button', { name: 'Add another endorsement' }));
    await user.click(screen.getByRole('checkbox'));
    expect(screen.queryByRole('region', { name: 'New endorsement' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('region', { name: 'New endorsement' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'First endorsement' })).getByLabelText('Endorsement text')).toHaveValue('Original acknowledgement.');
  });
});
