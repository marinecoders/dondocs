/**
 * Pins the compile sequence.
 *
 * The order is load-bearing rather than cosmetic — folders must exist before any
 * write, preloads must be queued before the templates that reference them, and
 * template prefixes must be stripped because `\input{\DocumentType}` resolves at
 * the root. These tests record every call a fake engine receives so a reordering
 * shows up as a failing assertion instead of a font that mysteriously stops
 * loading.
 */
import { describe, it, expect } from 'vitest';
import { prepareEngine, compileDocument, LatexCompileError } from '@/services/latex/renderDocument';
import type { LatexEngine, CompileResult } from '@/services/latex/latexEngine';

type Call =
  | { op: 'mkdir'; path: string }
  | { op: 'write'; path: string }
  | { op: 'preload'; format: number; filename: string }
  | { op: 'main'; path: string }
  | { op: 'compile' };

function fakeEngine(result?: Partial<CompileResult>) {
  const calls: Call[] = [];
  const engine: LatexEngine = {
    isReady: () => true,
    makeMemFSFolder: (path) => { calls.push({ op: 'mkdir', path }); },
    writeMemFSFile: (path) => { calls.push({ op: 'write', path }); },
    preloadTexliveFile: (format, filename) => { calls.push({ op: 'preload', format, filename }); },
    setEngineMainFile: (path) => { calls.push({ op: 'main', path }); },
    compileLaTeX: async () => {
      calls.push({ op: 'compile' });
      return { status: 0, pdf: new Uint8Array([1, 2, 3]), log: '', ...result };
    },
  };
  return { engine, calls };
}

describe('prepareEngine', () => {
  it('creates every folder before it writes anything', () => {
    const { engine, calls } = fakeEngine();
    prepareEngine(engine, { templates: { 'tex/main.tex': 'x' } });

    const lastMkdir = calls.findLastIndex((c) => c.op === 'mkdir');
    const firstWrite = calls.findIndex((c) => c.op === 'write');
    expect(lastMkdir).toBeGreaterThanOrEqual(0);
    expect(firstWrite).toBeGreaterThan(lastMkdir);
  });

  it('queues every preload before the templates that reference them', () => {
    const { engine, calls } = fakeEngine();
    prepareEngine(engine, {
      packages: [{ format: 26, filename: 'geometry.sty', content: 'x' }],
      fonts: [{ format: 3, filename: 'ptmr7t.tfm', content: new Uint8Array([0]) }],
      templates: { 'tex/main.tex': 'x' },
    });

    const lastPreload = calls.findLastIndex((c) => c.op === 'preload');
    const templateWrite = calls.findIndex((c) => c.op === 'write' && c.path === 'main.tex');
    expect(templateWrite).toBeGreaterThan(lastPreload);
  });

  it('strips tex/ and templates/ so \\input{\\DocumentType} resolves at the root', () => {
    const { engine, calls } = fakeEngine();
    prepareEngine(engine, {
      templates: {
        'tex/main.tex': 'x',
        'templates/naval_letter.tex': 'y',
        'letterhead.tex': 'z',
      },
    });

    const written = calls.filter((c) => c.op === 'write').map((c) => c.path);
    expect(written).toContain('main.tex');
    expect(written).toContain('naval_letter.tex');
    expect(written).toContain('letterhead.tex');
    expect(written.some((p) => p.startsWith('tex/') || p.startsWith('templates/'))).toBe(false);
  });

  it('preloads the null stub across every format a package might ask for', () => {
    const { engine, calls } = fakeEngine();
    prepareEngine(engine, {});

    const nullFormats = calls
      .filter((c) => c.op === 'preload' && c.filename === 'null')
      .map((c) => (c as { format: number }).format);
    expect(nullFormats).toEqual([0, 10, 26, 27, 32, 39]);
    // and on the filesystem too, in case a preload lookup misses
    expect(calls.filter((c) => c.op === 'write').map((c) => c.path)).toContain('null.tex');
  });

  it('puts seals under attachments/ where the letterhead expects them', () => {
    const { engine, calls } = fakeEngine();
    prepareEngine(engine, { seals: { 'dow-seal.png': new Uint8Array([0]) } });
    expect(calls.filter((c) => c.op === 'write').map((c) => c.path)).toContain('attachments/dow-seal.png');
  });
});

