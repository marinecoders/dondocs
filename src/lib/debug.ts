/**
 * Debug Utility for DONDOCS-SECURED
 *
 * Verbosity Levels:
 *   0 = Silent  — no debug output (errors still logged)
 *   1 = Basic   — key milestones, timing summaries, warnings
 *   2 = Verbose — full detail: XML snippets, intermediate values, step-by-step traces
 *
 * Easy access methods:
 * - Keyboard: Ctrl+Shift+D to cycle verbosity (0 → 1 → 2 → 0)
 * - Console: DONDOCS.debug.level(0|1|2)
 *            DONDOCS.debug.silent() / DONDOCS.debug.basic() / DONDOCS.debug.verbose()
 *            DONDOCS.debug.status()
 * - URL: Add ?debug=1 or ?debug=2 to enable for session (?debug=true → level 1)
 * - Persistent: localStorage.setItem('DONDOCS_DEBUG', '1') or '2'
 *
 * Usage in code:
 *   import { debug } from '@/lib/debug';
 *   debug.log('Component', 'message', data);        // level 1+ (basic)
 *   debug.verbose('Component', 'detail', data);      // level 2 only
 *   debug.warn('Component', 'warning message');       // level 1+
 *   debug.error('Component', 'error message', error); // always shown
 *   debug.time('Operation');
 *   debug.timeEnd('Operation');
 */

import { APP_VERSION, GIT_SHA, BUILD_TIME } from '@/lib/version';

type LogLevel = 'log' | 'warn' | 'error' | 'info';

/** Verbosity: 0 = silent, 1 = basic, 2 = verbose */
type Verbosity = 0 | 1 | 2;

interface DebugConfig {
  verbosity: Verbosity;
  categories: Set<string>;
  showTimestamps: boolean;
  showPerformance: boolean;
}

// Check various sources for debug verbosity
function getInitialVerbosity(): Verbosity {
  // 1. Check URL param (highest priority for session)
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const debugParam = urlParams.get('debug');
    if (debugParam === '2') return 2;
    if (debugParam === '1' || debugParam === 'true') return 1;
  }

  // 2. Check localStorage (persistent)
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('DONDOCS_DEBUG');
    if (stored === '2') return 2;
    if (stored === '1' || stored === 'true') return 1;
  }

  // 3. Check if in development mode — default to basic
  if (import.meta.env.DEV) {
    return 1;
  }

  return 0;
}

const config: DebugConfig = {
  verbosity: getInitialVerbosity(),
  categories: new Set<string>(), // Empty = all categories enabled
  showTimestamps: true,
  showPerformance: true,
};

// Performance tracking
const timers: Map<string, number> = new Map();
const metrics: Map<string, number[]> = new Map();

// Styled console output
const styles = {
  log: 'color: #6b7280; font-weight: normal;',
  info: 'color: #3b82f6; font-weight: normal;',
  warn: 'color: #f59e0b; font-weight: bold;',
  error: 'color: #ef4444; font-weight: bold;',
  category: 'color: #8b5cf6; font-weight: bold;',
  timestamp: 'color: #9ca3af; font-size: 10px;',
  performance: 'color: #10b981; font-style: italic;',
};

function formatMessage(level: LogLevel, category: string, message: string): string[] {
  const parts: string[] = [];
  const stylesParts: string[] = [];

  if (config.showTimestamps) {
    const time = new Date().toISOString().slice(11, 23);
    parts.push(`%c[${time}]`);
    stylesParts.push(styles.timestamp);
  }

  parts.push(`%c[${category}]`);
  stylesParts.push(styles.category);

  parts.push(`%c${message}`);
  stylesParts.push(styles[level]);

  return [parts.join(' '), ...stylesParts];
}

/** Check if category should log at basic level (1+) */
function shouldLog(category: string): boolean {
  if (config.verbosity < 1) return false;
  if (config.categories.size === 0) return true; // All categories enabled
  return config.categories.has(category);
}

/** Check if category should log at verbose level (2) */
function shouldLogVerbose(category: string): boolean {
  if (config.verbosity < 2) return false;
  if (config.categories.size === 0) return true;
  return config.categories.has(category);
}

