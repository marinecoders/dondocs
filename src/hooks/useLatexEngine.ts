import { useState, useEffect, useCallback, useRef } from 'react';
import { debug } from '@/lib/debug';
import { base64ToUint8Array } from '@/lib/encoding';
import { LATEX } from '@/lib/constants';
import { compileDocument, prepareEngine, LatexCompileError } from '@/services/latex/renderDocument';

// Import the engine class - we'll load these as global scripts
declare global {
  interface Window {
    PdfTeXEngine: new () => PdfTeXEngine;
    LATEX_TEMPLATES: Record<string, string>;
    TEXLIVE_PACKAGES: Array<{ format: number; filename: string; content: string }>;
    TEXLIVE_FONTS: Array<{ format: number; filename: string; content: string }>;
    TEXLIVE_TYPE1_FONTS: Array<{ format: number; filename: string; content: string }>;
    TEXLIVE_VF_FONTS: Array<{ format: number; filename: string; content: string }>;
    SWIFTLATEX_BASE_PATH?: string;
  }
}

interface PdfTeXEngine {
  loadEngine(): Promise<void>;
  isReady(): boolean;
  writeMemFSFile(path: string, content: string | Uint8Array): void;
  makeMemFSFolder(path: string): void;
  setEngineMainFile(path: string): void;
  compileLaTeX(): Promise<{ status: number; pdf?: Uint8Array; log: string }>;
  preloadTexliveFile(format: number, filename: string, content: string | Uint8Array): void;
  setTexliveEndpoint(url: string): void;
}

interface LatexEngineState {
  engine: PdfTeXEngine | null;
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  lastCompileLog: string | null;
}

// Get base path from Vite (handles /dondocs/ in production)
const BASE_PATH = import.meta.env.BASE_URL || '/';

// Helper to dynamically load a script
function loadScript(src: string): Promise<void> {
  // Prepend base path for production builds
  const fullSrc = src.startsWith('/') ? `${BASE_PATH}${src.slice(1)}` : src;

  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (document.querySelector(`script[src="${fullSrc}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = fullSrc;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${fullSrc}`));
    document.head.appendChild(script);
  });
}

