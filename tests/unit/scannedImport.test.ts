import { describe, expect, it, vi } from 'vitest';
vi.mock('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {}, version: 'test' } }));
import { scanDimensions, validateScanFile, SCAN_MAX_BYTES, SCAN_MAX_PIXELS } from '@/lib/scannedImport';

describe('scan import input limits', () => {
  it.each([['scan.pdf', 'application/pdf', 'pdf'], ['photo.JPG', '', 'image'], ['scan.png', 'image/png', 'image']])('supports %s', (name, type, result) => {
    expect(validateScanFile({ name, type, size: 123 })).toBe(result);
  });
  it('rejects empty, oversized and unsupported inputs before decoding', () => {
    expect(() => validateScanFile({ name: 'scan.png', type: '', size: 0 })).toThrow('nonempty');
    expect(() => validateScanFile({ name: 'scan.pdf', type: '', size: SCAN_MAX_BYTES + 1 })).toThrow('20 MB');
    expect(() => validateScanFile({ name: 'scan.svg', type: 'image/svg+xml', size: 12 })).toThrow('PNG');
  });
  it('caps raster dimensions and rejects invalid or excessive images', () => {
    for (const [width, height] of [[1000, 2000], [8000, 9000], [1, 8000]]) {
      const result = scanDimensions(width, height);
      expect(result.width * result.height).toBeLessThanOrEqual(SCAN_MAX_PIXELS + 4000);
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(2600);
    }
    expect(() => scanDimensions(Infinity, 5)).toThrow('dimensions');
    expect(() => scanDimensions(10000, 10000)).toThrow('dimensions');
  });
});
