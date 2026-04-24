/**
 * Single source of truth for app version metadata.
 *
 * All version info in the app flows from here. Do NOT hardcode version
 * strings anywhere else — import from this module instead.
 *
 * Three orthogonal pieces of version info:
 *
 * - APP_VERSION: semver from package.json (human-readable, e.g. "1.2.0").
 *   Bumped manually on meaningful releases. Shown to users.
 *
 * - GIT_SHA: short git commit SHA at build time (e.g. "a3f9c2b").
 *   Auto-generated, no manual step. Granular deploy identifier — use this
 *   to verify whether a specific fix has shipped.
 *
 * - BUILD_TIME: ISO-8601 timestamp of when `vite build` ran.
 *   Auto-generated. Tells you when the deployed bundle was produced.
 *
 * Values are injected by Vite's `define` config at build time. In dev,
 * they reflect the running machine's git state. In production, they are
 * baked into the bundle and match exactly what was deployed.
 *
 * @see vite.config.ts (define block) for the source of each value.
 * @see src/types/build-constants.d.ts for the global declarations.
 */

export const APP_VERSION = __APP_VERSION__;
export const GIT_SHA = __GIT_SHA__;
export const BUILD_TIME = __BUILD_TIME__;

/**
 * Pre-formatted short version string for compact display.
 * Example: "v1.2.0 · a3f9c2b"
 */
export const VERSION_STRING = `v${APP_VERSION} · ${GIT_SHA}`;

/**
 * Formatted build timestamp for human display.
 * Returns a locale-aware date string, e.g. "Apr 23, 2026, 2:45 PM".
 */
export function formatBuildTime(locale?: string): string {
  try {
    return new Date(BUILD_TIME).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return BUILD_TIME;
  }
}
