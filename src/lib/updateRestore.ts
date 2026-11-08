import { z } from 'zod';
import { releaseId } from './releases';
export const UPDATE_RESTORE_KEY = 'dondocs-update-restore';
const restorePoint = z.object({
  schema: z.literal(1), dataFormat: z.literal(1), target: releaseId, previous: releaseId,
  documentId: z.string().nullable(), formType: z.string().optional(), section: z.string().nullable(),
  view: z.object({ editorLayout: z.enum(['focused', 'scroll']), previewVisible: z.boolean(), sidebarCollapsed: z.boolean(), sidebarOutlineVisible: z.boolean() }),
  scroll: z.number().nonnegative(), retried: z.boolean().optional(),
});
export type UpdateRestorePoint = z.infer<typeof restorePoint>;
export function readUpdateRestore(): UpdateRestorePoint | null {
  try { const raw = sessionStorage.getItem(UPDATE_RESTORE_KEY); return raw ? restorePoint.parse(JSON.parse(raw)) : null; }
  catch { return null; }
}
export function writeUpdateRestore(point: UpdateRestorePoint): void {
  const json = JSON.stringify(restorePoint.parse(point));
  sessionStorage.setItem(UPDATE_RESTORE_KEY, json);
  if (sessionStorage.getItem(UPDATE_RESTORE_KEY) !== json) throw new Error('This tab could not save its update restore point');
}
export function clearUpdateRestore(): void { sessionStorage.removeItem(UPDATE_RESTORE_KEY); }
