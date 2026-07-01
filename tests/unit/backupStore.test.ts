import { describe, it, expect } from 'vitest';
import { useBackupStore } from '@/stores/backupStore';

describe('backupStore', () => {
  it('reports unsupported where the File System Access API is absent (test env)', () => {
    // No window.showSaveFilePicker in the test environment.
    expect(useBackupStore.getState().status).toBe('unsupported');
  });

  it('init / writeNow are safe no-ops when unsupported', async () => {
    await expect(useBackupStore.getState().init()).resolves.toBeUndefined();
    await expect(useBackupStore.getState().writeNow()).resolves.toBeUndefined();
    expect(useBackupStore.getState().fileName).toBeNull();
  });
});
