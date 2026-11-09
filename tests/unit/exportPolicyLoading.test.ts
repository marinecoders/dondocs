import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals();vi.resetModules(); });
it('uses a runtime request distinct from the offline precache and retries a failed read', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Offline')).mockResolvedValueOnce(new Response('null'));
  vi.stubGlobal('fetch', fetch);
  const { getExportDeploymentPolicy } = await import('@/config/classification');
  expect((await getExportDeploymentPolicy('example.test')).status).toBe('error');
  expect((await getExportDeploymentPolicy('example.test', true)).status).toBe('ready');
  expect(fetch).toHaveBeenLastCalledWith('/classification.config.json?deployment-policy=runtime', { cache: 'no-cache' });
});
it('accepts explicit absence but keeps invalid JSON and server failures distinct', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response('<html>')).mockResolvedValueOnce(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const { getExportDeploymentPolicy } = await import('@/config/classification');
  expect((await getExportDeploymentPolicy('example.test')).status).toBe('ready');
  expect((await getExportDeploymentPolicy('example.test', true)).status).toBe('error');
  expect((await getExportDeploymentPolicy('example.test', true)).status).toBe('error');
});
