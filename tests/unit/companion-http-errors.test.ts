// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHandler } from '../../companion/handler';
import { renderToFile } from '../../companion/renderToFile';
import { systemPandocVersion } from '../../companion/renderDocx';
import { lookupUnits } from '../../companion/unitLookup';
import { toStore } from '../../companion/letterInput';
import { OutsideSandboxError } from '../../companion/outputPath';
import { RenderTimeoutError } from '../../companion/limits';
import { companionPublication } from '../_helpers/companionPublication';
import { manualRequest } from '../_helpers/manualPacket';

vi.mock('../../companion/renderToFile', () => ({ renderToFile: vi.fn() }));
vi.mock('../../companion/unitLookup', () => ({ lookupUnits: vi.fn() }));
vi.mock('../../companion/renderDocx', () => ({ systemPandocVersion: vi.fn(), VENDORED_PANDOC: 'test' }));
vi.mock('../../companion/letterInput', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../companion/letterInput')>();
  return { ...actual, toStore: vi.fn(actual.toStore) };
});

let server: Server;
let base: string;
let stderr: ReturnType<typeof vi.spyOn>;
const VALID = { docType: 'naval_letter', subject: 'ERROR HANDLING' };
const PRIVATE_DETAIL = '/private/companion/internal.ts:42:7 document-content-marker';
const failures = [
  ['Error', new Error(`engine failed at ${PRIVATE_DETAIL}`)],
  ['string', `worker stack: ${PRIVATE_DETAIL}`],
  ['object', { message: PRIVATE_DETAIL, stack: PRIVATE_DETAIL }],
] as const;

beforeAll(async () => {
  server = createServer(createHandler({}, '/private/companion/output'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  vi.mocked(toStore).mockReset();
  vi.mocked(systemPandocVersion).mockResolvedValue(null);
  stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function post(body: unknown) {
  return fetch(`${base}/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('HTTP error diagnostics stay in companion logs', () => {
  it.each(failures)('hides render diagnostics from a thrown %s', async (_kind, failure) => {
    vi.mocked(renderToFile).mockRejectedValueOnce(failure);
    const response = await post(VALID);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false, v: 1, errors: ['Render failed. Check the companion logs for details.'],
    });
    expect(stderr).toHaveBeenCalledWith('  render failed:', failure);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it.each(failures)('hides unit lookup diagnostics from a thrown %s', async (_kind, failure) => {
    vi.mocked(lookupUnits).mockRejectedValueOnce(failure);
    const response = await fetch(`${base}/units?query=SVP`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false, v: 1, errors: ['Unit lookup failed. Check the companion logs for details.'],
    });
    expect(stderr).toHaveBeenCalledWith('  unit lookup failed:', failure);
  });

  it('handles an unexpected route failure without an unhandled rejection', async () => {
    const failure = new Error(PRIVATE_DETAIL);
    vi.mocked(systemPandocVersion).mockRejectedValueOnce(failure);
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false, v: 1, errors: ['Request failed. Check the companion logs for details.'],
    });
    expect(stderr).toHaveBeenCalledWith('  request failed:', failure);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it.each([
    ['publication', companionPublication],
    ['manual front matter', manualRequest],
  ] as const)('hides caught %s validation diagnostics', async (_kind, input) => {
    const failure = new Error(PRIVATE_DETAIL);
    vi.mocked(toStore).mockImplementationOnce(() => { throw failure; });
    const response = await post(input());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, v: 1, errors: [expect.stringContaining('Check the companion logs')] });
    expect(JSON.stringify(body)).not.toContain(PRIVATE_DETAIL);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('validation failed:'), failure);
    expect(renderToFile).not.toHaveBeenCalled();
  });

  it('keeps sandbox refusals actionable without echoing exception details', async () => {
    vi.mocked(renderToFile).mockRejectedValueOnce(new OutsideSandboxError(PRIVATE_DETAIL, '/private/output'));
    const response = await post(VALID);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false, v: 1, errors: ['refusing to write outside the output root; choose a filename inside the output root'],
    });
  });

  it('keeps deadline failures distinct without echoing exception details', async () => {
    vi.mocked(renderToFile).mockRejectedValueOnce(new RenderTimeoutError(PRIVATE_DETAIL, 100));
    const response = await post(VALID);
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      ok: false, v: 1, errors: ['render did not finish before the deadline and was abandoned'],
    });
  });

  it.each(['missing figure', 'missing enclosure', 'image enclosure'])('reports a %s as an input error without invoking the renderer', async (kind) => {
    const input = companionPublication();
    if (kind === 'missing figure') {
      input.paragraphs!.push({ text: 'Drawing', figure: { fileId: 'drawing' } });
    } else {
      input.enclosures = [{ title: 'Drawing', fileId: 'drawing' }];
      if (kind === 'image enclosure') {
        input.attachments = [{ id: 'drawing', name: 'drawing.png', mimeType: 'image/png', dataBase64: 'dGVzdA==' }];
      }
    }
    const response = await post(input);
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain(kind === 'image enclosure'
      ? 'Enclosure "Drawing" requires a PDF attachment.' : 'Attachment "drawing" is missing.');
    expect(renderToFile).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
});
