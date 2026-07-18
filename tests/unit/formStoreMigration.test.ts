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
    // Migration normalizes each block to carry an explicit `style` (a block
    // saved before the style field defaults to 'typed').
    expect(useFormStore.getState().navmc10274.signatureBlocks).toEqual([
      { statement: 'Acknowledged:', name: 'T. R. OAKES', style: 'typed' },
    ]);
  });

  it('upgrades a pre-1.2.107 digital flag to style', async () => {
    localStorage.setItem(
      FORMS_PERSIST_KEY,
      JSON.stringify({
        state: {
          navmc10274: {
            signatureBlocks: [
              { statement: '', name: 'R. L. SMITH', digital: true },
              { statement: '', name: 'J. A. DOE', digital: false },
            ],
          },
        },
        version: 0,
      })
    );
    await useFormStore.persist.rehydrate();
    expect(useFormStore.getState().navmc10274.signatureBlocks).toEqual([
      { statement: '', name: 'R. L. SMITH', style: 'digital' },
      { statement: '', name: 'J. A. DOE', style: 'typed' },
    ]);
  });

  it('gives a pre-signatures navmc11811 an empty signatureBlocks list', async () => {
    localStorage.setItem(
      FORMS_PERSIST_KEY,
      JSON.stringify({
        state: {
          navmc11811: {
            lastName: 'DOE',
            remarksText: 'Saved before the 118(11) had signatures.',
            // no signatureBlocks key
          },
        },
        version: 0,
      })
    );
    await useFormStore.persist.rehydrate();
    const data = useFormStore.getState().navmc11811;
    expect(data.lastName).toBe('DOE');
    expect(data.remarksText).toBe('Saved before the 118(11) had signatures.');
    expect(data.signatureBlocks).toEqual([]); // never undefined — the Forms tab .maps it
  });

  it('upgrades a 118(11) block from the digital flag to style', async () => {
    localStorage.setItem(
      FORMS_PERSIST_KEY,
      JSON.stringify({
        state: {
          navmc11811: {
            signatureBlocks: [{ statement: '', name: 'A. B. COUNSELOR', digital: true }],
          },
        },
        version: 0,
      })
    );
    await useFormStore.persist.rehydrate();
    expect(useFormStore.getState().navmc11811.signatureBlocks).toEqual([
      { statement: '', name: 'A. B. COUNSELOR', style: 'digital' },
    ]);
  });
});
