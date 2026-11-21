import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const html = readFileSync('index.html', 'utf8');
describe('public entry content', () => {
  it('uses one canonical origin and valid application metadata', () => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://dondocs.marines.dev/');
    const data = JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(data['@type']).toBe('WebApplication');
    expect(data.url).toBe('https://dondocs.marines.dev/');
    const robots = readFileSync('public/robots.txt', 'utf8');
    expect(robots).toContain('Sitemap: https://dondocs.marines.dev/sitemap.xml');
  });
  it('provides meaningful content and a guide route without JavaScript', () => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('#root')?.textContent).toContain('Browser storage is separate from a backup');
    expect(document.querySelector('a')?.getAttribute('href')).toContain('/docs/USER_GUIDE.md');
    expect(document.title).toContain('Naval Letter Generator');
  });
});
