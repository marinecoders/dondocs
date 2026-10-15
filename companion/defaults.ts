/**
 * Machine defaults: the unit, signer, SSIC and originator code a request may
 * omit. They come from a config file, so an agent does not restate its own
 * unit on every call.
 *
 * The file is parsed against the request's own `unit` and `signature`
 * shapes, so a config cannot set anything a request cannot, and a typo is
 * named at startup instead of being dropped at render time.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as z from 'zod';
import { signature, unit } from './letterSchema';
import type { CompanionDefaults } from './letterInput';

/** Where machine defaults are read from. */
// `||`, not `??`: a client that lets the user leave the field blank passes ''.
export const CONFIG_PATH = process.env.DONDOCS_CONFIG || join(homedir(), '.dondocs', 'companion.config.json');

export const configSchema = z.object({
  unit: unit.optional(),
  signature: signature.optional(),
  ssic: z.string().optional(),
  originatorCode: z.string().optional(),
}).strict();

/**
 * Read machine defaults. A missing file is normal, not an error: the built-in
 * fallbacks in `toStore` keep a fresh install working before anyone
 * configures it. A file that exists but is not the documented shape stops the
 * companion, the same as one that is not JSON.
 */
export async function loadDefaults(path: string = CONFIG_PATH): Promise<CompanionDefaults> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf-8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') { return {}; }
    throw new Error(`${path} is not readable JSON: ${(err as Error).message}`, { cause: err });
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'top level'}: ${i.message}`).join('; ');
    throw new Error(`${path} is not a valid companion config: ${issues}`);
  }
  return parsed.data;
}

let saves = 0;

/** A field set to null is being taken back; anything absent is left as it was. */
export type DefaultsPatch = {
  [K in keyof CompanionDefaults]?: CompanionDefaults[K] | null;
};

/**
 * Write machine defaults, merged over whatever is already on disk.
 *
 * Validated against the same schema `loadDefaults` reads, because a file
 * that does not fit stops the companion at its next start: a bad save
 * here would be a broken install later. The write lands in one move, by
 * renaming a temporary file in the same directory over the target, so an
 * interrupted one cannot leave half a config behind either.
 */
export async function saveDefaults(patch: DefaultsPatch, path: string = CONFIG_PATH): Promise<CompanionDefaults> {
  const current = await loadDefaults(path);
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) { delete merged[key]; } else if (value !== undefined) { merged[key] = value; }
  }

  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'top level'}: ${i.message}`).join('; ');
    throw new Error(`refusing to write ${path}: ${issues}`);
  }

  // Indented: the file is documented as one a person may edit by hand.
  const json = `${JSON.stringify(parsed.data, null, 2)}\n`;
  // The pid separates two companions, the counter two saves inside one.
  const temp = `${path}.${process.pid}.${saves++}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temp, json, 'utf-8');
    await rename(temp, path);
  } catch (err) {
    // A write that stops partway, or a rename that cannot land, would leave
    // the temporary file beside the config a person keeps. Take it back.
    await rm(temp, { force: true });
    throw err;
  }
  return parsed.data;
}
