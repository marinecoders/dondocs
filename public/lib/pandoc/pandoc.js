/* pandoc.js: JavaScript interface to pandoc.wasm.
   Copyright (c) 2025 Tweag I/O Limited and John MacFarlane. MIT License.

   Interface:

   await convert(options, stdin, files)

   - options is a JavaScript object representing pandoc options: this should
     correspond to the format used in pandoc's default files.
   - stdin is a string or nil
   - files is a JavaScript object whose keys are filenames and whose values
     are the data in the corresponding file, as Blobs.

   The return value is a JavaScript object with 3 properties, stdout,
   stderr, and warnings, all strings. warnings is a JSON-encoded
   version of the warnings produced by pandoc. If the pandoc process
   produces an output file, it will be added to files.

   await query(options)

    - options is a JavaScript object with a 'query' property and in
      some cases a 'format' property. Possible queries include
      'version', 'highlight-styles', 'highlight-languages', 'input-formats',
      'output-formats', 'default-template' (requires 'format'),
      and 'extensions-for-format' (requires 'format').

   The return value is a JavaScript string or in some cases a list
   of strings.
*/

// Air-gap: the WASI shim is vendored locally (public/lib/pandoc/wasi-shim.js,
// a self-contained bundle of @bjorn3/browser_wasi_shim@0.3.0). This import
// used to be a top-level await on a public CDN — on an isolated network the
// whole module (and with it DOCX export) died at load time. Don't name CDN
// hosts even in comments here: check-no-cdn scans shipped text verbatim.
import {
  WASI,
  OpenFile,
  File,
  ConsoleStdout,
  PreopenDirectory,
} from "./wasi-shim.js";

const args = ["pandoc.wasm", "+RTS", "-H64m", "-RTS"];
const env = [];
const fileSystem = new Map();
const fds = [
  new OpenFile(new File(new Uint8Array(), { readonly: true })),
  ConsoleStdout.lineBuffered((msg) => console.log(`[WASI stdout] ${msg}`)),
  ConsoleStdout.lineBuffered((msg) => console.warn(`[WASI stderr] ${msg}`)),
  new PreopenDirectory("/", fileSystem),
];
const options = { debug: false };
const wasi = new WASI(args, env, fds, options);
// Air-gap: pandoc.wasm is vendored same-origin, split into sub-25MiB parts
// (Cloudflare's per-file deploy limit) by scripts/vendor-assets.mjs and
// reassembled here before instantiation. The manifest carries the part list
// and exact sizes, so progress reports against a real total and a truncated
// part (or an error body standing in for one) is caught before
// WebAssembly.instantiate can fail cryptically. Resolved against
// import.meta.url so any BASE_URL deployment works.
const MANIFEST_URL = new URL("./pandoc.wasm.manifest.json", import.meta.url);
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

// Progress reporting hook: consumers (e.g. the DOCX converter UI) can set
// `globalThis.__dondocsPandocProgress` to a function BEFORE importing this
// module. The hook receives events of the form:
//   { kind: "fetch-start" }
//   { kind: "fetch-progress", loaded: number, total: number }  // total may be 0 if unknown
//   { kind: "instantiate-start" }
//   { kind: "ready" }
// Errors inside the hook are swallowed so they never break pandoc loading.
function reportProgress(event) {
  try {
    const hook = globalThis.__dondocsPandocProgress;
    if (typeof hook === "function") hook(event);
  } catch (_err) {
    // Intentionally ignored — progress reporting must not block pandoc init.
  }
}

