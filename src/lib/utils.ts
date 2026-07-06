import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Human-readable byte size: bytes → "812 B" / "24.0 KB" / "2.4 MB".
 * Keeps one decimal for KB/MB (dropped when it's a whole number) so a
 * 2 MB upload reads "2 MB", not "2048.0 KB".
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trimDecimal(kb)} KB`;
  return `${trimDecimal(kb / 1024)} MB`;
}

function trimDecimal(n: number): string {
  // 2.0 → "2", 2.4 → "2.4"
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
