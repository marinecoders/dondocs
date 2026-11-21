import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const html = readFileSync('index.html', 'utf8');
describe('public entry content', () => {
  it('provides meaningful content and a guide route without JavaScript', () => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('#root')?.textContent).toContain('Browser storage is separate from a backup');
    expect(document.querySelector('a')?.getAttribute('href')).toContain('/docs/USER_GUIDE.md');
    expect(document.title).toContain('Naval Letter Generator');
  });
});
