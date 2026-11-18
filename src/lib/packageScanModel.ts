import { z } from 'zod';
import type { PackageRevision } from './actionPackages';
const identity = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const sourceSchema = z.object({ id: identity, name: z.string().min(1).max(255), type: z.enum(['application/pdf', 'image/png', 'image/jpeg']), size: z.number().int().positive().max(20 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const packageScanSchema = z.object({
  id: identity, memberId: identity, memberRevisionId: identity, memberLabel: z.string().min(1).max(120), source: sourceSchema,
  capturedAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(), status: z.enum(['recognized', 'corrected']),
  pages: z.array(z.object({ page: z.number().int().min(1).max(12), recognizedText: z.string().max(500_000), text: z.string().max(500_000), confidence: z.number().min(0).max(100) }).strict()).min(1).max(12),
}).strict().superRefine((scan, context) => {
  if (scan.updatedAt < scan.capturedAt || scan.pages.some((page, index) => page.page !== index + 1)
    || scan.status !== (scan.pages.some(page => page.text !== page.recognizedText) ? 'corrected' : 'recognized'))
    context.addIssue({ code: 'custom', message: 'Recognized evidence has inconsistent page identities, correction state or timestamps.' });
  if (scan.source.type !== 'application/pdf' && scan.pages.length !== 1) context.addIssue({ code: 'custom', message: 'An image has one recognized source page.' });
  if (scan.pages.reduce((total, page) => total + page.text.length, 0) > 500_000 || scan.pages.reduce((total, page) => total + page.recognizedText.length, 0) > 500_000)
    context.addIssue({ code: 'custom', message: 'Recognized evidence text exceeds 500,000 characters.' });
});
export type PackageScan = z.infer<typeof packageScanSchema>;
export const packageScansSchema = z.object({ version: z.literal(1), items: z.array(packageScanSchema).max(20) }).strict().superRefine((scans, context) => {
  if (new Set(scans.items.map(scan => scan.id)).size !== scans.items.length) context.addIssue({ code: 'custom', message: 'Duplicate recognized-evidence identity.' });
  if (new TextEncoder().encode(JSON.stringify(scans)).byteLength > 2 * 1024 * 1024) context.addIssue({ code: 'custom', message: 'Recognized evidence exceeds the 2 MB revision limit.' });
});
export type PackageScans = z.infer<typeof packageScansSchema>;
export const MAX_PACKAGE_SCAN_HISTORY_BYTES = 8 * 1024 * 1024;
export function packageScanIsCurrent(scan: PackageScan, revision: PackageRevision): boolean {
  const member = revision.members.find(member => member.id === scan.memberId);
  return !!member && member.kind !== 'native' && member.revisionId === scan.memberRevisionId
    && member.original.id === scan.source.id && member.original.sha256 === scan.source.sha256 && member.original.name === scan.source.name;
}
export function packageScansText(input: PackageScans): string {
  const text: string[] = [];
  const visit = (value: unknown): void => { if (typeof value === 'string') text.push(value); else if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') Object.values(value).forEach(visit); };
  visit(packageScansSchema.parse(input)); return text.join('\n');
}
