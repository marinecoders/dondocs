/**
 * Machine defaults: the unit, signer, SSIC and originator code a request may
 * omit. They come from a config file, so an agent does not restate its own
 * unit on every call.
 *
 * The file is parsed against the request's own `unit` and `signature`
 * shapes, so a config cannot set anything a request cannot, and a typo is
 * named at startup instead of being dropped at render time.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as z from 'zod';
import { signature, unit } from './letterSchema';
import type { CompanionDefaults } from './letterInput';

/** Where machine defaults are read from. */
// `||`, not `??`: a client that lets the user leave the field blank passes ''.
export const CONFIG_PATH = process.env.DONDOCS_CONFIG || join(homedir(), '.dondocs', 'companion.config.json');

const configSchema = z.object({
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
