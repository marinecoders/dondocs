/**
 * Writing the machine defaults.
 *
 * `loadDefaults` throws at startup on a file that exists and does not fit
 * the schema, so a bad write here is a companion that will not start next
 * time. Everything below is about that: validate before writing, write in
 * one move, and leave the old file alone when the new one is wrong.
 */
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDefaults, saveDefaults } from '../../companion/defaults';

let refuseRename = false;
vi.mock('node:fs/promises', async (real) => {
  const fs = await real<typeof import('node:fs/promises')>();
  return { ...fs, rename: (from: string, to: string) => (refuseRename ? Promise.reject(new Error('refused')) : fs.rename(from, to)) };
});

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dondocs-defaults-'));
  path = join(dir, 'nested', 'companion.config.json');
});

const SIGNER = { rank: 'Corporal', first: 'R', last: 'CHIOFALO', title: 'Admin Chief' };
const UNIT = { name: 'MARINE INNOVATION UNIT', line2: 'MARFORRES', address: '10 MCDONALD ST, NEWBURGH, NY 12550-5012' };

describe('saving the machine defaults', () => {
  it('writes a file the companion can read back at startup', async () => {
    const saved = await saveDefaults({ unit: UNIT, signature: SIGNER, ssic: '1650' }, path);
    expect(saved).toEqual({ unit: UNIT, signature: SIGNER, ssic: '1650' });
    await expect(loadDefaults(path)).resolves.toEqual(saved);
    // Written for a person to read and edit, since that is the other way in.
    expect(await readFile(path, 'utf-8')).toMatch(/^\{\n {2}"unit"/);
  });

  it('makes the directory when it is not there yet', async () => {
    await saveDefaults({ signature: SIGNER }, path);
    await expect(loadDefaults(path)).resolves.toEqual({ signature: SIGNER });
  });

  it('keeps what it was not asked to change', async () => {
    await saveDefaults({ unit: UNIT, ssic: '1650' }, path);
    const saved = await saveDefaults({ signature: SIGNER }, path);
    expect(saved).toEqual({ unit: UNIT, signature: SIGNER, ssic: '1650' });
  });

  it('takes a field back when it is set to null', async () => {
    await saveDefaults({ unit: UNIT, ssic: '1650' }, path);
    expect(await saveDefaults({ ssic: null }, path)).toEqual({ unit: UNIT });
  });

  it('refuses a shape the companion could not load, and leaves the old file alone', async () => {
    await saveDefaults({ unit: UNIT }, path);
    const before = await readFile(path, 'utf-8');
    await expect(saveDefaults({ signature: { rank: 7 } } as never, path)).rejects.toThrow(/signature/);
    expect(await readFile(path, 'utf-8')).toBe(before);
    await expect(loadDefaults(path)).resolves.toEqual({ unit: UNIT });
  });

  it('leaves nothing behind when the write is refused', async () => {
    await expect(saveDefaults({ unit: { department: 'space force' } } as never, path)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  it('takes its temporary file back when the move cannot land', async () => {
    // The one failure that happens after the temporary file exists, so the
    // one that could leave it beside a config a person keeps. Nothing in a
    // filesystem refuses a rename on demand, hence the stub.
    refuseRename = true;
    try {
      await expect(saveDefaults({ unit: UNIT }, path)).rejects.toThrow(/refused/);
    } finally {
      refuseRename = false;
    }
    expect(await readdir(join(dir, 'nested'))).toEqual([]);
  });

  it('replaces a file already there rather than appending to it', async () => {
    const plain = join(dir, 'plain.json');
    await writeFile(plain, JSON.stringify({ ssic: '5216' }));
    expect(await saveDefaults({ ssic: '1650' }, plain)).toEqual({ ssic: '1650' });
    await expect(loadDefaults(plain)).resolves.toEqual({ ssic: '1650' });
  });
});
