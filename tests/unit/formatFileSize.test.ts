import { describe, it, expect } from 'vitest';
import { formatFileSize } from '@/lib/utils';

describe('formatFileSize', () => {
  it('shows raw bytes under 1 KiB', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('shows KB from 1 KiB up to 1 MiB, dropping a trailing .0', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB'); // 1.5 KiB
    expect(formatFileSize(1024 * 1023)).toBe('1023 KB');
  });

  it('rolls over to MB at 1 MiB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
    expect(formatFileSize(Math.round(1024 * 1024 * 2.4))).toBe('2.4 MB');
  });

  it('keeps one decimal only when it is non-zero', () => {
    expect(formatFileSize(2048)).toBe('2 KB'); // was "2048.0 KB" before
    expect(formatFileSize(1024 * 1024 * 3)).toBe('3 MB');
  });
});
