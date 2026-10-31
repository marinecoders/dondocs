import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useDocumentStore } from '@/stores/documentStore';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { renderEditorSection, getSectionError, errorBearingIds } from '@/components/layout/editorSections';
import { Sl3IllustrationsSection, Sl3CoverSection, Sl3InventorySection } from '@/components/editor/Sl3Sections';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { sl3Fixture } from '../_helpers/sl3Fixture';

beforeEach(() => {
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState(sl3Fixture());
  useEditorOutlineStore.getState().registerJump(null);
});

it('offers only the SL-3 authentication fields and retains edits', () => {
  render(renderEditorSection('signature', DOC_TYPE_CONFIG.sl3));
  expect(screen.getByText('Digital authentication required')).toBeInTheDocument();
  expect(screen.queryByLabelText('By direction')).not.toBeInTheDocument();
  expect(screen.queryByRole('radio', { name: 'Typed Only' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Office Code')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Signing authority title'), { target: { value: 'Program Manager, Training Systems' } });
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Training' } });
  expect(useDocumentStore.getState().formData).toMatchObject({ sigLast: 'Training', sigTitle: 'Program Manager, Training Systems' });
});

it('repairs incompatible imported signature options explicitly and leaves the title for author correction', () => {
  const s = useDocumentStore.getState();
  s.setField('signatureType', 'image');
  s.setField('byDirection', true);
  s.setField('sigTitle', 'By direction');
  render(renderEditorSection('signature', DOC_TYPE_CONFIG.sl3));
  expect(screen.getByRole('alert')).toHaveTextContent('incompatible signature');
  fireEvent.click(screen.getByRole('button', { name: 'Use SL-3 authentication' }));
  expect(useDocumentStore.getState().formData).toMatchObject({ signatureType: 'digital', byDirection: false, sigTitle: 'By direction' });
  expect(screen.getByLabelText('Signing authority title')).toHaveAttribute('aria-invalid', 'true');
});

it('routes a missing technical source to the section that owns it', () => {
  const store = sl3Fixture();
  store.formData.sl3!.sourceManual = '';
  const missing = errorBearingIds(DOC_TYPE_CONFIG.sl3).filter((id) =>
    getSectionError(id, store.formData, store.paragraphs, DOC_TYPE_CONFIG.sl3, store.endItems));
  expect(missing).toEqual(['sl3-details']);
  expect(errorBearingIds(DOC_TYPE_CONFIG.naval_letter)).not.toContain('classification');
});

it('routes inventory and signature feedback to their own editing sections', () => {
  const store = sl3Fixture();
  store.formData.sl3!.components[0].quantity = '0';
  store.formData.sigTitle = '';
  expect(errorBearingIds(DOC_TYPE_CONFIG.sl3).filter((id) =>
    getSectionError(id, store.formData, store.paragraphs, DOC_TYPE_CONFIG.sl3, store.endItems)))
    .toEqual(['sl3-inventory', 'signature']);
});

it('lets the export checklist jump to the field section that needs correction', () => {
  const visited: string[] = [];
  useEditorOutlineStore.getState().registerJump((id) => visited.push(id));
  const s = useDocumentStore.getState();
  s.setField('sl3', { ...s.formData.sl3!, sourceManual: '' });
  render(<Sl3CoverSection />);
  fireEvent.click(screen.getByText(/items? to complete before export/));
  fireEvent.click(screen.getByRole('button', { name: 'Identify the source technical manual for this standalone SL-3 extract.' }));
  expect(visited).toEqual(['sl3-details']);
  useEditorOutlineStore.getState().registerJump(null);
});

it('distinguishes upload and label controls for multiple illustrations', () => {
  useDocumentStore.setState({ paragraphs: ['drawing-one', 'drawing-two'].map((referenceId) => ({ referenceId, text: referenceId, level: 0, figure: {} })) });
  render(<Sl3IllustrationsSection />);
  for (const i of [1, 2]) {
    const name = `Illustration ${i} (unassigned)`;
    expect(screen.getByLabelText(`Choose illustration for ${name}`)).toHaveAttribute('type', 'file');
    fireEvent.change(screen.getByLabelText(`${name} lettering review`), { target: { value: 'labels' } });
    fireEvent.click(screen.getByRole('button', { name: `Add searchable label to ${name}` }));
    fireEvent.change(screen.getByLabelText(`${name} label 1 text`), { target: { value: `Label ${i}` } });
  }
  expect(useDocumentStore.getState().formData.sl3!.artwork.map((a) => a.labels[0].text)).toEqual(['Label 1', 'Label 2']);
});

it('disables unavailable sibling moves while retaining working reorder actions', () => {
  render(<Sl3InventorySection />);
  expect(screen.getByRole('button', { name: 'Move item 1 up' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Move item 3 down' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Move item 1 down' }));
  expect(useDocumentStore.getState().formData.sl3!.components.map((c) => c.id)).toEqual(['component-1', 'component-0', 'component-2']);
});
