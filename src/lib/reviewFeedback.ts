import { z } from 'zod';

export const feedbackCategorySchema = z.enum(['edit', 'question', 'required-correction']);
export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;
export const feedbackFilterSchema = z.enum(['all', 'unclassified', ...feedbackCategorySchema.options]);
export type FeedbackFilter = z.infer<typeof feedbackFilterSchema>;

export const FEEDBACK_CATEGORIES: ReadonlyArray<{ value: FeedbackCategory; label: string }> = [
  { value: 'edit', label: 'Edit' },
  { value: 'question', label: 'Question' },
  { value: 'required-correction', label: 'Required correction' },
];

export function feedbackCategoryLabel(category?: FeedbackCategory): string {
  return FEEDBACK_CATEGORIES.find(item => item.value === category)?.label ?? 'Unclassified';
}

export function matchesFeedbackFilter(category: FeedbackCategory | undefined, filter: FeedbackFilter): boolean {
  return filter === 'all' || (category ?? 'unclassified') === filter;
}
