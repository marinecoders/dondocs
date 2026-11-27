import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { EditableSignedField } from '@/services/forms/signingBridge';

type Answers = Record<string, string | boolean>;

export function SignedFormFields({ fields, onSave, onCancel }: {
  fields: EditableSignedField[]; onSave: (changes: Answers) => void; onCancel: () => void;
}) {
  const [id, setId] = useState(fields[0]?.id);
  const [changes, setChanges] = useState<Answers>({});
  const field = fields.find(item => item.id === id);
  const value = field && (changes[field.id] ?? field.value);
  const control = 'w-full rounded border bg-background p-2';
  function change(next: string | boolean) {
    if (!field) return;
    setChanges(previous => {
      const result = { ...previous };
      if (next === field.value) delete result[field.id];
      else result[field.id] = next;
      return result;
    });
  }
  return <section aria-label="Edit unlocked fields" className="space-y-3">
    {field ? <>
      <label className="grid gap-1">Field<select className={control} value={id} onChange={e => setId(e.target.value)}>
        {fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select></label>
      <label className="grid gap-1">{field.label}
        {typeof value === 'boolean' ? <input type="checkbox" checked={value} onChange={e => change(e.target.checked)} /> :
          field.options.length ? <select className={control} value={String(value)} onChange={e => change(e.target.value)}>
            {!field.options.some(o => o.value === value) && <option value={String(value)}>{String(value).trim() || 'Choose a value'}</option>}
            {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select> : field.multiline ? <textarea className={control} value={String(value)} onChange={e => change(e.target.value)} /> :
            <Input value={String(value)} onChange={e => change(e.target.value)} />}
      </label>
      <Button disabled={!Object.keys(changes).length} onClick={() => onSave(changes)}>Save field changes</Button>
    </> : <p>No fields are available to edit on this revision.</p>}
    <Button variant="ghost" onClick={onCancel}>{Object.keys(changes).length ? 'Discard field changes' : 'Done'}</Button>
  </section>;
}
