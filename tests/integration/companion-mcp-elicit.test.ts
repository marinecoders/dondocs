/**
 * The unit picker, driven by a client that can show a form.
 *
 * `companion-mcp-client.test.ts` connects with no capabilities and proves an
 * ambiguous lookup comes back as a list. This client declares elicitation, so
 * the same lookup should come back as a question, and only the answer should
 * be returned.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');
const QUERY = 'marine innovation unit';

type Lookup = { total: number; truncated: boolean; matches: Array<{ mcc: string | null; unit: { address?: string } }> };
type Picker = { message: string; requestedSchema: { properties: { unit: { oneOf: Array<{ const: string; title: string }> } }; required?: string[] } };

let client: Client;
let asked: Picker[] = [];
let answer: () => ElicitResult = () => ({ action: 'decline' });

const structured = (r: unknown): Lookup => (r as { structuredContent: Lookup }).structuredContent;
const isError = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;
const lookup = (query: string, limit = 20) => client.callTool({ name: 'dondocs_unit_lookup', arguments: { query, limit } });

beforeAll(async () => {
  client = new Client({ name: 'dondocs-picker', version: '1' }, { capabilities: { elicitation: {} } });
  client.setRequestHandler('elicitation/create', async (request: ElicitRequest) => {
    asked.push(request.params as unknown as Picker);
    return answer();
  });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(REPO, 'node_modules', 'vite-node', 'dist', 'cli.mjs'), 'companion/mcp.ts'],
    cwd: REPO,
    env: { ...process.env, DONDOCS_CONFIG: '/nonexistent/companion.config.json' },
    stderr: 'pipe',
  }));
}, 200_000);

afterAll(async () => { await client?.close(); });

describe('a client that can show a form', () => {
  it('is asked which unit when several match, and gets only the pick back', async () => {
    asked = [];
    answer = () => ({ action: 'decline' });
    const declined = await lookup(QUERY);
    expect(isError(declined)).toBe(false);
    expect(asked).toHaveLength(1);
    // Declining leaves the model where a client without forms is: the list.
    expect(structured(declined).total).toBe(7);
    expect(structured(declined).matches).toHaveLength(7);

    const { message, requestedSchema } = asked[0];
    expect(message).toMatch(/7 units match/);
    expect(requestedSchema.required).toEqual(['unit']);
    const options = requestedSchema.properties.unit.oneOf;
    expect(options.map((o) => o.const)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(options[1].title).toContain('NEWBURGH');
    expect(options[1].title).toContain('SVP');

    asked = [];
    answer = () => ({ action: 'accept', content: { unit: '1' } });
    const picked = await lookup(QUERY);
    expect(isError(picked)).toBe(false);
    expect(asked).toHaveLength(1);
    expect(structured(picked)).toMatchObject({ total: 1, truncated: false });
    expect(structured(picked).matches).toEqual([structured(declined).matches[1]]);
    expect(structured(picked).matches[0].mcc).toBe('SVP');
  }, 60_000);

  it('does not ask when one unit matches or when the list is truncated', async () => {
    asked = [];
    answer = () => { throw new Error('should not be asked'); };
    expect(structured(await lookup('Marine Innovation Unit Newburgh')).total).toBe(1);
    expect(structured(await lookup(QUERY, 2))).toMatchObject({ total: 7, truncated: true });
    expect(structured(await lookup('no-such-unit-xyz')).matches).toEqual([]);
    expect(asked).toHaveLength(0);
  }, 60_000);

  it('treats an answer outside the offered choices as a decline', async () => {
    asked = [];
    answer = () => ({ action: 'accept', content: { unit: '99' } });
    const res = await lookup(QUERY);
    expect(isError(res)).toBe(false);
    expect(structured(res).matches).toHaveLength(7);
    await expect(client.ping()).resolves.toBeDefined();
  }, 60_000);
});
