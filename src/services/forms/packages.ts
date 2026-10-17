import { idbFormDefinitions } from '@/lib/documentsDb';
import { PDFDocument } from 'pdf-lib';
import { adaptLegacyForm, compileFormDefinition, type FormDefinition } from './model';
import type { FormConfig } from '@/types/formConfig';

const CACHE = 'dondocs-form-packages-v1';
const MAX_BYTES = 100 * 1024 * 1024;
const memory = new Map<string, Uint8Array>();
function remember(hash: string, bytes: Uint8Array) {
  if (bytes.byteLength > 20 * 1024 * 1024) return;
  let size = bytes.byteLength;
  for (const value of memory.values()) size += value.byteLength;
  if (size > 20 * 1024 * 1024) memory.clear();
  memory.set(hash, bytes);
}
export async function digest(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Template verification requires HTTPS or localhost');
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
const keyFor = (hash: string) => `/__form_assets/${hash}.pdf`;
const urlFor = (directory: string, file: string) => `/templates/${directory.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(file)}`;

async function pageDimensionsMatch(bytes: Uint8Array, page: FormDefinition['pages'][number]): Promise<boolean> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPageCount() === 1 && Math.abs(pdf.getPage(0).getWidth() - page.width) <= 0.1 && Math.abs(pdf.getPage(0).getHeight() - page.height) <= 0.1;
}

export async function loadPackagePage(d: FormDefinition, file: string, requireOffline = false): Promise<Uint8Array> {
  const page = d.pages.find(p => p.file === file);
  if (!page?.sha256) throw new Error('Template page has no checksum');
  const hash = page.sha256;
  const hit = memory.get(hash);
  if (hit && !requireOffline) {
    if (!await pageDimensionsMatch(hit, page)) throw new Error(`Template dimensions mismatch: ${file}`);
    return hit;
  }
  let cache: Cache | null = null;
  let stored: Response | undefined;
  try {
    cache = typeof caches !== 'undefined' ? await caches.open(CACHE) : null;
    stored = await cache?.match(keyFor(hash));
    if (stored && (!stored.ok || await digest(new Uint8Array(await stored.clone().arrayBuffer())) !== hash)) {
      stored = undefined;
      await cache?.delete(keyFor(hash));
    }
  } catch (error) { if (requireOffline) throw error; cache = null; }
  const response = stored ?? await fetch(urlFor(d.directory, file), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Template page unavailable: ${file}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Public content digests, not authentication secrets.
  // eslint-disable-next-line security/detect-possible-timing-attacks
  if (await digest(bytes) !== hash) throw new Error(`Template revision mismatch: ${file}`);
  if (!await pageDimensionsMatch(bytes, page)) throw new Error(`Template dimensions mismatch: ${file}`);
  if (cache && !stored) {
    const save = async () => {
      const keys = await cache.keys();
      let total = bytes.byteLength;
      for (const key of keys) total += Number((await cache.match(key))?.headers.get('Content-Length') ?? MAX_BYTES);
      if (total > MAX_BYTES) throw new Error('Offline form storage is full. Saved revisions will not be removed.');
      await cache.put(keyFor(hash), new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.byteLength), 'X-Form-Cached-At': String(Date.now()) } }));
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.locks?.request) await navigator.locks.request(CACHE, save);
      else await save();
    } catch (error) { if (requireOffline) throw error; }
  }
  if (!cache && requireOffline) throw new Error('Offline storage is unavailable');
  remember(hash, bytes);
  return bytes;
}

export async function loadDefinition(directory: string): Promise<FormDefinition> {
  const response = await fetch(urlFor(directory, 'form.json'));
  if (!response.ok) throw new Error(`Form definition unavailable: ${response.status}`);
  const data = await response.json();
  if (data.schemaVersion === 2) {
    const d = compileFormDefinition(data);
    if (d.directory !== directory || d.pages.some(p => !p.sha256)) throw new Error('Published form has invalid asset references');
    return d;
  }
  const legacy = data as FormConfig;
  const pages = await Promise.all(legacy.pages.map(async file => {
    const res = await fetch(urlFor(directory, file), { cache: 'no-store' });
    if (!res.ok) throw new Error(`Missing template: ${file}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() !== 1) throw new Error('Template assets must contain one page');
    return { file, width: pdf.getPage(0).getWidth(), height: pdf.getPage(0).getHeight(), sha256: await digest(bytes) };
  }));
  const d = adaptLegacyForm(legacy, pages);
  d.pages = pages;
  d.definitionRevision = await digest(new TextEncoder().encode(JSON.stringify(data)));
  d.templateRevision = await digest(new TextEncoder().encode(JSON.stringify(pages)));
  return d;
}

export async function packageAvailableOffline(d: FormDefinition): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  const cache = await caches.open(CACHE);
  for (const page of d.pages) {
    if (!page.sha256) return false;
    const response = await cache.match(keyFor(page.sha256));
    if (!response?.ok) return false;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await digest(bytes) !== page.sha256) return false;
    try { if (!await pageDimensionsMatch(bytes, page)) return false; } catch { return false; }
  }
  return true;
}

export async function removeUnusedPackages(definitions: FormDefinition[]): Promise<void> {
  if (typeof caches === 'undefined') return;
  const persisted = await idbFormDefinitions();
  if (persisted === null) return;
  const keep = new Set([...definitions, ...persisted].flatMap(d => d.pages.map(p => p.sha256)));
  const cache = await caches.open(CACHE);
  for (const request of await cache.keys()) {
    const hash = new URL(request.url).pathname.split('/').pop()?.replace('.pdf', '');
    const cachedAt = Number((await cache.match(request))?.headers.get('X-Form-Cached-At') ?? Date.now());
    if (hash && !keep.has(hash) && Date.now() - cachedAt > 86400000) { await cache.delete(request); memory.delete(hash); }
  }
}
