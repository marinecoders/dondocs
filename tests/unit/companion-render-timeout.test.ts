/**
 * A render that outlives the deadline is cancelled, not merely abandoned.
 *
 * Before, the losing branch of the race kept its pdfTeX worker, so a wedged
 * compile spun at full CPU for the life of the server and each repeat added
 * another. The deadline now aborts the render, which disposes the engine.
 */
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({ signals: [] as AbortSignal[] }));

vi.mock('../../companion/render', () => ({
  renderPdf: (_input: unknown, _defaults: unknown, opts?: { signal?: AbortSignal }) =>
    new Promise<Uint8Array>((_, reject) => {
      if (opts?.signal) {
        mocks.signals.push(opts.signal);
        opts.signal.addEventListener('abort', () => reject(new Error('engine disposed')));
      }
    }),
}));

process.env.DONDOCS_RENDER_TIMEOUT_MS = '100';
const { renderToFile } = await import('../../companion/renderToFile');

describe('the render deadline', () => {
  it('aborts the render it gives up on', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dondocs-timeout-'));
    await expect(renderToFile({ docType: 'naval_letter', subject: 'SLOW', out: 'slow.pdf' }, {}, root))
      .rejects.toThrow(/did not finish within 100ms/);
    expect(mocks.signals, 'renderPdf was not given a signal to abort on').toHaveLength(1);
    expect(mocks.signals[0].aborted).toBe(true);
  });
});
