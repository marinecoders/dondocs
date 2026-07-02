import { pdfjs } from 'react-pdf';

/**
 * Single source of pdf.js configuration for every preview surface (desktop
 * panel and mobile modal). The worker file is vendored at
 * public/lib/pdf.worker.min.mjs and kept in lockstep with react-pdf's nested
 * pdfjs-dist by scripts/sync-pdf-worker.mjs (CI verifies the copy is current).
 *
 * The `?v=` parameter matters: the service worker runtime-caches /lib/* files
 * CacheFirst for 90 days (engine-core-cache-v1), and runtime cache keys
 * include the query string. Without the version stamp, upgrading pdfjs would
 * serve returning users a stale worker against a newer API — the classic
 * "worker version does not match the API" failure.
 */
pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}lib/pdf.worker.min.mjs?v=${pdfjs.version}`;

/**
 * CVE-2024-4367 hardening: pdf.js's optional eval-based font glyph renderer
 * could be coerced into arbitrary JavaScript by a malicious PDF. Our PDFs are
 * self-generated, but enclosures are user-supplied files that get merged into
 * the full-quality preview — so the safe, slightly slower non-eval glyph path
 * is forced everywhere. Defined at module scope so <Document options={...}>
 * receives a referentially stable object (react-pdf reloads the document when
 * `options` changes identity).
 */
export const HARDENED_PDF_OPTIONS = { isEvalSupported: false } as const;

/**
 * Canvas backing-store cap. Retina rendering at full devicePixelRatio is the
 * main memory driver (bytes ~ width² × dpr²); iOS Safari enforces a hard
 * canvas memory budget (~384 MB) that killed the previous naive all-pages
 * renderer there. Capping dpr — lower on iOS — plus page virtualization keeps
 * the mounted-canvas total to a few tens of MB worst case.
 */
export function getDprCap(isIOS: boolean): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(dpr, isIOS ? 1.5 : 2);
}
