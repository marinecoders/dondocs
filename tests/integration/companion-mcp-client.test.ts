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
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { LETTER_TEMPLATES } from '../../src/data/templates';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

const hasPandoc = spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

const REPO = resolve(import.meta.dirname, '..', '..');

let client: Client;
let root: string;

const text = (r: unknown): string =>
  ((r as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? '').join('');
const pathOf = (r: unknown): string | undefined => (text(r).match(/ to (.+)$/) ?? [])[1];
const isError = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;
const structured = (r: unknown): unknown => (r as { structuredContent?: unknown }).structuredContent;
const blocks = (r: unknown, type: string): Array<Record<string, unknown>> =>
  ((r as { content?: Array<Record<string, unknown>> }).content ?? []).filter((c) => c.type === type);

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

  it('tells the model how the tools fit together', () => {
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain(root);
    for (const name of ['dondocs_unit_lookup', 'dondocs_template_get', 'dondocs_letter', 'dondocs://defaults', 'From']) {
      expect(instructions).toContain(name);
    }
  });

  it('answers ping', async () => {
    await expect(client.ping()).resolves.toBeDefined();
  });

  it('publishes letter and lookup tools with their input schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'dondocs_letter', 'dondocs_template_get', 'dondocs_template_list', 'dondocs_unit_lookup',
    ]);

    const schema = tools.find((t) => t.name === 'dondocs_letter')!.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    const props = Object.keys(schema.properties ?? {});
    // classification was missing here while the HTTP door honoured it.
    expect(props).toEqual(expect.arrayContaining(['docType', 'subject', 'paragraphs', 'unit', 'classification']));
    expect(schema.required).toContain('docType');
    // Every letter and memorandum layout prints From:, the MFR included; a
    // request that omits it gets an empty label, so the description says so.
    for (const field of ['from', 'to']) {
      expect((schema.properties![field] as { description: string }).description, field).toMatch(/memorand/i);
    }
    expect(schema.additionalProperties, 'an unnamed field must be refused, not stripped').toBe(false);
    // It replaces the file at `out`, which is not the additive-only behaviour
    // destructiveHint false denotes.
    expect(tools.find((t) => t.name === 'dondocs_letter')!.annotations).toMatchObject({
      readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
    });
    expect((schema.properties!.out as { description: string }).description).toMatch(/replaced/);
  }, 60_000);

  it('publishes an output schema for every tool', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.outputSchema, `${tool.name} returns a text block the model has to parse`).toBeDefined();
    }
  });

  it('lists template metadata and retrieves every complete template', async () => {
    const { tools } = await client.listTools();
    for (const name of ['dondocs_template_list', 'dondocs_template_get']) {
      expect(tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
        readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false,
      });
    }
    const result = await client.callTool({ name: 'dondocs_template_list', arguments: {} });
    expect(isError(result), text(result)).toBe(false);
    const summaries = LETTER_TEMPLATES.map(({ id, name, category, description }) => ({ id, name, category, description }));
    expect(JSON.parse(text(result))).toEqual(summaries);
    expect(structured(result)).toEqual({ templates: summaries });
    for (const template of LETTER_TEMPLATES) {
      const full = await client.callTool({ name: 'dondocs_template_get', arguments: { id: template.id } });
      expect(isError(full), text(full)).toBe(false);
      expect(JSON.parse(text(full))).toEqual(template);
      expect(structured(full)).toEqual(template);
    }
  });

  it('publishes every template as a resource a host can attach without a tool call', async () => {
    expect(client.getServerCapabilities()?.resources).toBeDefined();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toEqual(['dondocs://templates/{id}']);

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(
      ['dondocs://defaults', ...LETTER_TEMPLATES.map((t) => `dondocs://templates/${t.id}`)].sort(),
    );
    expect(resources.find((r) => r.uri === 'dondocs://defaults')).toMatchObject({
      name: 'defaults', title: 'Machine defaults', mimeType: 'application/json',
    });
    const listed = resources.find((r) => r.uri === 'dondocs://templates/report-findings')!;
    expect(listed).toMatchObject({ name: 'report-findings', mimeType: 'application/json' });
    expect(listed.title).toBe(LETTER_TEMPLATES.find((t) => t.id === 'report-findings')!.name);

    const { contents } = await client.readResource({ uri: 'dondocs://templates/report-findings' });
    expect(contents).toHaveLength(1);
    expect(contents[0]).toMatchObject({ uri: 'dondocs://templates/report-findings', mimeType: 'application/json' });
    expect(JSON.parse((contents[0] as { text: string }).text)).toEqual(LETTER_TEMPLATES.find((t) => t.id === 'report-findings'));

    // Invalid params, naming the URI, not an internal error.
    await expect(client.readResource({ uri: 'dondocs://templates/no-such-template' })).rejects.toMatchObject({
      code: -32602, message: expect.stringContaining('dondocs://templates/no-such-template'),
    });
    await expect(client.ping()).resolves.toBeDefined();
  });

  it('reports the configured defaults and the file that sets them', async () => {
    const { contents } = await client.readResource({ uri: 'dondocs://defaults' });
    expect(contents[0]).toMatchObject({ uri: 'dondocs://defaults', mimeType: 'application/json' });
    // No config file in this suite, so every default is absent and the path
    // tells the user where to put one.
    expect(JSON.parse((contents[0] as { text: string }).text)).toEqual({
      path: '/nonexistent/companion.config.json', unit: null, signature: null, ssic: null, originatorCode: null,
    });
  });

  it('completes a template id from a prefix', async () => {
    expect(client.getServerCapabilities()?.completions).toBeDefined();
    const ref = { type: 'ref/resource' as const, uri: 'dondocs://templates/{id}' };
    const { completion } = await client.complete({ ref, argument: { name: 'id', value: 'app' } });
    expect(completion.values.sort()).toEqual(LETTER_TEMPLATES.map((t) => t.id).filter((id) => id.startsWith('app')).sort());
    expect(completion.values.length).toBeGreaterThan(1);
    expect((await client.complete({ ref, argument: { name: 'id', value: '' } })).completion.values).toHaveLength(LETTER_TEMPLATES.length);
  });

  it('offers a draft_letter prompt whose arguments complete', async () => {
    expect(client.getServerCapabilities()?.prompts).toBeDefined();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['draft_letter']);
    const args = prompts[0].arguments ?? [];
    expect(args.map((a) => a.name).sort()).toEqual(['docType', 'template']);
    expect(args.every((a) => !a.required), 'both arguments are optional').toBe(true);

    const ref = { type: 'ref/prompt' as const, name: 'draft_letter' };
    const types = (await client.complete({ ref, argument: { name: 'docType', value: 'joint_' } })).completion.values;
    expect(types.sort()).toEqual(['joint_letter', 'joint_memorandum']);
    const ids = (await client.complete({ ref, argument: { name: 'template', value: 'award' } })).completion.values;
    expect(ids).toEqual(LETTER_TEMPLATES.map((t) => t.id).filter((id) => id.startsWith('award')));
    expect(ids.length).toBeGreaterThan(0);
  });

  it('builds the prompt from a document type, or from a template with the template embedded', async () => {
    const bare = await client.getPrompt({ name: 'draft_letter', arguments: { docType: 'joint_letter' } });
    expect(bare.messages).toHaveLength(1);
    expect(bare.messages[0].role).toBe('user');
    const instructions = (bare.messages[0].content as { text: string }).text;
    expect(instructions).toContain('joint_letter');
    expect(instructions).toMatch(/From and To/);
    expect(instructions).toContain('dondocs_unit_lookup');
    expect(instructions).toContain('dondocs_letter');

    const template = LETTER_TEMPLATES.find((t) => t.id === 'report-findings')!;
    const from = await client.getPrompt({ name: 'draft_letter', arguments: { template: template.id } });
    expect(from.messages).toHaveLength(2);
    expect((from.messages[0].content as { text: string }).text).toContain(template.docType);
    expect(from.messages[1].content).toMatchObject({
      type: 'resource',
      resource: { uri: `dondocs://templates/${template.id}`, mimeType: 'application/json' },
    });
    expect(JSON.parse((from.messages[1].content as { resource: { text: string } }).resource.text)).toEqual(template);

    // Both bad arguments are invalid params, whichever side rejects them.
    // An endorsement is refused without its ordinal and basic letter, so the
    // prompt for an endorsement template has to ask for them up front.
    const endorsement = await client.getPrompt({ name: 'draft_letter', arguments: { template: 'appointment-acknowledgement' } });
    const ask = (endorsement.messages[0].content as { text: string }).text;
    expect(ask).toContain('endorsement.ordinal');
    expect(ask).toContain('endorsement.basicLetterId');
    const plain = (from.messages[0].content as { text: string }).text;
    expect(plain).not.toContain('endorsement.ordinal');

    await expect(client.getPrompt({ name: 'draft_letter', arguments: { template: 'no-such-template' } })).rejects.toMatchObject({
      code: -32602, message: expect.stringContaining('no-such-template'),
    });
    await expect(client.getPrompt({ name: 'draft_letter', arguments: { docType: 'sonnet' } })).rejects.toMatchObject({ code: -32602 });
    await expect(client.ping()).resolves.toBeDefined();
  });

  it('returns a recoverable error for an unknown template ID', async () => {
    const result = await client.callTool({ name: 'dondocs_template_get', arguments: { id: 'no-such-template' } });
    expect(isError(result)).toBe(true);
    expect(text(result)).toMatch(/Unknown template ID.*dondocs_template_list/);
    await expect(client.ping()).resolves.toBeDefined();
  });

  it('looks up MIU, narrows by location, and renders the returned letterhead', async () => {
    const lookup = async (query: string, limit = 20) => {
      const response = await client.callTool({ name: 'dondocs_unit_lookup', arguments: { query, limit } });
      expect(isError(response), text(response)).toBe(false);
      expect(structured(response)).toEqual(JSON.parse(text(response)));
      return JSON.parse(text(response));
    };
    const all = await lookup('marine innovation unit');
    expect(all.total).toBe(7);
    expect(all.matches.map((m: { mcc: string }) => m.mcc)).toContain('SVP');
    const selected = await lookup('Marine Innovation Unit Newburgh');
    expect(selected.total).toBe(1);
    expect(selected.matches[0].unit.address).toBe('10 MCDONALD ST, NEWBURGH NY 12550-5012');
    expect((await lookup('SVP')).matches).toEqual(selected.matches);
    expect((await lookup('016')).total).toBeGreaterThan(1);
    expect(await lookup('Marine Innovation Unit', 2)).toMatchObject({ total: 7, truncated: true });
    expect((await lookup('MIU')).matches).toEqual(all.matches);
    expect((await lookup('no-such-unit-xyz')).matches).toEqual([]);
    const result = await client.callTool({ name: 'dondocs_letter', arguments: {
      docType: 'naval_letter', subject: 'LOOKUP CHECK', out: 'lookup.pdf',
      unit: selected.matches[0].unit,
      paragraphs: [{ text: 'Letterhead supplied by the directory lookup.' }],
    } });
    expect(isError(result), text(result)).toBe(false);
    expect((await readFile(pathOf(result)!)).subarray(0, 4).toString()).toBe('%PDF');
  }, 200_000);

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

    expect(structured(res)).toEqual({ format: 'pdf', path: file, bytes: bytes.byteLength });
    // A host that renders links lets the user open the file from the reply.
    expect(blocks(res, 'resource_link')).toEqual([expect.objectContaining({
      uri: pathToFileURL(file!).href, name: 'client.pdf', mimeType: 'application/pdf', size: bytes.byteLength,
    })]);
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

    // Inside an object as well: a stripped portion mark is a missing marking.
    const nested = await client.callTool({ name: 'dondocs_letter', arguments: {
      docType: 'naval_letter', subject: 'TYPO', paragraphs: [{ text: 'x', portionMarkng: 'S' }],
    } }).then((r) => r, (e: Error) => ({ isError: true, content: [{ text: e.message }] }));
    expect(isError(nested)).toBe(true);
    expect(text(nested)).toMatch(/portionMarkng/);
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
    // them must still return three distinct files, each with its own content.
    // Distinct paths alone prove nothing: each call named its own `out`.
    expect(new Set(results.map(pathOf)).size).toBe(3);
    if (hasPdfToolchain) {
      for (const [i, res] of results.entries()) {
        const page = spawnSync('pdftotext', ['-layout', pathOf(res)!, '-'], { encoding: 'utf-8' }).stdout;
        expect(page, `file ${i + 1} carries another call's text`).toContain(`CONCURRENT ${i + 1}`);
      }
    }
  }, 200_000);

  it('renders a DOCX with the format in the structured result and the link', async () => {
    if (!hasPandoc) {
      console.warn('[companion-mcp-client] pandoc missing - DOCX case SKIPPED locally.');
      expect(Boolean(process.env.CI), 'CI must install pandoc; without it this case proves nothing.').toBe(false);
      return;
    }
    const res = await client.callTool({ name: 'dondocs_letter', arguments: {
      docType: 'naval_letter', format: 'docx', out: 'client.docx', subject: 'DOCX OVER MCP',
      from: 'F', to: 'T', paragraphs: [{ text: 'Converted by pandoc.' }],
    } });
    expect(isError(res), text(res)).toBe(false);
    expect(text(res)).toMatch(/^Wrote DOCX/);
    expect(structured(res)).toMatchObject({ format: 'docx', path: expect.stringMatching(/client\.docx$/) });
    expect(blocks(res, 'resource_link')[0]).toMatchObject({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect((await readFile(pathOf(res)!)).subarray(0, 2).toString('latin1')).toBe('PK');
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
