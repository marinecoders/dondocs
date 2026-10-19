import { useId, type ReactNode } from 'react';
import type { Answer, AnswerField } from '@/services/forms/model';

interface Props {
  field: AnswerField;
  value: Answer | undefined;
  onChange: (value: Answer) => void;
  label?: string;
  id?: string;
  error?: string;
}
const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-10 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive';

export function FormAnswerControl({ field, value, onChange, label = field.label, id, error }: Props) {
  const controlId = useId();
  const errorId = `${controlId}-error`;
  const attributes = {
    id: id ?? controlId,
    'aria-label': label,
    'aria-required': field.requiredAt === 'export' || undefined,
    'aria-invalid': !!error || undefined,
    'aria-describedby': error ? errorId : undefined,
  };
  let control: ReactNode;
  if (field.kind === 'signature') return <p className="text-xs text-muted-foreground">Sign after export.</p>;
  if (field.kind === 'boolean') {
    control = <select {...attributes} className={inputClass} value={value === undefined ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? '' : e.target.value === 'true')}>
      <option value="">Select</option><option value="true">Yes</option><option value="false">No</option>
    </select>;
  } else if (field.kind === 'singleChoice') {
    control = <select {...attributes} className={inputClass} value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)}>
      <option value="">Select</option>{field.options?.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>;
  } else if (field.kind === 'multipleChoice') {
    control = <fieldset {...attributes} className="space-y-1">
      {field.options?.map(o => <label key={o.id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={Array.isArray(value) && value.includes(o.id)} onChange={e => {
          const selected = Array.isArray(value) ? value : [];
          onChange(e.target.checked ? [...selected, o.id] : selected.filter(v => v !== o.id));
        }} />{o.label}
      </label>)}
    </fieldset>;
  } else {
    const text = typeof value === 'string' ? value : '';
    control = field.multiline
      ? <textarea {...attributes} className={inputClass} rows={4} value={text} onChange={e => onChange(e.target.value)} />
      : <input {...attributes} className={inputClass} type={field.kind === 'date' ? 'date' : 'text'} inputMode={field.kind === 'decimal' ? 'decimal' : undefined} value={text} onChange={e => onChange(e.target.value)} />;
  }
  return <div className="space-y-1">
    {control}
    {error && <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