export function useLatexEngine() {
  const [state, setState] = useState<LatexEngineState>({
    engine: null,
    isReady: false,
    isLoading: true,
    error: null,
    lastCompileLog: null,
  });

  const engineRef = useRef<PdfTeXEngine | null>(null);
  const initStartedRef = useRef(false);
  // Chain of in-flight compiles. Each call to `compile()` queues its work
  // after whatever's currently pending, so two rapid compiles can never
  // both pass the engine's isReady() check before either flips the Busy
  // flag (the TOCTOU race inside vendor PdfTeXEngine.js — flagged in the
  // perf audit). The chain swallows errors when storing back to the ref
  // so a failed compile doesn't poison the queue, but callers still see
  // the original error via the returned Promise.

  const initEngine = useCallback(async () => {
    // Prevent double initialization in StrictMode
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    debug.time('EngineInit');
    debug.group('Engine', 'LaTeX Engine Initialization');

    try {
      setState((s) => ({ ...s, isLoading: true, error: null }));

      // Load required scripts dynamically
      debug.log('Engine', 'Loading LaTeX engine scripts...');

      // Set base path for Worker to find swiftlatexpdftex.js
      // Remove trailing slash for proper path joining
      window.SWIFTLATEX_BASE_PATH = BASE_PATH.replace(/\/$/, '');
      debug.log('Engine', 'Base path set', { basePath: BASE_PATH });

      // Load PdfTeXEngine first
      debug.time('ScriptLoad');
      await loadScript('/lib/PdfTeXEngine.js');
      debug.log('Engine', 'PdfTeXEngine.js loaded');

      // Load templates and packages
      await Promise.all([
        loadScript('/lib/latex-templates.js?v=12'),
        loadScript('/lib/texlive-packages.js'),
      ]);
      debug.timeEnd('ScriptLoad');

      // No wait needed: each loadScript() resolves on `script.onload`, which
      // fires after the script body has executed. PdfTeXEngine.js declares
      // `var PdfTeXEngine = ...` at top level, so the global is already on
      // `window` by the time onload fires. Same for LATEX_TEMPLATES /
      // TEXLIVE_PACKAGES. The previous 100 ms blind setTimeout was vestigial.
      if (!window.PdfTeXEngine) {
        throw new Error('PdfTeXEngine not loaded - check if /lib/PdfTeXEngine.js exists');
      }

      debug.log('Engine', 'Initializing LaTeX engine...');
      debug.time('EngineLoad');
      const engine = new window.PdfTeXEngine();
      await engine.loadEngine();
      debug.timeEnd('EngineLoad');

      // Set texlive endpoint to correct path (relative to base URL)
      // This tells the Worker where to fetch missing TeX packages from
      const texliveUrl = `${BASE_PATH}lib/texlive/`;
      engine.setTexliveEndpoint(texliveUrl);
      debug.log('Engine', 'TexLive endpoint set', { url: texliveUrl });

      // Gather the assets. This is the half that is genuinely browser-specific:
      // the bundles arrive as globals from <script> tags, the fonts are base64,
      // and the seals come over fetch. A headless host reads all of it from disk.
      debug.time('PreloadPackages');
      const fonts = [
        ...(window.TEXLIVE_FONTS ?? []),
        ...(window.TEXLIVE_TYPE1_FONTS ?? []),
        ...(window.TEXLIVE_VF_FONTS ?? []),
      ].map((f) => ({ format: f.format, filename: f.filename, content: base64ToUint8Array(f.content) }));

      const seals: Record<string, Uint8Array> = {};
      await Promise.all(
        LATEX.SEAL_FILES.map(async (sealFile) => {
          try {
            const response = await fetch(`${BASE_PATH}attachments/${sealFile}`);
            if (response.ok) {
              seals[sealFile] = new Uint8Array(await response.arrayBuffer());
              debug.log('Engine', `Loaded seal: ${sealFile}`);
            } else {
              debug.warn('Engine', `Seal file not found: ${sealFile}`, { status: response.status });
            }
          } catch (err) {
            debug.warn('Engine', `Failed to load seal: ${sealFile}`, err);
          }
        })
      );

      // The order these land in is load-bearing and lives in one place now.
      prepareEngine(engine, {
        packages: window.TEXLIVE_PACKAGES,
        fonts,
        templates: window.LATEX_TEMPLATES,
        seals,
      });
      debug.timeEnd('PreloadPackages');
      debug.log('Engine', 'Filesystem prepared', {
        packages: window.TEXLIVE_PACKAGES?.length ?? 0,
        fonts: fonts.length,
        templates: Object.keys(window.LATEX_TEMPLATES ?? {}).length,
        seals: Object.keys(seals).length,
      });

      engineRef.current = engine;
      debug.timeEnd('EngineInit');
      debug.log('Engine', 'LaTeX engine ready!');
      debug.groupEnd();

      setState({
        engine,
        isReady: true,
        isLoading: false,
        error: null,
        lastCompileLog: null,
      });
    } catch (err) {
      debug.error('Engine', 'Failed to initialize LaTeX engine', err);
      debug.groupEnd();
      initStartedRef.current = false; // Allow retry
      setState({
        engine: null,
        isReady: false,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        lastCompileLog: null,
      });
    }
  }, []);

  const resetEngine = useCallback(async () => {
    debug.log('Engine', 'Resetting engine...');
    initStartedRef.current = false;
    setState((s) => ({ ...s, isReady: false, isLoading: true }));
    await initEngine();
  }, [initEngine]);

  const compile = useCallback(
    async (files: Record<string, string | Uint8Array>): Promise<Uint8Array | null> => {
      // Inner function: the actual compile work. Wrapped in a queue
      // below so two rapid compiles can never both pass isReady() before
      // either flips the worker's Busy flag.
      const doCompile = async (): Promise<Uint8Array | null> => {
      const engine = engineRef.current;
      if (!engine) {
        debug.error('Compile', 'Engine not ready');
        throw new Error('Engine not ready');
      }

      debug.time('Compile');
      debug.log('Compile', 'Starting compilation', { fileCount: Object.keys(files).length });

      // The write -> setMainFile -> compile sequence lives in renderDocument so
      // the headless host runs the identical path. What stays here is the part
      // that is genuinely the hook's: engine lifecycle, React state, and the
      // log analysis below.
      let result: { status: number; log: string };
      try {
        const pdf = await compileDocument(engine, files);
        debug.timeEnd('Compile');
        debug.log('Compile', 'Compilation successful', { pdfSize: pdf.byteLength });
        return pdf;
      } catch (err) {
        debug.timeEnd('Compile');
        if (!(err instanceof LatexCompileError)) { throw err; }

        // A corrupt format file needs the engine rebuilt, not a retry.
        if (err.needsReset) {
          debug.error('Compile', 'Fatal format file error - resetting engine');
          await resetEngine();
          throw new Error('ENGINE_RESET_NEEDED', { cause: err });
        }
        result = { status: err.status, log: err.log };
      }

      // ========== DETAILED ERROR ANALYSIS ==========
      debug.error('Compile', '========== COMPILATION FAILED ==========');

      const logLines = result.log?.split('\n') || [];
      const errorDetails: string[] = [];

      // Find the file that caused the error
      const fileLoadPattern = /\(([^()]+)\)/g;
      const loadedFiles: string[] = [];
      let match;
      while ((match = fileLoadPattern.exec(result.log || '')) !== null) {
        loadedFiles.push(match[1]);
      }
      debug.log('Compile', 'Files loaded before error:', loadedFiles.slice(-10));

      // Find where HTML content appears (indicates bad file fetch)
      const htmlIndex = result.log?.indexOf('<!doctype') ?? -1;
      const htmlLineIndex = result.log?.indexOf('<') ?? -1;
      if (htmlIndex !== -1 || htmlLineIndex !== -1) {
        const contextStart = Math.max(0, (htmlIndex !== -1 ? htmlIndex : htmlLineIndex) - 200);
        const contextEnd = Math.min(result.log?.length || 0, (htmlIndex !== -1 ? htmlIndex : htmlLineIndex) + 100);
        const context = result.log?.substring(contextStart, contextEnd);
        debug.error('Compile', '⚠️ HTML CONTENT DETECTED IN LATEX LOG');
        debug.error('Compile', 'Context around HTML:', context);
        errorDetails.push('HTML content detected in LaTeX log (possible missing package)');

        // Find which file was being loaded when HTML appeared
        const beforeHtml = result.log?.substring(0, htmlIndex !== -1 ? htmlIndex : htmlLineIndex) || '';
        const lastOpenParen = beforeHtml.lastIndexOf('(');
        const lastFile = beforeHtml.substring(lastOpenParen);
        debug.error('Compile', '🔴 FILE THAT RETURNED HTML:', lastFile.substring(0, 100));
      }

      // Extract ALL error-related lines from the log
      // This catches: ! errors, Undefined control sequence, Missing X, LaTeX Error, etc.
      const errorPatterns = [
        /^!/,                           // LaTeX errors start with !
        /Undefined control sequence/i,  // Common error
        /Missing .* inserted/i,         // Missing $ inserted, etc.
        /LaTeX Error/i,                 // LaTeX package errors
        /Fatal error/i,                 // Fatal errors
        /Emergency stop/i,              // Emergency stop
        /Too many/i,                    // Too many errors
        /Runaway/i,                     // Runaway argument
        /File .* not found/i,           // Missing file
        /Package .* Error/i,            // Package errors
      ];

      const errorLines: string[] = [];
      for (let i = 0; i < logLines.length; i++) {
        const line = logLines[i];
        const isErrorLine = errorPatterns.some(pattern => pattern.test(line));
        if (isErrorLine) {
          errorLines.push(line);
          // Also grab the next few lines for context (often contains the actual error location)
          for (let j = 1; j <= 3 && i + j < logLines.length; j++) {
            const nextLine = logLines[i + j];
            // Stop if we hit another error or empty line
            if (nextLine.trim() === '' || nextLine.startsWith('!')) break;
            // Include lines that look like context (l.XX, indented lines, etc.)
            if (nextLine.match(/^l\.\d+/) || nextLine.startsWith(' ') || nextLine.startsWith('\t')) {
              errorLines.push(nextLine);
            }
          }
        }
      }

      if (errorLines.length > 0) {
        debug.error('Compile', 'LaTeX Errors:', errorLines);
        errorDetails.push(...errorLines);
      }

      // Find ALL line error matches (l.XX format)
      const lineErrorMatches = result.log?.matchAll(/l\.(\d+)\s+(.+)/g);
      if (lineErrorMatches) {
        for (const lineMatch of lineErrorMatches) {
          const errorLine = `Error at line ${lineMatch[1]}: ${lineMatch[2]}`;
          if (!errorDetails.includes(errorLine)) {
            debug.error('Compile', errorLine);
            errorDetails.push(errorLine);
          }
        }
      }

      // Show last 20 lines of log for context
      debug.log('Compile', 'Last 20 lines of log:', logLines.slice(-20).join('\n'));

      debug.error('Compile', '========================================');

      // Build formatted error log for display
      const formattedLog = [
        '========== COMPILATION FAILED ==========',
        '',
        'ERRORS FOUND:',
        ...errorDetails.map(e => `  ${e}`),
        '',
        '--- Last 30 lines of LaTeX log ---',
        ...logLines.slice(-30),
        '========================================'
      ].join('\n');

      setState(s => ({ ...s, lastCompileLog: formattedLog }));

      // Create error with details attached so it's immediately available
      const error = new Error('Compilation failed') as Error & { compileLog?: string };
      error.compileLog = formattedLog;
      throw error;
      };
      // Serialization lives with the engine in renderDocument, so every host
      // gets it — not just this one.
      return doCompile();
    },
    [resetEngine]
  );

  // Mount-time engine boot. initEngine() is async and writes engine-status
  // state as it progresses (downloading → loading wasm → ready). There's no
  // event-handler equivalent for "the hook just mounted, kick off the long-
  // running boot sequence" — that's the canonical purpose of effects.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initEngine();
  }, [initEngine]);

  // Wait for engine to be ready (useful after ENGINE_RESET_NEEDED)
  const waitForReady = useCallback(async (timeoutMs = 5000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (engineRef.current?.isReady()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }, []);

  return {
    ...state,
    compile,
    resetEngine,
    waitForReady,
  };
}
