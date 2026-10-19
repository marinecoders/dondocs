import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, resolveTheme, THEMES } from '@/lib/appearance';
import { useUIStore } from '@/stores/uiStore';

const bootScript = readFileSync('index.html', 'utf8').match(/<!-- Prevent theme flash[^]*?<script>([^]*?)<\/script>/)![1];

afterEach(() => {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark');
});

describe('appearance persistence and first paint', () => {
  it.each([
    { theme: 'light' }, { theme: 'dark' }, { theme: 'classic' },
    { theme: 'dark', colorScheme: 'default' },
    { theme: 'dark', colorScheme: 'navy' },
    { theme: 'light', colorScheme: 'usmc' },
    { theme: 'unknown' }, {},
  ])('applies the same theme before and after React starts: %j', (saved) => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" media="(prefers-color-scheme: light)"><meta name="theme-color" media="(prefers-color-scheme: dark)">');
    const theme = resolveTheme(saved, 'dark');
    runInNewContext(bootScript, {
      document,
      window: { matchMedia: () => ({ matches: true }) },
      localStorage: { getItem: () => JSON.stringify({ state: saved }) },
    });
    expect(document.documentElement.dataset.theme).toBe(theme);
    const before = document.documentElement.outerHTML;
    applyTheme(theme);
    expect(document.documentElement.outerHTML).toBe(before);
    expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark');
    expect(document.documentElement.style.colorScheme).toBe(theme === 'dark' ? 'dark' : 'light');
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      expect(meta.content).toBe(THEMES.find(({ value }) => value === theme)!.canvas);
    }
  });

  it('uses the system preference when storage is blocked', () => {
    runInNewContext(bootScript, {
      document,
      window: { matchMedia: () => ({ matches: false }) },
      localStorage: { getItem: () => { throw new Error('Storage blocked'); } },
    });
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('migrates older branded preferences without resetting workspace dimensions or reading position', async () => {
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 0, state: {
      theme: 'dark', colorScheme: 'navy', sidebarWidth: 310, previewWidth: 45,
      documentPositions: { draft: { top: 125, section: 'body' } },
    } }));
    await useUIStore.persist.rehydrate();
    expect(useUIStore.getState()).toMatchObject({
      theme: 'classic', sidebarWidth: 310, previewWidth: 45,
      documentPositions: { draft: { top: 125, section: 'body' } },
    });
    expect(JSON.parse(localStorage.getItem('dondocs_ui')!).state).not.toHaveProperty('colorScheme');
    useUIStore.getState().setTheme('dark');
    await useUIStore.persist.rehydrate();
    expect(useUIStore.getState().theme).toBe('dark');
  });
});
