/**
 * A failure to write the file is not a render failure. It is reported as
 * what it is, with the path, so the model can choose another `out`.
 */
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../companion/render', () => ({ renderPdf: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]) }));
const { renderToFile, OutputWriteError } = await import('../../companion/renderToFile');

describe('a write that fails', () => {
  it('is reported as a write failure naming the path, not as a render failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dondocs-write-'));
    // A regular file where the target's directory would go.
    await writeFile(join(root, 'sub'), 'not a directory');
    const attempt = renderToFile({ docType: 'naval_letter', subject: 'W', out: 'sub/letter.pdf' }, {}, root);
    await expect(attempt).rejects.toBeInstanceOf(OutputWriteError);
    await expect(attempt).rejects.toThrow(/could not write .*sub\/letter\.pdf/);
  });
});
