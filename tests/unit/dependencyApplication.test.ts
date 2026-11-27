import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { maintainedPackageAction } from '@/lib/maintainedPackageActions';
import { listConditionalPackageInstances } from '@/lib/packageConditional';

afterEach(() => vi.unstubAllGlobals());

it('selects the required documents for dependency-application', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
    expect(pathname).toBe('/templates/navmc/10922/2021-07/original.pdf');
    return new Response(new Uint8Array(await readFile('public' + pathname)));
  });
  const template = await maintainedPackageAction('dependency-application');
  const selected = (values: Record<string, string | boolean>) => listConditionalPackageInstances(template, { version: 1, groups: {}, values })
    .filter(member => member.condition === true).map(member => member.memberKey);
  for (const event of ['marriage', 'birth', 'loss']) {
    expect(selected({ event, supportOrder: false })).toEqual(['application', event]);
  }
  expect(selected({ event: 'birth', supportOrder: true })).toEqual(['application', 'birth', 'order']);
  expect(template.members[0].completion?.blankSha256).toBe(createHash('sha256')
    .update(Buffer.from(template.members[0].blankPdf!.data, 'base64')).digest('hex'));
});
