/**
 * The server driven by the published protocol client.
 *
 * `companion-mcp.test.ts` writes the JSON-RPC frames itself, which is how it can
 * prove stdout carries nothing but protocol. A driver written against the same
 * reading of the spec as the server shares its blind spots, so this one covers
 * what that cannot: version negotiation, capabilities, ping, concurrent calls
 * and shutdown.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');

let client: Client;
let root: string;

const text = (r: unknown): string =>
  ((r as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? '').join('');
const pathOf = (r: unknown): string | undefined => (text(r).match(/ to (.+)$/) ?? [])[1];
const isError = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-client-'));
  client = new Client({ name: 'dondocs-conformance', version: '1' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({
    // Run the entry directly rather than through a package manager, so the
    // child is the server and not a wrapper that owns its stdio.
    command: process.execPath,
    args: [join(REPO, 'node_modules', 'vite-node', 'dist', 'cli.mjs'), 'companion/mcp.ts'],
    cwd: REPO,
    env: { ...process.env, DONDOCS_OUT_ROOT: root, DONDOCS_CONFIG: '/nonexistent/companion.config.json' },
    stderr: 'pipe',
  }));
}, 200_000);

afterAll(async () => {
  await client?.close();
  if (root) { await rm(root, { recursive: true, force: true }); }
});

describe('a protocol client', () => {
  it('negotiates a protocol version both sides agree on', () => {
    const negotiated = client.getNegotiatedProtocolVersion();
    // Asserted, not pinned — a hardcoded revision goes stale unnoticed.
    expect(typeof negotiated).toBe('string');
    expect(negotiated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reports its identity and tool capability', () => {
    expect(client.getServerVersion()?.name).toBe('dondocs');
    expect(client.getServerCapabilities()?.tools).toBeDefined();
  });

  it('answers ping', async () => {
    await expect(client.ping()).resolves.toBeDefined();
  });

  it('publishes one tool whose schema names the fields that matter', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['dondocs_letter']);

    const schema = tools[0].inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    const props = Object.keys(schema.properties ?? {});
    // classification was missing here while the HTTP door honoured it.
    expect(props).toEqual(expect.arrayContaining(['docType', 'subject', 'paragraphs', 'unit', 'classification']));
    expect(schema.required).toContain('docType');
    expect(schema.additionalProperties, 'an unnamed field must be refused, not stripped').toBe(false);
  }, 60_000);

  it('renders a real PDF', async () => {
    const res = await client.callTool({ name: 'dondocs_letter', arguments: {
      docType: 'naval_letter', out: 'client.pdf', subject: 'PROTOCOL CLIENT CHECK',
      from: 'Commanding Officer, Test Unit', to: 'Commanding General, Test Command',
      paragraphs: [{ text: 'Rendered through the published client.' }],
    } });
    expect(isError(res), text(res)).toBe(false);

    const file = pathOf(res);
    expect(file?.startsWith(root)).toBe(true);
    const bytes = await readFile(file!);
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
  }, 200_000);

  it('carries a classification into the document', async () => {
    const res = await client.callTool({ name: 'dondocs_letter', arguments: {
      docType: 'naval_letter', out: 'marked.pdf', subject: 'MARKED',
      from: 'F', to: 'T', paragraphs: [{ text: 'Body.' }],
      classification: { level: 'secret' },
    } });
    expect(isError(res), text(res)).toBe(false);
    // Size is a proxy the toolchain always has: the banner adds page furniture
    // to every page. The text-level assertion lives with the pdftotext suites.
    const marked = (await readFile(pathOf(res)!)).byteLength;

    const plain = await client.callTool({ name: 'dondocs_letter', arguments: {
      docType: 'naval_letter', out: 'plain.pdf', subject: 'MARKED',
      from: 'F', to: 'T', paragraphs: [{ text: 'Body.' }],
    } });
    const unmarked = (await readFile(pathOf(plain)!)).byteLength;
    expect(marked, 'a classified document rendered byte-identical to an unclassified one').not.toBe(unmarked);
  }, 200_000);

  it('refuses a field it does not publish', async () => {
    const res = await client.callTool({ name: 'dondocs_letter', arguments: {
      docType: 'naval_letter', subject: 'TYPO', paragraphs: [{ text: 'x' }],
      clasification: { level: 'secret' },
    } }).then((r) => r, (e: Error) => ({ isError: true, content: [{ text: e.message }] }));
    expect(isError(res)).toBe(true);
    expect(text(res)).toMatch(/clasification/);
  }, 60_000);

  it('refuses a path outside the output root and writes nothing', async () => {
    const res = await client.callTool({ name: 'dondocs_letter', arguments: {
      docType: 'naval_letter', subject: 'ESCAPE', out: '../../../../tmp/pwned.pdf',
      paragraphs: [{ text: 'x' }],
    } });
    expect(isError(res)).toBe(true);
    expect(text(res)).toMatch(/outside the output root/);
    expect(existsSync('/tmp/pwned.pdf')).toBe(false);
  }, 60_000);

  it('handles concurrent calls without crossing them', async () => {
    const results = await Promise.all([1, 2, 3].map((n) => client.callTool({
      name: 'dondocs_letter',
      arguments: {
        docType: 'naval_letter', out: `conc-${n}.pdf`, subject: `CONCURRENT ${n}`,
        from: 'F', to: 'T', paragraphs: [{ text: `Render ${n}.` }],
      },
    })));
    expect(results.every((r) => !isError(r)), results.map(text).join(' | ')).toBe(true);
    // The engine cannot compile two documents at once; the queue that serialises
    // them must still return three distinct files.
    expect(new Set(results.map(pathOf)).size).toBe(3);
  }, 200_000);

  it('stays usable after every failure above', async () => {
    const res = await client.callTool({ name: 'dondocs_letter', arguments: {
      docType: 'naval_letter', out: 'after.pdf', subject: 'STILL ALIVE',
      from: 'F', to: 'T', paragraphs: [{ text: 'The session survived.' }],
    } });
    expect(isError(res), text(res)).toBe(false);
    await expect(client.ping()).resolves.toBeDefined();
  }, 200_000);
});
