import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getSerializedSession } from '@/stores/documentStore';
import { SessionChanges } from '@/components/SessionChanges';

it('marks restore removals and additions while retaining full field values', () => {
  const before = getSerializedSession();
  before.formData.subject = 'Report Friday';
  const after = structuredClone(before);
  after.formData.subject = 'Report Monday';
  const { container } = render(<SessionChanges before={before} after={after} highlightText />);
  expect(container.querySelector('del')).toHaveTextContent('Friday');
  expect(container.querySelector('ins')).toHaveTextContent('Monday');
  expect(screen.getByText('1 changed field.', { exact: false })).toBeVisible();
  expect(container.querySelector('del')?.parentElement?.textContent).toBe('Report Friday');
  expect(container.querySelector('ins')?.parentElement?.textContent).toBe('Report Monday');
});

it('keeps profile comparisons unmarked unless highlighting is requested', () => {
  const before = getSerializedSession();
  const after = structuredClone(before);
  after.formData.subject = 'Changed subject';
  const { container } = render(<SessionChanges before={before} after={after} />);
  expect(container.querySelector('del, ins')).toBeNull();
});

it('shows movement independently from marked prose and keeps fallback limits visible', () => {
  const before = getSerializedSession();
  before.paragraphs = ['alpha', 'bravo', 'charlie'].map(id => ({ id, text: `${id} text`, level: 0 }));
  const after = { ...before, paragraphs: [before.paragraphs[2], ...before.paragraphs.slice(0, 2)] };
  const { container, rerender } = render(<SessionChanges before={before} after={after} highlightText />);
  expect(screen.getByRole('heading', { name: 'Paragraphs › 3 → 1 › Movement' })).toBeVisible();
  expect(screen.getByText('1 comparison item.')).toBeVisible();
  expect(container.querySelector('del, ins')).toBeNull();
  expect(screen.getAllByRole('note')).toHaveLength(2);
  const unrelated = { ...before, paragraphs: before.paragraphs.map((p, index) => ({ ...p, id: `other-${index}` })) };
  rerender(<SessionChanges before={before} after={unrelated} highlightText />);
  expect(screen.getByText('No content differences.')).toBeVisible();
  expect(screen.getByText(/no shared paragraph identities/)).toBeVisible();
});
