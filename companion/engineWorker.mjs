// SPIKE — worker side. Runs the vendored SwiftLaTeX pdfTeX engine under Node.
//
// The engine is emscripten output built for a Web Worker: it assigns
// `self["onmessage"]` and replies with `self.postMessage`. Node's worker_threads
// gives us an equivalent channel, so this shims the three globals the engine
// reaches for and then loads it unmodified.
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { readFileSync, copyFileSync, mkdtempSync, readdirSync, existsSync, appendFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const LIB = workerData.libDir;

// The engine derives a bucket from LaTeX's format code, but the vendored tree
// files by the code the GENERATOR chose — e.g. it asks for 26/geometry.sty
// (cls/clo) while the file sits in 27 (sty). Index the tree by basename once so
// a lookup resolves regardless of which bucket the request names.
const TEX_ROOT = join(LIB, 'texlive', 'pdftex');
const byName = new Map();
if (existsSync(TEX_ROOT)) {
  for (const bucket of readdirSync(TEX_ROOT)) {
    const dir = join(TEX_ROOT, bucket);
    try {
      for (const f of readdirSync(dir)) if (!byName.has(f)) byName.set(f, join(dir, f));
    } catch { /* not a directory */ }
  }
}
function findTexFile(relPath) {
  // The vendored tree carries saved 404 pages under real font names — a bare
  // "cmmi8" that is 402 bytes of HTML sits next to the genuine cmmi8.tfm. The
  // engine rejects those itself and caches the name as missing, so a candidate
  // is only usable if it is not one of them.
  const usable = (p) => {
    if (!p || !existsSync(p)) return false;
    const fd = openSync(p, 'r');
    const buf = Buffer.alloc(15);
    try { readSync(fd, buf, 0, 15, 0); } finally { closeSync(fd); }
    return !/<!doctype|<html/i.test(buf.toString('latin1'));
  };
  const base = relPath.split('/').pop();
  const candidates = [join(LIB, relPath), byName.get(base)];
  // kpathsea strips the extension for font lookups — it asks for "ptmr7t",
  // the tree holds "ptmr7t.tfm".
  for (const ext of ['.tfm', '.vf', '.pfb', '.enc', '.fd', '.sty', '.cls', '.def', '.cfg']) {
    candidates.push(byName.get(base + ext));
  }
  return candidates.find(usable) || null;
}


// --- the shim -------------------------------------------------------------
// Emscripten detects ENVIRONMENT_IS_NODE and uses require('fs') for the wasm,
// so we only have to supply the Worker-shaped message channel plus locateFile.
globalThis.self = globalThis;
globalThis.postMessage = (msg) => parentPort.postMessage(msg);
globalThis.close = () => process.exit(0);
globalThis.importScripts = () => {};

// The engine does `var Module = {}` unconditionally, so a preset Module is
// discarded — wasmBinary/locateFile cannot be injected. Shim fetch instead and
// resolve the engine's relative URLs against the vendored lib dir, which leaves
// swiftlatexpdftex.js byte-identical to what the browser loads.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (/^https?:/i.test(url)) return realFetch(input, init);
  const rel = url.replace(/^\.?\//, '').split('?')[0];
  try {
    const buf = readFileSync(join(LIB, rel));
    return new Response(buf, { status: 200 });
  } catch {
    return new Response(null, { status: 404 });
  }
};

// Node has no XHR; the engine uses it to pull texlive packages on demand.
// Serve them from the vendored tree instead, so the spike stays offline.
// With DONDOCS_TEXLIVE_BUNDLE_ONLY set, only the format file is served: that
// is what an offline browser has -- the preloaded bundle and nothing else.
const BUNDLE_ONLY = process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY === '1';
globalThis.XMLHttpRequest = class {
  open(_m, url) { this._url = String(url); }
  get responseType() { return this._rt || ''; }
  set responseType(v) { this._rt = v; }
  setRequestHeader() {}
  overrideMimeType() {}
  getAllResponseHeaders() { return 'content-type: application/octet-stream\r\n'; }
  getResponseHeader(name) {
    // kpathsea asks for the length/type to size its buffer before reading.
    const n = String(name || '').toLowerCase();
    if (n === 'content-type') return 'application/octet-stream';
    if (n === 'content-length') return String(this.response ? this.response.byteLength || this.response.length || 0 : 0);
    return null;
  }
  send() {
    parentPort.postMessage({ spike: 'xhr', url: this._url });
    try {
      // Keep the FULL relative path — the engine asks for
      // texlive/pdftex/10/swiftlatexpdftex.fmt and the vendored tree is nested
      // exactly that way. Flattening to the basename loses the /10/ segment.
      const rel = this._url.replace(/^\.?\//, '').split('?')[0];
      const hit = BUNDLE_ONLY && !rel.endsWith('.fmt') ? null : findTexFile(rel);
      if (!hit) throw new Error('not found: ' + rel);
      this.response = readFileSync(hit);
      if (this._rt === 'arraybuffer') {
        const b = this.response;
        this.response = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }
      this.status = 200;
    } catch {
      this.status = 404; this.response = null;
    }
    this.readyState = 4;
    if (typeof this.onload === 'function') this.onload();
  }
};

parentPort.on('message', (data) => {
  if (typeof globalThis.self.onmessage === 'function') {
    globalThis.self.onmessage({ data });
  }
});

// Load the engine unmodified; a patched copy would drift from the browser's.
const require = createRequire(import.meta.url);
try {
  // The repo is "type": "module", so a .js sibling is parsed as ESM and the
  // engine's require('fs') explodes. Load it through a .cjs copy; locateFile
  // still points wasm resolution back at public/lib.
  const shim = join(mkdtempSync(join(tmpdir(), 'swiftlatex-')), 'engine.cjs');
  copyFileSync(join(LIB, 'swiftlatexpdftex.js'), shim);
  // The path is a temp file this function just wrote from a vendored, in-repo
  // asset; no user input reaches it.
  // eslint-disable-next-line security/detect-non-literal-require
  require(shim);
  parentPort.postMessage({ spike: 'loaded' });
} catch (err) {
  parentPort.postMessage({ spike: 'loadError', message: String(err && err.stack || err) });
}
