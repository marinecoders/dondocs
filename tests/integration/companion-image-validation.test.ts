// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../../companion/handler';
import { docxImageFixture } from '../_helpers/docxImageFixture';

let server: Server, base: string, root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-image-validation-'));
  server = createServer(createHandler({}, root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

describe('real companion image input errors', () => {
  it.each(['pdf', 'docx'] as const)('returns an actionable 400 for invalid %s signature bytes', async format => {
    const response = await fetch(`${base}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      docType: 'business_letter', subject: 'INVALID SIGNATURE INPUT', format,
      paragraphs: [{ text: 'Training letter' }], signature: { imageFileId: 'signature' },
      attachments: [{ id: 'signature', name: 'signature.png', mimeType: 'image/png', dataBase64: Buffer.from('not an image').toString('base64') }],
    }) });
    expect(response.status).toBe(400);
    expect((await response.json()).errors.join(' ')).toMatch(/valid PNG/);
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    ['pdf', 'jpeg'], ['docx', 'jpeg'], ['pdf', 'png'], ['docx', 'png'],
  ] as const)('returns an actionable 400 for invalid %s %s bytes without writing output', async (format, type) => {
    const images = await docxImageFixture();
    const bytes = type === 'jpeg' ? images.jpeg.subarray(0, images.jpeg.indexOf(Buffer.from([0xff, 0xda]))) : Buffer.from('not an image');
    const response = await fetch(`${base}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      docType: 'business_letter', subject: 'INVALID IMAGE INPUT', format,
      paragraphs: [{ text: 'Training image', figure: { fileId: 'image' } }],
      attachments: [{ id: 'image', name: `image.${type}`, mimeType: `image/${type}`, dataBase64: bytes.toString('base64') }],
    }) });
    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(type === 'jpeg' ? /JPEG.*(?:truncated|ending)/ : /valid PNG/);
    expect(result.errors.join(' ')).not.toContain('companion logs');
    expect(await readdir(root)).toEqual([]);
  });
});
