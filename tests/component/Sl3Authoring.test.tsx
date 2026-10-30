import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  Sl3CoverSection,
  Sl3InventorySection,
  Sl3DetailsSection,
  Sl3IllustrationsSection,
} from '@/components/editor/Sl3Sections';
import { useDocumentStore } from '@/stores/documentStore';
import { sl3Fixture } from '../_helpers/sl3Fixture';

beforeEach(() => {
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState(sl3Fixture());
});

it('changes layout without losing inventory content', () => {
  render(<Sl3CoverSection />);
  const original = structuredClone(
    useDocumentStore.getState().formData.sl3!.components,
  );
  fireEvent.change(screen.getByLabelText('Inventory layout'), {
    target: { value: 'landscape' },
  });
  expect(useDocumentStore.getState().formData.sl3!.orientation).toBe(
    'landscape',
  );
  expect(useDocumentStore.getState().formData.sl3!.components).toEqual(
    original,
  );
});

it('edits components through stable IDs and attaches a component directly after its parent', () => {
  render(<Sl3InventorySection />);
  fireEvent.change(screen.getByLabelText('Item 3 nomenclature'), {
    target: { value: 'HANDLE, Training' },
  });
  fireEvent.change(screen.getByLabelText('Item 3 parent'), {
    target: { value: 'component-0' },
  });
  expect(
    useDocumentStore.getState().formData.sl3!.components.map((item) => item.id),
  ).toEqual(['component-0', 'component-2', 'component-1']);
  expect(useDocumentStore.getState().formData.sl3!.components[1]).toMatchObject(
    { parentId: 'component-0', nomenclature: 'HANDLE, Training' },
  );
});

it('cleans component references when a special note is removed', () => {
  const s = useDocumentStore.getState();
  const data = structuredClone(s.formData.sl3!);
  data.notes = [
    { id: 'note', text: 'A demonstration special note.', portionMarking: 'U' },
  ];
  data.components[0].noteIds = ['note'];
  s.setField('sl3', data);
  render(<Sl3DetailsSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
  expect(useDocumentStore.getState().formData.sl3!.notes).toEqual([]);
  expect(
    useDocumentStore.getState().formData.sl3!.components[0].noteIds,
  ).toEqual([]);
});

it('keeps children under the surviving ancestor when a nested parent is removed', () => {
  const data = structuredClone(useDocumentStore.getState().formData.sl3!);
  data.components[1].parentId = data.components[0].id;
  data.components[2].parentId = data.components[1].id;
  useDocumentStore.getState().setField('sl3', data);
  render(<Sl3InventorySection />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove item 2' }));
  expect(useDocumentStore.getState().formData.sl3!.components[1]).toMatchObject(
    {
      id: 'component-2',
      parentId: 'component-0',
    },
  );
});

it('labels figures in publication order even when they were uploaded in a different order', () => {
  const data = structuredClone(useDocumentStore.getState().formData.sl3!);
  data.endItemFigureId = 'end-item';
  data.components[0].figureId = 'component';
  useDocumentStore.getState().setField('sl3', data);
  useDocumentStore.setState({
    paragraphs: [
      {
        referenceId: 'component',
        text: 'Component drawing',
        level: 0,
        figure: {},
      },
      {
        referenceId: 'end-item',
        text: 'End item drawing',
        level: 0,
        figure: {},
      },
    ],
  });
  render(<Sl3IllustrationsSection />);
  expect(screen.getByLabelText('Figure 1 title')).toHaveValue(
    'End item drawing',
  );
  expect(screen.getByLabelText('Figure 2 title')).toHaveValue(
    'Component drawing',
  );
  expect(
    screen.getByRole('option', { name: 'Figure 1: End item drawing' }),
  ).toBeInTheDocument();
});