export const debug = {
  // --- Core logging methods (level 1+) ---
  log(category: string, message: string, ...data: unknown[]): void {
    if (!shouldLog(category)) return;
    const [formatted, ...logStyles] = formatMessage('log', category, message);
    console.log(formatted, ...logStyles, ...data);
  },

  info(category: string, message: string, ...data: unknown[]): void {
    if (!shouldLog(category)) return;
    const [formatted, ...logStyles] = formatMessage('info', category, message);
    console.info(formatted, ...logStyles, ...data);
  },

  warn(category: string, message: string, ...data: unknown[]): void {
    if (!shouldLog(category)) return;
    const [formatted, ...logStyles] = formatMessage('warn', category, message);
    console.warn(formatted, ...logStyles, ...data);
  },

  error(category: string, message: string, ...data: unknown[]): void {
    // Always log errors, even at verbosity 0
    const [formatted, ...logStyles] = formatMessage('error', category, message);
    console.error(formatted, ...logStyles, ...data);
  },

  // --- Verbose logging (level 2 only) ---
  /** Log detailed/verbose info — only shown at verbosity level 2 */
  verbose(category: string, message: string, ...data: unknown[]): void {
    if (!shouldLogVerbose(category)) return;
    const [formatted, ...logStyles] = formatMessage('log', category, `[verbose] ${message}`);
    console.log(formatted, ...logStyles, ...data);
  },

  /** Log a verbose group (collapsed) — level 2 only */
  verboseGroup(category: string, label: string, fn: () => void): void {
    if (!shouldLogVerbose(category)) return;
    console.groupCollapsed(`%c[${category}] ${label}`, styles.category);
    fn();
    console.groupEnd();
  },

  /** Log verbose data table — level 2 only */
  verboseTable(category: string, label: string, data: unknown): void {
    if (!shouldLogVerbose(category)) return;
    console.log(`%c[${category}] ${label}:`, styles.category);
    console.table(data);
  },

  // --- Performance timing (level 1+) ---
  time(label: string): void {
    if (config.verbosity < 1 || !config.showPerformance) return;
    timers.set(label, performance.now());
  },

  timeEnd(label: string): number {
    const start = timers.get(label);
    if (!start) {
      if (config.verbosity >= 1) {
        console.warn(`Timer '${label}' does not exist`);
      }
      return 0;
    }

    const duration = performance.now() - start;
    timers.delete(label);

    // Track metrics
    if (!metrics.has(label)) {
      metrics.set(label, []);
    }
    metrics.get(label)!.push(duration);

    if (config.verbosity >= 1 && config.showPerformance) {
      console.log(
        `%c⏱ ${label}: ${duration.toFixed(2)}ms`,
        styles.performance
      );
    }

    return duration;
  },

  // --- Group logging (level 1+) ---
  group(category: string, label: string): void {
    if (!shouldLog(category)) return;
    console.group(`%c[${category}] ${label}`, styles.category);
  },

  groupEnd(): void {
    if (config.verbosity < 1) return;
    console.groupEnd();
  },

  // --- Table logging (level 1+) ---
  table(category: string, data: unknown): void {
    if (!shouldLog(category)) return;
    console.log(`%c[${category}] Data:`, styles.category);
    console.table(data);
  },

  // --- State inspection (level 2) ---
  inspect(category: string, label: string, obj: unknown): void {
    if (!shouldLogVerbose(category)) return;
    console.log(`%c[${category}] ${label}:`, styles.category);
    console.dir(obj, { depth: 4 });
  },

  // --- Verbosity level control ---
  /** Set verbosity: 0 = silent, 1 = basic, 2 = verbose */
  level(v: Verbosity): void {
    config.verbosity = v;
    const labels = ['Silent (0)', 'Basic (1)', 'Verbose (2)'];
    const colors = ['#6b7280', '#10b981', '#f59e0b'];
    localStorage.setItem('DONDOCS_DEBUG', String(v));
    console.log(
      `%c🔧 DONDOCS Verbosity: ${labels[v]}`,
      `color: ${colors[v]}; font-weight: bold; font-size: 14px;`
    );
    if (v > 0) {
      console.log('Use DONDOCS.debug.help() for available commands');
    }
  },

  /** Set to level 0 — silent (only errors) */
  silent(): void { debug.level(0); },
  /** Set to level 1 — basic milestones and timing */
  basic(): void { debug.level(1); },
  /** Set to level 2 — full verbose detail */
  verbose2(): void { debug.level(2); },

  // Legacy compat — enable() sets level 1, disable() sets level 0
  enable(): void { debug.level(1); },
  disable(): void { debug.level(0); },

  /** Cycle verbosity: 0 → 1 → 2 → 0 */
  toggle(): void {
    const next = ((config.verbosity + 1) % 3) as Verbosity;
    debug.level(next);
  },

  status(): void {
    const labels = ['Silent (0)', 'Basic (1)', 'Verbose (2)'];
    console.log('%c📊 DONDOCS Debug Status', 'color: #8b5cf6; font-weight: bold; font-size: 14px;');
    console.table({
      verbosity: labels[config.verbosity],
      categories: config.categories.size === 0 ? 'All' : [...config.categories].join(', '),
      showTimestamps: config.showTimestamps,
      showPerformance: config.showPerformance,
      environment: import.meta.env.DEV ? 'Development' : 'Production',
    });
  },

  // --- Filter by category ---
  only(...categories: string[]): void {
    config.categories = new Set(categories);
    console.log(`%c🔍 Filtering to categories: ${categories.join(', ')}`, styles.info);
  },

  all(): void {
    config.categories.clear();
    console.log('%c🔍 Showing all categories', styles.info);
  },

  // --- Performance metrics ---
  metrics(): void {
    console.log('%c📈 Performance Metrics', 'color: #10b981; font-weight: bold; font-size: 14px;');
    const metricsData: Record<string, { avg: string; min: string; max: string; count: number }> = {};

    metrics.forEach((times, label) => {
      if (times.length > 0) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);
        metricsData[label] = {
          avg: `${avg.toFixed(2)}ms`,
          min: `${min.toFixed(2)}ms`,
          max: `${max.toFixed(2)}ms`,
          count: times.length,
        };
      }
    });

    if (Object.keys(metricsData).length === 0) {
      console.log('No metrics recorded yet');
    } else {
      console.table(metricsData);
    }
  },

  clearMetrics(): void {
    metrics.clear();
    console.log('%c🗑 Metrics cleared', styles.info);
  },

  // --- Help ---
  help(): void {
    console.log(`
%c🔧 DONDOCS Debug Commands
%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

%cVerbosity Levels:%c
  DONDOCS.debug.level(0)     - Silent: errors only
  DONDOCS.debug.level(1)     - Basic: milestones, timing, warnings
  DONDOCS.debug.level(2)     - Verbose: full detail, XML, intermediates
  DONDOCS.debug.silent()     - Shortcut for level(0)
  DONDOCS.debug.basic()      - Shortcut for level(1)
  DONDOCS.debug.verbose2()   - Shortcut for level(2)
  DONDOCS.debug.toggle()     - Cycle: 0 → 1 → 2 → 0
  DONDOCS.debug.status()     - Show current status

%cFilter Categories:%c
  DONDOCS.debug.only('DOCX', 'LaTeX')  - Only show specific categories
  DONDOCS.debug.all()                   - Show all categories

%cPerformance:%c
  DONDOCS.debug.metrics()      - Show performance metrics
  DONDOCS.debug.clearMetrics() - Clear recorded metrics

%cKeyboard Shortcut:%c
  Ctrl+Shift+D - Cycle verbosity (0 → 1 → 2 → 0)

%cURL Parameter:%c
  ?debug=1  Basic logging     ?debug=2  Verbose logging

%cCategories:%c
  LaTeX, Store, PDF, DOCX, UI, Engine, Compile, Error
`,
      'color: #8b5cf6; font-weight: bold; font-size: 16px;',
      'color: #6b7280;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;'
    );
  },

  // --- State accessors ---
  get isEnabled(): boolean {
    return config.verbosity >= 1;
  },

  get verbosityLevel(): Verbosity {
    return config.verbosity;
  },
};

