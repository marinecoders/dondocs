/** Slot keys are JSON arrays. Extra selections have an independent ID after the closing bracket. */
export function evidenceUploadSlot(key: string) {
  const end = key.lastIndexOf(']/');
  return end < 0 ? key : key.slice(0, end + 1);
}
