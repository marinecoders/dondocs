/**
 * The built server runs where nothing else is installed.
 *
 * `build:companion` bundles both entries and copies the render assets beside
 * them; `build:mcpb` stages that as a bundle a desktop client installs. Both
 * are started here from an empty directory with a minimal environment, so a
 * wrong asset path or a dependency the bundle forgot fails at the first
 * render rather than on a user's machine.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const REPO = resolve(import.meta.dirname, '..', '..');
const BUILT = join(REPO, 'dist-companion');
const MCPB_DIR = join(REPO, 'dist-mcpb');
const hasPandoc = spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;
const version = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf-8')).version as string;

type Msg = Record<string, unknown> & { result?: Record<string, unknown> & { isError?: boolean; content?: Array<{ text?: string }>; structuredContent?: Record<string, unknown> }; error?: { message: string } };

/** A raw JSON-RPC client over a child's stdio, with nothing of ours on its PATH or cwd. */
class Cold {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, (m: Msg) => void>();
  private nextId = 1;
  readonly junk: string[] = [];
  stderr = '';

  constructor(entry: string, cwd: string, out: string) {
    this.child = spawn(process.execPath, [entry], {
      cwd,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', DONDOCS_OUT_ROOT: out, DONDOCS_CONFIG: '/nonexistent/companion.config.json' },
    }) as ChildProcessWithoutNullStreams;
    this.child.stderr.on('data', (d: Buffer) => { this.stderr += d.toString(); });
    let buffer = '';
    this.child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString();
      let cut: number;
      while ((cut = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line) { continue; }
        try {
          const msg = JSON.parse(line) as Msg;
          if (msg.id !== undefined && !msg.method) { this.pending.get(msg.id as number)?.(msg); this.pending.delete(msg.id as number); }
        } catch { this.junk.push(line); }
      }
    });
  }

  call(method: string, params?: unknown): Promise<Msg> {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`${method} timed out. stderr:\n${this.stderr}`)), 180_000);
      this.pending.set(id, (m) => { clearTimeout(timer); res(m); });
    });
  }

  notify(method: string) { this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`); }
  close() { this.child.kill(); }
}

async function handshake(entry: string, cwd: string, out: string, capabilities: Record<string, unknown> = {}): Promise<Cold> {
  const server = new Cold(entry, cwd, out);
  const init = await server.call('initialize', { protocolVersion: '2025-11-25', capabilities, clientInfo: { name: 'cold', version: '1' } });
  expect(init.error, server.stderr).toBeUndefined();
  server.notify('notifications/initialized');
  return server;
}

const text = (m: Msg) => (m.result?.content ?? []).map((c) => c.text ?? '').join('');

/** What every entry must do from an empty directory. */
function rendersEverything(label: string, entry: () => string) {
  describe(label, () => {
    let server: Cold;
    let cwd: string;
    let out: string;

    beforeAll(async () => {
      cwd = await mkdtemp(join(tmpdir(), 'dondocs-cold-cwd-'));
      out = await mkdtemp(join(tmpdir(), 'dondocs-cold-out-'));
      server = await handshake(entry(), cwd, out);
    }, 200_000);
    afterAll(async () => {
      server?.close();
      for (const dir of [cwd, out]) { if (dir) { await rm(dir, { recursive: true, force: true }); } }
    });

    it('lists the four tools', async () => {
      const { result } = await server.call('tools/list', {});
      expect((result!.tools as Array<{ name: string }>).map((t) => t.name).sort()).toEqual([
        'dondocs_letter', 'dondocs_template_get', 'dondocs_template_list', 'dondocs_unit_lookup',
      ]);
    });

    it('renders a PDF that reads back', async () => {
      const res = await server.call('tools/call', { name: 'dondocs_letter', arguments: {
        docType: 'naval_letter', subject: 'COLD RUN', out: 'cold.pdf', from: 'F', to: 'T', paragraphs: [{ text: 'Rendered by the built server.' }],
      } });
      expect(res.result?.isError, text(res)).toBeFalsy();
      const path = res.result!.structuredContent!.path as string;
      expect(path.startsWith(out)).toBe(true);
      expect((await readFile(path)).subarray(0, 4).toString()).toBe('%PDF');
      if (hasPdfToolchain) {
        expect(execFileSync('pdftotext', ['-layout', path, '-']).toString()).toContain('COLD RUN');
      }
    }, 200_000);

    it('renders a DOCX when pandoc is present', async () => {
      if (!hasPandoc) {
        console.warn(`[${label}] pandoc missing - DOCX case SKIPPED locally.`);
        expect(Boolean(process.env.CI), 'CI must install pandoc; without it this case proves nothing.').toBe(false);
        return;
      }
      const res = await server.call('tools/call', { name: 'dondocs_letter', arguments: {
        docType: 'naval_letter', format: 'docx', subject: 'COLD DOCX', out: 'cold.docx', paragraphs: [{ text: 'x' }],
      } });
      expect(res.result?.isError, text(res)).toBeFalsy();
      expect((await readFile(res.result!.structuredContent!.path as string)).subarray(0, 2).toString('latin1')).toBe('PK');
    }, 200_000);

    it('carries the letter card page, self-contained, and points the render tool at it', async () => {
      const { result } = await server.call('tools/list', {});
      const letter = (result!.tools as Array<{ name: string; _meta?: { ui?: { resourceUri?: string }; 'ui/resourceUri'?: string } }>).find((t) => t.name === 'dondocs_letter')!;
      // Both keys, as the SDK writes them: hosts on the earlier draft read the flat one.
      expect(letter._meta?.ui?.resourceUri).toBe('ui://dondocs/letter.html');
      expect(letter._meta?.['ui/resourceUri']).toBe('ui://dondocs/letter.html');
      const read = await server.call('resources/read', { uri: 'ui://dondocs/letter.html' });
      const [page] = read.result!.contents as Array<{ mimeType: string; text: string }>;
      expect(page.mimeType).toBe('text/html;profile=mcp-app');
      // The sandbox loads nothing from the network: the bridge, pdf.js and
      // its worker are in the file, and the page reads the letter back
      // through the files resource.
      expect(page.text).toContain('<script');
      // The slot is filled by a replacer function; a string replacement once
      // pasted the slot's own text wherever the bundle said `$&`.
      expect(page.text).not.toContain('<!-- letter.js -->');
      expect(page.text).toContain('WorkerMessageHandler');
      expect(page.text).toContain('dondocs://files/');
      expect(page.text).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
    });

    it('tells a host that renders pages the letter is in the chat, and any other to present the file', async () => {
      const pages = await handshake(entry(), cwd, out, { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } });
      try {
        const args = { docType: 'naval_letter', subject: 'BY HOST', out: 'host.pdf', from: 'F', to: 'T', paragraphs: [{ text: 'Body.' }] };
        const card = await pages.call('tools/call', { name: 'dondocs_letter', arguments: args });
        expect(card.result?.isError, text(card)).toBeFalsy();
        expect(text(card)).toMatch(/\nThe letter is shown in the chat as a card\. .*out "host\.pdf"/);
        expect(text(card)).not.toContain('present_files');
        const plain = await server.call('tools/call', { name: 'dondocs_letter', arguments: args });
        expect(text(plain)).toMatch(/\nShow it in the chat: call present_files/);
      } finally {
        pages.close();
      }
    }, 200_000);

    it('keeps stdout to the protocol', () => {
      expect(server.junk).toEqual([]);
    });
  });
}

describeToolchainRequirement('companion-dist');

describe('the companion build', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', '--silent', 'build:companion'], { cwd: REPO, stdio: 'pipe' });
  }, 300_000);

  it('writes both entries and the render assets, and not the browser pandoc', () => {
    for (const file of ['companion/mcp.mjs', 'companion/server.mjs', 'companion/engineWorker.mjs', 'lib/texlive-packages.js', 'lib/swiftlatexpdftex.wasm', 'lib/pandoc/dondocs.lua', 'lib/pandoc/reference.docx', 'attachments/dow-seal.png']) {
      expect(existsSync(join(BUILT, file)), file).toBe(true);
    }
    expect(readdirSync(join(BUILT, 'lib', 'pandoc')).some((f) => f.includes('wasm')), 'the 56 MB browser pandoc has no place in the server build').toBe(false);
  });

  rendersEverything('the built file', () => join(BUILT, 'companion', 'mcp.mjs'));

  it('serves HTTP from the built file too', async () => {
    const out = await mkdtemp(join(tmpdir(), 'dondocs-cold-http-'));
    const port = 7700 + Math.floor(Math.random() * 200);
    const proc = spawn(process.execPath, [join(BUILT, 'companion', 'server.mjs')], {
      cwd: out,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', DONDOCS_OUT_ROOT: out, DONDOCS_CONFIG: '/nonexistent', DONDOCS_PORT: String(port) },
    });
    try {
      let health: Response | undefined;
      for (let i = 0; i < 60 && !health; i++) {
        health = await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined);
        if (!health) { await new Promise((r) => setTimeout(r, 500)); }
      }
      expect(health?.status).toBe(200);
      const res = await fetch(`http://127.0.0.1:${port}/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ docType: 'naval_letter', subject: 'HTTP COLD', paragraphs: [{ text: 'x' }], out: 'http.pdf' }),
      });
      expect(res.status).toBe(200);
      expect(existsSync(join(out, 'http.pdf'))).toBe(true);
    } finally {
      proc.kill();
      await rm(out, { recursive: true, force: true });
    }
  }, 200_000);
});

