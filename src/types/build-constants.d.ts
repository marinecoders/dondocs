/**
 * Build-time constants injected by Vite's `define` config.
 *
 * Source values live in vite.config.ts. These globals are replaced at build
 * time with string literals — they are NOT available at runtime in Node or
 * in test environments without the same `define` setup.
 *
 * All consumer code should import from `@/lib/version` rather than reference
 * these globals directly.
 */
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __BUILD_TIME__: string;
