import { requestReleaseWorker } from './releaseClient';
import { RUNTIME_BASE } from './releasePaths';

interface CachedOfflineOutputs {
  pdf: boolean;
  wordBytes: number;
}

type UnknownReason = 'uncontrolled' | 'updating-worker' | 'setting-up' | 'storage-unavailable';

export type OfflineOutputStatus =
  | ({ kind: 'verified' } & CachedOfflineOutputs)
  | { kind: 'unknown'; reason: UnknownReason };
const wordFiles = typeof __PANDOC_FILES__ === 'undefined' ? [] : __PANDOC_FILES__;
export const wordOfflineBytes = wordFiles.reduce((total, file) => total + file.bytes, 0);

export function wordAssetUrl(filename: string, buildTime = __BUILD_TIME__): string {
  const url = `${RUNTIME_BASE}lib/pandoc/${filename}`;
  return filename === 'reference.docx' || filename === 'dondocs.lua' ? `${url}?v=${encodeURIComponent(buildTime)}` : url;
}

function serviceWorkerController(): ServiceWorker | null {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
}

async function usableWordResponse(response: Response | undefined, file: (typeof wordFiles)[number]): Promise<boolean> {
  if (!response?.ok) return false;
  const type = response.headers.get('Content-Type') ?? '';
  if (type.includes('text/html') || file.name.endsWith('.js') && !/(?:java|ecma)script/i.test(type)) return false;
  if (!response.headers.get('Content-Encoding') && response.headers.get('Content-Length') === String(file.bytes)) return true;
  return (await response.clone().blob()).size === file.bytes;
}

async function readLegacyOutputStatus(): Promise<CachedOfflineOutputs> {
  const scope = (await navigator.serviceWorker.getRegistration())?.scope;
  // Workbox only caches the shell on a handled navigation. Its engine files
  // may initially come from the network in the uncontrolled first tab.
  const shell = scope && await caches.match(new URL(window.location.href, scope), {
    cacheName: __APP_SHELL_CACHE__,
  });
  const pdf = !!shell && shell.ok && (await Promise.all([
    caches.match(`${RUNTIME_BASE}lib/PdfTeXEngine.js`, { ignoreSearch: true }),
    caches.match(`${RUNTIME_BASE}lib/swiftlatexpdftex.js`, { ignoreSearch: true }),
    caches.match(`${RUNTIME_BASE}lib/swiftlatexpdftex.wasm`, { ignoreSearch: true }),
    caches.match(`${RUNTIME_BASE}lib/texlive/pdftex/10/swiftlatexpdftex.fmt`),
    caches.match(`${RUNTIME_BASE}lib/texlive-packages.js`, { ignoreSearch: true }),
    caches.match(`${RUNTIME_BASE}lib/latex-templates.js?rev=${__LATEX_TEMPLATES_REVISION__}`),
  ])).every(response => response?.ok);
  let wordBytes = 0;
  for (const file of wordFiles) {
    if (await usableWordResponse(await caches.match(wordAssetUrl(file.name), { cacheName: __PANDOC_CACHE__ }), file)) {
      wordBytes += file.bytes;
    }
  }
  return { pdf, wordBytes };
}

export async function readOfflineOutputStatus(): Promise<OfflineOutputStatus> {
  if (typeof caches === 'undefined') return { kind: 'unknown', reason: 'storage-unavailable' };
  const controller = serviceWorkerController();
  if (!controller) return { kind: 'unknown', reason: 'uncontrolled' };
  try {
    if (__RELEASE_ID__) {
      const { canPrepare, pdf, wordBytes } = await requestReleaseWorker<CachedOfflineOutputs & { canPrepare: boolean }>(controller, {
        type: 'GET_OFFLINE_OUTPUT_STATUS', id: __RELEASE_ID__,
      }, 4000);
      return canPrepare ? { kind: 'verified', pdf, wordBytes } : { kind: 'unknown', reason: 'setting-up' };
    }
    return { kind: 'verified', ...await readLegacyOutputStatus() };
  } catch (cause) {
    const outdated = cause instanceof Error && cause.message === 'Unsupported release request';
    return { kind: 'unknown', reason: outdated ? 'updating-worker' : 'storage-unavailable' };
  }
}

export async function prepareWordOffline(onProgress: (bytes: number) => void): Promise<OfflineOutputStatus> {
  const status = await readOfflineOutputStatus();
  if (status.kind !== 'verified' || !wordOfflineBytes) throw new Error('Reopen DonDocs while connected to enable offline preparation.');
  if (status.wordBytes === wordOfflineBytes) return status;
  if (!navigator.onLine) throw new Error('Reconnect to download the missing Word resources.');
  onProgress(status.wordBytes);
  const legacy = __RELEASE_ID__ ? undefined : await caches.open(__PANDOC_CACHE__);
  let bytes = 0;
  for (const file of wordFiles) {
    const url = wordAssetUrl(file.name);
    const existing = await legacy?.match(url);
    if (!await usableWordResponse(existing, file)) {
      if (existing) await legacy?.delete(url);
      const response = await fetch(url).catch(() => undefined);
      if (!response || !await usableWordResponse(response, file)) {
        throw new Error('A Word resource did not finish downloading. Check your connection and try again.');
      }
      // Keep verified bytes available even if Workbox's background cache put
      // has not settled yet. The release worker owns its content-keyed cache.
      if (legacy && !await legacy.match(url)) await legacy.put(url, response);
    }
    bytes += file.bytes;
    onProgress(Math.max(status.wordBytes, bytes));
  }
  const completed = await readOfflineOutputStatus();
  if (completed.kind !== 'verified' || completed.wordBytes !== wordOfflineBytes) throw new Error('The browser could not keep all the Word resources. Reopen DonDocs and try again.');
  return completed;
}
