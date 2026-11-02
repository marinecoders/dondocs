import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadPdfBlob, preOpenWindowForIOS } from '@/utils/downloadPdf';

const payload = new TextEncoder().encode('%PDF-1.7\nDownload delivery fixture\n%%EOF');
const filename = 'training-document.pdf';
const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0 Safari/537.36';
const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const chromeIOS = safari.replace('Version/18.0', 'CriOS/135.0');
const firefoxIOS = safari.replace('Version/18.0', 'FxiOS/135.0');
const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/135.0 Mobile Safari/537.36';
let links: Array<{ href: string; name: string }>;
let blobs: Map<string, Blob>;

function device(userAgent: string) {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints: 0 });
}

beforeEach(() => {
  links = [];
  blobs = new Map();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    const url = `blob:download-test-${blobs.size}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    links.push({ href: this.href, name: this.download });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PDF delivery', () => {
  it.each([['desktop', desktop], ['iOS Safari', safari]])('%s downloads the original bytes and filename, then releases the URL', async (_name, ua) => {
    device(ua);
    vi.useFakeTimers();
    expect(await downloadPdfBlob(new Blob([payload]), filename)).toBe(true);
    expect(links).toHaveLength(1);
    expect(links[0].name).toBe(filename);
    const blob = blobs.get(links[0].href)!;
    expect(blob.type).toBe('application/octet-stream');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(payload);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(links[0].href);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('Android downloads the original bytes through a data URL', async () => {
    device(android);
    expect(await downloadPdfBlob(new Blob([payload]), filename)).toBe(true);
    expect(links).toHaveLength(1);
    expect(links[0].name).toBe(filename);
    expect(links[0].href).toMatch(/^data:application\/octet-stream;base64,/);
    expect(new Uint8Array(Buffer.from(links[0].href.split(',')[1], 'base64'))).toEqual(payload);
  });

  it.each([['Chrome', chromeIOS], ['Firefox', firefoxIOS]])('iOS %s opens the original PDF bytes for saving', async (_name, ua) => {
    device(ua);
    const target = { document: document.implementation.createHTMLDocument(), opener: window, closed: false } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(target);
    expect(await downloadPdfBlob(new Blob([payload]), filename)).toBe(true);
    expect(open).toHaveBeenCalledWith('', '_blank');
    const url = target.document.querySelector('iframe')!.src;
    expect(url).toMatch(/^data:application\/pdf;base64,/);
    expect(new Uint8Array(Buffer.from(url.split(',')[1], 'base64'))).toEqual(payload);
    expect(target.document.querySelector('a')!.download).toBe(filename);
    expect(target.opener).toBeNull();
    expect(links).toHaveLength(0);
  });

  it('uses a tab opened during the iOS click instead of opening another one after compilation', async () => {
    device(chromeIOS);
    const target = { document: document.implementation.createHTMLDocument(), opener: window, closed: false, close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(target);
    expect(preOpenWindowForIOS()).toBe(target);
    expect(target.document.body.textContent).toBe('Preparing your PDF…');
    expect(await downloadPdfBlob(new Blob([payload]), filename, target)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(target.close).not.toHaveBeenCalled();
    expect(target.document.querySelector('iframe')).not.toBeNull();
  });

  it('falls back to downloading when popups are blocked and keeps the editor page open', async () => {
    device(chromeIOS);
    vi.spyOn(window, 'open').mockReturnValue(null);
    const originalLocation = window.location.href;
    expect(await downloadPdfBlob(new Blob([payload]), filename)).toBe(true);
    expect(links).toHaveLength(1);
    expect(links[0].name).toBe(filename);
    expect(links[0].href).toMatch(/^data:application\/octet-stream;base64,/);
    expect(new Uint8Array(Buffer.from(links[0].href.split(',')[1], 'base64'))).toEqual(payload);
    // The old fallback navigated the editor away after 500 ms.
    await new Promise(resolve => setTimeout(resolve, 550));
    expect(window.location.href).toBe(originalLocation);
  });

  it('downloads the file if the prepared tab navigated away during compilation', async () => {
    device(chromeIOS);
    const target = {
      closed: false,
      get document() { throw new DOMException('Cross-origin tab', 'SecurityError'); },
    } as unknown as Window;
    expect(await downloadPdfBlob(new Blob([payload]), filename, target)).toBe(true);
    expect(links).toHaveLength(1);
    expect(links[0].name).toBe(filename);
    expect(new Uint8Array(await blobs.get(links[0].href)!.arrayBuffer())).toEqual(payload);
  });

  it('continues without a prepared tab when browser policy rejects window.open', () => {
    device(chromeIOS);
    vi.spyOn(window, 'open').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    expect(preOpenWindowForIOS()).toBeNull();
  });

  it.each([['Android', android], ['iOS Chrome', chromeIOS]])('%s falls back to a file download when FileReader fails', async (_name, ua) => {
    device(ua);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      this.dispatchEvent(new ProgressEvent('error'));
      // A failed FileReader still emits loadend. It must not try to open a
      // null result, throw, or bypass the fallback.
      this.dispatchEvent(new ProgressEvent('loadend'));
    });
    expect(await downloadPdfBlob(new Blob([payload]), filename)).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(links).toHaveLength(1);
    expect(links[0].name).toBe(filename);
    expect(new Uint8Array(await blobs.get(links[0].href)!.arrayBuffer())).toEqual(payload);
  });
});
