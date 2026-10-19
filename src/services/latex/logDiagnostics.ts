/** Locate an HTML response without mistaking TeX banners/PDF syntax for HTML. */
export function htmlResponseIndex(log: string): number {
  return log.search(/<!doctype\s+html\b|<html(?:\s|>)/i);
}
