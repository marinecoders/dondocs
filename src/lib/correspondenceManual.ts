import { z } from 'zod';
import source from '@/data/correspondenceManualSource.json';

export const CORRESPONDENCE_MANUAL = Object.freeze(source);
const section = z.object({
  id: z.string().max(10),
  title: z.string().max(120),
  firstPage: z.number().int().positive(),
  lastPage: z.number().int().positive(),
});
const page = z.object({
  number: z.number().int().positive(),
  label: z.string().max(20),
  section: z.string().max(10),
  text: z.string().max(20_000),
});
const manualSchema = z.object({
  schema: z.literal(1),
  sourceSha256: z.literal(source.sourceSha256),
  sections: z.array(section).length(18),
  pages: z.array(page).length(source.pages),
});

export type CorrespondenceManual = z.infer<typeof manualSchema>;
export interface ManualLocation { chapter?: number; paragraph?: string; query?: string }
export interface ManualMatch { start: number; end: number }
export interface ManualSearchResult { page: number; label: string; section: string; excerpt: string }
const CACHE = 'dondocs-correspondence-manual-v1';

/** The source and text are versioned together; saved drafts never enter this cache. */
export function manualResourceUrl(kind: 'text' | 'pdf'): string {
  const path = kind === 'text' ? source.textPath : source.pdfPath;
  return new URL(`${import.meta.env.BASE_URL || '/'}${path}`, location.origin).href;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}

async function verifiedBytes(response: Response, kind: 'text' | 'pdf', signal: AbortSignal): Promise<Uint8Array> {
  const expected = kind === 'text' ? source.textBytes : source.pdfBytes;
  if (!response.ok || Number(response.headers.get('Content-Length')) > expected) {
    throw new Error('The bundled manual resource is unavailable.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The bundled manual resource could not be read.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > expected) throw new Error('The bundled manual exceeds its expected size.');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const expectedHash = kind === 'text' ? source.textSha256 : source.sourceSha256;
  if (size !== expected || await digest(bytes) !== expectedHash) {
    throw new Error('The bundled manual failed its integrity check. Reconnect and retry.');
  }
  signal.throwIfAborted();
  return bytes;
}

export async function loadManualResource(kind: 'text' | 'pdf', signal: AbortSignal): Promise<{ bytes: Uint8Array; cached: boolean }> {
  const hash = kind === 'text' ? `${source.textSha256}.json` : `${source.sourceSha256}.pdf`;
  // Content-based keys let application releases reuse an unchanged reference.
  const cacheKey = new URL(`/__dd_manual/${hash}`, location.origin).href;
  let cache: Cache | undefined;
  try {
    cache = typeof caches === 'undefined' ? undefined : await caches.open(CACHE);
  } catch { /* Private browsing may disable persistent caching. */ }
  signal.throwIfAborted();
  if (cache) {
    const saved = await cache.match(cacheKey).catch(() => undefined);
    if (saved) {
      try {
        return { bytes: await verifiedBytes(saved, kind, signal), cached: true };
      } catch {
        signal.throwIfAborted();
        await cache.delete(cacheKey).catch(() => {});
      }
    }
  }

  const response = await fetch(manualResourceUrl(kind), { signal, credentials: 'same-origin', redirect: 'error' });
  const bytes = await verifiedBytes(response, kind, signal);
  let cached = false;
  if (cache) {
    try {
      await cache.put(cacheKey, new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': kind === 'text' ? 'application/json' : 'application/pdf' },
      }));
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - 4))) await cache.delete(old);
      cached = true;
    } catch { /* Keep the readable resource when a cache write fails. */ }
  }
  signal.throwIfAborted();
  return { bytes, cached };
}

export function parseCorrespondenceManual(bytes: Uint8Array): CorrespondenceManual {
  const data = manualSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (data.sections[0].firstPage !== 1 || data.sections.at(-1)?.lastPage !== source.pages) {
    throw new Error('Invalid manual chapter range.');
  }
  for (let i = 0; i < data.sections.length; i++) {
    const current = data.sections[i];
    if (current.lastPage < current.firstPage || (i > 0 && current.firstPage !== data.sections[i - 1].lastPage + 1)) {
      throw new Error('Invalid manual chapter range.');
    }
  }
  for (let i = 0; i < data.pages.length; i++) {
    const current = data.pages[i];
    const chapter = data.sections.find(chapter => chapter.id === current.section);
    if (current.number !== i + 1 || !chapter || current.number < chapter.firstPage || current.number > chapter.lastPage) {
      throw new Error('Invalid manual page identity.');
    }
  }
  return data;
}

/** Literal, case-insensitive phrase matching across PDF line breaks. */
export function findManualMatch(text: string, query: string): ManualMatch | undefined {
  const needle = query.trim().replace(/\s+/g, ' ').toLowerCase();
  if (needle.length < 2 || needle.length > 160) return;
  let normalized = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const whitespace = /\s/.test(text[i]);
    if (whitespace && normalized.endsWith(' ')) {
      ends[ends.length - 1] = i + 1;
      continue;
    }
    const value = whitespace ? ' ' : text[i].toLowerCase();
    normalized += value;
    for (let j = 0; j < value.length; j++) {
      starts.push(i);
      ends.push(i + 1);
    }
  }
  const at = normalized.indexOf(needle);
  if (at >= 0) return { start: starts[at], end: ends[at + needle.length - 1] };
}

export function searchCorrespondenceManual(manual: CorrespondenceManual, query: string): { results: ManualSearchResult[]; total: number } {
  const results: ManualSearchResult[] = [];
  let total = 0;
  for (const page of manual.pages) {
    const match = findManualMatch(page.text, query);
    if (!match) continue;
    total++;
    if (results.length < 50) {
      results.push({
        page: page.number,
        label: page.label,
        section: page.section,
        excerpt: page.text.slice(Math.max(0, match.start - 75), match.end + 110).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return { results, total };
}

export function locateManualPage(manual: CorrespondenceManual, location: ManualLocation): { page: number; foundParagraph: boolean } {
  const chapter = manual.sections.find(chapter => chapter.id === String(location.chapter));
  if (!chapter) {
    const query = location.query;
    const match = location.chapter === undefined && query
      ? manual.pages.find(page => findManualMatch(page.text, query))
      : undefined;
    return { page: match?.number ?? 1, foundParagraph: !location.paragraph };
  }
  const pages = manual.pages.filter(page => page.section === chapter.id);
  if (location.paragraph && /^\d{1,3}(?:\.\d{1,3}){0,2}$/.test(location.paragraph)) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${location.paragraph.replaceAll('.', '\\.')}\\.\\s`, 'u');
    const target = pages.find(page => pattern.test(page.text));
    if (target) return { page: target.number, foundParagraph: true };
  }
  if (location.query) {
    const query = location.query;
    const target = pages.find(page => findManualMatch(page.text, query));
    if (target) return { page: target.number, foundParagraph: !location.paragraph };
  }
  return { page: chapter.firstPage, foundParagraph: !location.paragraph };
}
