/**
 * Helpers for attach points (enclosures, signature) that accept only one file
 * type. They split a dropped/picked list into the good files and the rejects so
 * the caller can attach the good ones AND tell the user about the rest, instead
 * of dropping an unsupported file silently — a "nothing happened" dead end.
 */

/** Partition a file list by a predicate. Pure; order-preserving. */
export function partitionFiles(
  files: File[],
  accept: (file: File) => boolean
): { accepted: File[]; rejected: File[] } {
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const file of files) (accept(file) ? accepted : rejected).push(file);
  return { accepted, rejected };
}

/**
 * A human message for rejected files, given the accepted-type label (e.g.
 * "PDF", "image"). Names the file when there's exactly one, counts otherwise.
 */
export function rejectedFilesMessage(rejected: File[], typeLabel: string): string {
  if (rejected.length === 1) {
    return `"${rejected[0].name}" isn't a ${typeLabel} file, so it was skipped.`;
  }
  return `${rejected.length} files weren't ${typeLabel} files, so they were skipped.`;
}

export const isPdfFile = (file: File): boolean => file.type === 'application/pdf';
export const isImageFile = (file: File): boolean => file.type.startsWith('image/');
