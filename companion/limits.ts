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
const DEFAULT_MS = 45_000;
const override = process.env.DONDOCS_RENDER_TIMEOUT_MS;
const parsed = override === undefined ? DEFAULT_MS : Number(override);
if (!(Number.isFinite(parsed) && parsed > 0)) {
  // stderr: under MCP, stdout is the protocol.
  console.error(`ignoring DONDOCS_RENDER_TIMEOUT_MS=${JSON.stringify(override)}; using ${DEFAULT_MS}ms`);
}
export const RENDER_TIMEOUT_MS = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MS;

export class RenderTimeoutError extends Error {
  constructor(format: string, ms: number) {
    super(`${format} render did not finish within ${ms}ms and was abandoned`);
    this.name = 'RenderTimeoutError';
  }
}
