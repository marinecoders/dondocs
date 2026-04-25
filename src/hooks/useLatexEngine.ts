import { useState, useEffect, useCallback, useRef } from 'react';
import { debug } from '@/lib/debug';
import { base64ToUint8Array } from '@/lib/encoding';
import { LATEX } from '@/lib/constants';

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
  const compileQueueRef = useRef<Promise<unknown>>(Promise.resolve());

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
        loadScript('/lib/latex-templates.js?v=11'),
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

      // Create virtual filesystem directories
      for (const dir of LATEX.MEMFS_DIRECTORIES) {
        engine.makeMemFSFolder(dir);
      }
      debug.log('Engine', 'Virtual filesystem directories created', { dirs: LATEX.MEMFS_DIRECTORIES });

      // Preload TeX Live packages (text files like .cls, .sty, .cfg)
      debug.time('PreloadPackages');
      if (window.TEXLIVE_PACKAGES) {
        debug.log('Engine', `Preloading ${window.TEXLIVE_PACKAGES.length} TeX Live packages...`);
        for (const pkg of window.TEXLIVE_PACKAGES) {
          engine.preloadTexliveFile(pkg.format, pkg.filename, pkg.content);
        }
      }

      // Preload TFM font metrics (format 3, base64 encoded)
      if (window.TEXLIVE_FONTS) {
        debug.log('Engine', `Preloading ${window.TEXLIVE_FONTS.length} TFM font metrics...`);
        for (const font of window.TEXLIVE_FONTS) {
          const bytes = base64ToUint8Array(font.content);
          engine.preloadTexliveFile(font.format, font.filename, bytes);
        }
      }

      // Preload Type1 fonts (format 4, base64 encoded)
      if (window.TEXLIVE_TYPE1_FONTS) {
        debug.log('Engine', `Preloading ${window.TEXLIVE_TYPE1_FONTS.length} Type1 fonts...`);
        for (const font of window.TEXLIVE_TYPE1_FONTS) {
          const bytes = base64ToUint8Array(font.content);
          engine.preloadTexliveFile(font.format, font.filename, bytes);
        }
      }

      // Preload Virtual fonts (format 2, base64 encoded)
      if (window.TEXLIVE_VF_FONTS) {
        debug.log('Engine', `Preloading ${window.TEXLIVE_VF_FONTS.length} Virtual fonts...`);
        for (const font of window.TEXLIVE_VF_FONTS) {
          const bytes = base64ToUint8Array(font.content);
          engine.preloadTexliveFile(font.format, font.filename, bytes);
        }
      }

      // Preload null stub file - must happen with other preloads (before wait)
      // This prevents 404 errors when LaTeX packages try to \input{null}
      // Only 'null' and 'null.tex' work - tex/ prefixed paths cause FS errors
      const nullStubContent = '% null stub file - prevents 404 errors\n\\endinput\n';
      const nullPaths = ['null', 'null.tex'];
      const nullFormats = [0, 10, 26, 27, 32, 39];
      for (const format of nullFormats) {
        for (const nullPath of nullPaths) {
          engine.preloadTexliveFile(format, nullPath, nullStubContent);
        }
      }
      debug.log('Engine', 'Null stub preloaded', { paths: nullPaths, formats: nullFormats });

      debug.timeEnd('PreloadPackages');

      // No wait needed here either. `preloadTexliveFile` posts a message to
      // the worker, which handles `cmd:'preloadtex'` synchronously
      // (FS.writeFile + cache update — no async work). Worker postMessage
      // queues are FIFO, so any subsequent postMessage we send (writefile
      // for templates, setmainfile, compilelatex) will be processed strictly
      // *after* the preloads it follows. The previous 2000 ms blind
      // setTimeout cost a flat 2 s on every cold start with no functional
      // benefit.

      // Write LaTeX templates
      // Templates are stored with 'tex/' prefix but need to be written to root for SwiftLaTeX
      debug.time('WriteTemplates');
      if (window.LATEX_TEMPLATES) {
        const templateCount = Object.keys(window.LATEX_TEMPLATES).length;
        debug.log('Engine', `Writing ${templateCount} LaTeX templates...`);
        for (const [path, content] of Object.entries(window.LATEX_TEMPLATES)) {
          // Strip 'tex/' prefix if present - SwiftLaTeX expects files in root
          let targetPath = path.startsWith('tex/') ? path.slice(4) : path;
          // Also strip 'templates/' prefix - \input{\DocumentType} expects files at root
          targetPath = targetPath.startsWith('templates/') ? targetPath.slice(10) : targetPath;
          engine.writeMemFSFile(targetPath, content);
        }
      }
      debug.timeEnd('WriteTemplates');

      // Write null stub file to memfs as backup (preloading happened earlier)
      // Some LaTeX packages try to \input{null} - we also write to memfs in case preload fails
      for (const nullPath of nullPaths) {
        engine.writeMemFSFile(nullPath, nullStubContent);
      }
      debug.log('Engine', 'Null stub files written to memfs');

      // Load seal images into virtual filesystem.
      //
      // Fetched in parallel — they're served from the same origin and are
      // independent files, so there's no reason to do four sequential RTTs.
      // Combined with the PNG optimization (~86% size reduction), cold-start
      // network cost on a slow connection drops from seconds to a few hundred
      // milliseconds.
      debug.log('Engine', 'Loading seal images...', { files: LATEX.SEAL_FILES });
      await Promise.all(
        LATEX.SEAL_FILES.map(async (sealFile) => {
          try {
            const response = await fetch(`${BASE_PATH}attachments/${sealFile}`);
            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer();
              engine.writeMemFSFile(`attachments/${sealFile}`, new Uint8Array(arrayBuffer));
              debug.log('Engine', `Loaded seal: ${sealFile}`);
            } else {
              debug.warn('Engine', `Seal file not found: ${sealFile}`, { status: response.status });
            }
          } catch (err) {
            debug.warn('Engine', `Failed to load seal: ${sealFile}`, err);
          }
        })
      );

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
      if (!engine || !engine.isReady()) {
        debug.error('Compile', 'Engine not ready');
        throw new Error('Engine not ready');
      }

      debug.time('Compile');
      debug.log('Compile', 'Starting compilation', { fileCount: Object.keys(files).length });

      // Write all files to virtual filesystem
      for (const [path, content] of Object.entries(files)) {
        debug.log('Compile', `Writing file: ${path}`, {
          size: typeof content === 'string' ? content.length : content.byteLength,
        });
        engine.writeMemFSFile(path, content);
      }

      // Set main file and compile
      engine.setEngineMainFile(LATEX.MAIN_FILE);
      debug.log('Compile', 'Main file set, starting LaTeX compilation...');

      const result = await engine.compileLaTeX();
      debug.timeEnd('Compile');

      debug.log('Compile', 'Compilation result', {
        status: result.status,
        pdfSize: result.pdf?.byteLength,
        logLength: result.log?.length,
      });

      if (result.status === 0 && result.pdf) {
        debug.log('Compile', 'Compilation successful', { pdfSize: result.pdf.byteLength });
        return result.pdf;
      }

      // Check for fatal error requiring reset
      if (result.log?.includes('Fatal format file error')) {
        debug.error('Compile', 'Fatal format file error - resetting engine');
        await resetEngine();
        throw new Error('ENGINE_RESET_NEEDED');
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
      // Chain after any prior compile so engine.compileLaTeX() runs
      // strictly serialized. We strip prior errors with `.catch()`
      // before chaining doCompile so a failed compile doesn't poison
      // the next caller. We then store back a swallowed-error version
      // so the queue keeps moving, but return the original `next` so
      // this caller still sees its own error.
      const next = compileQueueRef.current.catch(() => undefined).then(doCompile);
      compileQueueRef.current = next.catch(() => undefined);
      return next;
    },
    [resetEngine]
  );

  useEffect(() => {
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
