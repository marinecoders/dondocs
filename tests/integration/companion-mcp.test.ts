/**
 * The MCP server, driven the way a client drives it.
 *
 * This spawns the real process and speaks newline-delimited JSON-RPC over its
 * stdio — no SDK client, no in-memory transport. That is deliberate: the things
 * most likely to break are the ones a mocked transport hides. A stray
 * `console.log` corrupts the protocol channel, and a schema that fails to
 * serialize leaves the tool invisible to the client while every unit test still
 * passes.
 *
 * The render case is the slow one and it is the point — it proves the MCP path
 * reaches the same generator the HTTP path does, and writes a real PDF.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let child: ChildProcessWithoutNullStreams;
let root: string;
let stderr = '';
const stdoutJunk: string[] = [];
const pending = new Map<number, (msg: Record<string, unknown>) => void>();
let nextId = 1;
let negotiated = '';

/** One JSON-RPC round trip. */
function call(method: string, params?: unknown, timeoutMs = 180_000): Promise<Record<string, unknown>> {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`${method} timed out. stderr:\n${stderr}`)), timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); res(msg); });
  });
}

function notify(method: string, params?: unknown) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-mcp-'));
  child = spawn(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), 'companion/mcp.ts'], {
    cwd: resolve(import.meta.dirname, '..', '..'),
    env: { ...process.env, DONDOCS_OUT_ROOT: root, DONDOCS_CONFIG: '/nonexistent/companion.config.json' },
  }) as ChildProcessWithoutNullStreams;

  child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

  let buffer = '';
  child.stdout.on('data', (d: Buffer) => {
    buffer += d.toString();
    let cut: number;
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) { continue; }
      // A non-JSON line means something wrote to stdout that is not a protocol
      // message. Collect it rather than throwing: an exception in a stream
      // handler kills the run with an unhelpful trace, while a collected line
      // becomes a named assertion below.
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        stdoutJunk.push(line);
        continue;
      }
      const resolveFn = pending.get(msg.id as number);
      if (resolveFn) { pending.delete(msg.id as number); resolveFn(msg); }
    }
  });

  const init = await call('initialize', {
    // A revision this hand-written driver speaks — a floor, not a claim about
    // what the server prefers. companion-mcp-client.test.ts covers negotiation.
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'dondocs-test', version: '1' },
  });
  expect(init.error, JSON.stringify(init.error)).toBeUndefined();
  negotiated = (init.result as { protocolVersion?: string })?.protocolVersion ?? '';
  notify('notifications/initialized');
}, 200_000);

afterAll(() => { child?.kill(); });

