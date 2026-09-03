/**
 * Time Compliance Period on a Modification Instruction.
 *
 * MIL-STD-38784C, via the MARCORSYSCOM template: "Only URGENT Modification
 * Instructions must have completion date of less than one year. When an MI is
 * NORMAL the time compliance period is one year unless otherwise indicated and
 * the paragraph is omitted."
 *
 * So the urgency decides whether a date is required at all, and an URGENT MI
 * that quietly gives itself more than a year is the case worth catching: it
 * reads as urgent to the fleet while behaving like a normal one.
 *
 * Pure and leaf, like the classification checks, so the rules are testable
 * without rendering anything. Advisory — the drafter decides.
 */

import type { Paragraph } from '@/types/document';

export type MiUrgency = 'urgent' | 'normal';

export interface TimeComplianceFinding {
  severity: 'error' | 'warning';
  message: string;
}

/** Days in the compliance ceiling. Leap years shift this by a day; a boundary
 *  case that close is the drafter's call, not something to fail them on. */
const ONE_YEAR_DAYS = 365;

export function validateTimeCompliance(
  urgency: MiUrgency,
  completionDate: string | undefined,
  today: Date
): TimeComplianceFinding[] {
  if (urgency !== 'urgent') return [];

  const raw = (completionDate ?? '').trim();
  if (!raw) {
    return [{
      severity: 'error',
      message: 'An URGENT Modification Instruction must give a completion date.',
    }];
  }

  const due = new Date(raw);
  if (Number.isNaN(due.getTime())) {
    return [{ severity: 'error', message: `"${raw}" is not a date the completion period can be read from.` }];
  }

  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days > ONE_YEAR_DAYS) {
    return [{
      severity: 'error',
      message: 'An URGENT Modification Instruction must complete within one year. Shorten the period, or issue it as NORMAL.',
    }];
  }
  if (days < 0) {
    return [{ severity: 'warning', message: 'The completion date has already passed.' }];
  }
  return [];
}

/** "When MI is NORMAL the time compliance period is one year unless otherwise
 *  indicated and paragraph is omitted." A NORMAL instruction that still carries
 *  the paragraph is asked to drop it. Advisory. */
export function validateTimeComplianceParagraph(urgency: MiUrgency, paragraphs: Paragraph[]): TimeComplianceFinding[] {
  if (urgency !== 'normal') return [];
  const carries = paragraphs.some((p) => /^time compliance period$/i.test((p.header ?? '').trim()));
  return carries
    ? [{ severity: 'warning', message: 'A NORMAL Modification Instruction omits the Time Compliance Period paragraph; remove it, or issue the instruction as URGENT.' }]
    : [];
}
