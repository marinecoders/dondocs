/**
 * The defaults resource shows what a render without `unit` will use.
 *
 * The other client suites run with no config file. This one writes a config,
 * starts the server on it, and checks that the resource reports it and that a
 * letter rendered without a unit carries it.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const REPO = resolve(import.meta.dirname, '..', '..');

// Every key set, and an SSIC that differs from the built-in fallback, so the
// render check cannot pass on the fallback by coincidence.
const config = {
  unit: { name: 'DEFAULTS RESOURCE UNIT', line2: 'PARENT COMMAND', address: 'PSC BOX 1, QUANTICO VA 22134', department: 'usmc' },
  signature: { first: 'A', middle: 'B', last: 'SMITH', rank: 'Major', title: 'Officer in Charge' },
  ssic: '1650',
  originatorCode: 'S-6',
};

let client: Client;
let root: string;
let configPath: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-defaults-'));
  configPath = join(root, 'companion.config.json');
  await writeFile(configPath, JSON.stringify(config));
  client = new Client({ name: 'dondocs-defaults', version: '1' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(REPO, 'node_modules', 'vite-node', 'dist', 'cli.mjs'), 'companion/mcp.ts'],
    cwd: REPO,
    env: { ...process.env, DONDOCS_OUT_ROOT: root, DONDOCS_CONFIG: configPath },
    stderr: 'pipe',
  }));
}, 200_000);

afterAll(async () => {
  await client?.close();
  if (root) { await rm(root, { recursive: true, force: true }); }
});

describe('the defaults resource', () => {
  describeToolchainRequirement('companion-mcp-defaults');

  it('reports the configured defaults and where they came from', async () => {
    const { contents } = await client.readResource({ uri: 'dondocs://defaults' });
    expect(JSON.parse((contents[0] as { text: string }).text)).toEqual({ path: configPath, ...config });
  });

  it.skipIf(!hasPdfToolchain)('matches what a render without a unit uses', async () => {
    const res = await client.callTool({ name: 'dondocs_letter', arguments: {
      docType: 'naval_letter', out: 'defaults.pdf', subject: 'DEFAULTS', from: 'F', to: 'T', paragraphs: [{ text: 'Body.' }],
    } });
    expect((res as { isError?: boolean }).isError, JSON.stringify((res as { content?: unknown }).content)).not.toBe(true);
    const { path } = (res as { structuredContent: { path: string } }).structuredContent;
    const text = spawnSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf-8' }).stdout;
    expect(text).toContain(config.unit.name);
    expect(text).toContain('A. B. SMITH');
    expect(text).toContain(config.ssic);
    expect(text).toContain(config.originatorCode);
  }, 200_000);
});
