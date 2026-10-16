import 'fake-indexeddb/auto';
import { beforeEach, describe, it, expect } from 'vitest';
import { buildDraftFile, parseDraftFile } from '@/lib/draftFile';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { persistAttachment } from '@/lib/attachments';

beforeEach(() => { useDocumentStore.getState().resetForm(); useDocumentStore.getState().setDocumentCategory('correspondence'); });
describe('portable draft review', () => {
  it('round-trips an enclosure, basic letter and signature without carrying local handles', async () => {
    const data = new Uint8Array([37, 80, 68, 70, 0, 255]).buffer;
    const fileRef = await persistAttachment({ name: 'basic.pdf', size: data.byteLength, type: 'application/pdf' }, data);
    useDocumentStore.setState({
      formData: { docType: 'new_page_endorsement', basicLetterFileRef: fileRef, signatureImage: { name: 'sign.png', size: 3, data: 'YWJj' } },
      docType: 'new_page_endorsement', enclosures: [{ title: 'Report', file: { name: 'report.pdf', size: data.byteLength, data } }],
    });
    const exported = JSON.parse(JSON.stringify(await buildDraftFile()));
    expect(JSON.stringify(exported)).not.toContain(fileRef.id);
    const parsed = parseDraftFile(exported);
    expect(parsed.files[0]?.data).toEqual(data);
    expect(parsed.basicLetter?.data).toEqual(data);
    expect(parsed.session.formData.signatureImage?.data).toBe('YWJj');
  });
  it('exports only the current form and retains local signature images', async () => {
    useDocumentStore.setState({ documentCategory: 'forms', formType: 'navmc_10274' });
    useFormStore.getState().setNavmc10274Field('natureOfAction', 'Portable form');
    useFormStore.getState().setNavmc10274Field('signatureBlocks', [{ name: 'Sample', statement: '', style: 'image', image: 'data:image/png;base64,YWJj' }]);
    useFormStore.getState().setNavmc11811Field('remarksText', 'Unrelated private draft');
    const exported = JSON.parse(JSON.stringify(await buildDraftFile()));
    expect(JSON.stringify(exported)).not.toContain('Unrelated');
    expect(parseDraftFile(exported).session.forms?.navmc10274?.signatureBlocks[0].image).toContain('YWJj');
  });
  it('rejects malformed content before any editor mutation', () => {
    const before = getSerializedSession();
    expect(() => parseDraftFile({ ...before, enclosures: [{ title: 'Broken', file: { name: 'broken.pdf', size: 3, data: {} } }] })).toThrow();
    expect(getSerializedSession().formData).toEqual(before.formData);
  });
});
