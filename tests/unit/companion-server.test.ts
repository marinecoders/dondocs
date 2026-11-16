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
import { createServer, request, type Server } from 'node:http';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler, validate } from '../../companion/handler';
import { LETTER_TEMPLATES } from '../../src/data/templates';

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

/** Stop uploading when the server answers; require its complete JSON response. */
async function oversizedPost(url: string, contentLength = true) {
  return new Promise<{ status: number; connection: string | undefined; json: { ok: boolean; errors: string[] } }>((resolve, reject) => {
    let responding = false;
    const req = request(url, { method: 'POST', headers: {
      'content-type': 'application/json', ...(contentLength ? { 'content-length': '17000000' } : {}),
    } }, (res) => {
      responding = true;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.once('error', reject);
      res.once('aborted', () => reject(new Error('oversize response was aborted')));
      res.once('end', () => {
        try { resolve({ status: res.statusCode!, connection: res.headers.connection, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
        finally { req.destroy(); }
      });
    });
    // Once headers arrive, only a complete response can resolve; response-stream
    // abort/error handlers still reject an interrupted or truncated response.
    req.once('error', (error) => { if (!responding) reject(error); });
    req.setTimeout(10_000, () => req.destroy(new Error('oversized upload response timed out')));
    void (async () => {
      const chunk = Buffer.alloc(64 * 1024, 'x');
      for (let sent = 0; sent < 16_100_000 && !responding;) {
        const part = chunk.subarray(0, Math.min(chunk.length, 16_100_000 - sent));
        sent += part.length;
        await new Promise<void>((done, fail) => req.write(part, (error) => error ? fail(error) : done()));
      }
      // Withhold the final body bytes/end marker: the cap must reject early.
    })().catch((error) => { if (!responding) reject(error); });
  });
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

describe('template routes', () => {
  it('lists only catalog metadata and retrieves every full template', async () => {
    const res = await fetch(`${base}/templates`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      ok: true, v: 1,
      templates: LETTER_TEMPLATES.map(({ id, name, category, description }) => ({
        id, name, category, description,
      })),
    });
    for (const template of LETTER_TEMPLATES) {
      const full = await fetch(`${base}/templates/${encodeURIComponent(template.id)}`);
      expect(full.status).toBe(200);
      expect(await full.json()).toEqual({ ok: true, v: 1, template });
    }
  });

  it('returns a helpful 404 for an unknown ID', async () => {
    const res = await fetch(`${base}/templates/no-such-template`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, v: 1, errors: [expect.stringContaining('GET /templates')] });
  });

  it('rejects malformed ID encoding and remains usable', async () => {
    expect((await fetch(`${base}/templates/%ZZ`)).status).toBe(400);
    expect((await fetch(`${base}/templates?source=cli`)).status).toBe(200);
  });

  it('does not accept POST for template routes', async () => {
    expect((await post('{}', '/templates')).status).toBe(404);
    expect((await post('{}', `/templates/${LETTER_TEMPLATES[0].id}`)).status).toBe(404);
  });
});

describe('unit lookup route', () => {
  it('finds the Newburgh letterhead by name and MCC', async () => {
    const res = await fetch(`${base}/units?query=Marine%20Innovation%20Unit%20Newburgh`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true, v: 1, source: expect.any(String), lastUpdated: expect.any(String),
      total: 1, truncated: false,
      matches: [{ mcc: 'SVP', unit: { address: '10 MCDONALD ST, NEWBURGH NY 12550-5012', department: 'usmc' } }],
    });
    const byMcc = await (await fetch(`${base}/units?query=SVP`)).json();
    expect(byMcc.matches).toEqual(body.matches);
  });

  it('limits results while reporting the full count', async () => {
    const body = await (await fetch(`${base}/units?query=Marine+Innovation+Unit&limit=2`)).json();
    expect(body).toMatchObject({ ok: true, v: 1, total: 7, truncated: true });
    expect(body.matches).toHaveLength(2);
  });

  it('returns a successful empty result for no matches', async () => {
    const res = await fetch(`${base}/units?query=no-such-unit-xyz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, v: 1, total: 0, truncated: false, matches: [] });
  });

  it.each(['', '?query=', '?query=%20', `?query=${'x'.repeat(201)}`, '?query=SVP&limit=0', '?query=SVP&limit=51', '?query=SVP&limit=1.5', '?query=SVP&limit=no', '?query=SVP&limit='])('rejects invalid input %s', async (suffix) => {
    const res = await fetch(`${base}/units${suffix}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, v: 1, errors: expect.any(Array) });
  });

  it('does not accept POST', async () => {
    expect((await post('{}', '/units?query=SVP')).status).toBe(404);
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
    expect(json.errors).toEqual(['invalid JSON']);
  });

  it.each([null, [], false, 42, 'not an object'])('rejects a non-object JSON body: %j', async (body) => {
    const { status, json } = await post(JSON.stringify(body));
    expect(status).toBe(400);
    expect(json).toEqual({ ok: false, v: 1, errors: ['request must be a JSON object'] });
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it.each([true, false])('rejects an unfinished oversized upload before aborting its response (Content-Length: %s)', async (contentLength) => {
    let abortedBeforeResponse = false;
    const handler = createHandler({}, root);
    const observed = createServer((req, res) => {
      req.once('aborted', () => { if (!res.writableFinished) abortedBeforeResponse = true; });
      handler(req, res);
    });
    await new Promise<void>((resolve) => observed.listen(0, '127.0.0.1', resolve));
    const address = observed.address();
    if (!address || typeof address === 'string') throw new Error('no probe port');
    const probe = `http://127.0.0.1:${address.port}`;
    try {
      const { status, connection, json } = await oversizedPost(`${probe}/generate`, contentLength);
      expect(status).toBe(400);
      expect(connection).toBe('close');
      expect(json).toEqual({ ok: false, v: 1, errors: ['request body exceeds 16000000 bytes'] });
      expect(abortedBeforeResponse).toBe(false);
      expect((await fetch(`${probe}/health`)).status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => observed.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('does not poison the connection for the request that follows', async () => {
    // Oversized uploads explicitly close rather than reuse their connection.
    // A following normal request must still receive its validation response.
    const big = await oversizedPost(`${base}/generate`);
    expect(big.status).toBe(400);
    expect(big.connection).toBe('close');

    const next = await post(JSON.stringify({ docType: 'invoice', format: 'rtf', paragraphs: 'not an array' }));
    expect(next.status).toBe(400);
    expect(next.json.errors!.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects a mismatched contract version', async () => {
    const { status, json } = await post(JSON.stringify({ ...VALID, v: 99 }));
    expect(status).toBe(400);
    expect(json.errors?.join(' ')).toMatch(/contract version 99/);
  });

  it('refuses a key it does not publish, by name, as the MCP door does', async () => {
    // Stripping it silently is how a misspelled classification rendered an
    // unmarked document with a 200.
    const { status, json } = await post(JSON.stringify({
      docType: 'naval_letter', subject: 'TYPO', paragraphs: [{ text: 'x' }], clasification: { level: 'secret' },
    }));
    expect(status).toBe(400);
    expect(json.errors!.join(' ')).toMatch(/clasification/);
  });

  it('reports every problem at once rather than one per round-trip', async () => {
    const { status, json } = await post(JSON.stringify({ docType: 'invoice', format: 'rtf', paragraphs: 'not an array' }));
    expect(status).toBe(400);
    // docType + format + paragraphs shape, each named.
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
    // The schema names it first, in its own path form, the same as the MCP door.
    expect(problems.join(' ')).toMatch(/paragraphs\.1\.text/);
  });

  it('rejects an array where an object belongs', () => {
    expect(validate({ ...VALID, unit: [] as never }).join(' ')).toMatch(/unit: .*expected object/);
  });
});
