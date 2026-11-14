import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { inspectRasterImage, prepareDocxImages, signatureExtent, type DocxImageSource } from '@/services/docx/imageAssets';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { useDocumentStore } from '@/stores/documentStore';
import { persistAttachment } from '@/lib/attachments';
import { buildDraftFile, parseDraftFile } from '@/lib/draftFile';
import { documentTextFields, projectCapturedOutput } from '@/lib/documentFields';
import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { validateLetter } from '../../companion/validateLetter';
import { toStore } from '../../companion/letterInput';
import { configSchema } from '../../companion/defaults';
import { businessFigureFile, figureFile } from '@/lib/figures';
import { docxImageFixture } from '../_helpers/docxImageFixture';

const ref = (id: string, type = 'image/png') => ({ id, name: `${id}.png`, type, size: 1 });
function source(): DocxImageSource {
  return { docType: 'business_letter', formData: { signatureType: 'image', signatureImage: { name: 'signature.png', size: 1, data: '', fileRef: ref('signature') } },
    paragraphs: [{ text: 'Training layout', level: 0, figure: { fileRef: ref('figure'), name: 'figure.png', type: 'image/png', width: 1, height: 1000 } }] };
}

describe('Word image preparation', () => {
  it.each(['information_memorandum', 'joint_letter', 'joint_memorandum', 'moa', 'mou', 'i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'])('does not decode retained inactive %s signature data for PDF', docType => {
    const store = { ...useDocumentStore.getState().getSnapshot(), docType,
      formData: { signatureType: 'image' as const, signatureImage: { name: 'retained.png', size: 4, data: 'invalid!' } } };
    expect(generateAllLatexFiles(store).signatureImage).toBeUndefined();
    expect(store.formData.signatureImage.data).toBe('invalid!');
  });

  it('does not decode retained image data after selecting a typed-only signature', () => {
    const store = { ...useDocumentStore.getState().getSnapshot(), formData: {
      signatureType: 'none' as const, signatureImage: { name: 'retained.png', size: 4, data: 'invalid!' },
    } };
    expect(generateAllLatexFiles(store).signatureImage).toBeUndefined();
    expect(store.formData.signatureImage.data).toBe('invalid!');
  });
  it('keeps flat-TeX image names explicit and plain-text-only exports unchanged', () => {
    const store = { ...useDocumentStore.getState().getSnapshot(), docType: 'business_letter', formData: { signatureType: 'none' as const }, paragraphs: [{ text: 'Plain letter', level: 0 }] };
    const tex = generateFlatLatex(store);
    expect(tex).toContain('Plain letter');
    expect(tex).not.toContain('{signature.png}');
    expect(tex).not.toContain('{figure-');
  });
  it('loads captured assets and uses actual dimensions without external paths', async () => {
    const images = await docxImageFixture();
    const model = source();
    const seen: string[] = [];
    const media = await prepareDocxImages(model, async id => { seen.push(id); return images[id as 'signature' | 'figure']; });
    expect(seen).toEqual(['signature', 'figure']);
    expect(Object.keys(media)).toHaveLength(2);
    expect(media['signature.png']).toEqual(new Uint8Array(images.signature));
    expect(model.paragraphs[0].figure).toMatchObject({ width: 480, height: 240 });
    expect(signatureExtent(model.formData.signatureImage!.data)).toEqual({ width: 1.5, height: .375 });
    const store = { ...useDocumentStore.getState().getSnapshot(), ...model, documentMode: 'custom' as const };
    const tex = generateFlatLatex(store);
    expect(tex).toContain('width=1.5000in,height=0.3750in');
    expect(tex).toContain('width=6.5000in,height=3.2500in');
    expect(tex).toContain('alt={Training layout}');
    expect(tex).not.toContain('blob:');
    const pdf = generateAllLatexFiles(store);
    expect(pdf.figures).toHaveLength(1);
    expect(pdf.texFiles['body.tex']).toContain(pdf.figures[0].file);
  });

  it.each(['missing', 'corrupt', 'pdf', 'unsupported'] as const)('fails instead of silently omitting %s figure assets', async kind => {
    const images = await docxImageFixture();
    const model = source(); model.formData = {};
    if (kind === 'pdf') model.paragraphs[0].figure!.type = 'application/pdf';
    if (kind === 'unsupported') model.docType = 'naval_letter';
    await expect(prepareDocxImages(model, async () => {
      if (kind === 'missing') throw new Error('gone');
      return kind === 'corrupt' ? new Uint8Array([1, 2, 3]) : images.figure;
    })).rejects.toThrow(/Figure|Word figures/);
  });

  it('includes business figure metadata in content review and captured output in either mode', () => {
    for (const documentMode of ['custom', 'compliant'] as const) {
      const snapshot = { ...useDocumentStore.getState().getSnapshot(), ...source(), documentMode, documentCategory: 'correspondence' as const };
      expect(documentTextFields(snapshot, 'draft').map(field => field.text)).toContain('figure.png');
      const capture = captureDocumentRevision({ documentId: 'images', epoch: 1, editSequence: 1, capturedAt: 1 }, snapshot);
      expect(copyCapturedDocument(projectCapturedOutput(capture)).document.paragraphs[0].figure?.fileRef?.id).toBe('figure');
    }
  });

  it('rejects JPEG bytes mislabeled as PNG rather than trusting dimensions or MIME metadata', async () => {
    const images = await docxImageFixture();
    const model = source(); model.formData = {};
    await expect(prepareDocxImages(model, async () => images.jpeg)).rejects.toThrow('Figure 1');
  });

  it('rejects a JPEG truncated after its dimensions but before its image data', async () => {
    const { jpeg } = await docxImageFixture();
    const scan = jpeg.indexOf(Buffer.from([0xff, 0xda]));
    expect(scan).toBeGreaterThan(0);
    await expect(inspectRasterImage(jpeg.subarray(0, scan), 'image/jpeg')).rejects.toThrow(/JPEG|image/i);
  });

  it('reads a complete JPEG from a nonzero-offset byte view', async () => {
    const { jpeg } = await docxImageFixture();
    const padded = new Uint8Array(jpeg.length + 37);
    padded.set(jpeg, 19);
    await expect(inspectRasterImage(padded.subarray(19, 19 + jpeg.length), 'image/jpeg')).resolves.toEqual({ width: 480, height: 240 });
  });

  it.each(['baseline', 'progressive', 'greyscale', 'cmyk', 'metadata'] as const)('accepts a complete %s JPEG', async kind => {
    const { figure } = await docxImageFixture();
    let image = sharp(figure);
    if (kind === 'greyscale') image = image.toColourspace('b-w');
    if (kind === 'cmyk') image = image.toColourspace('cmyk');
    if (kind === 'metadata') image = image.withMetadata({ orientation: 6 });
    const jpeg = await image.jpeg({ progressive: kind === 'progressive' }).toBuffer();
    await expect(inspectRasterImage(jpeg, 'image/jpeg')).resolves.toEqual({ width: 480, height: 240 });
  });

  it('ignores marker-like bytes inside bounded JPEG metadata segments', async () => {
    const { jpeg } = await docxImageFixture();
    const metadata = Buffer.from([0xff, 0xe3, 0, 8, 0xff, 0xd9, 0xff, 0xda, 0xff, 0xd8]);
    const image = Buffer.concat([jpeg.subarray(0, 2), metadata, jpeg.subarray(2)]);
    await expect(inspectRasterImage(image, 'image/jpeg')).resolves.toEqual({ width: 480, height: 240 });
  });

  it.each(['ending', 'segment-length', 'scan-length', 'zero-width', 'oversized'] as const)('rejects a JPEG with invalid %s', async kind => {
    const { jpeg } = await docxImageFixture();
    let image = Buffer.from(jpeg);
    if (kind === 'ending') image = image.subarray(0, image.length - 2);
    if (kind === 'segment-length') image.writeUInt16BE(0xffff, 4);
    if (kind === 'scan-length') image.writeUInt16BE(2, image.indexOf(Buffer.from([0xff, 0xda])) + 2);
    if (kind === 'zero-width' || kind === 'oversized') {
      const frame = image.indexOf(Buffer.from([0xff, 0xc0]));
      expect(frame).toBeGreaterThan(0);
      image.writeUInt16BE(kind === 'zero-width' ? 0 : 65535, frame + 7);
      if (kind === 'oversized') image.writeUInt16BE(65535, frame + 5);
    }
    await expect(inspectRasterImage(image, 'image/jpeg')).rejects.toThrow(/JPEG|image/i);
  });

  it.each(['graphic', 'paragraph'] as const)('escapes imported %s markings as text in Word and PDF', async target => {
    const images = await docxImageFixture();
    const model = source(); model.formData = {};
    if (target === 'graphic') model.paragraphs[0].figure!.portionMarking = '\\input{private-file}' as never;
    else model.paragraphs[0].portionMarking = '\\input{private-file}' as never;
    await prepareDocxImages(model, async () => images.figure);
    const store = { ...useDocumentStore.getState().getSnapshot(), ...model, documentMode: 'custom' as const };
    expect(generateFlatLatex(store)).not.toContain('\\input{private-file}');
    expect(generateAllLatexFiles(store).texFiles['body.tex']).not.toContain('\\input{private-file}');
    expect(generateFlatLatex(store)).toContain('private-file');
  });

  it('rejects duplicate PNG image headers before decoding even when both use benign dimensions', async () => {
    const { signature } = await docxImageFixture();
    const duplicate = Buffer.concat([signature.subarray(0, 33), signature.subarray(8, 33), signature.subarray(33)]);
    expect(() => signatureExtent(duplicate.toString('base64'))).toThrow('duplicate');
    await expect(inspectRasterImage(duplicate, 'image/png')).rejects.toThrow('duplicate');
  });

  it('rejects animated, truncated, corrupt-checksum and invalid-signature PNG inputs', async () => {
    const { figure } = await docxImageFixture();
    const animation = Buffer.alloc(20); animation.writeUInt32BE(8); animation.write('acTL', 4); animation.writeUInt32BE(1, 8);
    const animated = Buffer.concat([figure.subarray(0, 33), animation, figure.subarray(33)]);
    await expect(inspectRasterImage(animated, 'image/png')).rejects.toThrow('Animated');
    await expect(inspectRasterImage(figure.subarray(0, figure.length - 5), 'image/png')).rejects.toThrow('PNG');
    const badCrc = Buffer.from(figure); badCrc[badCrc.length - 1] ^= 1;
    await expect(inspectRasterImage(badCrc, 'image/png')).rejects.toThrow('checksum');
    const badSignature = Buffer.from(figure); badSignature[4] = 0;
    await expect(inspectRasterImage(badSignature, 'image/png')).rejects.toThrow('valid PNG');
  });

  it('rejects missing and unsupported signature images', async () => {
    await expect(prepareDocxImages({ ...source(), paragraphs: [], formData: { signatureType: 'image' } }, async () => new Uint8Array())).rejects.toThrow('missing');
    await expect(prepareDocxImages({ ...source(), docType: 'joint_letter' }, async () => new Uint8Array())).rejects.toThrow('single-signer');
  });

  it('also stops PDF export when a business figure has no image or carries a PDF page', () => {
    const model = source();
    delete model.paragraphs[0].figure!.fileRef;
    const store = { ...useDocumentStore.getState().getSnapshot(), ...model };
    expect(() => generateAllLatexFiles(store)).toThrow('has no image');
    model.paragraphs[0].figure!.fileRef = ref('pdf', 'application/pdf');
    model.paragraphs[0].figure!.type = 'application/pdf';
    expect(() => generateAllLatexFiles(store)).toThrow('is a PDF');
  });

  it('carries business figure bytes through portable draft export without local handles', async () => {
    const images = await docxImageFixture();
    const fileRef = await persistAttachment({ name: 'figure.png', type: 'image/png', size: images.figure.length }, new Uint8Array(images.figure).buffer);
    const model = source(); model.formData = {};
    model.paragraphs[0].figure!.fileRef = fileRef;
    useDocumentStore.setState({ ...model, documentMode: 'custom', documentCategory: 'correspondence', enclosures: [], references: [] });
    const exported = JSON.parse(JSON.stringify(await buildDraftFile()));
    const parsed = parseDraftFile(exported);
    expect(parsed.figures[0]?.data).toEqual(new Uint8Array(images.figure).buffer);
    expect(parsed.session.paragraphs[0].figure?.fileRef).toBeUndefined();
    expect(JSON.stringify(exported)).not.toContain(fileRef.id);
    expect(useDocumentStore.getState().paragraphs[0].figure?.fileRef?.id).toBe(fileRef.id);
  });
});

