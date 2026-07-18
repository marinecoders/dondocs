/**
 * Every user who saved NAVMC form data before 1.2.105 has a persisted
 * navmc10274 without `signatureBlocks`. zustand's default persist merge is
 * shallow — the stored object replaces the default wholesale — so without the
 * store's custom merge the field hydrates undefined and the Forms tab crashes
 * on .map. This pins the guard.
 */
import { describe, it, expect } from 'vitest';
import { useFormStore, FORMS_PERSIST_KEY } from '@/stores/formStore';

describe('formStore hydration of pre-signatureBlocks sessions', () => {
  it('fills signatureBlocks with an empty list and keeps the saved fields', async () => {
    localStorage.setItem(
      FORMS_PERSIST_KEY,
      JSON.stringify({
        state: {
          navmc10274: {
            actionNo: '007-24',
            supplementalInfo: 'Saved before signature blocks existed.',
            proposedAction: 'Keep me.',
            // no signatureBlocks key — the pre-1.2.105 shape
          },
        },
        version: 0,
      })
    );
    await useFormStore.persist.rehydrate();
    const data = useFormStore.getState().navmc10274;
    expect(data.actionNo).toBe('007-24');
    expect(data.proposedAction).toBe('Keep me.');
    expect(Array.isArray(data.signatureBlocks)).toBe(true);
    expect(data.signatureBlocks).toEqual([]);
  });

  it('keeps saved signature blocks when they exist', async () => {
    localStorage.setItem(
      FORMS_PERSIST_KEY,
      JSON.stringify({
        state: {
          navmc10274: {
            signatureBlocks: [{ statement: 'Acknowledged:', name: 'T. R. OAKES' }],
          },
        },
        version: 0,
      })
    );
    await useFormStore.persist.rehydrate();
    expect(useFormStore.getState().navmc10274.signatureBlocks).toEqual([
      { statement: 'Acknowledged:', name: 'T. R. OAKES' },
    ]);
  });
});
