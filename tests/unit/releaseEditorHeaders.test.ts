import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import worker from '../../scripts/serve-release';

describe('managed release editor response', () => {
  it.each(['/', '/index.html', '/releases/v1.3.247/index.html'])('applies the document policy on %s', async path => {
    const html = readFileSync('index.html', 'utf8');
    const fetch = vi.fn(async (forwarded: Request) => new Response(forwarded.method === 'HEAD' ? null : html, { headers: {
      'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*',
    } }));
    const request = new Request(`https://example.test${path}?preview=1`);
    const result = await worker.fetch(request, { ASSETS: { fetch } });
    expect(fetch.mock.calls[0][0].url).toBe(`https://example.test${path === '/' ? '/index.html' : path}?preview=1`);
    expect(result.headers.get('X-Frame-Options')).toBe('DENY');
    expect(result.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    const historical = path.startsWith('/releases/');
    const executionPolicy = result.headers.get(historical ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy');
    if (!historical) expect(result.headers.has('Content-Security-Policy-Report-Only')).toBe(false);
    expect(executionPolicy).toContain("worker-src 'self' blob:");
    expect(executionPolicy).toContain("'wasm-unsafe-eval'");
    for (const [, attributes, script] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!/\bsrc\s*=/.test(attributes)) expect(executionPolicy).toContain(`'sha256-${createHash('sha256').update(script).digest('base64')}'`);
    }
    expect(result.headers.get('Cache-Control')).toBe('no-cache');
    expect(result.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(await result.text()).toBe(html);
  });

  it('allows the recovery script injected by the managed release build', async () => {
    const recovery = readFileSync('scripts/release-recovery.js');
    const response = await worker.fetch(new Request('https://example.test/'), {
      ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }) },
    });
    const hash = createHash('sha256').update(recovery).digest('base64');
    expect(response.headers.get('Content-Security-Policy')).toContain(`'sha256-${hash}'`);
  });

  it('retains document protections on cache revalidation', async () => {
    const response = await worker.fetch(new Request('https://example.test/'), {
      ASSETS: { fetch: async () => new Response(null, { status: 304, headers: { ETag: '"entry"' } }) },
    });
    expect(response.status).toBe(304);
    expect(response.headers.get('ETag')).toBe('"entry"');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('keeps static assets and asset errors exact', async () => {
    for (const [path, status] of [['/assets/build.js', 200], ['/index.html', 404]] as const) {
      const incoming = new Response('asset', { status, headers: { 'Content-Type': 'text/plain' } });
      const response = await worker.fetch(new Request(`https://example.test${path}`), { ASSETS: { fetch: async () => incoming } });
      expect(response).toBe(incoming);
    }
  });
});
