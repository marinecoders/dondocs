import { afterEach, expect, it, vi } from 'vitest';
import { prepareFigureUpload } from '@/lib/prepareFigureUpload';
import { validateFigureAsset } from '@/services/latex/figureAssets';

vi.mock('@/services/latex/figureAssets', () => ({ validateFigureAsset: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it('stores an oriented JPEG at its decoded pixel dimensions and releases the bitmap', async () => {
  const bitmap = { width: 900, height: 1600, close: vi.fn() };
  const decode = vi.fn().mockResolvedValue(bitmap);
  const drawImage = vi.fn();
  const converted = new Blob(['normalized pixels'], { type: 'image/jpeg' });
  const convertToBlob = vi.fn().mockResolvedValue(converted);
  const makeCanvas = vi.fn(function (this: object) { return { getContext: () => ({ drawImage }), convertToBlob }; });
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('OffscreenCanvas', makeCanvas);
  const file = new File(['raw EXIF JPEG'], 'phone.jpg', { type: 'image/jpeg' });
  const prepared = await prepareFigureUpload(file);
  expect(decode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
  expect(makeCanvas).toHaveBeenCalledWith(900, 1600);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: .92 });
  expect(prepared).toMatchObject({ width: 900, height: 1600, type: 'image/jpeg' });
  expect(new TextDecoder().decode(prepared.bytes)).toBe('normalized pixels');
  expect(validateFigureAsset).toHaveBeenLastCalledWith(new Uint8Array(prepared.bytes), 'figure.jpg');
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it('keeps PNG transparency and original bytes instead of re-encoding', async () => {
  const bitmap = { width: 640, height: 480, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  const file = new File(['transparent PNG pixels'], 'cutout.png', { type: 'image/png' });
  const prepared = await prepareFigureUpload(file);
  expect(prepared.bytes).toEqual(await file.arrayBuffer());
  expect(prepared).toMatchObject({ width: 640, height: 480, type: 'image/png' });
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it('keeps a validated PDF intact and recognizes JPEGs without a MIME type', async () => {
  const file = new File(['PDF'], 'drawing.pdf', { type: 'application/pdf' });
  const pdf = await prepareFigureUpload(file);
  expect(pdf.bytes).toEqual(await file.arrayBuffer());
  expect(pdf.width).toBeUndefined();
  const bitmap = { width: 100, height: 200, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  vi.stubGlobal('OffscreenCanvas', undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['fallback JPEG'])));
  const jpg = await prepareFigureUpload(new File(['JPEG'], 'phone.JPEG'));
  expect(jpg.type).toBe('image/jpeg');
  expect(new TextDecoder().decode(jpg.bytes)).toBe('fallback JPEG');
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it('releases decoded pixels when encoding fails and refuses a damaged upload before decoding', async () => {
  const bitmap = { width: 100, height: 200, close: vi.fn() };
  const decode = vi.fn().mockResolvedValue(bitmap);
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('OffscreenCanvas', vi.fn(function () { return { getContext: () => null }; }));
  await expect(prepareFigureUpload(new File(['JPEG'], 'phone.jpg'))).rejects.toThrow('Cannot prepare');
  expect(bitmap.close).toHaveBeenCalledOnce();
  vi.mocked(validateFigureAsset).mockRejectedValueOnce(new Error('Cannot read figure'));
  decode.mockClear();
  await expect(prepareFigureUpload(new File(['invalid'], 'bad.png'))).rejects.toThrow('Cannot read figure');
  expect(decode).not.toHaveBeenCalled();
});
