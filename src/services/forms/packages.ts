import { templatePageGeometry } from './geometry';
import { idbFormDefinitions, idbReadAttachment, idbPutAttachment } from '@/lib/documentsDb';
import { formTemplateAttachmentId } from '@/lib/formTemplateAssets';
import { formAssetUrl } from '@/lib/releasePaths';
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
  memory.set(hash, new Uint8Array(bytes));
}
export async function digest(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Template verification requires HTTPS or localhost');
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
const keyFor = (hash: string) => `/__form_assets/${hash}.pdf`;
const urlFor = formAssetUrl;

async function pageDimensionsMatch(bytes: Uint8Array, page: FormDefinition['pages'][number]): Promise<boolean> {
  const pdf = await PDFDocument.load(bytes);
  if (pdf.getPageCount() !== 1) return false;
  const actual = templatePageGeometry(pdf.getPage(0));
  return Math.abs(actual.width - page.width) <= 0.1 && Math.abs(actual.height - page.height) <= 0.1;
}

/** Validate an exact captured page independently of the deployed form catalog. */
export async function validatePackagePage(d: FormDefinition, file: string, bytes: Uint8Array): Promise<void> {
  const page = d.pages.find(page => page.file === file);
  if (!page?.sha256 || await digest(bytes) !== page.sha256) throw new Error(`Template revision mismatch: ${file}`);
  if (!await pageDimensionsMatch(bytes, page)) throw new Error(`Template dimensions mismatch: ${file}`);
}

async function retainTemplateAttachment(hash: string, file: string, bytes: Uint8Array): Promise<void> {
  const id = formTemplateAttachmentId(hash);
  const before = await idbReadAttachment(id);
  if (before.status === 'found') {
    if (await digest(new Uint8Array(before.attachment.data)) !== hash) throw new Error('A retained form template is corrupt. Nothing was opened.');
    return;
  }
  if (before.status !== 'missing') throw new Error('Form template storage could not be read. Nothing was opened.');
  // Add-only writes cannot replace bytes another document or package owns.
  await idbPutAttachment({ id, name: file, type: 'application/pdf', size: bytes.byteLength, data: new Uint8Array(bytes).buffer }, true);
  const retained = await idbReadAttachment(id);
  if (retained.status !== 'found' || await digest(new Uint8Array(retained.attachment.data)) !== hash) throw new Error('The portable form templates could not be retained. Check browser storage and try again.');
}

/** Retain verified imports in the existing attachment store before publishing
 * metadata. Cache Storage is an accelerator; it is not the ownership boundary. */
export async function retainPackagePages(d: FormDefinition, pages: Readonly<Record<string, Uint8Array>>, current: () => boolean = () => true): Promise<boolean> {
  if (Object.keys(pages).length !== d.pages.length) throw new Error('The portable form has missing or unexpected template pages.');
  const owned = new Map<string, Uint8Array>();
  for (const page of d.pages) {
    if (!Object.hasOwn(pages, page.file)) throw new Error(`Template page unavailable: ${page.file}`);
    const bytes = new Uint8Array(pages[page.file]);
    await validatePackagePage(d, page.file, bytes);
    owned.set(page.sha256!, bytes);
  }
  if (!current()) return false;
  for (const page of d.pages) {
    if (!current()) return false;
    await retainTemplateAttachment(page.sha256!, page.file, owned.get(page.sha256!)!);
  }
  if (!current()) return false;
  for (const [hash, bytes] of owned) remember(hash, bytes);
  if (typeof caches === 'undefined') return true;
  let cache: Cache;
  try { cache = await caches.open(CACHE); } catch { return current(); }
  const save = async () => {
    let total = 0;
    for (const key of await cache.keys()) {
      const response = await cache.match(key);
      if (!response) continue;
      // Actual bodies avoid trusting absent, malformed or stale length headers.
      const pathname = typeof key === 'string' ? key : new URL(key.url).pathname;
      if (![...owned.keys()].some(hash => pathname === keyFor(hash))) total += (await response.arrayBuffer()).byteLength;
    }
    for (const bytes of owned.values()) total += bytes.byteLength;
    if (total > MAX_BYTES) throw new Error('Offline form storage is full. Saved revisions will not be removed.');
    for (const [hash, bytes] of owned) {
      if (!current()) return false;
      await cache.put(keyFor(hash), new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.byteLength), 'X-Form-Cached-At': String(Date.now()) } }));
    }
    if (!current()) return false;
    return true;
  };
  try {
    return typeof navigator !== 'undefined' && navigator.locks?.request
      ? await navigator.locks.request(CACHE, save) : await save();
  } catch { return current(); }
}

export async function loadPackagePage(d: FormDefinition, file: string, requireOffline = false): Promise<Uint8Array> {
  const page = d.pages.find(p => p.file === file);
  if (!page?.sha256) throw new Error('Template page has no checksum');
  const hash = page.sha256;
  const hit = memory.get(hash);
  if (hit) {
    if (!await pageDimensionsMatch(hit, page)) throw new Error(`Template dimensions mismatch: ${file}`);
    if (requireOffline) await retainTemplateAttachment(hash, file, hit);
    return new Uint8Array(hit);
  }
  const durable = await idbReadAttachment(formTemplateAttachmentId(hash));
  if (durable.status === 'found') {
    const bytes = new Uint8Array(durable.attachment.data);
    await validatePackagePage(d, file, bytes);
    remember(hash, bytes);
    return bytes;
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
  } catch { cache = null; }
  const response = stored ?? await fetch(urlFor(d.directory, file), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Template page unavailable: ${file}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Public content digests, not authentication secrets.
  // eslint-disable-next-line security/detect-possible-timing-attacks
  if (await digest(bytes) !== hash) throw new Error(`Template revision mismatch: ${file}`);
  if (!await pageDimensionsMatch(bytes, page)) throw new Error(`Template dimensions mismatch: ${file}`);
  if (requireOffline) await retainTemplateAttachment(hash, file, bytes);
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
    } catch { /* Durable imports and offline saves retain independent attachments. */ }
  }
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
    return { file, ...templatePageGeometry(pdf.getPage(0)), sha256: await digest(bytes) };
  }));
  const d = adaptLegacyForm(legacy, pages);
  d.pages = pages;
  d.definitionRevision = await digest(new TextEncoder().encode(JSON.stringify(data)));
  d.templateRevision = await digest(new TextEncoder().encode(JSON.stringify(pages)));
  return d;
}

export async function packageAvailableOffline(d: FormDefinition): Promise<boolean> {
  let cache: Cache | null = null;
  try { cache = typeof caches === 'undefined' ? null : await caches.open(CACHE); } catch { /* Retained attachments remain usable. */ }
  for (const page of d.pages) {
    if (!page.sha256) return false;
    const durable = await idbReadAttachment(formTemplateAttachmentId(page.sha256));
    if (durable.status === 'found') {
      try { await validatePackagePage(d, page.file, new Uint8Array(durable.attachment.data));continue; } catch { return false; }
    }
    const response = await cache?.match(keyFor(page.sha256));
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
  const collect = async () => {
    for (const request of await cache.keys()) {
      const hash = new URL(request.url).pathname.split('/').pop()?.replace('.pdf', '');
      const cachedAt = Number((await cache.match(request))?.headers.get('X-Form-Cached-At') ?? Date.now());
      if (hash && !keep.has(hash) && Date.now() - cachedAt > 86400000) { await cache.delete(request); memory.delete(hash); }
    }
  };
  if (typeof navigator !== 'undefined' && navigator.locks?.request) await navigator.locks.request(CACHE, collect);
  else await collect();
}