describe('the MCP Bundle', () => {
  let unpacked: string;

  beforeAll(async () => {
    execFileSync('npm', ['run', '--silent', 'build:mcpb'], { cwd: REPO, stdio: 'pipe' });
    unpacked = await mkdtemp(join(tmpdir(), 'dondocs-mcpb-'));
    execFileSync('npx', ['--yes', '@anthropic-ai/mcpb@2.1.2', 'unpack', join(MCPB_DIR, `dondocs-${version}.mcpb`), unpacked], { cwd: REPO, stdio: 'pipe' });
  }, 600_000);
  afterAll(async () => { if (unpacked) { await rm(unpacked, { recursive: true, force: true }); } });

  it('carries the manifest, the entry it names, and a checksum beside the file', async () => {
    const manifest = JSON.parse(await readFile(join(unpacked, 'manifest.json'), 'utf-8'));
    expect(manifest.version).toBe(version);
    expect(manifest.server.mcp_config.args).toEqual(['${__dirname}/companion/mcp.mjs']);
    // The desktop app installs an extension with a required setting switched
    // off, default or no default, until the person saves the settings page.
    for (const [key, field] of Object.entries<{ required?: boolean }>(manifest.user_config)) {
      expect(field.required, `${key} would leave the extension off after install`).not.toBe(true);
    }
    expect(existsSync(join(unpacked, manifest.server.entry_point))).toBe(true);
    expect(existsSync(join(MCPB_DIR, `dondocs-${version}.mcpb.sha256`))).toBe(true);
  });

  rendersEverything('the unpacked bundle', () => join(unpacked, 'companion', 'mcp.mjs'));
});