describe('compileDocument', () => {
  it('writes the files, then sets main, then compiles — in that order', async () => {
    const { engine, calls } = fakeEngine();
    await compileDocument(engine, { 'document.tex': 'x' });

    expect(calls.map((c) => c.op)).toEqual(['write', 'main', 'compile']);
  });

  it('returns the pdf bytes on success', async () => {
    const { engine } = fakeEngine();
    await expect(compileDocument(engine, {})).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('throws rather than resolving empty when no pdf comes back', async () => {
    const { engine } = fakeEngine({ status: 1, pdf: undefined, log: '! Undefined control sequence.' });
    await expect(compileDocument(engine, {})).rejects.toBeInstanceOf(LatexCompileError);
  });

  it('carries the log so the caller can diagnose', async () => {
    const { engine } = fakeEngine({ status: 1, pdf: undefined, log: '! Font OML/cmm/m/it/8=cmmi8 not loadable' });
    await expect(compileDocument(engine, {})).rejects.toMatchObject({ log: expect.stringContaining('cmmi8') });
  });

  it('flags a fatal format error as needing an engine rebuild', async () => {
    const { engine } = fakeEngine({ status: 1, pdf: undefined, log: 'Fatal format file error; I am stymied' });
    await expect(compileDocument(engine, {})).rejects.toMatchObject({ needsReset: true });
  });

  it('refuses to compile on an engine that is not ready', async () => {
    const { engine } = fakeEngine();
    await expect(compileDocument({ ...engine, isReady: () => false }, {})).rejects.toThrow('Engine not ready');
  });
});

describe('compileDocument serialization', () => {
  /** An engine whose compile only settles when we say so, so overlap is observable. */
  function gatedEngine() {
    let inFlight = 0;
    let maxConcurrent = 0;
    const releases: Array<() => void> = [];
    const engine: LatexEngine = {
      isReady: () => true,
      makeMemFSFolder: () => {},
      writeMemFSFile: () => {},
      preloadTexliveFile: () => {},
      setEngineMainFile: () => {},
      compileLaTeX: async () => {
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise<void>((r) => releases.push(r));
        inFlight--;
        return { status: 0, pdf: new Uint8Array([1]), log: '' };
      },
    };
    return { engine, releases, peak: () => maxConcurrent };
  }

  it('never lets two compiles overlap on one engine', async () => {
    const { engine, releases, peak } = gatedEngine();
    const a = compileDocument(engine, {});
    const b = compileDocument(engine, {});
    await new Promise((r) => setTimeout(r, 0));

    // Only the first may have entered compileLaTeX.
    expect(peak()).toBe(1);
    releases.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 0));
    releases.forEach((r) => r());
    await Promise.all([a, b]);
    expect(peak()).toBe(1);
  });

  it('lets a caller see its own failure without poisoning the next', async () => {
    let call = 0;
    const engine: LatexEngine = {
      isReady: () => true,
      makeMemFSFolder: () => {},
      writeMemFSFile: () => {},
      preloadTexliveFile: () => {},
      setEngineMainFile: () => {},
      compileLaTeX: async () => {
        call++;
        return call === 1
          ? { status: 1, log: '! boom', pdf: undefined }
          : { status: 0, pdf: new Uint8Array([9]), log: '' };
      },
    };

    const first = compileDocument(engine, {});
    const second = compileDocument(engine, {});
    await expect(first).rejects.toBeInstanceOf(LatexCompileError);
    await expect(second).resolves.toEqual(new Uint8Array([9]));
  });

  it('keeps separate engines independent', async () => {
    const one = gatedEngine();
    const two = gatedEngine();
    const a = compileDocument(one.engine, {});
    const b = compileDocument(two.engine, {});
    await new Promise((r) => setTimeout(r, 0));

    // Different engines must not queue behind each other.
    expect(one.peak()).toBe(1);
    expect(two.peak()).toBe(1);
    one.releases.forEach((r) => r());
    two.releases.forEach((r) => r());
    await Promise.all([a, b]);
  });
});
