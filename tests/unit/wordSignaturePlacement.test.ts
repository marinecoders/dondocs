import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { prepareDocxImages } from '@/services/docx/imageAssets';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { useDocumentStore } from '@/stores/documentStore';
import { buildDraftFileFromSnapshot, parsePortableDraft } from '@/lib/draftFile';
import { buildAssetSharePayload } from '@/lib/assetShare';
import { parseSharedDocument } from '@/lib/assetShare';
import { parseSavedSession } from '@/lib/savedSession';
import { serializeDocumentSnapshot } from '@/lib/documentSerialization';
import { validateLetter } from '../../companion/validateLetter';
import { renderPdf } from '../../companion/render';
import { letterSchema } from '../../companion/letterSchema';
import { toStore } from '../../companion/letterInput';
import { buildBaseline } from '../_helpers/compileMatrix';
import { docxImageFixture } from '../_helpers/docxImageFixture';

async function snapshot() {
  const { signature } = await docxImageFixture();
  return {
    ...useDocumentStore.getState().getSnapshot(), ...buildBaseline('joint_letter'),
    documentCategory: 'correspondence' as const, documentMode: 'custom' as const,
    formData: { ...buildBaseline('joint_letter').formData, signatureType: 'image' as const,
      signatureImageSigner: 'senior' as const,
      signatureImage: { name: 'signature.png', size: signature.length, data: signature.toString('base64') } },
  };
}

describe('Word signature placement', () => {
  it('requires an explicit valid dual signer rather than duplicating or guessing', async () => {
    const source = await snapshot();
    for (const role of [undefined, 'both', 'Senior']) {
      const invalid = { ...source, formData: { ...source.formData, signatureImageSigner: role } };
      await expect(prepareDocxImages(invalid as typeof source, async () => new Uint8Array())).rejects.toThrow('Choose the junior or senior');
      expect(() => generateFlatLatex(invalid as typeof source)).toThrow('Choose the junior or senior');
    }
  });

  it('preserves signer assignment and exact image through portable drafts and asset shares', async () => {
    const source = await snapshot();
    const draft = await parsePortableDraft(await buildDraftFileFromSnapshot(source, 1));
    expect(draft.session.formData.signatureImageSigner).toBe('senior');
    expect(draft.session.formData.signatureImage?.data).toBe(source.formData.signatureImage.data);
    const share = await parseSharedDocument(await buildAssetSharePayload(source, Date.now()));
    expect(share.session.formData.signatureImageSigner).toBe('senior');
    expect(share.session.formData.signatureImage?.data).toBe(source.formData.signatureImage.data);
    expect(parseSavedSession(serializeDocumentSnapshot(source, 1)).formData.signatureImageSigner).toBe('senior');
    const invalid = structuredClone(draft.session) as unknown as { formData: { signatureImageSigner: string } };
    invalid.formData.signatureImageSigner = 'both';
    expect(() => parseSavedSession(invalid)).toThrow();
    await expect(parsePortableDraft(invalid)).rejects.toThrow();
  });

  it('requires a FROM sender for an information memorandum image', async () => {
    const source = await snapshot();
    source.docType = 'information_memorandum';
    source.formData.from = '  ';
    await expect(prepareDocxImages(source, async () => new Uint8Array())).rejects.toThrow('FROM sender');
  });

  it('does not silently discard new Word-only placements through companion PDF output', async () => {
    const { signature } = await docxImageFixture();
    const input = { docType: 'joint_letter', subject: 'SYNTHETIC',
      signature: { imageFileId: 'sig', imageSigner: 'senior' as const },
      attachments: [{ id: 'sig', name: 'sig.png', mimeType: 'image/png' as const, dataBase64: signature.toString('base64') }] };
    expect(validateLetter(input).join(' ')).not.toMatch(/single-signer|imageSigner/);
    expect(toStore(input).formData.signatureImageSigner).toBe('senior');
    expect(letterSchema.safeParse({ ...input, signature: { ...input.signature, imageSigner: 'both' } }).success).toBe(false);
    await expect(renderPdf(input)).rejects.toThrow('require Word output');
    await expect(renderPdf({ ...input, docType: 'information_memorandum' })).rejects.toThrow('require Word output');
  });
});
