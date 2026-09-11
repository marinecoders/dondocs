// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  callbacks: new Map<string, (args: { query: string; limit: number }) => Promise<unknown>>(),
}));

vi.mock('../../companion/unitLookup', () => ({ lookupUnits: mocks.lookup }));
// Spread the real module: validateLetter imports TEMPLATE_FOR from here, and a
// mock that names only loadDefaults would make that import undefined.
vi.mock('../../companion/letterInput', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../companion/letterInput')>()),
  loadDefaults: async () => ({}),
}));
vi.mock('../../companion/renderToFile', () => ({ renderToFile: vi.fn() }));
vi.mock('../../companion/renderDocx', () => ({ systemPandocVersion: async () => 'test', VENDORED_PANDOC: 'test' }));
// Only what registration touches; the tool under test is reached through the
// callback the real module hands to registerTool.
vi.mock('@modelcontextprotocol/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@modelcontextprotocol/server')>()),
  McpServer: class {
    registerTool(name: string, _config: unknown, callback: (args: { query: string; limit: number }) => Promise<unknown>) {
      mocks.callbacks.set(name, callback);
    }
    registerResource() {}
    registerPrompt() {}
  },
}));
vi.mock('@modelcontextprotocol/server/stdio', () => ({
  serveStdio: (factory: () => unknown) => { factory(); return { close: vi.fn() }; },
}));

beforeAll(async () => {
  // Import the real registration without opening stdio or installing signal handlers.
  const on = vi.spyOn(process, 'on').mockReturnValue(process);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { await import('../../companion/mcp'); } finally { on.mockRestore(); log.mockRestore(); }
});
afterAll(() => { vi.restoreAllMocks(); });

describe('MCP unit lookup failures', () => {
  it.each([new Error('directory unavailable'), 'directory unavailable'])('returns a tool error and remains usable after %s', async (failure) => {
    const call = mocks.callbacks.get('dondocs_unit_lookup')!;
    mocks.lookup.mockRejectedValueOnce(failure);
    await expect(call({ query: 'SVP', limit: 20 })).resolves.toEqual({
      isError: true,
      content: [{ type: 'text', text: expect.stringMatching(/Unit lookup failed: directory unavailable.*Retry.*mailing address directly to dondocs_letter/) }],
    });
    const result = { total: 0, truncated: false, matches: [] };
    mocks.lookup.mockResolvedValueOnce(result);
    await expect(call({ query: 'SVP', limit: 20 })).resolves.toEqual({
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    });
    expect(mocks.lookup).toHaveBeenLastCalledWith('SVP', 20);
  });
});
