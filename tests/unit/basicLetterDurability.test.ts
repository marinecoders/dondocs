/**
 * The basic-letter PDF is stored like an enclosure file: its bytes live in the
 * attachments store, and only the fileRef is serialized, backed up, and kept
 * reachable by the GC. These pin that lifecycle so a saved endorsement doesn't
 * lose its basic letter on reload, in a backup, or to the attachment sweep.
 */
// Real in-memory IndexedDB before any store/attachments module evaluates.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { collectAttachmentIds } from '@/lib/backup';
import { persistAttachment } from '@/lib/attachments';
import { useDocumentStore, rehydrateEnclosureFiles, serializeSession } from '@/stores/documentStore';

const REF = { id: 'att-basic-letter-1', name: 'CO-ltr.pdf', size: 4096, type: 'application/pdf' };

function endorsementDocRecord() {
  return {
    session: {
      docType: 'new_page_endorsement',
      formData: { basicLetterFileRef: REF },
      enclosures: [],
    },
  };
}

describe('basic-letter attachment durability', () => {
  it('a backup embeds the basic-letter attachment bytes', () => {
    const ids = collectAttachmentIds([endorsementDocRecord()]);
    expect(ids).toContain(REF.id);
  });

  it('the backup collector still gathers enclosure refs alongside it', () => {
    const rec = {
      session: {
        docType: 'new_page_endorsement',
        formData: { basicLetterFileRef: REF },
        enclosures: [{ fileRef: { id: 'att-encl-9' } }],
      },
    };
    const ids = collectAttachmentIds([rec]);
    expect(ids).toEqual(expect.arrayContaining([REF.id, 'att-encl-9']));
  });
});

describe('serialize → rehydrate round-trip', () => {
  it('strips the bytes on serialize but keeps the ref', () => {
    useDocumentStore.setState((s) => ({
      formData: {
        ...s.formData,
        basicLetterFile: { name: 'x.pdf', size: 3, data: new Uint8Array([1, 2, 3]).buffer },
        basicLetterFileRef: REF,
      },
    }));
    const session = serializeSession(useDocumentStore.getState());
    expect(session.formData.basicLetterFile).toBeUndefined();
    expect(session.formData.basicLetterFileRef).toEqual(REF);
  });

  it('rehydrates the bytes from the attachments store on load', async () => {
    const data = new Uint8Array([9, 8, 7, 6]).buffer;
    const ref = await persistAttachment({ name: 'CO-ltr.pdf', size: 4, type: 'application/pdf' }, data);

    // A restored session carries only the ref (no bytes), exactly as serialized.
    useDocumentStore.setState((s) => ({
      formData: { ...s.formData, basicLetterFile: undefined, basicLetterFileRef: ref },
    }));
    expect(useDocumentStore.getState().formData.basicLetterFile).toBeUndefined();

    await rehydrateEnclosureFiles();

    const file = useDocumentStore.getState().formData.basicLetterFile;
    expect(file).toBeDefined();
    expect(new Uint8Array(file!.data)).toEqual(new Uint8Array(data));
  });
});
