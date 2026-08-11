/**
 * Where the companion is allowed to write.
 *
 * This is the security boundary of the whole thing. The caller supplies a
 * filename, and a caller is an LLM constructing JSON — so `../../../.ssh/authorized_keys`
 * is a realistic input, not a hypothetical one. Everything resolves inside one
 * root and anything escaping it is refused.
 */
import { homedir } from 'node:os';
import { resolve, join, sep } from 'node:path';

/** Default root. Somewhere a person would actually look for a letter. */
export const DEFAULT_ROOT = join(homedir(), 'Documents', 'DonDocs');

export class OutsideSandboxError extends Error {
  constructor(requested: string, root: string) {
    super(`refusing to write outside the output root: ${requested} is not inside ${root}`);
    this.name = 'OutsideSandboxError';
  }
}

/**
 * Resolve a caller-supplied name to an absolute path inside `root`.
 *
 * Resolution happens first and the containment check second, so `..` segments,
 * absolute paths and symlink-ish tricks are all judged on where they actually
 * land rather than on how they look.
 */
export function resolveOutputPath(requested: string, root: string = DEFAULT_ROOT): string {
  const cleanRoot = resolve(root);
  const target = resolve(cleanRoot, requested);

  // `startsWith(root)` alone would accept `/home/user/DonDocsEvil`, so require
  // either an exact match or a real path separator after the root.
  if (target !== cleanRoot && !target.startsWith(cleanRoot + sep)) {
    throw new OutsideSandboxError(requested, cleanRoot);
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
