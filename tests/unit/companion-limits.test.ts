/**
 * The render deadline override is a tuning knob. A value that is not a
 * positive number used to become NaN, which setTimeout treats as about a
 * millisecond, so every render was abandoned at once.
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';

const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

async function timeoutWith(value: string | undefined): Promise<number> {
  vi.resetModules();
  if (value === undefined) { delete process.env.DONDOCS_RENDER_TIMEOUT_MS; }
  else { process.env.DONDOCS_RENDER_TIMEOUT_MS = value; }
  return (await import('../../companion/limits')).RENDER_TIMEOUT_MS;
}

afterEach(() => { stderr.mockClear(); delete process.env.DONDOCS_RENDER_TIMEOUT_MS; });

describe('DONDOCS_RENDER_TIMEOUT_MS', () => {
  it('defaults to 45 seconds', async () => {
    expect(await timeoutWith(undefined)).toBe(45_000);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('takes a positive number', async () => {
    expect(await timeoutWith('30000')).toBe(30_000);
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each(['abc', '', '0', '-5', 'Infinity'])('ignores %j and says so on stderr', async (value) => {
    expect(await timeoutWith(value)).toBe(45_000);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('DONDOCS_RENDER_TIMEOUT_MS'));
  });
});