async function fetchWasmParts() {
  reportProgress({ kind: "fetch-start" });

  const manRes = await fetch(MANIFEST_URL);
  if (!manRes.ok) {
    throw new Error(
      `Failed to fetch pandoc.wasm manifest: HTTP ${manRes.status} ${manRes.statusText}. ` +
      "If developing locally, run `npm run vendor-assets` to stage the parts."
    );
  }
  const { parts, partBytes, totalBytes } = await manRes.json();
  if (
    !Array.isArray(parts) || parts.length === 0 ||
    !Array.isArray(partBytes) || partBytes.length !== parts.length ||
    !Number.isInteger(totalBytes) || totalBytes <= 0
  ) {
    throw new Error("pandoc.wasm.manifest.json is malformed — re-run `npm run vendor-assets`");
  }

  // The manifest gives the exact size upfront, so ONE allocation receives the
  // streamed bytes directly — no chunks[]+merge pass, halving peak memory for
  // a ~58 MB payload.
  const merged = new Uint8Array(totalBytes);
  let loaded = 0;
  // Throttle progress events to roughly once per 64 KB of download to avoid
  // flooding the React render loop on fast connections.
  const EMIT_EVERY = 64 * 1024;
  let nextEmitAt = EMIT_EVERY;

  for (let i = 0; i < parts.length; i++) {
    const response = await fetch(new URL(`./${parts[i]}`, import.meta.url));
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${parts[i]}: HTTP ${response.status} ${response.statusText}`
      );
    }
    const partStart = loaded;

    // Fallback when streaming isn't available (older runtimes / opaque bodies).
    if (!response.body || typeof response.body.getReader !== "function") {
      const buf = new Uint8Array(await response.arrayBuffer());
      if (partStart + buf.byteLength > totalBytes) {
        throw new Error(`${parts[i]} overflows the manifest's totalBytes`);
      }
      merged.set(buf, partStart);
      loaded += buf.byteLength;
      reportProgress({ kind: "fetch-progress", loaded, total: totalBytes });
    } else {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (loaded + value.byteLength > totalBytes) {
          throw new Error(`${parts[i]} overflows the manifest's totalBytes`);
        }
        merged.set(value, loaded);
        loaded += value.byteLength;
        if (loaded >= nextEmitAt) {
          reportProgress({ kind: "fetch-progress", loaded, total: totalBytes });
          nextEmitAt = loaded + EMIT_EVERY;
        }
      }
    }

    // Exact per-part size gate: a truncated download or an HTML error body
    // fails HERE with a named part, not later in instantiate with a cryptic
    // magic-word error.
    const got = loaded - partStart;
    if (got !== partBytes[i]) {
      throw new Error(
        `${parts[i]}: expected ${partBytes[i]} bytes, got ${got} (truncated or error body)`
      );
    }
  }

  if (loaded !== totalBytes) {
    throw new Error(`pandoc.wasm reassembly: expected ${totalBytes} bytes, got ${loaded}`);
  }
  if (!WASM_MAGIC.every((b, i) => merged[i] === b)) {
    throw new Error("pandoc.wasm reassembly failed the magic-byte check (00 61 73 6d)");
  }
  // Final progress tick so the UI can settle at 100%.
  reportProgress({ kind: "fetch-progress", loaded, total: totalBytes });
  return merged.buffer;
}

let wasmBytes = await fetchWasmParts();
reportProgress({ kind: "instantiate-start" });
const { instance } = await WebAssembly.instantiate(wasmBytes, {
  wasi_snapshot_preview1: wasi.wasiImport,
});
// Release the ~58MB reassembled buffer: instantiate has compiled its own copy,
// but this module-scope binding would otherwise retain it for the tab's
// lifetime on top of pandoc's linear memory.
wasmBytes = null;

wasi.initialize(instance);
instance.exports.__wasm_call_ctors();

function memory_data_view() {
  return new DataView(instance.exports.memory.buffer);
}

