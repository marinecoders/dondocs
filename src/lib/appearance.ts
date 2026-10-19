export const THEMES = [
  { value: 'light', label: 'Light', description: 'Warm neutrals', canvas: '#fbfbfa' },
  { value: 'dark', label: 'Dark', description: 'Soft charcoal', canvas: '#191a1c' },
  { value: 'classic', label: 'Classic', description: 'Original navy & red', canvas: '#f1f6fa' },
] as const;

export type Theme = typeof THEMES[number]['value'];

/** Accept old preferences without resetting unrelated workspace settings. */
export function resolveTheme(saved: { theme?: unknown; colorScheme?: unknown }, fallback: Theme): Theme {
  if (saved.colorScheme === 'navy' || saved.colorScheme === 'usmc') return 'classic';
  return THEMES.find(({ value }) => value === saved.theme)?.value ?? fallback;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  const canvas = THEMES.find(({ value }) => value === theme)!.canvas;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = canvas;
  });
}
