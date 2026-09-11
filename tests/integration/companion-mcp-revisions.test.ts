/**
 * The server answers in the vocabulary of the revision each client speaks.
 *
 * The SDK negotiates every revision it lists but does not translate results,
 * so a block or a schema shape from a newer revision reaches an older client
 * verbatim and is rejected there. Each case here opens its own server, speaks
 * raw JSON-RPC at one revision, and checks what comes back.
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');
const QUERY = 'marine innovation unit';
const LETTER = { docType: 'naval_letter', subject: 'REVISION', out: 'revision.pdf', from: 'F', to: 'T', paragraphs: [{ text: 'Body.' }] };

// The wire is untyped on purpose: the point is what each revision actually receives.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = Record<string, any>;

class Wire {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, (m: Msg) => void>();
  private nextId = 1;
  /** Requests the server sent us (elicitation), in order. */
  readonly serverRequests: Msg[] = [];
  answer: Msg = { action: 'decline' };

  constructor(readonly root: string) {
    this.child = spawn(process.execPath, [join(REPO, 'node_modules', 'vite-node', 'dist', 'cli.mjs'), 'companion/mcp.ts'], {
      cwd: REPO,
      env: { ...process.env, DONDOCS_OUT_ROOT: root, DONDOCS_CONFIG: '/nonexistent/companion.config.json' },
    }) as ChildProcessWithoutNullStreams;
    let buffer = '';
    this.child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString();
      let cut: number;
      while ((cut = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line) { continue; }
        const msg = JSON.parse(line) as Msg;
        if (msg.method && msg.id !== undefined) {
          this.serverRequests.push(msg);
          this.send({ jsonrpc: '2.0', id: msg.id, result: this.answer });
        } else if (msg.id !== undefined) {
          this.pending.get(msg.id)?.(msg);
          this.pending.delete(msg.id);
        }
      }
    });
  }

  send(msg: Msg) { this.child.stdin.write(`${JSON.stringify(msg)}\n`); }

  call(method: string, params?: unknown): Promise<Msg> {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, params });
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`${method} timed out`)), 180_000);
      this.pending.set(id, (m) => { clearTimeout(timer); res(m); });
    });
  }

  async initialize(protocolVersion: string, capabilities: Msg = {}): Promise<string> {
    const init = await this.call('initialize', { protocolVersion, capabilities, clientInfo: { name: 'revisions', version: '1' } });
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return init.result.protocolVersion;
  }

  close() { this.child.kill(); }
}

let wire: Wire | undefined;
let root: string;

async function open(): Promise<Wire> {
  root = await mkdtemp(join(tmpdir(), 'dondocs-rev-'));
  wire = new Wire(root);
  return wire;
}

afterEach(async () => {
  wire?.close();
  wire = undefined;
  if (root) { await rm(root, { recursive: true, force: true }); }
});

const contentTypes = (r: Msg): string[] => (r.result.content as Msg[]).map((c) => c.type);
const unitField = (w: Wire): Msg => w.serverRequests[0].params.requestedSchema.properties.unit;

describe('a client on 2025-03-26', () => {
  it('gets the letter result without the resource_link block that revision lacks', async () => {
    const w = await open();
    expect(await w.initialize('2025-03-26')).toBe('2025-03-26');
    const res = await w.call('tools/call', { name: 'dondocs_letter', arguments: LETTER });
    expect(res.result.isError, JSON.stringify(res.result)).toBeFalsy();
    expect(contentTypes(res)).toEqual(['text']);
  }, 200_000);

  it('is never asked to pick a unit, since elicitation did not exist yet', async () => {
    const w = await open();
    await w.initialize('2025-03-26', { elicitation: {} });
    const res = await w.call('tools/call', { name: 'dondocs_unit_lookup', arguments: { query: QUERY } });
    expect(w.serverRequests).toHaveLength(0);
    expect(res.result.structuredContent.total).toBe(7);
  }, 60_000);
});

describe('a client on 2025-06-18', () => {
  it('gets the resource_link block', async () => {
    const w = await open();
    expect(await w.initialize('2025-06-18')).toBe('2025-06-18');
    const res = await w.call('tools/call', { name: 'dondocs_letter', arguments: LETTER });
    expect(contentTypes(res)).toEqual(['text', 'resource_link']);
  }, 200_000);

  it('is offered the unit choices as enum and enumNames, the only titled form it knows', async () => {
    const w = await open();
    await w.initialize('2025-06-18', { elicitation: {} });
    w.answer = { action: 'accept', content: { unit: '1' } };
    const res = await w.call('tools/call', { name: 'dondocs_unit_lookup', arguments: { query: QUERY } });
    expect(w.serverRequests).toHaveLength(1);
    const field = unitField(w);
    expect(field.oneOf).toBeUndefined();
    expect(field.enum).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(field.enumNames).toHaveLength(7);
    expect(field.enumNames[1]).toContain('NEWBURGH');
    expect(res.result.structuredContent.matches[0].mcc).toBe('SVP');
  }, 60_000);
});

describe('a client on 2025-11-25', () => {
  it('is offered the unit choices as a titled oneOf', async () => {
    const w = await open();
    await w.initialize('2025-11-25', { elicitation: {} });
    await w.call('tools/call', { name: 'dondocs_unit_lookup', arguments: { query: QUERY } });
    const field = unitField(w);
    expect(field.enum).toBeUndefined();
    expect(field.oneOf).toHaveLength(7);
    expect(field.oneOf[1]).toMatchObject({ const: '1', title: expect.stringContaining('NEWBURGH') });
  }, 60_000);
});

describe('any client', () => {
  it('may omit the arguments member when it gets the prompt', async () => {
    const w = await open();
    await w.initialize('2025-11-25');
    const res = await w.call('prompts/get', { name: 'draft_letter' });
    expect(res.error, JSON.stringify(res.error)).toBeUndefined();
    expect(res.result.messages).toHaveLength(1);
  }, 60_000);
});

describe('a client on 2026-07-28, which carries its capabilities per request', () => {
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
    'io.modelcontextprotocol/clientInfo': { name: 'revisions', version: '1' },
  };

  it('is asked to pick a unit in band, and the retry carries the answer', async () => {
    const w = await open();
    const first = await w.call('tools/call', { _meta: meta, name: 'dondocs_unit_lookup', arguments: { query: QUERY } });
    expect(w.serverRequests, 'the 2026 era has no server-to-client request').toHaveLength(0);
    expect(first.result.resultType).toBe('input_required');
    expect(first.result.inputRequests.unit).toBeDefined();
    const retry = await w.call('tools/call', {
      _meta: meta, name: 'dondocs_unit_lookup', arguments: { query: QUERY },
      inputResponses: { unit: { action: 'accept', content: { unit: '1' } } },
    });
    expect(retry.result.structuredContent.matches).toHaveLength(1);
    expect(retry.result.structuredContent.matches[0].mcc).toBe('SVP');
  }, 60_000);
});
