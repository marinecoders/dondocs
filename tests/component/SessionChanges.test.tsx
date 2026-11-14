import { expect, it, vi } from 'vitest';
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

it('retains added and removed values through replacement rerenders without duplicate React keys', () => {
  const before = getSerializedSession();
  before.paragraphs = [{ id: 'keep', text: 'Unchanged paragraph', level: 0 }, { id: 'removed', text: 'Removed paragraph text', level: 0 }];
  const replacement = (id: string, text: string) => ({ ...before, paragraphs: [before.paragraphs[0], { id, text, level: 0 }] });
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const { container, rerender } = render(<SessionChanges before={before} after={replacement('first', 'First replacement text')} highlightText />);
    const initial = container.textContent;
    rerender(<SessionChanges before={before} after={replacement('second', 'Second replacement text')} highlightText />);
    expect(initial).toContain('Removed paragraph text');expect(initial).toContain('First replacement text');
    expect(screen.getByText('Removed paragraph text', { exact: true })).toBeVisible();
    expect(screen.getByText('Second replacement text', { exact: true })).toBeVisible();
    expect(container.textContent).not.toContain('First replacement text');
    const headings = screen.getAllByRole('heading').map(heading => heading.textContent);
    expect(new Set(headings).size).toBe(headings.length);
    expect(error.mock.calls.filter(args => args.map(String).join(' ').includes('same key'))).toEqual([]);
  } finally { error.mockRestore(); }
});
