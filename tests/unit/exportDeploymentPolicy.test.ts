import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertExportDeploymentPolicy, matchesPolicyHostname, normalizePolicyHostname, resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

const config = { maxLevel: 'secret', allowedLevels: ['unclassified', 'secret'], overrideDomain: 'example.test' };
const input = { hostname: 'example.test', environment: null, runtime: { status: 'absent' as const } };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
describe('export deployment policy', () => {
  it('normalizes hosts and requires explicit subdomain scope', () => {
    expect(normalizePolicyHostname(' EXAMPLE.TEST. ')).toBe('example.test');
    expect(normalizePolicyHostname('[::1]')).toBe('[::1]');
    for (const host of ['https://example.test', 'example.test:443', 'example.test/path', 'user@example.test', '', '*.test']) expect(normalizePolicyHostname(host)).toBeNull();
    expect(matchesPolicyHostname('docs.example.test', 'example.test')).toBe(false);
    expect(matchesPolicyHostname('docs.example.test', 'example.test', true)).toBe(true);
    for (const host of ['example.test.evil.com', 'evilexample.test', 'example', 'test']) expect(matchesPolicyHostname(host, 'example.test', true)).toBe(false);
  });
  it('uses environment then runtime then domain defaults only for matching hosts', () => {
    const runtime = { status: 'loaded' as const, config };
    expect(resolveExportDeploymentPolicy({ ...input, environment: { ...config, maxLevel: 'cui', allowedLevels: ['unclassified', 'cui'] }, runtime })).toMatchObject({ status: 'ready', policy: { source: 'environment', maxLevel: 'cui' } });
    expect(resolveExportDeploymentPolicy({ ...input, environment: { ...config, overrideDomain: 'other.test' }, runtime })).toMatchObject({ status: 'ready', policy: { source: 'runtime' } });
    expect(resolveExportDeploymentPolicy({ ...input, hostname: 'example.test.evil.com', runtime })).toMatchObject({ status: 'ready', policy: { source: 'domain', maxLevel: 'unclassified' } });
  });
  it('distinguishes absent policy from loading, failure, and invalid configuration', () => {
    for (const status of ['not-loaded', 'loading'] as const) expect(resolveExportDeploymentPolicy({ ...input, runtime: { status } }).status).toBe('not-ready');
    expect(resolveExportDeploymentPolicy({ ...input, runtime: { status: 'failed' } }).status).toBe('error');
    for (const bad of [{}, { ...config, allowedLevels: ['unclassified', 'top_secret'] }, { ...config, overrideDomain: 'https://example.test' }, { ...config, includeSubdomains: 'true' }]) {
      expect(resolveExportDeploymentPolicy({ ...input, runtime: { status: 'loaded', config: bad } }).status).toBe('error');
    }
    expect(resolveExportDeploymentPolicy({ ...input, environment: config, runtime: { status: 'failed' } }).status).toBe('ready');
  });
  it('issues frozen policy identities detached from caller configuration', () => {
    const data = structuredClone(config);
    const result = resolveExportDeploymentPolicy({ ...input, environment: data });
    if (result.status !== 'ready') throw new Error('Expected policy');
    const identity = result.policy.identity;
    data.allowedLevels.push('top_secret');
    expect(result.policy.allowedLevels).toEqual(['unclassified', 'secret']);
    expect(() => Object.assign(result.policy, { hostname: 'other.test' })).toThrow();
    expect(() => assertExportDeploymentPolicy({ ...result.policy })).toThrow();
    expect(result.policy.identity).toBe(identity);
    expect(resolveExportDeploymentPolicy({ ...input, environment: config })).toEqual(result);
  });
});

it('retains file load errors until an explicit retry, and treats only404 as absent', async () => {
  vi.resetModules();
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ status: 404, ok: false });
  vi.stubGlobal('fetch', fetch);
  const { getExportDeploymentPolicy } = await import('@/config/classification');
  expect((await getExportDeploymentPolicy('example.test')).status).toBe('error');
  expect((await getExportDeploymentPolicy('example.test')).status).toBe('error');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await getExportDeploymentPolicy('example.test', true)).toMatchObject({ status: 'ready', policy: { source: 'domain' } });
});
it('applies runtime host scope to the editor compatibility adapter', async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => config }));
  const { getExportDeploymentPolicy } = await import('@/config/classification');
  expect(await getExportDeploymentPolicy('example.test')).toMatchObject({ status: 'ready', policy: { source: 'runtime', maxLevel: 'secret' } });
  expect(await getExportDeploymentPolicy('example.test.evil.com')).toMatchObject({ status: 'ready', policy: { source: 'domain', maxLevel: 'unclassified' } });
});

it('accepts the explicit default policy file used by offline installations', async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => null }));
  const { getExportDeploymentPolicy } = await import('@/config/classification');
  expect(await getExportDeploymentPolicy('example.test')).toMatchObject({ status: 'ready', policy: { source: 'domain' } });
});

it('rejects a configured host suffix embedded in a different hostname', async () => {
  vi.stubEnv('VITE_CLASSIFICATION_MAX_LEVEL', 'secret');
  vi.stubEnv('VITE_CLASSIFICATION_OVERRIDE_DOMAIN', 'example.test');
  const { getDomainClassificationRestriction } = await import('@/lib/domainClassification');
  expect(getDomainClassificationRestriction('example.test.evil.com').maxLevel).toBe('unclassified');
  expect(getDomainClassificationRestriction('example').maxLevel).toBe('unclassified');
  expect(getDomainClassificationRestriction('example.test').maxLevel).toBe('secret');
});