const argc_ptr = instance.exports.malloc(4);
memory_data_view().setUint32(argc_ptr, args.length, true);
const argv = instance.exports.malloc(4 * (args.length + 1));
for (let i = 0; i < args.length; ++i) {
  const arg = instance.exports.malloc(args[i].length + 1);
  new TextEncoder().encodeInto(
    args[i],
    new Uint8Array(instance.exports.memory.buffer, arg, args[i].length)
  );
  memory_data_view().setUint8(arg + args[i].length, 0);
  memory_data_view().setUint32(argv + 4 * i, arg, true);
}
memory_data_view().setUint32(argv + 4 * args.length, 0, true);
const argv_ptr = instance.exports.malloc(4);
memory_data_view().setUint32(argv_ptr, argv, true);

instance.exports.hs_init_with_rtsopts(argc_ptr, argv_ptr);
reportProgress({ kind: "ready" });

export async function query(options) {
  const opts_str = JSON.stringify(options);
  const opts_bytes = new TextEncoder().encode(opts_str);
  const opts_ptr = instance.exports.malloc(opts_bytes.length);
  new Uint8Array(instance.exports.memory.buffer, opts_ptr, opts_bytes.length)
    .set(opts_bytes);
  // add input files to fileSystem
  fileSystem.clear();
  const out_file = new File(new Uint8Array(), { readonly: false });
  const err_file = new File(new Uint8Array(), { readonly: false });
  fileSystem.set("stdout", out_file);
  fileSystem.set("stderr", err_file);
  instance.exports.query(opts_ptr, opts_bytes.length);

  const err_text = new TextDecoder("utf-8", { fatal: true }).decode(err_file.data);
  if (err_text) console.log(err_text);
  const out_text = new TextDecoder("utf-8", { fatal: true }).decode(out_file.data);
  return JSON.parse(out_text);
}


export async function convert(options, stdin, files) {
  const opts_str = JSON.stringify(options);
  const opts_bytes = new TextEncoder().encode(opts_str);
  const opts_ptr = instance.exports.malloc(opts_bytes.length);
  new Uint8Array(instance.exports.memory.buffer, opts_ptr, opts_bytes.length)
    .set(opts_bytes);
  // add input files to fileSystem
  fileSystem.clear();
  const in_file = new File(new Uint8Array(), { readonly: true });
  const out_file = new File(new Uint8Array(), { readonly: false });
  const err_file = new File(new Uint8Array(), { readonly: false });
  const warnings_file = new File(new Uint8Array(), { readonly: false });
  fileSystem.set("stdin", in_file);
  fileSystem.set("stdout", out_file);
  fileSystem.set("stderr", err_file);
  fileSystem.set("warnings", warnings_file);
  for (const file in files) {
    await addFile(file, files[file], true);
  }
  // add output file if any
  if (options["output-file"]) {
    await addFile(options["output-file"], new Blob(), false);
  }
  // add media file for extracted media
  if (options["extract-media"]) {
    await addFile(options["extract-media"], new Blob(), false);
  }
  if (stdin) {
    in_file.data = new TextEncoder().encode(stdin);
  }
  instance.exports.convert(opts_ptr, opts_bytes.length);

  if (options["output-file"]) {
    files[options["output-file"]] =
       new Blob([fileSystem.get(options["output-file"]).data]);
  }
  if (options["extract-media"]) {
    const mediaFile = fileSystem.get(options["extract-media"]);
    if (mediaFile && mediaFile.data && mediaFile.data.length > 0) {
      files[options["extract-media"]] =
         new Blob([mediaFile.data], { type: 'application/zip' });
    }
  }
  const rawWarnings = new TextDecoder("utf-8", { fatal: true })
                          .decode(warnings_file.data);
  let warnings = [];
  if (rawWarnings) {
    warnings = JSON.parse(rawWarnings);
  }
  return {
    stdout: new TextDecoder("utf-8", { fatal: true }).decode(out_file.data),
    stderr: new TextDecoder("utf-8", { fatal: true }).decode(err_file.data),
    warnings: warnings
  };
}

async function addFile(filename, blob, readonly) {
  const buffer = await blob.arrayBuffer();
  const file = new File(new Uint8Array(buffer), { readonly: readonly });
  fileSystem.set(filename, file);
}