describe('companion image inputs', () => {
  it('keeps business PDF names bounded and distinct while leaving ordinary cache names unchanged', () => {
    const normal = 'a'.repeat(32);
    expect(businessFigureFile(1, 'image/png', 'image.png', normal)).toBe(figureFile(1, 'image/png', 'image.png', normal));
    const first = businessFigureFile(1, 'image/png', 'image.png', '../' + 'a'.repeat(97));
    const second = businessFigureFile(1, 'image/png', 'image.png', '../' + 'b'.repeat(97));
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(240);
    expect(first).toMatch(/^attachments\/figure-1-x[a-z2-7]+\.png$/);
    expect(() => businessFigureFile(1, 'image/png', 'image.png', '界'.repeat(100))).toThrow('shorter');
    expect(() => businessFigureFile(1, 'image/png', 'image.png', '\ud800'.repeat(100))).toThrow('Unicode');
  });
  it('does not accept request-scoped image attachment IDs as machine defaults', () => {
    expect(configSchema.safeParse({ signature: { last: 'Example', imageFileId: 'request-only' } }).success).toBe(false);
  });
  it.each(['paragraphs', 'attachments'] as const)('reports non-array %s without throwing', key => {
    expect(validateLetter({ docType: 'business_letter', subject: 'Synthetic', [key]: 'invalid' } as never).join(' ')).toContain('must be an array');
  });
  it('validates signature attachment identity and rejects unused bytes', () => {
    expect(validateLetter({ docType: 'business_letter', subject: 'Synthetic', signature: { imageFileId: 'missing' } }).join(' ')).toContain('missing');
    expect(validateLetter({ docType: 'business_letter', subject: 'Synthetic', attachments: [{ id: 'extra', name: 'extra.png', mimeType: 'image/png', dataBase64: 'AQID' }] }).join(' ')).toContain('not used');
    expect(validateLetter({ docType: 'business_letter', subject: 'Synthetic', signature: { imageFileId: 'sig' }, attachments: [{ id: 'sig', name: 'sig.jpg', mimeType: 'image/jpeg', dataBase64: 'AQID' }] }).join(' ')).toContain('PNG');
  });
  it('uses opaque attachment IDs without turning them or filenames into filesystem paths', async () => {
    const images = await docxImageFixture();
    const input = { docType: 'business_letter', subject: 'Synthetic', paragraphs: [{ text: 'Layout', figure: { fileId: '../../figure', width: 1, height: 1000 } }],
      signature: { imageFileId: '../signature' }, attachments: [
        { id: '../../figure', name: '../../figure.png', mimeType: 'image/png', dataBase64: images.figure.toString('base64') },
        { id: '../signature', name: '../../signature.png', mimeType: 'image/png', dataBase64: images.signature.toString('base64') },
      ] } as const;
    const data = JSON.parse(JSON.stringify(input));
    expect(validateLetter(data)).toEqual([]);
    const store = toStore(data);
    const media = await prepareDocxImages(store, async id => Buffer.from(data.attachments.find((file: { id: string }) => file.id === id).dataBase64, 'base64'));
    expect(Object.keys(media).every(path => /^[A-Za-z0-9.-]+$/.test(path) && !path.includes('..'))).toBe(true);
    expect(store.paragraphs[0].figure?.width).toBe(480);
  });
});
