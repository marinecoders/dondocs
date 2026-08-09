/**
 * How long a render gets before the companion gives up.
 *
 * Set against the caller's patience, not ours: agent HTTP tools commonly allow
 * about a minute, and expiring at the same moment would hand the model an opaque
 * transport timeout instead of a message naming what was slow.
 *
 * Renders measure 0.87s (PDF) and 0.49s (DOCX), so 45s is not a performance
 * ceiling — it is a wedged-process detector.
 */
export const RENDER_TIMEOUT_MS = Number(process.env.DONDOCS_RENDER_TIMEOUT_MS ?? 45_000);

export class RenderTimeoutError extends Error {
  constructor(format: string, ms: number) {
    super(`${format} render did not finish within ${ms}ms and was abandoned`);
    this.name = 'RenderTimeoutError';
  }
}
