export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const BACKUP_LIMIT = `${MAX_BACKUP_BYTES / (1024 * 1024)} MiB`;

export const WORKSPACE_BACKUP_TOO_LARGE = `This workspace exceeds the ${BACKUP_LIMIT} restore limit.`;
export const BACKUP_SIZE_RECOVERY = `${WORKSPACE_BACKUP_TOO_LARGE} Keep any previous backup. Use Export draft (.json) in Document actions or Editable package in Packages to save individual items with their files.`;

export class WorkspaceBackupTooLargeError extends Error {
  constructor() {
    super(BACKUP_SIZE_RECOVERY);
    this.name = 'WorkspaceBackupTooLargeError';
  }
}

export function exceedsBackupByteLimit(value: string | number): boolean {
  if (typeof value === 'number') return value > MAX_BACKUP_BYTES;
  // UTF-8 uses between one and three bytes per UTF-16 code unit.
  return value.length > MAX_BACKUP_BYTES ||
    (value.length * 3 > MAX_BACKUP_BYTES && new TextEncoder().encode(value).byteLength > MAX_BACKUP_BYTES);
}

export function assertBackupRestoreSize(value: string | number): void {
  if (exceedsBackupByteLimit(value)) {
    throw new Error(`This file exceeds the ${BACKUP_LIMIT} restore limit. Keep the file. Nothing was changed.`);
  }
}
