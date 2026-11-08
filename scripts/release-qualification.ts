import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';

export async function releaseSourceDigest(root = process.cwd()): Promise<string> {
  const names = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(name =>
    /^(?:src\/|public\/|scripts\/|package(?:-lock)?\.json$|vite.*\.ts$|Caddyfile$|Dockerfile.release$|wrangler.release.toml$|\.github\/workflows\/(?:publish-release|qualify-release)\.yml$)/.test(name)).sort();
  const hash = createHash('sha256');
  for (const name of names) hash.update(name).update('\0').update(await readFile(resolve(root, name))).update('\0');
  return hash.digest('hex');
}
const qualification = z.object({
  schema: z.literal(1), sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  iphone: z.object({ device: z.string().min(1), os: z.string().min(1), browser: z.string().min(1), build: z.string().min(1), checkedAt: z.string().datetime(),
    installedResume: z.literal(true), acceptedUpdate: z.literal(true), offlineReopen: z.literal(true), attachmentBytes: z.literal(true), backupRestore: z.literal(true) }),
  production: z.object({ url: z.url().startsWith('https://'), canonicalWorkerVerified: z.literal(true), competingPublishersDisabled: z.literal(true) }),
});
export function checkQualification(input: unknown, digest: string, origin?: string) {
  const record = qualification.parse(input);
  if (record.sourceDigest !== digest) throw new Error('Qualification is for different source inputs');
  if (origin && new URL(record.production.url).origin !== new URL(origin).origin) throw new Error('Qualification is for a different production host');
  return record;
}
