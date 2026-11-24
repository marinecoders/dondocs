import { expect, it, vi } from 'vitest';
import { assertBackupRestoreSize, exceedsBackupByteLimit, MAX_BACKUP_BYTES } from '@/lib/backupSize';
import { classifyBackup, restoreBackupFile } from '@/lib/backup';

it('accepts the exact byte limit and rejects the next byte', () => {
  expect(exceedsBackupByteLimit(MAX_BACKUP_BYTES)).toBe(false);
  expect(exceedsBackupByteLimit(MAX_BACKUP_BYTES + 1)).toBe(true);
});

it('checks multibyte JSON before parsing even when the code-unit count is under the limit', () => {
  const heading = '{"kind":"dondocs-backup","version":5,"extra":"';
  const tail = '"}';
  const content = '🦀'.repeat(Math.floor((MAX_BACKUP_BYTES - heading.length - tail.length) / 4));
  const padding = 'a'.repeat(MAX_BACKUP_BYTES - heading.length - tail.length - content.length * 2);
  const atLimit = heading + content + padding + tail;
  expect(atLimit.length).toBeLessThan(MAX_BACKUP_BYTES);
  expect(exceedsBackupByteLimit(atLimit)).toBe(false);
  const tooLarge = atLimit + ' ';
  expect(exceedsBackupByteLimit(tooLarge)).toBe(true);
  expect(() => classifyBackup(tooLarge)).toThrow('100 MiB restore limit');
});

it('rejects oversize files before reading their contents', async () => {
  const text = vi.fn();
  await expect(restoreBackupFile({ size: MAX_BACKUP_BYTES + 1, text } as unknown as Blob)).rejects.toThrow('100 MiB restore limit');
  expect(text).not.toHaveBeenCalled();
  expect(() => assertBackupRestoreSize(MAX_BACKUP_BYTES)).not.toThrow();
});
