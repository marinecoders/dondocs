import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentNavigation } from '@/components/layout/DocumentNavigation';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, lastKindIds: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
});

describe('workspace category navigation', () => {
  it('preserves edits across correspondence and both forms, and resumes the most recent form', async () => {
    const user = userEvent.setup();
    useDocumentStore.getState().setFormData({ subject: 'Keep this letter' });
    const letterId = useDocumentsStore.getState().currentId;
    // Viewing an older draft must take precedence over a more recently edited one.
    useDocumentsStore.getState().newDocument();
    useDocumentStore.getState().setFormData({ subject: 'Another newer letter' });
    useDocumentsStore.getState().switchTo(letterId!);
    render(<DocumentNavigation />);

    await user.click(screen.getByRole('button', { name: 'Forms' }));
    expect(screen.getByRole('button', { name: 'Forms' })).toHaveAttribute('aria-current', 'page');
    useFormStore.getState().setNavmc10274Field('supplementalInfo', 'Keep this administrative action');
    const actionId = useDocumentsStore.getState().currentId;

    await user.selectOptions(screen.getByRole('combobox', { name: 'Switch form' }), 'navmc_118_11');
    useFormStore.getState().setNavmc11811Field('remarksText', 'Keep these remarks');
    const remarksId = useDocumentsStore.getState().currentId;

    await user.click(screen.getByRole('button', { name: 'Correspondence' }));
    expect(useDocumentsStore.getState().currentId).toBe(letterId);
    expect(useDocumentStore.getState().formData.subject).toBe('Keep this letter');
    await user.click(screen.getByRole('button', { name: 'Forms' }));
    expect(useDocumentsStore.getState().currentId).toBe(remarksId);
    expect(screen.getByRole('combobox', { name: 'Switch form' })).toHaveValue('navmc_118_11');
    expect(useFormStore.getState().navmc11811.remarksText).toBe('Keep these remarks');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Switch form' }), 'navmc_10274');
    expect(useDocumentsStore.getState().currentId).toBe(actionId);
    expect(useFormStore.getState().navmc10274.supplementalInfo).toBe('Keep this administrative action');
    await user.click(screen.getByRole('button', { name: 'Forms' }));
    expect(useDocumentsStore.getState().currentId).toBe(actionId);
    expect(Object.keys(useDocumentsStore.getState().docs)).toHaveLength(4);
  });
});
