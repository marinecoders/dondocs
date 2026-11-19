import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { assertAssemblyPagesReadable, inspectAssemblyPdf, loadAssemblyPdf, PROTECTED_PDF_LIMITS } from '@/services/pdf/assemblyPdf';
import { PDF_RESOURCE_LIMITS } from '@/services/pdf/validatePdfResources';
import { assembleEndorsement, validateBasicLetter } from '@/services/pdf/assembleEndorsement';
import { mergeEnclosures } from '@/services/pdf/mergeEnclosures';

const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), destroy: vi.fn(), cleanup: vi.fn(), cancel: vi.fn(), render: vi.fn() }));
vi.mock('react-pdf', () => ({ pdfjs: { getDocument: mocks.getDocument } }));
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

beforeEach(async () => {
  vi.restoreAllMocks();
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.destroy.mockResolvedValue(undefined);
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  const png = await fixture('red.png');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob([png], { type: 'image/png' })));
  mocks.getDocument.mockImplementation(() => ({ destroy: mocks.destroy, promise: Promise.resolve({ numPages: 2,
    getPage: async () => ({ cleanup: mocks.cleanup, getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }), render: mocks.render }),
  }) }));
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

  for (const filter of ['DCTDecode', 'DCT']) it(`preserves a real JPEG with ${filter} encoding`, async () => {
    const pdf = await PDFDocument.create(), jpeg = await fixture('red.jpg'), main = await fixture('source.pdf');
    const image = await pdf.embedJpg(jpeg);
    pdf.addPage().drawImage(image, { x: 72, y: 72, width: 300, height: 60 });
    await pdf.flush();
    const stream = pdf.context.lookup(image.ref);
    if (!(stream instanceof PDFRawStream)) throw new Error('The synthetic JPEG stream is missing.');
    stream.dict.set(PDFName.of('Filter'), PDFName.of(filter));
    const bytes = new Uint8Array(await pdf.save()), original = bytes.slice();
    expect(await inspectAssemblyPdf(bytes)).toEqual({ pageCount: 1, pageImages: false });
    expect((await assembleEndorsement(main, bytes)).ok).toBe(true);
    const merged = await mergeEnclosures(main, [{ number: 1, title: 'JPEG source', data: bytes.buffer }]);
    expect(merged.hasErrors).toBe(false);
    const retained = (await PDFDocument.load(merged.pdfBytes)).context.enumerateIndirectObjects().map(([, object]) => object)
      .filter((object): object is PDFRawStream => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
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
      expect(options).toMatchObject({ password: '', isEvalSupported: false, stopAtErrors: true });
      expect(options.data.buffer).not.toBe(source.buffer);
    }
    expect(mocks.render).toHaveBeenCalledTimes(6);
    expect(mocks.cleanup).toHaveBeenCalledTimes(6);
    expect(mocks.destroy).toHaveBeenCalledTimes(3);
    expect(source).toEqual(original);
  });

  it('requires a usable image canvas rather than returning blank protected pages', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await expect(loadAssemblyPdf(await fixture('owner-aes.pdf'))).rejects.toThrow(/cannot prepare protected/);
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
    mocks.getDocument.mockReturnValue({ destroy: mocks.destroy, promise: Promise.resolve({ numPages: PROTECTED_PDF_LIMITS.pages + 1 }) });
    await expect(loadAssemblyPdf(await fixture('owner-aes.pdf'))).rejects.toThrow(/1–50 pages/);
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('rejects invalid geometry and releases the page and worker', async () => {
    mocks.getDocument.mockReturnValue({ destroy: mocks.destroy, promise: Promise.resolve({ numPages: 1, getPage: async () => ({ cleanup: mocks.cleanup, getViewport: () => ({ width: Infinity, height: 792 }) }) }) });
    await expect(loadAssemblyPdf(await fixture('owner-aes.pdf'))).rejects.toThrow(/dimensions/);
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('keeps the rendered crop and rotation dimensions rather than imposing Letter geometry', async () => {
    mocks.getDocument.mockReturnValue({ destroy: mocks.destroy, promise: Promise.resolve({ numPages: 1, getPage: async () => ({ cleanup: mocks.cleanup,
      getViewport: ({ scale }: { scale: number }) => ({ width: 648 * scale, height: 540 * scale }), render: mocks.render }) }) });
    const { pdf } = await loadAssemblyPdf(await fixture('owner-cropped.pdf'));
    expect(pdf.getPage(0).getSize()).toEqual({ width: 648, height: 540 });
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });

  it('stops at the total decoded page-pixel budget and releases the rejected page', async () => {
    mocks.getDocument.mockImplementation(() => ({ destroy: mocks.destroy, promise: Promise.resolve({ numPages: 50,
      getPage: async () => ({ cleanup: mocks.cleanup, getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }), render: mocks.render }),
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
