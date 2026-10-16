// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHandler } from '../../companion/handler';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFDict, PDFArray } from 'pdf-lib';
import { companionPublication } from '../_helpers/companionPublication';
import { renderToFile } from '../../companion/renderToFile';

let client: Client;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-itype-mcp-'));
  client = new Client({ name: 'itype-test', version: '1' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), 'node_modules/vite-node/dist/cli.mjs'), 'companion/mcp.ts'],
    cwd: process.cwd(), stderr: 'pipe',
    env: { ...process.env, DONDOCS_OUT_ROOT: root, DONDOCS_CONFIG: '/nonexistent/config.json' },
  }));
});
afterAll(async () => { await client?.close(); if (root) await rm(root, { recursive: true, force: true }); });

async function drawing(pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([400, 300]).drawText('BRACKET DRAWING', { x: 20, y: 150 });
  return Buffer.from(await doc.save()).toString('base64');
}

async function pdfFrom(result: Awaited<ReturnType<Client['callTool']>>) {
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  const path = (result.structuredContent as { path: string }).path;
  return PDFDocument.load(await readFile(path));
}

describe('I-Type over MCP', () => {
  it.each(['MI', 'TI', 'SI', 'LI'] as const)('exports %s with an authentication signature field', async (type) => {
    const input = companionPublication(type);
    const pdf = await pdfFrom(await client.callTool({ name: 'dondocs_letter', arguments: input }));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
    const fields = pdf.getForm().getFields();
    expect(fields.map((field) => field.getName())).toContain('Signature1');
    const widget = fields.find((field) => field.getName() === 'Signature1')!.acroField.getWidgets()[0];
    expect(widget.P()?.toString()).toBe(pdf.getPage(1).ref.toString());
    expect(pdf.catalog.get(PDFName.of('Outlines'))).toBeDefined();
  });

  it('renders tables, a figure, an appendix and an enclosure, then replaces the draft', async () => {
    const input = companionPublication();
    input.out = 'complete.pdf';
    input.attachments = [{ id: 'drawing', name: 'drawing.pdf', mimeType: 'application/pdf', dataBase64: await drawing() }];
    input.enclosures = [{ title: 'Bracket drawing', fileId: 'drawing', pageStyle: 'fit' }];
    input.publication!.tables = { majorItems: [{ values: { description: 'SUPPORT BRACKET', nsn: '1005-01-566-1100', tamcn: 'A02557G', id: '12345A' } }] };
    input.paragraphs!.push(
      { text: 'Bracket drawing', level: 0, figure: { fileId: 'drawing' } },
      { text: '', level: 0, header: 'Major Items Affected', tableKey: 'majorItems' },
      { text: 'Reference dimensions.', level: 0, header: 'Dimensions', appendix: true },
    );
    const pdf = await pdfFrom(await client.callTool({ name: 'dondocs_letter', arguments: input }));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(5);
    const field = pdf.getForm().getField('Signature1').acroField.getWidgets()[0];
    expect(field.P()?.toString()).toBe(pdf.getPage(1).ref.toString());
    input.subject = 'REVISED SUPPORT BRACKET INSPECTION';
    await pdfFrom(await client.callTool({ name: 'dondocs_letter', arguments: input }));
    expect((await readdir(root)).filter((name) => name.startsWith('complete'))).toEqual(['complete.pdf']);
  });

  it('refuses incomplete metadata and unsupported DOCX without writing', async () => {
    const input = companionPublication();
    input.out = 'refused.pdf';
    input.publication!.pcn = '';
    const result = await client.callTool({ name: 'dondocs_letter', arguments: input });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('PCN');
    const docx = await client.callTool({ name: 'dondocs_letter', arguments: { ...companionPublication(), format: 'docx', out: 'refused.docx' } });
    expect(docx.isError).toBe(true);
    expect(JSON.stringify(docx.content)).toContain('PDF only');
    expect(await readdir(root)).not.toContain('refused.pdf');
    expect(await readdir(root)).not.toContain('refused.docx');
  });
});

it('rejects corrupt enclosures and multi-page figures before writing', async () => {
  const input = companionPublication();
  input.out = 'bad-asset.pdf';
  input.attachments = [{ id: 'drawing', name: 'drawing.pdf', mimeType: 'application/pdf', dataBase64: 'dGVzdA==' }];
  input.enclosures = [{ title: 'Bad drawing', fileId: 'drawing' }];
  await expect(renderToFile(input, {}, root)).rejects.toThrow(/PDF|pdf/);
  delete input.enclosures;
  input.attachments[0].dataBase64 = await drawing(2);
  input.paragraphs!.push({ text: 'Drawing', figure: { fileId: 'drawing' } });
  await expect(renderToFile(input, {}, root)).rejects.toThrow(/2 pages/);
  expect(await readdir(root)).not.toContain('bad-asset.pdf');
});

it('exports the same publication through HTTP contract v1', async () => {
  const server = createServer(createHandler({}, root));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const response = await fetch(`http://127.0.0.1:${address.port}/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, ...companionPublication('TI'), out: 'http-publication.pdf' }),
    });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    const pdf = await PDFDocument.load(await readFile(result.files[0].path));
    expect(pdf.getForm().getFields().map((field) => field.getName())).toContain('Signature1');
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

it('keeps enclosure destinations separate for concurrent MCP calls', async () => {
  await Promise.all([1, 3].map(async (count) => {
    const input = companionPublication();
    input.out = `concurrent-${count}.pdf`;
    input.attachments = [{ id: 'enclosure', name: 'drawing.pdf', mimeType: 'application/pdf', dataBase64: await drawing(count) }];
    input.enclosures = [{ title: `Drawing with ${count} sheets`, fileId: 'enclosure' }];
    const pdf = await pdfFrom(await client.callTool({ name: 'dondocs_letter', arguments: input }));
    const root = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    const last = root.lookup(PDFName.of('Last'), PDFDict);
    const destination = last.lookup(PDFName.of('Dest'), PDFArray);
    expect(destination.get(0).toString()).toBe(pdf.getPage(pdf.getPageCount() - count).ref.toString());
  }));
});
