/**
 * Where the companion is allowed to write.
 *
 * This is the security boundary of the whole thing. The caller supplies a
 * filename, and a caller is an LLM constructing JSON — so `../../../.ssh/authorized_keys`
 * is a realistic input, not a hypothetical one. Everything resolves inside one
 * root and anything escaping it is refused.
 */
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, join, sep } from 'node:path';

/** Default root. Somewhere a person would actually look for a letter. */
export const DEFAULT_ROOT = join(homedir(), 'Documents', 'DonDocs');

/**
 * The root DONDOCS_OUT_ROOT names, or the default. A bundle host fills the
 * variable from a setting whose default is written with a placeholder
 * (`${DOCUMENTS}/DonDocs`); should that arrive unexpanded, it is not a
 * directory to create under wherever the host launched us.
 */
export function outputRoot(value: string | undefined = process.env.DONDOCS_OUT_ROOT): string {
  if (!value) { return DEFAULT_ROOT; }
  if (/\$\{[^}]*\}/.test(value)) {
    // stderr: under MCP, stdout is the protocol.
    console.error(`ignoring DONDOCS_OUT_ROOT=${JSON.stringify(value)}: unexpanded placeholder; using ${DEFAULT_ROOT}`);
    return DEFAULT_ROOT;
  }
  return value;
}

export class OutsideSandboxError extends Error {
  constructor(requested: string, root: string) {
    super(`refusing to write outside the output root: ${requested} is not inside ${root}`);
    this.name = 'OutsideSandboxError';
  }
}

const inside = (path: string, root: string) => path === root || path.startsWith(root + sep);

/** Whether `path` exists as a directory entry, following nothing. */
function entryOf(path: string): { exists: boolean; symlink: boolean } {
  try {
    return { exists: true, symlink: lstatSync(path).isSymbolicLink() };
  } catch {
    return { exists: false, symlink: false };
  }
}

/**
 * Resolve a caller-supplied name to an absolute path inside `root`.
 *
 * Two checks. The lexical one catches `..` segments and absolute paths. The
 * second walks the target's existing components below the root: none may be a
 * symlink (dangling or not, a link is where a write leaves the root), and the
 * nearest existing directory must really sit inside the root. The root itself
 * is refused: writing there would replace the directory with a file.
 */
export function resolveOutputPath(requested: string, root: string = DEFAULT_ROOT): string {
  const cleanRoot = resolve(root);
  const target = resolve(cleanRoot, requested);

  // `startsWith(root)` alone would accept `/home/user/DonDocsEvil`, so require
  // a real path separator after the root.
  if (target === cleanRoot || !target.startsWith(cleanRoot + sep)) {
    throw new OutsideSandboxError(requested, cleanRoot);
  }

  if (existsSync(cleanRoot)) {
    let anchor = cleanRoot;
    for (let probe = target; probe !== cleanRoot; probe = dirname(probe)) {
      const entry = entryOf(probe);
      if (entry.symlink) { throw new OutsideSandboxError(requested, cleanRoot); }
      if (entry.exists) { anchor = probe; break; }
    }
    if (!inside(realpathSync(anchor), realpathSync(cleanRoot))) {
      throw new OutsideSandboxError(requested, cleanRoot);
    }
  }
  return target;
}

/** Turn a subject line into a filename that is safe on every platform. */
export function filenameFor(subject: string | undefined, format: 'pdf' | 'docx'): string {
  const base = (subject ?? 'document')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'document'}.${format}`;
}
