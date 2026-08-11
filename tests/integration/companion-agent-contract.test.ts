/**
 * The companion driven the way an agent's HTTP tool drives it.
 *
 * WHAT THIS IS: a faithful emulation of the calling convention such tools use —
 * a string-or-object body, success derived from the HTTP status alone, and the
 * output clipped before the model ever sees it. The server underneath is the
 * real one, rendering real documents.
 *
 * WHAT THIS IS NOT: proof that any particular product works. No agent runs here.
 * It pins the CONTRACT, so that a change on our side which would break a
 * status-derived caller fails in CI instead of in front of someone.
 *
 * The cases are the ones that actually bite: a body sent as a pre-encoded string
 * (which arrives with no Content-Type), a response that must survive clipping,
 * and the failures — a refused request, a sandbox escape, a dead port — where
 * what the model reads decides whether it can recover.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../../companion/handler';

/** The clip a harness applies to tool output before the model sees it. */
const MAX_OUTPUT = 8_000;

interface ToolResult { ok: boolean; output: string }

/**
 * An agent HTTP tool, reproduced. Two details matter and are easy to get wrong:
 * an object body is stringified AND gets a Content-Type, while a string body is
 * sent as-is with NO Content-Type; and `ok` comes from the status, never from
 * anything in the payload.
 */
async function httpRequestTool(input: {
  method?: string; url: string; headers?: Record<string, string>; body?: unknown;
}): Promise<ToolResult> {
  const method = String(input.method ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  const headers: Record<string, string> = { ...(input.headers ?? {}) };

  let body: string | undefined;
  if (method === 'POST' && input.body != null) {
    body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
    if (typeof input.body !== 'string' && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  }

  try {
    const res = await fetch(input.url, { method, headers, body });
    const text = await res.text();
    return {
      ok: res.status >= 200 && res.status < 400,
      output: `HTTP ${res.status}\n${text.slice(0, MAX_OUTPUT)}`,
    };
  } catch (e) {
    return { ok: false, output: `http_request: ${(e as Error).message}` };
  }
}

let server: Server;
let base: string;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-agent-'));
  server = createServer(createHandler({}, root));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr === 'string' || addr === null) { throw new Error('no port'); }
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

const LETTER = {
  docType: 'naval_letter',
  subject: 'REQUEST FOR ADDITIONAL RANGE TIME',
  from: 'Commanding Officer, 1st Battalion, 6th Marines',
  to: 'Commanding General, II MEF',
  paragraphs: [{ text: 'Request approval for additional range time in FY26.' }],
};

describe('a session that succeeds', () => {
  it('probes capabilities and learns what it may ask for', async () => {
    const res = await httpRequestTool({ url: `${base}/` });
    expect(res.ok).toBe(true);
    const body = JSON.parse(res.output.split('\n').slice(1).join('\n')) as {
      docTypes: string[]; formats: string[]; outputRoot: string;
    };
    // Everything needed to construct a valid call, without sending a letter.
    expect(body.docTypes).toContain('naval_letter');
    expect(body.formats).toEqual(['pdf', 'docx']);
    expect(body.outputRoot).toBe(root);
  }, 60_000);

  it('sends the letter and gets back a path to a real PDF', async () => {
    const res = await httpRequestTool({ method: 'POST', url: `${base}/generate`, body: LETTER });
    expect(res.ok, res.output).toBe(true);

    const payload = JSON.parse(res.output.split('\n').slice(1).join('\n')) as {
      ok: boolean; files: Array<{ format: string; path: string; bytes: number }>;
    };
    const file = payload.files[0];
    expect(file.path.startsWith(root)).toBe(true);

    const bytes = await readFile(file.path);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.byteLength).toBe(file.bytes);
  }, 200_000);

  it('survives the output clip — the whole point of answering with a path', async () => {
    const res = await httpRequestTool({ method: 'POST', url: `${base}/generate`, body: { ...LETTER, out: 'clip.pdf' } });
    // If the response were the document rather than a path it would be truncated
    // here and the model would read corrupt base64 as success.
    expect(res.output.length).toBeLessThan(MAX_OUTPUT);
    expect(() => JSON.parse(res.output.split('\n').slice(1).join('\n'))).not.toThrow();
  }, 200_000);

  it('accepts a pre-encoded string body, which arrives with no Content-Type', async () => {
    // A tool whose schema declares `body` as a string sends it this way, and
    // then sets no Content-Type at all. Refusing that would break the most
    // likely call shape.
    const res = await httpRequestTool({
      method: 'POST', url: `${base}/generate`,
      body: JSON.stringify({ ...LETTER, out: 'string-body.pdf' }),
    });
    expect(res.ok, res.output).toBe(true);
    expect(res.output).toMatch(/string-body\.pdf/);
  }, 200_000);
});

describe('a session that goes wrong', () => {
  it('reports a refused request as not-ok, with something to act on', async () => {
    const res = await httpRequestTool({ method: 'POST', url: `${base}/generate`, body: { docType: 'naval_letter' } });
    // Not-ok is what stops the model reporting success to the user.
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/HTTP 400/);
    // And the message has to say what to do, not merely that something failed.
    expect(res.output).toMatch(/subject or one paragraph/);
  }, 60_000);

  it('names every problem at once instead of one per round-trip', async () => {
    const res = await httpRequestTool({
      method: 'POST', url: `${base}/generate`,
      body: { docType: 'invoice', format: 'rtf', paragraphs: 'not an array' },
    });
    expect(res.ok).toBe(false);
    const errors = (JSON.parse(res.output.split('\n').slice(1).join('\n')) as { errors: string[] }).errors;
    expect(errors.length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('refuses a traversal path and says where files may go', async () => {
    const res = await httpRequestTool({
      method: 'POST', url: `${base}/generate`,
      body: { ...LETTER, out: '../../../../tmp/pwned.pdf' },
    });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/outside the output root/);
  }, 60_000);

  it('surfaces a dead companion as a transport error, not a silent nothing', async () => {
    // The likeliest failure in practice: nobody started the service.
    const res = await httpRequestTool({ method: 'POST', url: 'http://127.0.0.1:1/generate', body: LETTER });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/http_request:/);
    expect(res.output.length).toBeGreaterThan(20); // an empty message is useless to a model
  }, 60_000);
});