describe('the MCP server', () => {
  it('answers the handshake with a protocol version', () => {
    // Shape, not value. The server is free to settle on a revision newer than
    // the one this driver opened with.
    expect(negotiated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('advertises dondocs_letter with a usable schema', async () => {
    const res = await call('tools/list');
    const tools = (res.result as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }).tools;
    const tool = tools.find((t) => t.name === 'dondocs_letter');
    expect(tool, `tools: ${tools.map((t) => t.name).join(', ')}`).toBeDefined();

    const props = tool!.inputSchema.properties as Record<string, unknown>;
    // Publishing the field names is what MCP buys over a raw HTTP call.
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['docType', 'subject', 'paragraphs', 'unit']));
    expect(tool!.inputSchema.required).toContain('docType');
    // The address must be one string, which is the trap that bit us before.
    const unitProps = ((props.unit as Record<string, unknown>).properties ?? {}) as Record<string, unknown>;
    expect(unitProps).toHaveProperty('address');
    expect(unitProps).not.toHaveProperty('city');
  }, 60_000);

  it('renders a real PDF through the same generator the HTTP path uses', async () => {
    const res = await call('tools/call', {
      name: 'dondocs_letter',
      arguments: {
        docType: 'naval_letter',
        subject: 'MCP TRANSPORT CHECK',
        from: 'Commanding Officer, 1st Battalion, 6th Marines',
        to: 'Commanding General, II MEF',
        paragraphs: [{ text: 'This letter was produced over the MCP transport.' }],
      },
    });

    const result = res.result as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(result.isError, result.content?.[0]?.text).toBeFalsy();

    const text = result.content[0].text;
    expect(text).toMatch(/^Wrote PDF/);
    const path = text.match(/ to (.+)$/)![1];
    expect(path.startsWith(root)).toBe(true);

    // A path is only worth returning if it names a real document.
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(10_000);
  }, 200_000);

  it('refuses a path outside the output root and says so as a tool error', async () => {
    const res = await call('tools/call', {
      name: 'dondocs_letter',
      arguments: { docType: 'naval_letter', subject: 'ESCAPE', out: '../../../../tmp/pwned.pdf' },
    });
    const result = res.result as { isError?: boolean; content: Array<{ text: string }> };
    // isError, not a protocol error: the model should read it and retry with a
    // sane filename rather than the client treating the server as broken.
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside the output root/);
  }, 60_000);

  it('rejects an unknown docType via the published schema', async () => {
    const res = await call('tools/call', {
      name: 'dondocs_letter',
      arguments: { docType: 'invoice', subject: 'X' },
    });
    // Either the SDK rejects it as invalid params or the tool reports an error;
    // what must NOT happen is an invoice rendering as a naval letter.
    const failed = res.error !== undefined || (res.result as { isError?: boolean })?.isError === true;
    expect(failed, JSON.stringify(res)).toBe(true);
  }, 60_000);

  it('refuses a letter with no subject and no paragraphs', async () => {
    // This is the rule MCP used to skip while HTTP enforced it: the schema
    // makes both fields optional, so an empty letter validated fine and
    // rendered a page carrying nothing but a letterhead.
    const res = await call('tools/call', {
      name: 'dondocs_letter',
      arguments: { docType: 'naval_letter' },
    });
    const result = res.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError, JSON.stringify(res)).toBe(true);
    expect(result.content[0].text).toMatch(/nothing to render/);
  }, 60_000);

  it('starts and keeps stdout clean when launched the way the docs say to launch it', async () => {
    // The suite above spawns from the repo. docs/COMPANION.md hands out a
    // launch form a client runs from its own working directory, with `--root`
    // so modules resolve; that form is part of the contract.
    const repo = resolve(import.meta.dirname, '..', '..');
    const proc = spawn(process.execPath, [
      join(repo, 'node_modules', 'vite-node', 'dist', 'cli.mjs'), '--root', repo, join(repo, 'companion', 'mcp.ts'),
    ], {
      cwd: tmpdir(),
      env: { ...process.env, DONDOCS_OUT_ROOT: root, DONDOCS_CONFIG: '/nonexistent/companion.config.json' },
    }) as ChildProcessWithoutNullStreams;

    try {
      const lines: string[] = [];
      proc.stdout.on('data', (d: Buffer) => { lines.push(...d.toString().split('\n')); });
      proc.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'launch-form', version: '1' } },
      })}\n`);

      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && !lines.some((l) => l.includes('"result"'))) {
        await new Promise((r) => setTimeout(r, 100));
      }

      // A server that never started would leave stdout clean too.
      expect(lines.some((l) => l.includes('"result"')), 'no initialize reply from the documented launch form').toBe(true);
      const junk = lines.map((l) => l.trim()).filter(Boolean).filter((l) => {
        try { JSON.parse(l); return false; } catch { return true; }
      });
      expect(junk, `non-protocol stdout from the documented launch form:\n${junk.join('\n')}`).toEqual([]);
    } finally {
      proc.kill();
    }
  }, 90_000);

  it('keeps stdout clean — diagnostics go to stderr', () => {
    // The whole session ran above. Anything on stdout that was not a protocol
    // message would have broken a real client's parser; vite's texlive plugin
    // banner used to land here.
    expect(stdoutJunk, `non-protocol stdout:\n${stdoutJunk.join('\n')}`).toEqual([]);
    expect(stderr).toMatch(/dondocs MCP server ready/);
  });
});
