/**
 * The companion's request path.
 *
 * These drive a REAL loopback listener rather than a fake req/res, because the
 * things worth proving here are HTTP-level: the status code (agent HTTP tools
 * generally derive success from status alone, so a 200 carrying an error reads
 * as a document that rendered fine), the body-size cap, and the sandbox refusal.
 *
 * Nothing here renders. Every case is a request that must be turned away before
 * the generator is reached, plus the capability probe — so the file stays fast
 * and its failures point at routing rather than at LaTeX.
 *
 * Node environment, not the suite's default happy-dom: the companion is a Node
 * process, and happy-dom's `fetch` applies the browser same-origin policy, so
 * every request to the loopback listener would fail as a CORS error.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler, validate } from '../../companion/handler';

let server: Server;
let base: string;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-sandbox-'));
  server = createServer(createHandler({}, root));
  // Port 0 — the OS picks a free one, so the suite never collides with a
  // companion the developer happens to be running.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr === 'string' || addr === null) { throw new Error('no port'); }
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

/** POST a raw body; returns status plus the parsed payload. */
async function post(body: string, path = '/generate') {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return { status: res.status, json: (await res.json()) as { ok: boolean; v: number; errors?: string[] } };
}

const VALID = { docType: 'naval_letter', subject: 'ROUTING CHECK' };

describe('capabilities', () => {
  it('answers GET / with the contract and the root it was given', async () => {
    const res = await fetch(`${base}/`);
    const body = (await res.json()) as { ok: boolean; v: number; outputRoot: string; docTypes: string[] };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.v).toBe(1);
    // Proves the handler answers about its OWN root, not a module-level default.
    expect(body.outputRoot).toBe(root);
    expect(body.docTypes).toContain('naval_letter');
  });

  it('answers /health identically', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('reports the docx converter rather than staying silent about it', async () => {
    const body = (await (await fetch(`${base}/`)).json()) as {
      docx: { pandoc: string | null; vendoredByApp: string; matchesApp: boolean; note?: string };
    };
    expect(body.docx).toHaveProperty('vendoredByApp');
    // Either pandoc is absent or it is not the vendored build — both must carry
    // a note. Silence here is the failure mode: a caller comparing against a
    // browser export would have no idea the converter differs.
    if (!body.docx.matchesApp) { expect(body.docx.note).toBeTruthy(); }
  });
});

describe('routing', () => {
  it('404s an unknown path', async () => {
    const { status, json } = await post(JSON.stringify(VALID), '/render');
    expect(status).toBe(404);
    expect(json.ok).toBe(false);
  });

  it('404s GET /generate — the render path is POST only', async () => {
    expect((await fetch(`${base}/generate`)).status).toBe(404);
  });

  it('carries the contract version on failures too, so a caller can tell why', async () => {
    const { json } = await post('{', '/generate');
    expect(json.v).toBe(1);
  });
});

describe('malformed input is 400, never 500', () => {
  it('rejects unparseable JSON', async () => {
    const { status, json } = await post('{"docType":');
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
  });

  it('rejects a body past the cap without reading it all into memory', async () => {
    // 1 MB + slop. The cap exists so a runaway caller cannot balloon the process.
    const { status, json } = await post(JSON.stringify({ ...VALID, subject: 'x'.repeat(1_100_000) }));
    expect(status).toBe(400);
    expect(json.errors?.join(' ')).toMatch(/exceeds/);
  });

  it('rejects a mismatched contract version', async () => {
    const { status, json } = await post(JSON.stringify({ ...VALID, v: 99 }));
    expect(status).toBe(400);
    expect(json.errors?.join(' ')).toMatch(/contract version 99/);
  });

  it('reports every problem at once rather than one per round-trip', async () => {
    const { status, json } = await post(JSON.stringify({ docType: 'invoice', format: 'rtf', paragraphs: 'not an array' }));
    expect(status).toBe(400);
    // docType + format + paragraphs shape + nothing-to-render.
    expect(json.errors!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the sandbox', () => {
  // This is the security boundary: `out` is chosen by an LLM composing JSON, so
  // a traversal attempt is a realistic input rather than a hypothetical one.
  const escapes = [
    '../../../../etc/passwd',
    '/etc/passwd',
    'subdir/../../../outside.pdf',
  ];

  for (const out of escapes) {
    it(`refuses ${out} with a 400, not a 500`, async () => {
      const { status, json } = await post(JSON.stringify({ ...VALID, out }));
      expect(status).toBe(400);
      expect(json.errors?.join(' ')).toMatch(/outside the output root/);
    });
  }

  it('writes nothing at all when a request is refused', async () => {
    // The refusals above ran first; if any had leaked past validation the
    // render would have created a file. An empty root proves they did not.
    expect(await readdir(root)).toEqual([]);
  });
});

describe('validate() directly', () => {
  // The HTTP cases above prove the wiring; these pin the rules cheaply.
  it('passes a minimal valid request', () => {
    expect(validate(VALID)).toEqual([]);
  });

  it('accepts an omitted version — v is optional, not required', () => {
    expect(validate({ docType: 'naval_letter', subject: 'S' })).toEqual([]);
  });

  it('demands something to render', () => {
    expect(validate({ docType: 'naval_letter' }).join(' ')).toMatch(/nothing to render/);
  });

  it('accepts a paragraph with no subject', () => {
    expect(validate({ docType: 'naval_letter', paragraphs: [{ text: 'Body.' }] })).toEqual([]);
  });

  it('names the offending paragraph index', () => {
    const problems = validate({
      docType: 'naval_letter',
      subject: 'S',
      paragraphs: [{ text: 'ok' }, { text: 42 } as never],
    });
    expect(problems.join(' ')).toMatch(/paragraphs\[1\]\.text/);
  });

  it('rejects an array where an object belongs', () => {
    expect(validate({ ...VALID, unit: [] as never }).join(' ')).toMatch(/unit must be an object/);
  });
});
