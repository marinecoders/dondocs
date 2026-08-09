/**
 * What the companion does with a request. `server.ts` owns the socket.
 *
 * Split out so the request path can be tested without binding a port: an
 * earlier version bound one at import time, which left routing, the body cap
 * and the sandbox refusal unreachable from a test. Nothing here has an import
 * side effect — the caller supplies both the defaults and the output root.
 *
 * It answers with a PATH, never the document. Agent harnesses clip tool output
 * — a few thousand characters is typical — and a letter is hundreds of kilobytes,
 * which is a far larger number again once base64 encoded. Bytes would arrive
 * truncated and corrupt. A path is sixty characters and the user gets a real file.
 */
import type { IncomingMessage, ServerResponse, RequestListener } from 'node:http';
import { systemPandocVersion, VENDORED_PANDOC } from './renderDocx';
import type { CompanionDefaults, LetterInput } from './letterInput';
import { DEFAULT_ROOT, OutsideSandboxError } from './outputPath';
import { renderToFile } from './renderToFile';
import { RenderTimeoutError } from './limits';
import { validateLetter, DOC_TYPES, FORMATS } from './validateLetter';

/** The contract version. Bump when the request or response shape changes. */
export const CONTRACT = 1;
export const ROOT = process.env.DONDOCS_OUT_ROOT ?? DEFAULT_ROOT;
/** A letter is kilobytes; anything past this is a runaway caller, not a document. */
const MAX_BODY = 1_000_000;


interface GenerateRequest extends LetterInput {
  v?: number;
}

/** Thrown when a caller sends more than the cap; the socket cannot be reused. */
class BodyTooLargeError extends Error {
  constructor(limit: number) { super(`request body exceeds ${limit} bytes`); this.name = 'BodyTooLargeError'; }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) { throw new BodyTooLargeError(MAX_BODY); }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * HTTP-level validation: the contract version, then the shared letter rules.
 * The content rules live in validateLetter so the MCP transport enforces the
 * identical set — they diverged once and MCP rendered empty letters.
 */
export function validate(body: GenerateRequest): string[] {
  const problems: string[] = [];
  if (body.v !== undefined && body.v !== CONTRACT) {
    problems.push(`unsupported contract version ${body.v}; this companion speaks v${CONTRACT}`);
  }
  return [...problems, ...validateLetter(body)];
}

/**
 * The request path, separated from the socket.
 *
 * Binding a port at import time would make every one of these branches
 * untestable — a test would have to start a real listener on a fixed port and
 * race the bootstrap. `defaults` and `root` arrive as arguments rather than
 * module state for the same reason: a test needs its own sandbox root, and the
 * sandbox is the security boundary worth testing hardest.
 */
export function createHandler(defaults: CompanionDefaults, root: string = ROOT): RequestListener {
  return (req, res) => { void handleRequest(req, res, defaults, root); };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  defaults: CompanionDefaults,
  root: string,
): Promise<void> {
  const json = (status: number, payload: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  // Capabilities, so a client can configure itself without being told.
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    // Report the DOCX converter honestly. A caller comparing output against a
    // browser export needs to know it is not the same pandoc.
    const pandoc = await systemPandocVersion();
    return json(200, {
      ok: true, v: CONTRACT, service: 'dondocs-companion',
      formats: FORMATS, docTypes: DOC_TYPES, outputRoot: root,
      // So a caller can see what it will get without sending a letter.
      defaults: { unit: defaults.unit ?? null, signature: defaults.signature ?? null },
      docx: pandoc
        ? {
            pandoc,
            vendoredByApp: VENDORED_PANDOC,
            matchesApp: pandoc === VENDORED_PANDOC,
            note: pandoc === VENDORED_PANDOC
              ? undefined
              : 'DOCX is converted by the system pandoc, not the build the app vendors; output may differ from a browser export.',
          }
        : { pandoc: null, vendoredByApp: VENDORED_PANDOC, matchesApp: false,
            note: 'pandoc is not installed, so docx requests will fail. pdf is unaffected.' },
      accepts: ['unit', 'ssic', 'serial', 'date', 'originatorCode', 'from', 'to', 'via',
                'subject', 'paragraphs', 'references', 'enclosures', 'copyTo',
                'distribution', 'signature', 'classification', 'pocEmail', 'formData'],
    });
  }
  if (req.method !== 'POST' || req.url !== '/generate') {
    return json(404, { ok: false, v: CONTRACT, errors: ['POST /generate, or GET / for capabilities'] });
  }

  let body: GenerateRequest;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    // Abandoning an oversized body mid-stream leaves unread bytes in the socket.
    // On a keep-alive connection the server parses those leftovers as the NEXT
    // request, which arrives as a connection reset for whatever the caller sends
    // second. Answer, then close: the response is delivered and the poisoned
    // socket is not reused.
    if (err instanceof BodyTooLargeError) {
      res.setHeader('Connection', 'close');
      json(400, { ok: false, v: CONTRACT, errors: [err.message] });
      req.destroy();
      return;
    }
    return json(400, { ok: false, v: CONTRACT, errors: [err instanceof Error ? err.message : 'invalid JSON'] });
  }

  // Answer 4xx on a bad request. Agent HTTP tools generally derive success from
  // the STATUS alone and hand the body to the model as text, so a 200 carrying an
  // error object would read as a document that rendered fine.
  const problems = validate(body);
  if (problems.length) { return json(400, { ok: false, v: CONTRACT, errors: problems }); }

  try {
    const file = await renderToFile(body, defaults, root);
    // stdout is fine here: this module is reached only from server.ts. Do not
    // import it into an MCP entry, where stdout is the protocol channel.
    console.log(`  ${file.format}  ${file.bytes} bytes  ->  ${file.path}`);
    return json(200, { ok: true, v: CONTRACT, files: [file] });
  } catch (err) {
    // A path that escapes the root is the caller's mistake, not ours.
    if (err instanceof OutsideSandboxError) { return json(400, { ok: false, v: CONTRACT, errors: [err.message] }); }
    // 504 rather than 500: the request was fine, the render did not finish.
    if (err instanceof RenderTimeoutError) { return json(504, { ok: false, v: CONTRACT, errors: [err.message] }); }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  render failed: ${message}`);
    return json(500, { ok: false, v: CONTRACT, errors: [message] });
  }
}
