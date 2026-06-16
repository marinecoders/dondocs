import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { useDocumentsStore } from '@/stores/documentsStore';
import { idbPutDocument, idbGetAllDocuments } from '@/lib/documentsDb';

// Legacy FOUO markings must fold to CUI in the PERSISTED registry on hydration —
// not only in the live store when the doc is opened — so opening an untouched
// legacy document doesn't look "edited" and churn/re-sort Recents. The migrated
// entry must keep its original updatedAt so it doesn't jump to the top.
describe('documentsStore hydration — legacy FOUO folds to CUI without churn', () => {
  it('migrates a persisted FOUO paragraph to CUI on init and preserves updatedAt', async () => {
    const meta = { id: 'legacy-fouo', title: 'Legacy', docType: 'naval_letter', updatedAt: 4242 };
    const session = {
      docType: 'naval_letter',
      documentCategory: 'correspondence',
      paragraphs: [
        { text: 'controlled', level: 0, portionMarking: 'FOUO' },
        { text: 'plain', level: 0 },
      ],
      references: [],
      enclosures: [],
      copyTos: [],
      distributions: [],
    };
    await idbPutDocument({ id: 'legacy-fouo', meta, session } as never);

    await useDocumentsStore.getState().init();

    // In-memory registry: FOUO -> CUI, other paragraph untouched, same updatedAt.
    const entry = useDocumentsStore.getState().docs['legacy-fouo'];
    expect(entry.session.paragraphs.map((p: { portionMarking?: string }) => p.portionMarking)).toEqual([
      'CUI',
      undefined,
    ]);
    expect(entry.meta.updatedAt).toBe(4242);

    // Persisted back to IndexedDB as CUI, still at the original updatedAt.
    const stored = (await idbGetAllDocuments()).find((r) => r.id === 'legacy-fouo');
    expect(stored?.session.paragraphs[0].portionMarking).toBe('CUI');
    expect(stored?.meta.updatedAt).toBe(4242);
  });
});
