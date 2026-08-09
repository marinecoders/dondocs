/**
 * The DOCX path's failure modes, not its happy path.
 *
 * Both cases here matter only to a companion that stays up. A one-shot render
 * can leak a scratch directory and hang forever without anyone noticing; a
 * server an agent talks to all week cannot.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, readdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LETTER = {
  docType: 'naval_letter',
  subject: 'DOCX HYGIENE',
  paragraphs: [{ text: 'Body.' }],
};

/** Scratch directories renderDocx creates, by prefix. */
async function scratchDirs(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((n) => n.startsWith('dondocs-companion-'));
}

describe('scratch directories', () => {
  it('leaves none behind after a successful conversion', async () => {
    const { renderDocx, systemPandocVersion } = await import('../../companion/renderDocx');
    if (!(await systemPandocVersion())) { return; } // pandoc absent; nothing to prove

    const before = await scratchDirs();
    const bytes = await renderDocx(LETTER as never);
    // Sanity: a real docx, so we know the conversion actually ran.
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.subarray(0, 2)).toString()).toBe('PK');

    const after = await scratchDirs();
    expect(after.filter((d) => !before.includes(d))).toEqual([]);
  }, 120_000);

});

describe('a pandoc that exits non-zero', () => {
  let fakeBin: string;
  let originalPath: string | undefined;

  beforeAll(async () => {
    fakeBin = await mkdtemp(join(tmpdir(), 'failing-pandoc-'));
    const script = join(fakeBin, 'pandoc');
    await writeFile(script, '#!/bin/sh\necho "pandoc: something went wrong" >&2\nexit 1\n');
    await chmod(script, 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${process.env.PATH}`;
    vi.resetModules();
  });

  afterAll(async () => {
    process.env.PATH = originalPath;
    await rm(fakeBin, { recursive: true, force: true });
    vi.resetModules();
  });

  it('reports the exit code and stderr rather than a bare failure', async () => {
    const { renderDocx } = await import('../../companion/renderDocx');
    await expect(renderDocx(LETTER as never)).rejects.toThrow(/pandoc exited 1.*something went wrong/s);
  }, 60_000);

  it('leaves no scratch directory behind', async () => {
    // Cleanup that only runs on success is not cleanup.
    const { renderDocx } = await import('../../companion/renderDocx');
    const before = await scratchDirs();
    await expect(renderDocx(LETTER as never)).rejects.toThrow();
    expect((await scratchDirs()).filter((d) => !before.includes(d))).toEqual([]);
  }, 60_000);
});

describe('a wedged pandoc', () => {
  let fakeBin: string;
  let originalPath: string | undefined;

  beforeAll(async () => {
    // A pandoc that never exits. Without a timeout the promise never settles
    // and the caller waits forever — an agent with no timeout of its own hangs.
    fakeBin = await mkdtemp(join(tmpdir(), 'fake-pandoc-'));
    const script = join(fakeBin, 'pandoc');
    await writeFile(script, '#!/bin/sh\nsleep 300\n');
    await chmod(script, 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${process.env.PATH}`;
  });

  afterAll(async () => {
    process.env.PATH = originalPath;
    await rm(fakeBin, { recursive: true, force: true });
  });

  it('is killed and reported rather than hanging the caller', async () => {
    process.env.DONDOCS_RENDER_TIMEOUT_MS = '1500';
    // The timeout is read at module load, so the module must be re-imported
    // after the env is set.
    vi.resetModules();
    const { renderDocx } = await import('../../companion/renderDocx');

    const started = Date.now();
    await expect(renderDocx(LETTER as never)).rejects.toThrow(/did not finish within 1500ms/);
    // It must give up near the deadline, not merely eventually.
    expect(Date.now() - started).toBeLessThan(20_000);

    delete process.env.DONDOCS_RENDER_TIMEOUT_MS;
    vi.resetModules();
  }, 60_000);

  it('cleans up its scratch directory even when killed', async () => {
    process.env.DONDOCS_RENDER_TIMEOUT_MS = '1500';
    vi.resetModules();
    const { renderDocx } = await import('../../companion/renderDocx');

    const before = await scratchDirs();
    await expect(renderDocx(LETTER as never)).rejects.toThrow();
    expect((await scratchDirs()).filter((d) => !before.includes(d))).toEqual([]);

    delete process.env.DONDOCS_RENDER_TIMEOUT_MS;
    vi.resetModules();
  }, 60_000);
});
