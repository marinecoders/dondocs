import { z } from 'zod';
import type { PackageRevision } from './actionPackages';

const identity = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => value !== 'prototype' && !Object.hasOwn(Object.prototype, value), 'Reserved task identity.');
const singleLine = z.string().trim().min(1, 'Enter a label.').max(160, 'Use 160 characters or fewer.')
  .refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), 'Use a single-line label.');
export function isPackageWorkDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
export const packageTaskTargetSchema = z.object({ kind: z.enum(['member', 'requirement']), id: identity }).strict();
export type PackageTaskTarget = z.infer<typeof packageTaskTargetSchema>;
export const packageTaskSchema = z.object({
  id: identity, title: singleLine, status: z.enum(['pending', 'complete']), owner: singleLine.optional(),
  dueDate: z.string().refine(isPackageWorkDate, 'Use a real date in YYYY-MM-DD format.').optional(),
  notes: z.string().max(2000, 'Use 2,000 characters or fewer.').refine(value => Array.from(value).every(character => character.charCodeAt(0) !== 127 && (character.charCodeAt(0) >= 32 || ['\n', '\r', '\t'].includes(character))), 'Unsupported control character.').optional(),
  target: packageTaskTargetSchema.optional(),
}).strict();
export type PackageTask = z.infer<typeof packageTaskSchema>;
export const packageWorkSchema = z.object({ version: z.literal(1), tasks: z.array(packageTaskSchema).max(100) }).strict()
  .superRefine((work, context) => {
    if (new Set(work.tasks.map(task => task.id)).size !== work.tasks.length)
      context.addIssue({ code: 'custom', message: 'Duplicate package task identity.' });
    if (new TextEncoder().encode(JSON.stringify(work)).byteLength > 256 * 1024)
      context.addIssue({ code: 'custom', message: 'Package work exceeds the 256 KB limit.' });
  });
export type PackageWork = z.infer<typeof packageWorkSchema>;
export const MAX_PACKAGE_WORK_HISTORY_BYTES = 8 * 1024 * 1024;
export function packageWorkText(work: PackageWork): string {
  const strings: string[] = [];
  function collect(value: unknown): void {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  }
  collect(packageWorkSchema.parse(work)); return strings.join('\n');
}

export interface PackageWorkDestination {
  section?: 'overview' | 'documents' | 'review' | 'delivery';
  panel?: 'information' | 'requirements' | 'intake' | 'consistency' | 'work';
  memberId?: string; requirementId?: string; factId?: string; bindingId?: string;
  revisionId?: string; outputId?: string; reviewRoundId?: string; citationId?: string;
}
export function resolvePackageTaskTarget(revision: PackageRevision, target: PackageTaskTarget): {
  state: 'available' | 'missing'; label: string; destination?: PackageWorkDestination;
} {
  if (target.kind === 'member') {
    const member = revision.members.find(member => member.id === target.id);
    return member ? { state: 'available', label: member.label, destination: { section: 'documents', memberId: member.id } }
      : { state: 'missing', label: 'The linked document is no longer in this revision.' };
  }
  const requirement = revision.requirements?.items.find(item => item.id === target.id);
  return requirement ? { state: 'available', label: requirement.label, destination: { section: 'overview', requirementId: requirement.id } }
    : { state: 'missing', label: 'The linked requirement is no longer in this revision.' };
}
/** Due dates are calendar dates in the user's current locale, not UTC instants. */
export function packageWorkToday(date = new Date()): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
