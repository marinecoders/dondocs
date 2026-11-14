import { z } from 'zod';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';

export const MAX_PORTABLE_RESOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_PORTABLE_TOTAL_BYTES = 75 * 1024 * 1024;
export const MAX_PORTABLE_RESOURCE_COUNT = 256;
const safePath = z.string().min(1).max(180).regex(/^[a-z0-9][a-z0-9._/-]*$/)
  .refine(path => path.split('/').every(part => part !== '' && part !== '.' && part !== '..'));
const entrySchema = z.object({
  path: safePath, name: z.string().min(1).max(255), mediaType: z.string().min(1).max(100),
  size: z.number().int().positive().max(MAX_PORTABLE_RESOURCE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  data: z.string().max(Math.ceil(MAX_PORTABLE_RESOURCE_BYTES / 3) * 4),
}).strict();
const manifestSchema = z.object({ kind: z.literal('dondocs-resources'), version: z.literal(1),
  entries: z.array(entrySchema).max(MAX_PORTABLE_RESOURCE_COUNT),
}).strict();
export interface PortableResourceInput { path: string; name: string; mediaType: string; data: ArrayBuffer }
export type PortableResourceEntry = z.infer<typeof entrySchema>;
export type PortableResourceManifest = z.infer<typeof manifestSchema>;
export interface PortableResource { name: string; mediaType: string; data: ArrayBuffer }

export async function portableResourceDigest(data: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Validate declared sizes before decoding or allocating any resource buffers. */
function validateInventory(manifest: PortableResourceManifest): void {
  let total = 0;
  const paths = new Set<string>();
  for (const entry of manifest.entries) {
    if (paths.has(entry.path)) throw new Error('The portable resource manifest repeats a path.');
    paths.add(entry.path);
    total += entry.size;
    if (total > MAX_PORTABLE_TOTAL_BYTES) throw new Error('Portable resources exceed the 75 MB total limit.');
    const padding = entry.data.endsWith('==') ? 2 : entry.data.endsWith('=') ? 1 : 0;
    if (entry.data.length !== Math.ceil(entry.size / 3) * 4 || /[^A-Za-z0-9+/]/.test(entry.data.slice(0, entry.data.length - padding))) {
      throw new Error('A portable resource has invalid encoded bytes or size.');
    }
  }
}

/** Own and hash exact bytes; callers bind safe paths to their document-specific slots. */
export async function buildPortableResources(inputs: readonly PortableResourceInput[]): Promise<PortableResourceManifest> {
  if (inputs.length > MAX_PORTABLE_RESOURCE_COUNT) throw new Error('Too many portable resources.');
  let total = 0;
  for (const input of inputs) {
    safePath.parse(input.path);
    if (!(input.data instanceof ArrayBuffer) || !input.data.byteLength || input.data.byteLength > MAX_PORTABLE_RESOURCE_BYTES) throw new Error('A portable resource exceeds the 25 MB file limit or is empty.');
    total += input.data.byteLength;
    if (total > MAX_PORTABLE_TOTAL_BYTES) throw new Error('Portable resources exceed the 75 MB total limit.');
  }
  const manifest = manifestSchema.parse({ kind: 'dondocs-resources', version: 1, entries: await Promise.all(inputs.map(async input => {
    const owned = input.data.slice(0);
    return { path: input.path, name: input.name, mediaType: input.mediaType, size: owned.byteLength,
      sha256: await portableResourceDigest(owned), data: uint8ArrayToBase64(new Uint8Array(owned)) };
  })) });
  validateInventory(manifest);
  return manifest;
}

/** Untrusted transfers never resolve a device-local handle or skip byte validation. */
export async function parsePortableResources(value: unknown): Promise<Map<string, PortableResource>> {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new Error('This portable resource manifest is invalid or unsupported.');
  const manifest = parsed.data;
  validateInventory(manifest);
  const resources = new Map<string, PortableResource>();
  for (const entry of manifest.entries) {
    const bytes = base64ToUint8Array(entry.data);
    if (bytes.byteLength !== entry.size || uint8ArrayToBase64(bytes) !== entry.data) throw new Error('A portable resource has invalid encoded bytes or size.');
    const data = new Uint8Array(bytes).buffer;
    if (await portableResourceDigest(data) !== entry.sha256) throw new Error('A portable resource does not match its checksum.');
    resources.set(entry.path, { name: entry.name, mediaType: entry.mediaType, data });
  }
  return resources;
}
