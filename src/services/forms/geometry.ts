import type { PDFPage } from 'pdf-lib';
import type { FormConfig, FormFieldBox } from '@/types/formConfig';

export interface TemplatePageGeometry { readonly width: number; readonly height: number }
const tolerance = 0.1;

/** Placements are measured on flattened, zero-origin template pages. */
export function templatePageGeometry(page: PDFPage): TemplatePageGeometry {
  const media = page.getMediaBox();const crop = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (![media.x, media.y, media.width, media.height, crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)
    || media.width <= 0 || media.height <= 0 || rotation !== 0
    || Math.abs(media.x) > tolerance || Math.abs(media.y) > tolerance
    || Math.abs(crop.x - media.x) > tolerance || Math.abs(crop.y - media.y) > tolerance
    || Math.abs(crop.width - media.width) > tolerance || Math.abs(crop.height - media.height) > tolerance) {
    throw new Error('Template geometry requires a flattened, unrotated page with a zero-origin full-page box. Normalize the source before publishing.');
  }
  return Object.freeze({ width: media.width, height: media.height });
}

export function formGeometryIssues(config: FormConfig, pages: readonly TemplatePageGeometry[]): string[] {
  const issues: string[] = [];
  const check = (box: FormFieldBox, pageNumber: number, path: string) => {
    const page = pages[pageNumber - 1];
    if (!Number.isInteger(pageNumber) || !page) { issues.push(`${path}: missing page ${pageNumber}`);return; }
    if (!box || ![box.left, box.top, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0
      || box.left < -tolerance || box.top > page.height + tolerance || box.top - box.height < -tolerance || box.left + box.width > page.width + tolerance) issues.push(`${path}: box is outside the actual page or has invalid dimensions`);
  };
  for (const [key, field] of Object.entries(config.fields)) check(field.box, field.page, `fields.${key}`);
  for (const [key, group] of Object.entries(config.rowGroups ?? {})) {
    if (!Number.isSafeInteger(group.count) || group.count < 1 || group.count > 10000 || !Number.isFinite(group.rowStride) || group.rowStride <= 0) { issues.push(`rowGroups.${key}: invalid row count or stride`);continue; }
    for (let i = 0; i < group.count; i++) for (const [column, field] of Object.entries(group.columns)) {
      const box = group.placements?.[i]?.[column] ?? { ...field.box, top: field.box.top - group.rowStride * i };
      check(box, group.page, `rowGroups.${key}.${i}.${column}`);
    }
  }
  return issues;
}
export function assertFormGeometry(config: FormConfig, pages: readonly TemplatePageGeometry[]): void {
  const issues = formGeometryIssues(config, pages);
  if (issues.length) throw new Error(`Invalid form geometry: ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? `; and ${issues.length - 3} other fields` : ''}`);
}