// TexLive debugging helpers
const texlive = {
  // Fetch summary from dev server (only works in development)
  async summary(): Promise<void> {
    try {
      const res = await fetch('/__texlive_summary');
      if (!res.ok) {
        console.log('%c[texlive] Summary only available in development mode', 'color: #f59e0b');
        return;
      }
      const data = await res.json();

      console.log('%c\n📦 TeX Live Request Summary', 'color: #10b981; font-weight: bold; font-size: 14px');
      console.log('%c────────────────────────────', 'color: #6b7280');

      console.log(`%c✓ Served: ${data.servedCount} files`, 'color: #10b981');
      console.log(`%c✗ Missing: ${data.missingCount} files`, 'color: #ef4444');

      if (data.missing.length > 0) {
        console.log('%c\nMissing files (returned 301):', 'color: #ef4444; font-weight: bold');
        data.missing.forEach((f: string) => console.log(`  - ${f}`));
        console.log('%c\nTo add missing files, copy them to public/lib/texlive/pdftex/<format>/', 'color: #6b7280');
      }

      if (data.served.length > 0) {
        console.groupCollapsed('%cServed files (click to expand)', 'color: #10b981');
        data.served.forEach((f: string) => console.log(`  ✓ ${f}`));
        console.groupEnd();
      }

      console.log('%c────────────────────────────\n', 'color: #6b7280');
    } catch (err) {
      console.error('[texlive] Failed to fetch summary:', err);
    }
  },

  // Show help
  help(): void {
    console.log(`
%c📦 TeX Live Debug Commands%c

  DONDOCS.texlive.summary()  - Show all requested files and which are missing
  DONDOCS.texlive.help()     - Show this help

%cVite Terminal shows real-time logs:%c
  ✓ 200  file → served     (file exists)
  ✗ 301  file → MISSING    (file not found, pdfTeX will fallback)
  ✓ STUB file → stub       (known stub file served)

%cFormat numbers:%c
  3  = tfm (font metrics)    26 = tex (source)
  4  = type1 (pfb fonts)     27 = sty (style)
  10 = cfg (config)          28 = cls (class)
  11 = map (font map)        32 = def (definitions)
  33 = vf (virtual font)     39 = clo (class options)
`,
      'color: #10b981; font-weight: bold; font-size: 14px',
      'color: inherit',
      'color: #f59e0b; font-weight: bold',
      'color: inherit',
      'color: #3b82f6; font-weight: bold',
      'color: inherit'
    );
  }
};

