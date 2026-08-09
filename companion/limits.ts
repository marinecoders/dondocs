/**
 * How long a render gets before the companion gives up.
 *
 * The number is chosen against the CALLER's patience, not ours. Agent HTTP tools
 * commonly allow about a minute per call. If we waited that long too, the two
 * would expire together and the model would get an opaque transport timeout
 * instead of our message saying what was slow.
 *
 * So: finish, or fail with an explanation, comfortably inside the caller's
 * window. Measured render times are 0.87s for PDF and 0.49s for DOCX, so 45s is
 * two orders of magnitude of headroom — reaching it means something is wedged.
 */
export const RENDER_TIMEOUT_MS = Number(process.env.DONDOCS_RENDER_TIMEOUT_MS ?? 45_000);

export class RenderTimeoutError extends Error {
  constructor(format: string, ms: number) {
    super(`${format} render did not finish within ${ms}ms and was abandoned`);
    this.name = 'RenderTimeoutError';
  }
}
