import { describe, expect, it, vi } from 'vitest';
import { buildDraftFileFromSnapshot, parseDraftFile } from '@/lib/draftFile';
import { createBlankSession, prepareSessionState } from '@/stores/documentStore';
import { loadAttachment, readAttachment } from '@/lib/attachments';

vi.mock('@/lib/attachments', async original => ({
  ...await original<typeof import('@/lib/attachments')>(),
  loadAttachment: vi.fn(async () => { throw new Error('Global attachment storage was consulted.'); }),
  readAttachment: vi.fn(async () => { throw new Error('Global attachment storage was consulted.'); }),
}));
const bytes = new Uint8Array([1, 2, 3]).buffer;
const ref = (id: string) => ({ id, name: `${id}.png`, size: bytes.byteLength, type: 'image/png' });

describe('owned portable-snapshot resources', () => {
  it('serializes all correspondence attachment slots and signature bytes exclusively through the supplied reader', async () => {
    const source = prepareSessionState(createBlankSession(undefined, 'new_page_endorsement'));
    source.formData.signatureImage = { name: 'signature.png', size: bytes.byteLength, data: '', fileRef: ref('signature') };
    source.formData.basicLetterFileRef = ref('basic');
    source.enclosures = [{ title: 'Enclosure', fileRef: ref('enclosure') }];
    source.paragraphs = [{ id: crypto.randomUUID(), text: 'Figure', level: 0, figure: { name: 'figure.png', type: 'image/png', fileRef: ref('figure') } }];
    const before = structuredClone(source), owned = vi.fn(async (_id: string) => bytes.slice(0));
    const draft = await buildDraftFileFromSnapshot(source, Date.now(), owned), parsed = parseDraftFile(draft);
    expect(new Set(owned.mock.calls.map(call => call[0]))).toEqual(new Set(['signature', 'basic', 'enclosure', 'figure']));
    expect(parsed.session.formData.signatureImage?.data).toBe('AQID');
    expect(parsed.basicLetter?.data).toEqual(bytes); expect(parsed.files[0]?.data).toEqual(bytes); expect(parsed.figures[0]?.data).toEqual(bytes);
    expect(source).toEqual(before); expect(loadAttachment).not.toHaveBeenCalled(); expect(readAttachment).not.toHaveBeenCalled();
  });

  it.each(['navmc_10274', 'navmc_118_11'] as const)('uses the owned reader for every retained %s signature, including inactive styles', async formType => {
    const source = prepareSessionState(createBlankSession(formType));
    source.documentCategory = 'forms';
    const form = formType === 'navmc_10274' ? source.forms!.navmc10274! : source.forms!.navmc11811!;
    form.signatureBlocks = (['image', 'typed', 'digital'] as const).map((style, index) => ({ name: `Signer ${index}`, statement: '', style, imageRef: ref(`form-${index}`) }));
    const owned = vi.fn(async (_id: string) => bytes.slice(0));
    const draft = await buildDraftFileFromSnapshot(source, Date.now(), owned), parsed = parseDraftFile(draft);
    expect(new Set(owned.mock.calls.map(call => call[0]))).toEqual(new Set(['form-0', 'form-1', 'form-2']));
    const result = formType === 'navmc_10274' ? parsed.session.forms?.navmc10274 : parsed.session.forms?.navmc11811;
    expect(result!.signatureBlocks.map(block => block.image)).toEqual(['AQID', 'AQID', 'AQID']);
    expect(result!.signatureBlocks.every(block => !block.imageRef)).toBe(true);
    expect(loadAttachment).not.toHaveBeenCalled(); expect(readAttachment).not.toHaveBeenCalled();
  });

  it('fails on missing owned signature bytes instead of falling back to global storage', async () => {
    const source = prepareSessionState(createBlankSession());
    source.formData.signatureImage = { name: 'signature.png', size: bytes.byteLength, data: '', fileRef: ref('missing') };
    await expect(buildDraftFileFromSnapshot(source, Date.now(), async () => null)).rejects.toThrow('Signature image could not be read');
    expect(loadAttachment).not.toHaveBeenCalled(); expect(readAttachment).not.toHaveBeenCalled();
  });
});