// Expose to window for console access
declare global {
  interface Window {
    DONDOCS: {
      debug: typeof debug;
      texlive: typeof texlive;
      /** Semver from package.json (e.g. "1.2.0") */
      version: string;
      /** Short git commit SHA of the deployed build (e.g. "a3f9c2b") */
      sha: string;
      /** ISO-8601 build timestamp */
      buildTime: string;
    };
  }
}

if (typeof window !== 'undefined') {
  window.DONDOCS = {
    debug,
    texlive,
    version: APP_VERSION,
    sha: GIT_SHA,
    buildTime: BUILD_TIME,
  };

  // Keyboard shortcut: Ctrl+Shift+D
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      debug.toggle();
    }
  });

  // Show startup message if verbosity > 0
  if (config.verbosity >= 1) {
    const levelLabel = config.verbosity === 2 ? 'Verbose (2)' : 'Basic (1)';
    console.log(
      `%c🔧 DONDOCS Debug: ${levelLabel} %c(Ctrl+Shift+D to cycle)`,
      'color: #10b981; font-weight: bold; font-size: 12px;',
      'color: #6b7280; font-size: 10px;'
    );
    console.log(
      '%c📦 TeX Live debugging: %cDONDOCS.texlive.help()',
      'color: #3b82f6; font-size: 11px;',
      'color: #6b7280; font-size: 11px;'
    );
  }
}

export default debug;
