import { expect, it } from 'vitest';
import { buildPortableResources, parsePortableResources, MAX_PORTABLE_RESOURCE_BYTES, MAX_PORTABLE_RESOURCE_COUNT } from '@/lib/portableResources';
import { decodeSharePlaintext } from '@/lib/shareCrypto';
import pako from 'pako';

const input = () => ({ path: 'assets/support.pdf', name: 'support.pdf', mediaType: 'application/pdf', data: new TextEncoder().encode('%PDF-1.4\nSynthetic').buffer });
it('owns exact resource bytes and metadata after a portable round trip', async () => {
  const source = input(), original = source.data.slice(0);
  const manifest = await buildPortableResources([source]);
  new Uint8Array(source.data).fill(0);
  const resource = (await parsePortableResources(manifest)).get(source.path)!;
  expect(resource).toEqual({ name: source.name, mediaType: source.mediaType, data: original });
  new Uint8Array(resource.data).fill(1);
  expect((await parsePortableResources(manifest)).get(source.path)!.data).toEqual(original);
});
it.each(['../source.pdf', '/source.pdf', 'assets//source.pdf', 'assets/./source.pdf', 'assets/../source.pdf', 'assets\\source.pdf', 'https://example.test/file'])('rejects unsafe portable path %s', async path => {
  await expect(buildPortableResources([{ ...input(), path }])).rejects.toThrow();
});
it('rejects duplicate paths, unsupported versions and entry count before accepting a manifest', async () => {
  await expect(buildPortableResources([input(), input()])).rejects.toThrow(/repeats/);
  const manifest = await buildPortableResources([input()]);
  await expect(parsePortableResources({ ...manifest, version: 2 })).rejects.toThrow(/unsupported/);
  await expect(parsePortableResources({ ...manifest, entries: Array.from({ length: MAX_PORTABLE_RESOURCE_COUNT + 1 }, () => manifest.entries[0]) })).rejects.toThrow();
});
it('rejects corrupted hashes, declared lengths and noncanonical encodings', async () => {
  const manifest = await buildPortableResources([input()]);
  for (const entry of [{ ...manifest.entries[0], sha256: '0'.repeat(64) }, { ...manifest.entries[0], size: 1 }, { ...manifest.entries[0], data: '!!!!' }]) {
    await expect(parsePortableResources({ ...manifest, entries: [entry] })).rejects.toThrow();
  }
  const padded = await buildPortableResources([{ ...input(), data: new Uint8Array([0]).buffer }]);
  padded.entries[0].data = 'AB==';
  await expect(parsePortableResources(padded)).rejects.toThrow(/encoded/);
});
it('rejects file and aggregate declared bounds before decoding large resource strings', async () => {
  const manifest = await buildPortableResources([input()]);
  await expect(parsePortableResources({ ...manifest, entries: [{ ...manifest.entries[0], size: MAX_PORTABLE_RESOURCE_BYTES + 1 }] })).rejects.toThrow();
  await expect(buildPortableResources([{ ...input(), data: new ArrayBuffer(MAX_PORTABLE_RESOURCE_BYTES + 1) }])).rejects.toThrow(/25 MB/);
});
it('handles an eight-megabyte resource without overflowing a regular-expression or argument stack', async () => {
  const data = new Uint8Array(8 * 1024 * 1024);data[0] = 137;data[data.length - 1] = 93;
  const manifest = await buildPortableResources([{ ...input(), path: 'assets/large.png', data: data.buffer }]);
  const decoded = new Uint8Array((await parsePortableResources(manifest)).get('assets/large.png')!.data);
  expect(decoded.byteLength).toBe(data.byteLength);
  expect(decoded[0]).toBe(137);expect(decoded.at(-1)).toBe(93);
});
it('stops compressed bombs at the expanded-byte budget and preserves legacy uncompressed JSON', () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ text: 'x'.repeat(256 * 1024) }));
  expect(() => decodeSharePlaintext(pako.deflate(bytes), 128 * 1024)).toThrow(/expanded/);
  expect(decodeSharePlaintext(pako.deflate(bytes), bytes.byteLength)).toEqual({ text: 'x'.repeat(256 * 1024) });
  expect(decodeSharePlaintext(new TextEncoder().encode('{"legacy":true}'))).toEqual({ legacy: true });
  expect(() => decodeSharePlaintext(pako.deflate(bytes).subarray(0, 20))).toThrow(/compressed/);
});
