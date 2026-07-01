import { describe, it, expect } from 'vitest';
import { formatShortcut } from '@/lib/platform';

// formatShortcut drives every shortcut label in the command palette and kbd
// hints, so a token-map or separator regression would mislabel shortcuts
// app-wide with nothing else to catch it. Pass the platform explicitly so both
// branches are covered regardless of the host running the test.
describe('formatShortcut', () => {
  describe('macOS (glyphs, no separator)', () => {
    it('maps the primary modifier and joins without a separator', () => {
      expect(formatShortcut('mod K', true)).toBe('⌘K');
    });
    it('stacks multiple modifiers as glyphs', () => {
      expect(formatShortcut('mod shift T', true)).toBe('⌘⇧T');
      expect(formatShortcut('mod alt P', true)).toBe('⌘⌥P');
    });
    it('renders named keys and passes literals through', () => {
      expect(formatShortcut('esc', true)).toBe('Esc');
      expect(formatShortcut('enter', true)).toBe('↵');
      expect(formatShortcut('ctrl A', true)).toBe('⌃A');
    });
  });

  describe('Windows/Linux (words, + separator)', () => {
    it('maps the primary modifier to Ctrl and joins with +', () => {
      expect(formatShortcut('mod K', false)).toBe('Ctrl+K');
    });
    it('stacks multiple modifiers as words', () => {
      expect(formatShortcut('mod shift T', false)).toBe('Ctrl+Shift+T');
      expect(formatShortcut('mod alt P', false)).toBe('Ctrl+Alt+P');
    });
    it('renders named keys and passes literals through', () => {
      expect(formatShortcut('esc', false)).toBe('Esc');
      expect(formatShortcut('enter', false)).toBe('Enter');
    });
  });

  it('upper-cases single letters but leaves multi-char literals alone', () => {
    expect(formatShortcut('k', true)).toBe('K');
    expect(formatShortcut('F2', true)).toBe('F2');
  });
});
