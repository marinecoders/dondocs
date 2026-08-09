/**
 * The narrow port both LaTeX hosts satisfy.
 *
 * The browser drives `public/lib/PdfTeXEngine.js`, which cannot be imported into
 * Node — it reaches for `window.SWIFTLATEX_BASE_PATH`, `document.currentScript`,
 * the DOM `Worker`, and `URL.createObjectURL`. A headless host therefore has to
 * talk the worker protocol directly.
 *
 * The two are the same protocol at different levels: `preloadTexliveFile` is
 * literally `postMessage({cmd:'preloadtex', ...})`. So this interface is the
 * shape they already share, which lets `renderDocument()` hold the compile
 * sequence once instead of each host restating it. The vendored engine class
 * satisfies it structurally, with no edit to the vendored asset.
 */
export interface LatexEngine {
  isReady(): boolean;
  makeMemFSFolder(path: string): void;
  writeMemFSFile(path: string, content: string | Uint8Array): void;
  preloadTexliveFile(format: number, filename: string, content: string | Uint8Array): void;
  setEngineMainFile(path: string): void;
  compileLaTeX(): Promise<CompileResult>;
}

export interface CompileResult {
  status: number;
  pdf?: Uint8Array;
  log: string;
}

/** A texlive member preloaded before compiling, as `texlive-packages.js` ships them. */
export interface TexlivePackage {
  format: number;
  filename: string;
  content: string | Uint8Array;
}

/**
 * The folders the engine expects before any file is written. Re-exported from
 * the canonical list rather than restated, so the two cannot drift.
 */
export { MEMFS_DIRECTORIES as ENGINE_FOLDERS } from '@/config/paths';

/**
 * Templates arrive keyed by their repo path (`tex/main.tex`,
 * `templates/naval_letter.tex`) but the engine's filesystem is flat — and
 * `\input{\DocumentType}` resolves against the root, so a doc-type template that
 * kept its prefix would never be found.
 */
export function stripTemplatePrefix(path: string): string {
  const withoutTex = path.startsWith('tex/') ? path.slice(4) : path;
  return withoutTex.startsWith('templates/') ? withoutTex.slice(10) : withoutTex;
}
