/**
 * The config file is parsed against the request's own unit and signature
 * shapes. A file that is not that shape stops the companion at startup with
 * the path and the field named, the same as a file that is not JSON; it used
 * to load and fail every render with an internal error, or drop the operator's
 * value without a word.
 */
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDefaults } from '../../companion/defaults';

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'dondocs-config-')); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

async function configOf(contents: string, name = 'companion.config.json'): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, contents);
  return path;
}

describe('loadDefaults', () => {
  it('treats a missing file as no defaults', async () => {
    await expect(loadDefaults(join(dir, 'absent.json'))).resolves.toEqual({});
  });

  it('accepts the documented shape', async () => {
    const config = {
      unit: { name: 'TEST UNIT', line2: 'PARENT', address: 'PSC BOX 1, QUANTICO VA 22134', department: 'usmc', seal: 'dow' },
      signature: { first: 'A', middle: 'B', last: 'SMITH', rank: 'Major', title: 'Officer in Charge' },
      ssic: '5216', originatorCode: 'S-6',
    };
    await expect(loadDefaults(await configOf(JSON.stringify(config), 'ok.json'))).resolves.toEqual(config);
  });

  it('refuses a file that is not an object, naming the path', async () => {
    const path = await configOf('null', 'null.json');
    await expect(loadDefaults(path)).rejects.toThrow(path);
  });

  it('refuses a wrong-typed field by name rather than dropping it', async () => {
    const path = await configOf(JSON.stringify({ unit: '1st Battalion' }), 'typed.json');
    await expect(loadDefaults(path)).rejects.toThrow(/unit/);
  });

  it('refuses a key the request could not set either', async () => {
    const path = await configOf(JSON.stringify({ unit: { name: 'X', city: 'Quantico' } }), 'extra.json');
    await expect(loadDefaults(path)).rejects.toThrow(/city/);
  });

  it('still refuses a file that is not JSON', async () => {
    const path = await configOf('{ not json', 'bad.json');
    await expect(loadDefaults(path)).rejects.toThrow(/not readable JSON/);
  });
});
