import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { degrees, PDFBool, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { assertAssemblyPagesReadable, inspectAssemblyPdf, loadAssemblyPdf, PROTECTED_PDF_LIMITS } from '@/services/pdf/assemblyPdf';
import { PDF_RESOURCE_LIMITS } from '@/services/pdf/validatePdfResources';
import { assembleEndorsement, validateBasicLetter } from '@/services/pdf/assembleEndorsement';
import { mergeEnclosures } from '@/services/pdf/mergeEnclosures';
import { addSignatureField } from '@/services/pdf/addSignatureField';

const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), destroy: vi.fn(), cleanup: vi.fn(), cancel: vi.fn(), render: vi.fn() }));
vi.mock('react-pdf', () => ({ pdfjs: { getDocument: mocks.getDocument, AnnotationType: { WIDGET: 20 }, OPS: { paintImageXObject: 85, paintImageXObjectRepeat: 88 } } }));
vi.mock('@/components/pdf/pdfConfig', () => ({ HARDENED_PDF_OPTIONS: { isEvalSupported: false } }));
const fixture = async (name: string) => new Uint8Array(await readFile(`tests/fixtures/permission-pdfs/${name}`));

async function nestedForm(corrupt: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
  const dictionary = { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 612, 792], Resources: {} };
  const inner = pdf.context.register(corrupt
    ? pdf.context.stream(Uint8Array.of(1, 2, 3, 4), { ...dictionary, Filter: 'FlateDecode' })
    : pdf.context.flateStream('1 0 0 rg 72 72 300 50 re f', dictionary));
  const outer = pdf.context.register(pdf.context.flateStream('q /Inner Do Q', {
    ...dictionary, Resources: { XObject: { Inner: inner } },
  }));
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { Outer: outer } }));
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream('q /Outer Do Q')));
  return new Uint8Array(await pdf.save());
}

async function annotatedPdf(flags = 4, subtype = 'Stamp'): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
  page.drawText('Synthetic annotated source');
  const appearance = pdf.context.register(pdf.context.flateStream('1 0 0 rg 0 0 300 60 re f', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 60], Resources: {},
  }));
  page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(pdf.context.obj({
    Type: 'Annot', Subtype: subtype, Rect: [72, 72, 372, 132], AP: { N: appearance }, F: flags,
  }))]));
  return new Uint8Array(await pdf.save());
}

function mockPdfJsPages(numPages: number) {
  mocks.getDocument.mockImplementation(() => ({ destroy: mocks.destroy, promise: Promise.resolve({ getMetadata: async () => ({ info: { IsXFAPresent: false } }), numPages,
    getPage: async () => ({ getAnnotations: async () => [], cleanup: mocks.cleanup, getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }), render: mocks.render }),
  }) }));
}

beforeEach(async () => {
  vi.restoreAllMocks();
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.destroy.mockResolvedValue(undefined);
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  const png = await fixture('red.png');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob([png], { type: 'image/png' })));
  mockPdfJsPages(2);
});

