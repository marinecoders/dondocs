// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';
import { toStore } from '../../companion/letterInput';
import { renderToFile } from '../../companion/renderToFile';
import { companionPublication } from '../_helpers/companionPublication';
import { manualRequest } from '../_helpers/manualPacket';

const mocks = vi.hoisted(() => ({ server: undefined as McpServer | undefined }));
vi.mock('../../companion/defaults', () => ({ CONFIG_PATH: '/nonexistent', loadDefaults: async () => ({}) }));
vi.mock('../../companion/renderToFile', () => ({ renderToFile: vi.fn() }));
vi.mock('../../companion/renderDocx', () => ({ systemPandocVersion: async () => null, VENDORED_PANDOC: 'test' }));
vi.mock('../../companion/letterInput', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../companion/letterInput')>();
  return { ...actual, toStore: vi.fn(actual.toStore) };
});
// Use the real server and tool registration, replacing only the stdio startup.
vi.mock('@modelcontextprotocol/server/stdio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@modelcontextprotocol/server/stdio')>()),
  serveStdio: (factory: () => McpServer) => {
    mocks.server = factory();
    return { close: vi.fn() };
  },
}));

let client: Client;
beforeAll(async () => {
  const on = vi.spyOn(process, 'on').mockReturnValue(process);
  const log = console.log;
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { await import('../../companion/mcp'); } finally {
    console.log = log;
    on.mockRestore();
    stderr.mockRestore();
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mocks.server!.connect(serverTransport);
  client = new Client({ name: 'validation-error-test', version: '1' }, { capabilities: {} });
  await client.connect(clientTransport);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await client?.close(); await mocks.server?.close(); });

describe('MCP shared validation failures', () => {
  it.each([
    ['publication', companionPublication],
    ['manual front matter', manualRequest],
  ] as const)('returns a safe tool error for an unexpected %s failure and stays usable', async (_kind, input) => {
    const failure = new Error('/private/companion/internal.ts:42:7 document-content-marker');
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(toStore).mockImplementationOnce(() => { throw failure; });
    const result = await client.callTool({ name: 'dondocs_letter', arguments: input() });
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('Check the companion logs') }],
    });
    expect(JSON.stringify(result)).not.toContain(failure.message);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('validation failed:'), failure);
    expect(renderToFile).not.toHaveBeenCalled();

    const next = await client.callTool({ name: 'dondocs_letter', arguments: { docType: 'naval_letter' } });
    expect(next).toMatchObject({
      isError: true, content: [{ type: 'text', text: expect.stringContaining('nothing to render') }],
    });
  });
});
