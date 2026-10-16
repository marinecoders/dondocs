import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FindReplaceModal } from '@/components/modals/FindReplaceModal';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';

beforeEach(() => {
  useUIStore.setState({ findReplaceOpen: true });
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState({ documentCategory: 'correspondence', formType: 'navmc_10274', paragraphs: [{ text: 'Alpha alpha', header: 'Alpha', level: 0 }] });
  useDocumentStore.getState().setField('subject', 'Alpha letter');
  useFormStore.getState().clearNavmc10274();
  useFormStore.getState().clearNavmc11811();
});

async function enterSearch() {
  await userEvent.type(screen.getByLabelText('Find', { exact: true }), 'alpha');
  await userEvent.type(screen.getByLabelText('Replace with', { exact: true }), '$& done');
}

describe('find and replace scope', () => {
  it.each(['navmc_10274', 'navmc_118_11'] as const)('only changes active %s text and signatures', async (formType) => {
    useDocumentStore.setState({ documentCategory: 'forms', formType });
    useFormStore.getState().setNavmc10274Field('natureOfAction', 'Alpha action');
    useFormStore.getState().setNavmc11811Field('remarksText', 'Alpha remarks');
    useFormStore.getState().setNavmc10274Field('signatureBlocks', [{ name: 'Alpha', statement: 'Alpha approved' }]);
    useFormStore.getState().setNavmc11811Field('signatureBlocks', [{ name: 'Alpha', statement: 'Alpha acknowledged' }]);
    render(<FindReplaceModal />);
    await enterSearch();
    expect(screen.getByText('1 of 3')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Replace All' }));
    const forms = useFormStore.getState();
    const active = formType === 'navmc_10274' ? forms.navmc10274 : forms.navmc11811;
    expect(active.signatureBlocks[0].name).toBe('$& done');
    expect(active.signatureBlocks[0].statement).toContain('$& done');
    expect(formType === 'navmc_10274' ? forms.navmc10274.natureOfAction : forms.navmc11811.remarksText).toContain('$& done');
    expect(formType === 'navmc_10274' ? forms.navmc11811.remarksText : forms.navmc10274.natureOfAction).toContain('Alpha');
    expect(useDocumentStore.getState().formData.subject).toBe('Alpha letter');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Alpha alpha');
    expect(screen.getByText('No matches')).toBeVisible();
  });

  it('replaces correspondence text and headings literally, preserving forms', async () => {
    useFormStore.getState().setNavmc10274Field('natureOfAction', 'Alpha action');
    render(<FindReplaceModal />);
    await enterSearch();
    await userEvent.click(screen.getByRole('button', { name: 'Replace All' }));
    expect(useDocumentStore.getState().paragraphs[0]).toMatchObject({ text: '$& done $& done', header: '$& done' });
    expect(useDocumentStore.getState().formData.subject).toBe('$& done letter');
    expect(useFormStore.getState().navmc10274.natureOfAction).toBe('Alpha action');
  });

  it('keeps the selected match valid when replacing the last match', async () => {
    render(<FindReplaceModal />);
    await enterSearch();
    await userEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(screen.getByText('4 of 4')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getByText('3 of 3')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getByText('2 of 2')).toBeVisible();
  });
});
