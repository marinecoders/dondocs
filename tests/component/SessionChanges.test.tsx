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
