import { z } from 'zod';

export const releaseId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const releaseManifest = z.object({
  schema: z.literal(1), id: releaseId, version: z.string(), createdAt: z.string().datetime(),
  dataFormat: z.literal(1), workerProtocol: z.literal(1),
  entry: z.string(),
  assets: z.array(z.object({
    url: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative(), type: z.string(),
    group: z.enum(['shell', 'runtime', 'form']),
  })).max(20000),
}).superRefine((manifest, context) => {
  const seen = new Set<string>();
  for (const asset of manifest.assets) {
    const url = new URL(asset.url, 'https://release.invalid');
    if (url.origin !== 'https://release.invalid' || url.pathname !== asset.url || seen.has(asset.url)
      || !asset.url.startsWith('/releases/') && !asset.url.startsWith('/runtimes/') && !/^\/templates\/.*\/revisions\//.test(asset.url)) {
      context.addIssue({ code: 'custom', message: 'Invalid or duplicate immutable asset URL' });
    }
    seen.add(asset.url);
  }
  if (manifest.entry !== `/releases/${manifest.id}/index.html`
    || !manifest.assets.some(asset => asset.url === manifest.entry && asset.group === 'shell')) {
    context.addIssue({ code: 'custom', message: 'Missing release entry' });
  }
});
export type ReleaseManifest = z.infer<typeof releaseManifest>;
export type ReleaseAsset = ReleaseManifest['assets'][number];

export const manifestUrl = (id: string) => `/releases/${releaseId.parse(id)}/release.json`;
