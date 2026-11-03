import { describe, expect, it } from 'vitest';
import { pandocSupportFileUrl } from '@/services/docx/pandoc-converter';

describe('Word support-file cache keys', () => {
  it.each(['dondocs.lua', 'reference.docx'])('%s bypasses an older build’s CacheFirst entry', (filename) => {
    const previous = pandocSupportFileUrl(filename, '2026-11-02T12:00:00.000Z');
    const current = pandocSupportFileUrl(filename, '2026-11-03T12:00:00.000Z');
    const cache = new Map([[previous, 'old layout']]);
    expect(current).not.toBe(previous);
    expect(cache.has(current)).toBe(false);
    const parsed = new URL(current, 'https://dondocs.test/');
    expect(parsed.pathname).toBe(`/lib/pandoc/${filename}`);
    expect(parsed.searchParams.get('v')).toBe('2026-11-03T12:00:00.000Z');
  });

  it('reuses the same URL within one build for offline access', () => {
    expect(pandocSupportFileUrl('dondocs.lua')).toBe(pandocSupportFileUrl('dondocs.lua', __BUILD_TIME__));
  });
});
