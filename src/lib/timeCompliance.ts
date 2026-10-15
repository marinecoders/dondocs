import { publicationSection } from '@/data/techpub/sections';
import { addYears, format, isValid, parse, parseISO, startOfDay } from 'date-fns';
import type { Paragraph } from '@/types/document';

export type MiUrgency = 'urgent' | 'normal';
export interface TimeComplianceFinding {
  severity: 'error' | 'warning';
  message: string;
}

export function publicationDate(date: string): Date {
  return parse(date.trim(), 'd MMM yy', new Date());
}

/** MIL-DTL-28999D 3.3.2.4: completion must precede the calendar-year anniversary. */
export function validateTimeCompliance(
  urgency: MiUrgency,
  completionDate: string | undefined,
  issued: Date
): TimeComplianceFinding[] {
  if (urgency !== 'urgent') return [];
  const error = (message: string): TimeComplianceFinding[] => [{ severity: 'error', message }];
  if (!completionDate?.trim()) return error('An URGENT Modification Instruction must give a completion date.');
  const due = parseISO(completionDate.trim());
  if (!isValid(due)) return error('Enter a valid completion date.');
  if (!isValid(issued)) return error('Enter a valid publication date before setting the compliance period.');
  const start = startOfDay(issued);
  if (startOfDay(due) < start) return error('The completion date precedes the publication date.');
  if (startOfDay(due) >= addYears(start, 1)) {
    return error('An URGENT Modification Instruction must complete in less than one year from the publication date.');
  }
  return [];
}

/** The date field is the source for urgent MIs; stored paragraph dates cannot override it. */
export function withTimeCompliance(paragraphs: Paragraph[], urgency: MiUrgency, completionDate?: string): Paragraph[] {
  if (urgency !== 'urgent') return paragraphs;
  const match = (p: Paragraph) => publicationSection(p) === 'timeCompliance';
  const due = parseISO(completionDate ?? '');
  const text = `Complete this modification by ${isValid(due) ? format(due, 'd MMMM yyyy') : '[COMPLETION DATE REQUIRED]'}.`;
  const first = paragraphs.findIndex(match);
  const result = paragraphs.filter((p, i) => !match(p) || i === first).map((p) => match(p) ? { ...p, text } : p);
  if (first < 0) {
    const index = result.findIndex((p) => p.level === 0 && !['purpose', 'administration', 'supersedure'].includes(publicationSection(p) ?? ''));
    result.splice(index < 0 ? result.length : index, 0, { level: 0, publicationSection: 'timeCompliance', header: 'Time Compliance Period', text });
  }
  return result;
}

export function validateTimeComplianceParagraph(urgency: MiUrgency, paragraphs: Paragraph[]): TimeComplianceFinding[] {
  return urgency === 'normal' && paragraphs.some((p) => /^time compliance period$/i.test(p.header?.trim() ?? ''))
    ? [{ severity: 'warning', message: 'A NORMAL MI omits Time Compliance Period unless a different period is specified.' }]
    : [];
}
