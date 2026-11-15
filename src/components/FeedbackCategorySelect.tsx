import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { FEEDBACK_CATEGORIES, feedbackCategorySchema, feedbackFilterSchema,
  type FeedbackCategory, type FeedbackFilter } from '@/lib/reviewFeedback';

interface CommonProps {
  label: string;
  disabled?: boolean;
}

type Props = CommonProps & (
  | { filter: true; value: FeedbackFilter; onChange: (value: FeedbackFilter) => void }
  | { filter?: false; value: FeedbackCategory | 'unclassified'; onChange: (value: FeedbackCategory) => void }
);

export function FeedbackCategorySelect(props: Props) {
  const id = useId();
  function change(value: string) {
    if (props.filter) {
      const parsed = feedbackFilterSchema.safeParse(value);
      if (parsed.success) props.onChange(parsed.data);
    } else {
      const parsed = feedbackCategorySchema.safeParse(value);
      if (parsed.success) props.onChange(parsed.data);
    }
  }
  return <div className="space-y-1">
    <Label htmlFor={id}>{props.label}</Label>
    <select id={id} value={props.value} disabled={props.disabled}
      className="w-full rounded-md border bg-background p-2 text-sm"
      onChange={event => change(event.target.value)}>
      {props.filter && <option value="all">All categories</option>}
      {(props.filter || props.value === 'unclassified') && <option value="unclassified" disabled={!props.filter}>Unclassified</option>}
      {FEEDBACK_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
    </select>
  </div>;
}
