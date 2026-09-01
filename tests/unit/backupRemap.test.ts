/**
 * Re-picking a backup file is the step users complain about, so the two things
 * that make it painless are pinned here: the picker is told where the last file
 * lived, and a stalled mirror only sends someone back to the picker when a new
 * file is genuinely what they need.
 */
import { describe, it, expect, vi } from 'vitest';
import { backupAction, isFileMissing, pickFile } from '@/stores/backupStore';

const handle = (name: string) => ({ name, kind: 'file' }) as unknown as FileSystemFileHandle;

describe('backupAction', () => {
  it('re-grants on the file we already have when only permission lapsed', () => {
    expect(backupAction('needs-permission', false)).toBe('reconnect');
  });

  it('sends the user to the picker only when the file is genuinely gone', () => {
    expect(backupAction('error', true)).toBe('setup');
  });

  it('does not blame the file for a write something else refused', () => {
    // Ransomware protection or a policy between the browser and that folder
    // leaves the file perfectly good. Offering a new one teaches the user to
    // re-map something that was never broken — the whole complaint.
    expect(backupAction('error', false)).toBe('retry');
  });

  it('offers nothing where there is nothing to fix or no way out', () => {
    expect(backupAction('connected', false)).toBeNull();
    expect(backupAction('unsupported', false)).toBeNull();
    expect(backupAction('off', false)).toBe('setup');
  });
});

describe('pickFile', () => {
  it('opens where the last file lived and keeps its name', async () => {
    const picker = vi.fn().mockResolvedValue(handle('mine.json'));
    const previous = handle('mine.json');

    await pickFile(picker, previous);

    const opts = picker.mock.calls[0][0];
    expect(opts.startIn).toBe(previous);
    // Carrying the name forward re-targets the same file instead of quietly
    // starting a second one beside it.
    expect(opts.suggestedName).toBe('mine.json');
    // <=32 chars of [A-Za-z0-9_-], or the browser throws TypeError.
    expect(opts.id).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  it('still asks the browser to remember the folder when no handle survived', async () => {
    const picker = vi.fn().mockResolvedValue(handle('dondocs-backup.json'));

    await pickFile(picker, null);

    const opts = picker.mock.calls[0][0];
    expect(opts.id).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(opts.suggestedName).toBe('dondocs-backup.json');
    expect(opts).not.toHaveProperty('startIn');
  });

  it('asks again without the hint rather than letting it block the re-pick', async () => {
    // A browser that refuses startIn must not cost the user their backup.
    const picker = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to read the 'startIn' property"))
      .mockResolvedValueOnce(handle('mine.json'));

    const result = await pickFile(picker, handle('mine.json'));

    expect(result.name).toBe('mine.json');
    expect(picker).toHaveBeenCalledTimes(2);
    expect(picker.mock.calls[1][0]).not.toHaveProperty('startIn');
  });

  it('treats a dismissed dialog as an answer, not a hint to retry', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const picker = vi.fn().mockRejectedValue(abort);

    await expect(pickFile(picker, handle('mine.json'))).rejects.toThrow('aborted');
    expect(picker).toHaveBeenCalledTimes(1);
  });
});

describe('isFileMissing', () => {
  // Whether the file is gone is asked, not inferred. A write can fail for
  // reasons that say nothing about the file — and in OPFS a write to a deleted
  // entry silently recreates it, so the write error is not evidence either way.
  it('says gone only when the file itself reports gone', async () => {
    const missing = {
      getFile: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' })),
    } as unknown as FileSystemFileHandle;
    await expect(isFileMissing(missing)).resolves.toBe(true);
  });

  it('does not read an unrelated failure as a missing file', async () => {
    const blocked = {
      getFile: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })),
    } as unknown as FileSystemFileHandle;
    await expect(isFileMissing(blocked)).resolves.toBe(false);
  });

  it('is false for a file that answers, and for no handle at all', async () => {
    const present = { getFile: () => Promise.resolve(new Blob()) } as unknown as FileSystemFileHandle;
    await expect(isFileMissing(present)).resolves.toBe(false);
    await expect(isFileMissing(null)).resolves.toBe(false);
  });
});
