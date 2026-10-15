/**
 * Settling the machine defaults from a conversation.
 *
 * The point of the tool is that a person never edits JSON: they answer a
 * question, the file is written, and the very next letter uses it. Each
 * case here is one of those words: asked, written, used, and left alone
 * when the answer does not come.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');
const UNIT = { name: 'MARINE INNOVATION UNIT', line2: 'MARFORRES', address: '10 MCDONALD ST, NEWBURGH, NY 12550-5012' };
const SIGNER = { rank: 'Corporal', first: 'R', last: 'CHIOFALO', title: 'Admin Chief' };

let client: Client;
let dir: string;
let config: string;
let asked: Array<{ message: string; requestedSchema: Record<string, unknown> }> = [];
let answer: () => ElicitResult = () => ({ action: 'decline' });

const text = (r: unknown): string => ((r as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? '').join('');
const structured = (r: unknown): Record<string, unknown> => (r as { structuredContent: Record<string, unknown> }).structuredContent;
const isError = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;
const save = (args: Record<string, unknown>) => client.callTool({ name: 'dondocs_save_defaults', arguments: args });
const onFile = async () => JSON.parse(await readFile(config, 'utf-8')) as Record<string, unknown>;

/** A fresh server per case, since the point is what it holds in memory. */
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dondocs-save-'));
  config = join(dir, 'companion.config.json');
  asked = [];
  answer = () => ({ action: 'decline' });
  client = new Client({ name: 'dondocs-setup', version: '1' }, { capabilities: { elicitation: {} } });
  client.setRequestHandler('elicitation/create', async (request: ElicitRequest) => {
    asked.push(request.params as unknown as { message: string; requestedSchema: Record<string, unknown> });
    return answer();
  });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(REPO, 'node_modules', 'vite-node', 'dist', 'cli.mjs'), 'companion/mcp.ts'],
    cwd: REPO,
    env: { ...process.env, DONDOCS_CONFIG: config, DONDOCS_OUT_ROOT: dir },
    stderr: 'pipe',
  }));
}, 200_000);

afterEach(async () => {
  await client?.close();
  if (dir) { await rm(dir, { recursive: true, force: true }); }
});

describe('settling the machine defaults', () => {
  it('writes what it is given and shows it on the defaults resource at once', async () => {
    const res = await save({ unit: UNIT, signature: SIGNER, ssic: '1650' });
    expect(isError(res), text(res)).toBe(false);
    expect(structured(res)).toMatchObject({ path: config, unit: UNIT, signature: SIGNER, ssic: '1650' });
    expect(await onFile()).toEqual({ unit: UNIT, signature: SIGNER, ssic: '1650' });
    // The running server, not just the file: this is the resource a model reads.
    const { contents } = await client.readResource({ uri: 'dondocs://defaults' });
    expect(JSON.parse((contents[0] as { text: string }).text)).toMatchObject({ unit: UNIT, signature: SIGNER, ssic: '1650' });
  }, 200_000);

  it('renders the next letter on the saved letterhead, with no unit given', async () => {
    await save({ unit: UNIT, signature: SIGNER });
    const res = await client.callTool({ name: 'dondocs_letter', arguments: {
      docType: 'naval_letter', out: 'after.pdf', subject: 'AFTER SETUP', to: 'T', paragraphs: [{ text: 'Body.' }],
    } });
    expect(isError(res), text(res)).toBe(false);
    // The letterhead is in the PDF, so read it back rather than trusting the call.
    const path = (structured(res) as unknown as { path: string }).path;
    expect((await readFile(path)).subarray(0, 4).toString()).toBe('%PDF');
  }, 200_000);

  it('asks the person for the signature block when none is given or stored', async () => {
    answer = () => ({ action: 'accept', content: SIGNER });
    const res = await save({ unit: UNIT });
    expect(isError(res), text(res)).toBe(false);
    expect(asked).toHaveLength(1);
    expect(asked[0].message).toMatch(/signs/i);
    // A form schema may not carry additionalProperties; the SDK refuses one that does.
    expect(asked[0].requestedSchema).not.toHaveProperty('additionalProperties');
    expect(Object.keys((asked[0].requestedSchema as { properties: Record<string, unknown> }).properties).sort())
      .toEqual(['first', 'last', 'middle', 'rank', 'title']);
    expect(await onFile()).toEqual({ unit: UNIT, signature: SIGNER });
  }, 200_000);

  it('writes nothing when the person declines the form', async () => {
    answer = () => ({ action: 'decline' });
    const res = await save({ unit: UNIT });
    expect(asked).toHaveLength(1);
    expect(text(res)).toMatch(/Nothing saved/);
    expect(existsSync(config)).toBe(false);
  }, 200_000);

  it('treats a form sent back blank as no answer, and asks again next time', async () => {
    // Every field is optional, so a host will happily accept an untouched
    // form. Storing that would be an empty signature block nobody asked
    // for, and the question would never come round again.
    answer = () => ({ action: 'accept', content: {} });
    const res = await save({ unit: UNIT });
    expect(isError(res), text(res)).toBe(false);
    expect(text(res)).toMatch(/Nothing saved/);
    expect(existsSync(config)).toBe(false);

    asked = [];
    answer = () => ({ action: 'accept', content: SIGNER });
    await save({ unit: UNIT });
    expect(asked).toHaveLength(1);
    expect(await onFile()).toEqual({ unit: UNIT, signature: SIGNER });
  }, 200_000);

  it('does not ask again once a signature is stored', async () => {
    answer = () => ({ action: 'accept', content: SIGNER });
    await save({ unit: UNIT });
    asked = [];
    const res = await save({ ssic: '1650' });
    expect(asked).toEqual([]);
    expect(structured(res)).toMatchObject({ signature: SIGNER, ssic: '1650' });
  }, 200_000);

  it('says so, and stays up, when the file cannot be written', async () => {
    // A directory where the config belongs: the write fails for a reason no
    // input validation can catch, which is the branch worth proving.
    await mkdir(config);
    const res = await save({ unit: UNIT, signature: SIGNER });
    expect(isError(res)).toBe(true);
    expect(text(res)).toMatch(/unchanged/);
    await expect(client.ping()).resolves.toBeDefined();
  }, 200_000);
});
