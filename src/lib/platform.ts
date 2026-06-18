// Platform detection + keyboard-shortcut formatting.
//
// The keyboard *handlers* are already cross-platform (App.tsx gates on
// `e.ctrlKey || e.metaKey`); this module governs only the *display* of
// shortcuts so Windows/Linux users see `Ctrl`/`Alt`/`Shift` words and macOS
// users see the `⌘`/`⌥`/`⇧` glyphs they actually have on their keyboards.

function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Prefer the modern, non-deprecated hint when present (returns "macOS",
  // "Windows", "Linux", …); fall back to the legacy platform/userAgent strings.
  const uaPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const probe = uaPlatform || navigator.platform || navigator.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(probe);
}

export const isMac = detectMac();

/** Primary modifier display: `⌘` on macOS, `Ctrl` elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl';

const MAC_TOKENS: Record<string, string> = {
  mod: '⌘', cmd: '⌘', meta: '⌘',
  ctrl: '⌃', control: '⌃',
  alt: '⌥', opt: '⌥', option: '⌥',
  shift: '⇧',
  enter: '↵', return: '↵',
  esc: 'Esc', escape: 'Esc',
};

const PC_TOKENS: Record<string, string> = {
  mod: 'Ctrl', cmd: 'Ctrl', meta: 'Ctrl',
  ctrl: 'Ctrl', control: 'Ctrl',
  alt: 'Alt', opt: 'Alt', option: 'Alt',
  shift: 'Shift',
  enter: 'Enter', return: 'Enter',
  esc: 'Esc', escape: 'Esc',
};

/**
 * Format a space-separated shortcut spec into a platform-appropriate display
 * string. Modifier tokens (`mod`, `alt`, `shift`, `enter`, …) map by platform;
 * single letters are upper-cased; multi-character literals pass through.
 *
 *   formatShortcut('mod K')        → '⌘K'        (mac)  / 'Ctrl+K'        (pc)
 *   formatShortcut('mod shift T')  → '⌘⇧T'       (mac)  / 'Ctrl+Shift+T'  (pc)
 */
export function formatShortcut(keys: string, mac: boolean = isMac): string {
  const map = mac ? MAC_TOKENS : PC_TOKENS;
  const sep = mac ? '' : '+';
  return keys
    .trim()
    .split(/\s+/)
    .map((token) => {
      const lower = token.toLowerCase();
      if (lower in map) return map[lower];
      return token.length === 1 ? token.toUpperCase() : token;
    })
    .join(sep);
}