describe('protected PDF assembly', () => {
  it('keeps ordinary PDF pages on the vector path', async () => {
    const source = await fixture('source.pdf'), original = source.slice();
    const loaded = await loadAssemblyPdf(source);
    expect(loaded.pageImages).toBe(false);
    expect(loaded.pdf.getPageCount()).toBe(2);
    expect(mocks.getDocument).not.toHaveBeenCalled();
    expect(source).toEqual(original);
  });

  it('rejects malformed unencrypted page streams before attachment or either assembly path can report success', async () => {
    const corrupt = await PDFDocument.create();
    corrupt.addPage().node.set(PDFName.of('Contents'), corrupt.context.register(
      corrupt.context.stream(Uint8Array.of(1, 2, 3, 4), { Filter: 'FlateDecode' }),
    ));
    const bytes = new Uint8Array(await corrupt.save()), original = bytes.slice(), main = await fixture('source.pdf');
    await expect(inspectAssemblyPdf(bytes)).rejects.toThrow(/page 1 is unreadable/);
    expect(await validateBasicLetter(bytes)).toMatchObject({ ok: false, error: expect.stringMatching(/page 1 is unreadable/) });
    const assembled = await assembleEndorsement(main, bytes);
    expect(assembled).toMatchObject({ ok: false, error: expect.stringMatching(/page 1 is unreadable/) });
    expect(assembled.pdfBytes).toBe(main);
    const merged = await mergeEnclosures(main, [{ number: 1, title: 'Malformed source', data: bytes.buffer }]);
    expect(merged.hasErrors).toBe(true);
    expect(merged.errors[0].error).toMatch(/page 1 is unreadable/);
    expect(bytes).toEqual(original);
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it('rejects a corrupt JPEG instead of accepting an unreadable scanned page', async () => {
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    const image = pdf.context.register(pdf.context.stream(Uint8Array.of(1, 2, 3, 4), {
      Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2,
      ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode',
    }));
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { ScannedPage: image } }));
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream('q /ScannedPage Do Q')));
    const bytes = new Uint8Array(await pdf.save()), original = bytes.slice(), main = await fixture('source.pdf');
    await expect(inspectAssemblyPdf(bytes)).rejects.toThrow(/JPEG.*unreadable/);
    expect(await validateBasicLetter(bytes)).toMatchObject({ ok: false });
    expect((await assembleEndorsement(main, bytes)).ok).toBe(false);
    expect((await mergeEnclosures(main, [{ number: 1, title: 'Unreadable JPEG', data: bytes.buffer }])).hasErrors).toBe(true);
    expect(bytes).toEqual(original);
  });

  it('bounds encoded JPEG dimensions before the decoder can allocate from them', async () => {
    const { JpegImage } = await import('pdfjs-dist/image_decoders/pdf.image_decoders.mjs');
    const parse = vi.spyOn(JpegImage.prototype, 'parse');
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    // The PDF dictionary claims two pixels; the embedded SOF claims 65,535².
    const encoded = Uint8Array.of(255, 216, 255, 192, 0, 17, 8, 255, 255, 255, 255, 3,
      1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217);
    const image = pdf.context.register(pdf.context.stream(encoded, {
      Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2,
      ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode',
    }));
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { Oversized: image } }));
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream('q /Oversized Do Q')));
    await expect(inspectAssemblyPdf(new Uint8Array(await pdf.save()))).rejects.toThrow(/JPEG.*preparation limit/);
    expect(parse).not.toHaveBeenCalled();
  });

  it('includes padded four-component 4x-sampling coefficient buffers in JPEG admission', async () => {
    const { JpegImage } = await import('pdfjs-dist/image_decoders/pdf.image_decoders.mjs');
    const parse = vi.spyOn(JpegImage.prototype, 'parse');
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    // 3000² pixels fit a four-byte estimate, but four full-resolution Int16
    // component buffers with MCU padding exceed the 64 MB stream budget.
    const encoded = Uint8Array.of(255, 216, 255, 192, 0, 20, 8, 11, 184, 11, 184, 4,
      1, 68, 0, 2, 68, 0, 3, 68, 0, 4, 68, 0, 255, 217);
    const image = pdf.context.register(pdf.context.stream(encoded, {
      Type: 'XObject', Subtype: 'Image', Width: 3000, Height: 3000,
      ColorSpace: 'DeviceCMYK', BitsPerComponent: 8, Filter: 'DCTDecode',
    }));
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { Sampled: image } }));
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream('q /Sampled Do Q')));
    await expect(inspectAssemblyPdf(new Uint8Array(await pdf.save()))).rejects.toThrow(/JPEG.*preparation limit/);
    expect(parse).not.toHaveBeenCalled();
  });

  it('rejects failed image dependencies even when the renderer resolves successfully', async () => {
    mocks.getDocument.mockImplementation(() => ({ destroy: mocks.destroy, promise: Promise.resolve({ getMetadata: async () => ({ info: { IsXFAPresent: false } }), numPages: 1,
      getPage: async () => ({ getAnnotations: async () => [], cleanup: mocks.cleanup, render: mocks.render,
        getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
        getOperatorList: async () => ({ fnArray: [85], argsArray: [['failed-image', 2, 2]] }),
        objs: { get: (_id: string, ready: (value: null) => void) => ready(null) },
      }),
    }) }));
    await expect(loadAssemblyPdf(await fixture('owner-aes.pdf'))).rejects.toThrow(/image.*could not be decoded/);
    expect(mocks.render).toHaveBeenCalledOnce();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('cancels while an image dependency is unresolved and releases the worker', async () => {
    const waiting = vi.fn();
    mocks.getDocument.mockImplementation(() => ({ destroy: mocks.destroy, promise: Promise.resolve({ getMetadata: async () => ({ info: { IsXFAPresent: false } }), numPages: 1,
      getPage: async () => ({ getAnnotations: async () => [], cleanup: mocks.cleanup, render: mocks.render,
        getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
        getOperatorList: async () => ({ fnArray: [85], argsArray: [['pending-image', 2, 2]] }),
        objs: { get: waiting },
      }),
    }) }));
    const controller = new AbortController();
    const pending = loadAssemblyPdf(await fixture('owner-aes.pdf'), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(waiting).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalled();
  });

  it.each([4, 36])('includes printable annotation appearances as images for enclosure embedding (flags %i)', async flags => {
    const bytes = await annotatedPdf(flags), original = bytes.slice(), main = await fixture('source.pdf');
    expect(await inspectAssemblyPdf(bytes)).toMatchObject({ pageImages: true, imageCopyReason: 'annotations' });
    expect((await mergeEnclosures(main, [{ number: 1, title: 'Annotated enclosure', data: bytes.buffer }])).hasErrors).toBe(false);
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ intent: 'print' }));
    expect(bytes).toEqual(original);
  });

  it('preserves printable Link appearances rather than treating them as link metadata', async () => {
    const bytes = await annotatedPdf(4, 'Link'), original = bytes.slice();
    expect(await inspectAssemblyPdf(bytes)).toMatchObject({ pageImages: true, imageCopyReason: 'annotations' });
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ intent: 'print' }));
    expect(bytes).toEqual(original);
  });

  it.each(['owner-saved-field.pdf', 'owner-saved-field-opaque.pdf'])('uses only parsed appearance metadata for encrypted valued fields (%s)', async name => {
    mocks.getDocument.mockImplementation(() => ({ destroy: mocks.destroy, promise: Promise.resolve({
      numPages: 1, getMetadata: async () => ({ info: { IsXFAPresent: false } }),
      getPage: async () => ({ cleanup: mocks.cleanup, render: mocks.render,
        getAnnotations: async () => [{ annotationType: 20, rect: [30, 250, 330, 290], fieldValue: 'Synthetic saved value', hasAppearance: true }],
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
        getViewport: ({ scale }: { scale: number }) => ({ width: 400 * scale, height: 400 * scale }),
      }),
    }) }));
    const bytes = await fixture(name), original = bytes.slice();
    if (name.includes('opaque')) await expect(inspectAssemblyPdf(bytes)).rejects.toThrow(/cannot verify.*valued printable form field/);
    else expect(await inspectAssemblyPdf(bytes)).toMatchObject({ pageCount: 1, pageImages: true, imageCopyReason: 'permissions' });
    expect(bytes).toEqual(original);
  });

  it.each(['missing', 'needs-update'])('rejects printable form fields with %s appearances before copying or rasterizing', async mode => {
    const pdf = await PDFDocument.load(await annotatedPdf(4, 'Widget'));
    const annotation = pdf.context.lookup(pdf.getPage(0).node.Annots()!.get(0), PDFDict);
    annotation.set(PDFName.of('V'), PDFString.of('Synthetic field value'));
    if (mode === 'missing') annotation.delete(PDFName.of('AP'));
    else pdf.catalog.set(PDFName.of('AcroForm'), pdf.context.obj({ NeedAppearances: PDFBool.True }));
    const bytes = new Uint8Array(await pdf.save()), original = bytes.slice();
    await expect(inspectAssemblyPdf(bytes)).rejects.toThrow(/cannot verify.*valued printable form field/);
    expect(await validateBasicLetter(bytes)).toMatchObject({ ok: false, error: expect.stringContaining('flattened PDF') });
    expect(mocks.getDocument).not.toHaveBeenCalled();
    expect(bytes).toEqual(original);
  });

  it('keeps vector content when an imported unsigned DonDocs widget has nothing to print', async () => {
    const source = await addSignatureField(await fixture('source.pdf'));
    for (const removeAppearance of [false, true]) {
      const pdf = await PDFDocument.load(source);
      const form = pdf.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
      form.set(PDFName.of('NeedAppearances'), PDFBool.True);
      const fields = form.lookup(PDFName.of('Fields')) as import('pdf-lib').PDFArray;
      const signature = pdf.context.lookup(fields.get(0), PDFDict);
      if (removeAppearance) signature.delete(PDFName.of('AP'));
      const bytes = new Uint8Array(await pdf.save());
      expect(await validateBasicLetter(bytes)).toMatchObject({ ok: true, pageCount: 2 });
      const assembled = await assembleEndorsement(await fixture('source.pdf'), bytes);
      expect(assembled.ok).toBe(true);
      expect((await PDFDocument.load(assembled.pdfBytes)).getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    }
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it('detects inherited valued fields but ignores zero-area invisible signature widgets', async () => {
    const pdf = await PDFDocument.load(await annotatedPdf(4, 'Widget'));
    const annotation = pdf.context.lookup(pdf.getPage(0).node.Annots()!.get(0), PDFDict);
    annotation.delete(PDFName.of('AP'));
    annotation.set(PDFName.of('Parent'), pdf.context.obj({ V: PDFString.of('Inherited value') }));
    await expect(inspectAssemblyPdf(new Uint8Array(await pdf.save()))).rejects.toThrow(/valued printable form field/);
    annotation.set(PDFName.of('Rect'), pdf.context.obj([0, 0, 0, 0]));
    expect(await inspectAssemblyPdf(new Uint8Array(await pdf.save()))).toMatchObject({ pageImages: false });
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  for (const packets of [false, true]) it(`rejects nonempty XFA form packets before accepting static fallback pages (array ${packets})`, async () => {
    const pdf = await PDFDocument.load(await fixture('source.pdf'));
    const stream = pdf.context.register(pdf.context.stream('<xfa>Synthetic form value</xfa>'));
    pdf.catalog.set(PDFName.of('AcroForm'), pdf.context.obj({ Fields: [],
      XFA: packets ? ['template', stream] : stream, NeedAppearances: PDFBool.True }));
    const bytes = new Uint8Array(await pdf.save()), original = bytes.slice();
    await expect(inspectAssemblyPdf(bytes)).rejects.toThrow(/XFA.*flattened/);
    expect(await validateBasicLetter(bytes)).toMatchObject({ ok: false, error: expect.stringContaining('XFA') });
    expect(mocks.getDocument).not.toHaveBeenCalled();
    expect(bytes).toEqual(original);
  });

  it('keeps ordinary static AcroForm metadata without XFA or valued widgets supported', async () => {
    const pdf = await PDFDocument.load(await fixture('source.pdf'));
    pdf.catalog.set(PDFName.of('AcroForm'), pdf.context.obj({ Fields: [], NeedAppearances: PDFBool.True }));
    expect(await inspectAssemblyPdf(new Uint8Array(await pdf.save()))).toMatchObject({ pageCount: 2, pageImages: false });
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it('renders printable basic-letter annotations as a separate static derivative', async () => {
    mockPdfJsPages(1);
    const bytes = await annotatedPdf(), main = await fixture('source.pdf'), original = bytes.slice();
    expect(await validateBasicLetter(bytes)).toMatchObject({ ok: true, pageCount: 1, pageImages: true, imageCopyReason: 'annotations' });
    const assembled = await assembleEndorsement(main, bytes);
    expect(assembled.ok).toBe(true);
    const output = await PDFDocument.load(assembled.pdfBytes);
    expect(output.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ intent: 'print' }));
    expect(bytes).toEqual(original);
  });

  for (const [flags, subtype] of [[0, 'Stamp'], [5, 'Stamp'], [6, 'Stamp'], [4, 'Link']] as const) {
    it(`keeps non-printing, hidden or metadata annotations off the image-copy path (${flags}/${subtype})`, async () => {
      const pdf = await PDFDocument.load(await annotatedPdf(flags, subtype));
      if (subtype === 'Link') pdf.context.lookup(pdf.getPage(0).node.Annots()!.get(0), PDFDict).delete(PDFName.of('AP'));
      expect(await inspectAssemblyPdf(new Uint8Array(await pdf.save()))).toMatchObject({ pageImages: false });
      expect(mocks.getDocument).not.toHaveBeenCalled();
    });
  }

  it('copies visual page geometry without imported annotation objects', async () => {
    const upload = await PDFDocument.load(await annotatedPdf(0));
    const page = upload.getPage(0);
    page.setRotation(degrees(90));
    page.setCropBox(12, 18, 450, 650);
    const original = new Uint8Array(await upload.save());
    const owned = original.slice();
    const main = await addSignatureField(await fixture('source.pdf'));
    const enclosure = { number: 1, title: 'Reviewed attachment', data: owned.buffer };
    const results = [
      { result: await assembleEndorsement(main, owned), sourcePage: 0, preservesGeometry: true },
      { result: await mergeEnclosures(main, [enclosure]), sourcePage: 2, preservesGeometry: false },
      { result: await mergeEnclosures(main, [enclosure], undefined, false, [], { preserveReplacementPages: true }), sourcePage: 2, preservesGeometry: true },
    ];
    for (const { result, sourcePage, preservesGeometry } of results) {
      const pdf = await PDFDocument.load(result.pdfBytes);
      expect(pdf.getPageCount()).toBe(3);
      const copied = pdf.getPage(sourcePage);
      expect(copied.node.Annots()?.size() ?? 0).toBe(0);
      expect(pdf.context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFDict
        && object.lookup(PDFName.of('Subtype')) === PDFName.of('Stamp'))).toBe(false);
      if (preservesGeometry) {
        expect(copied.getRotation().angle).toBe(90);
        expect(copied.getCropBox()).toEqual({ x: 12, y: 18, width: 450, height: 650 });
      }
      expect(pdf.getPages().some(outputPage => (outputPage.node.Annots()?.size() ?? 0) > 0)).toBe(true);
    }
    expect(await PDFDocument.load(owned).then(pdf => pdf.getPage(0).node.Annots()?.size())).toBe(1);
    expect(owned).toEqual(original);
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it('rejects a file descriptor where the visual resource graph should contain page data', async () => {
    const pdf = await PDFDocument.load(await fixture('source.pdf'));
    const resource = pdf.context.register(pdf.context.obj({ Type: 'Filespec' }));
    pdf.getPage(0).node.Resources()!.set(PDFName.of('SyntheticResource'), resource);
    const bytes = new Uint8Array(await pdf.save()), original = bytes.slice();
    await expect(inspectAssemblyPdf(bytes)).rejects.toThrow(/unsupported interactive page resources/);
    expect(bytes).toEqual(original);
  });

  it('rejects a corrupt nested Form XObject at every attachment and assembly boundary', async () => {
    const bytes = await nestedForm(true), original = bytes.slice(), main = await fixture('source.pdf');
    await expect(inspectAssemblyPdf(bytes)).rejects.toThrow(/page 1 is unreadable/);
    expect(await validateBasicLetter(bytes)).toMatchObject({ ok: false });
    const assembled = await assembleEndorsement(main, bytes);
    expect(assembled.ok).toBe(false);
    expect(assembled.pdfBytes).toBe(main);
    const merged = await mergeEnclosures(main, [{ number: 1, title: 'Corrupt nested form', data: bytes.buffer }]);
    expect(merged.hasErrors).toBe(true);
    expect(merged.errors[0].error).toMatch(/resource is corrupt/);
    expect(bytes).toEqual(original);
  });

  it('preserves valid nested Form XObjects as vector content', async () => {
    const bytes = await nestedForm(false), main = await fixture('source.pdf');
    expect(await inspectAssemblyPdf(bytes)).toEqual({ pageCount: 1, pageImages: false });
    const assembled = await assembleEndorsement(main, bytes);
    expect(assembled.ok).toBe(true);
    const merged = await mergeEnclosures(main, [{ number: 1, title: 'Valid nested form', data: bytes.buffer }]);
    expect(merged.hasErrors).toBe(false);
    const document = await PDFDocument.load(merged.pdfBytes);
    expect(document.getPageCount()).toBe(3);
    expect(document.context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFRawStream
      && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))).toBe(false);
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it('accepts legal Flate filter aliases in nested vector resources', async () => {
    const working = await PDFDocument.load(await nestedForm(false));
    for (const [, object] of working.context.enumerateIndirectObjects()) {
      if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Filter')) === PDFName.of('FlateDecode')) object.dict.set(PDFName.of('Filter'), PDFName.of('Fl'));
    }
    const bytes = new Uint8Array(await working.save()), original = bytes.slice(), main = await fixture('source.pdf');
    expect(await inspectAssemblyPdf(bytes)).toEqual({ pageCount: 1, pageImages: false });
    expect((await assembleEndorsement(main, bytes)).ok).toBe(true);
    expect((await mergeEnclosures(main, [{ number: 1, title: 'Vector aliases', data: bytes.buffer }])).hasErrors).toBe(false);
    expect(bytes).toEqual(original);
  });

  for (const [filter, indirect] of [['DCTDecode', false], ['DCT', true]] as const) it(`preserves a real JPEG with ${filter} encoding`, async () => {
    const pdf = await PDFDocument.create(), jpeg = await fixture('red.jpg'), main = await fixture('source.pdf');
    const image = await pdf.embedJpg(jpeg);
    pdf.addPage().drawImage(image, { x: 72, y: 72, width: 300, height: 60 });
    await pdf.flush();
    const stream = pdf.context.lookup(image.ref);
    if (!(stream instanceof PDFRawStream)) throw new Error('The synthetic JPEG stream is missing.');
    stream.dict.set(PDFName.of('Filter'), PDFName.of(filter));
    if (indirect) stream.dict.set(PDFName.of('Subtype'), pdf.context.register(PDFName.of('Image')));
    const bytes = new Uint8Array(await pdf.save()), original = bytes.slice();
    expect(await inspectAssemblyPdf(bytes)).toEqual({ pageCount: 1, pageImages: false });
    expect((await assembleEndorsement(main, bytes)).ok).toBe(true);
    const merged = await mergeEnclosures(main, [{ number: 1, title: 'JPEG source', data: bytes.buffer }]);
    expect(merged.hasErrors).toBe(false);
    const retained = (await PDFDocument.load(merged.pdfBytes)).context.enumerateIndirectObjects().map(([, object]) => object)
      .filter((object): object is PDFRawStream => object instanceof PDFRawStream && object.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'));
    expect(retained.some(object => object.getContents().every((value, index) => value === jpeg[index]) && object.getContentsSize() === jpeg.length)).toBe(true);
    expect(bytes).toEqual(original);
  });

  it('stops an expanding compressed resource before accepting it', async () => {
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(new Uint8Array(PDF_RESOURCE_LIMITS.streamBytes + 1))));
    await expect(assertAssemblyPagesReadable(pdf)).rejects.toThrow(/decoded resources exceed/);
  });

  it('bounds nested resource traversal and resolves shared resource cycles once', async () => {
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    page.drawText('Visible vector content');
    const resources = page.node.Resources()!;
    resources.set(PDFName.of('Shared'), pdf.context.register(resources));
    await pdf.flush();
    await expect(assertAssemblyPagesReadable(pdf)).resolves.toBeUndefined();
    let nested = resources;
    for (let depth = 0; depth <= PDF_RESOURCE_LIMITS.depth; depth++) {
      const child = pdf.context.obj({});nested.set(PDFName.of('Nested'), child);nested = child;
    }
    await expect(assertAssemblyPagesReadable(pdf)).rejects.toThrow(/too complex/);
  });

  for (const name of ['owner-aes.pdf', 'owner-rc4.pdf']) it(`renders ${name} into separately owned page images on both paths`, async () => {
    const source = await fixture(name), original = source.slice(), main = await fixture('source.pdf');
    const validation = await validateBasicLetter(source);
    expect(validation).toMatchObject({ ok: true, pageCount: 2, pageImages: true });
    const assembled = await assembleEndorsement(main, source);
    expect(assembled.ok).toBe(true);
    expect((await PDFDocument.load(assembled.pdfBytes)).getPageCount()).toBe(4);
    const merged = await mergeEnclosures(main, [{ number: 1, title: 'Synthetic protected source', data: source.buffer }]);
    expect(merged.hasErrors).toBe(false);
    const delivered = await PDFDocument.load(merged.pdfBytes);
    expect(delivered.getPageCount()).toBe(4);
    // Embedding an unflushed derivative used to drop its pending PNG streams.
    const images = delivered.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
    expect(images.length).toBeGreaterThanOrEqual(2);
    for (const [options] of mocks.getDocument.mock.calls) {
      expect(options).toMatchObject({ password: '', isEvalSupported: false, enableXfa: false, stopAtErrors: true });
      expect(options.data.buffer).not.toBe(source.buffer);
    }
    expect(mocks.render).toHaveBeenCalledTimes(6);
    expect(mocks.cleanup).toHaveBeenCalledTimes(6);
    expect(mocks.destroy).toHaveBeenCalledTimes(3);
    expect(source).toEqual(original);
  });

  it('requires a usable image canvas rather than returning blank protected pages', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await expect(loadAssemblyPdf(await fixture('owner-aes.pdf'))).rejects.toThrow(/cannot prepare PDF/);
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });

  it('rejects opening passwords with an actionable message and releases the worker', async () => {
    mocks.getDocument.mockImplementation(() => ({ destroy: mocks.destroy, promise: Promise.reject(Object.assign(new Error('Password required'), { name: 'PasswordException' })) }));
    const bytes = await fixture('opening-password.pdf'), main = await fixture('source.pdf');
    const result = await validateBasicLetter(bytes);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/opening password/) });
    const assembled = await assembleEndorsement(main, bytes);
    expect(assembled).toMatchObject({ ok: false, error: expect.stringMatching(/opening password/) });
    expect(assembled.pdfBytes).toEqual(main);
    const merged = await mergeEnclosures(main, [{ number: 1, title: 'Opening password', data: bytes.buffer }]);
    expect(merged.hasErrors).toBe(true);
    expect(merged.errors[0].error).toMatch(/opening password/);
    expect(mocks.destroy).toHaveBeenCalledTimes(3);
  });

  it('rejects excessive page counts before rendering', async () => {
    mocks.getDocument.mockReturnValue({ destroy: mocks.destroy, promise: Promise.resolve({ getMetadata: async () => ({ info: { IsXFAPresent: false } }), numPages: PROTECTED_PDF_LIMITS.pages + 1 }) });
    await expect(loadAssemblyPdf(await fixture('owner-aes.pdf'))).rejects.toThrow(/1–50 pages/);
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('rejects invalid geometry and releases the page and worker', async () => {
    mocks.getDocument.mockReturnValue({ destroy: mocks.destroy, promise: Promise.resolve({ getMetadata: async () => ({ info: { IsXFAPresent: false } }), numPages: 1, getPage: async () => ({ getAnnotations: async () => [], cleanup: mocks.cleanup, getViewport: () => ({ width: Infinity, height: 792 }) }) }) });
    await expect(loadAssemblyPdf(await fixture('owner-aes.pdf'))).rejects.toThrow(/dimensions/);
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('keeps the rendered crop and rotation dimensions rather than imposing Letter geometry', async () => {
    mocks.getDocument.mockReturnValue({ destroy: mocks.destroy, promise: Promise.resolve({ getMetadata: async () => ({ info: { IsXFAPresent: false } }), numPages: 1, getPage: async () => ({ getAnnotations: async () => [], cleanup: mocks.cleanup,
      getViewport: ({ scale }: { scale: number }) => ({ width: 648 * scale, height: 540 * scale }),
      getOperatorList: async () => ({ fnArray: [], argsArray: [] }), render: mocks.render }) }) });
    const { pdf } = await loadAssemblyPdf(await fixture('owner-cropped.pdf'));
    expect(pdf.getPage(0).getSize()).toEqual({ width: 648, height: 540 });
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });

  it('stops at the total decoded page-pixel budget and releases the rejected page', async () => {
    mocks.getDocument.mockImplementation(() => ({ destroy: mocks.destroy, promise: Promise.resolve({ getMetadata: async () => ({ info: { IsXFAPresent: false } }), numPages: 50,
      getPage: async () => ({ getAnnotations: async () => [], cleanup: mocks.cleanup, getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
        getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }), render: mocks.render }),
    }) }));
    await expect(loadAssemblyPdf(await fixture('owner-aes.pdf'))).rejects.toThrow(/preparation limit/);
    expect(mocks.render.mock.calls.length).toBeLessThan(50);
    expect(mocks.cleanup.mock.calls.length).toBe(mocks.render.mock.calls.length + 1);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('cancels an active render and releases the worker without modifying source bytes', async () => {
    let fail!: (error: unknown) => void;
    mocks.cancel.mockImplementation(() => fail(new Error('Rendering cancelled')));
    mocks.render.mockReturnValue({ promise: new Promise((_resolve, reject) => { fail = reject; }), cancel: mocks.cancel });
    const source = await fixture('owner-aes.pdf'), original = source.slice(), abort = new AbortController();
    const pending = loadAssemblyPdf(source, abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    abort.abort();
    await rejected;
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(source).toEqual(original);
  });
});
