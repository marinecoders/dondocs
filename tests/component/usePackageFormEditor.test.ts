import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { usePackageFormEditor } from '@/components/usePackageFormEditor';
import * as drafts from '@/lib/packageEditDrafts';
import { packageFormFixture } from '../_helpers/packageFormReviewFixture';

it('retries a failed draft read in place and preserves input after a recovery write failure', async () => {
  const { record, member } = await packageFormFixture();
  const original = drafts.openPackageEditDraft;
  const open = vi.spyOn(drafts, 'openPackageEditDraft').mockRejectedValueOnce(new Error('Storage unavailable'));
  try {
    const journal = await original(JSON.stringify([record.id, member.id, 'official-form']));
    const save = vi.spyOn(journal, 'save');
    open.mockResolvedValue(journal);
    const { result } = renderHook(() => usePackageFormEditor(record, member, vi.fn()));
    await waitFor(() => expect(result.current.error).toBe('Storage unavailable'));
    act(() => result.current.retryOpen());
    await waitFor(() => expect(result.current.ready).toBe(true));
    const values = result.current.values;
    if (values.kind !== 'configured') throw new Error('Expected a configured form');
    save.mockRejectedValueOnce(new Error('Storage full'));
    const changed = { ...values, answers: { ...values.answers, name: 'SYNTHETIC EXAMPLE' } };
    act(() => result.current.change(changed));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toBe('Storage full');
    expect(result.current.values).toEqual(changed);
  } finally { open.mockRestore(); }
});
