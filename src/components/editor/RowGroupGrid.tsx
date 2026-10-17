import { FormAnswerControl } from './FormAnswerControl';
import { editForm } from '@/services/forms/documents';
import { useDocumentStore } from '@/stores/documentStore';
import type { FormDefinition, FormDiagnostic } from '@/services/forms/model';
import { Button } from '@/components/ui/button';

interface Props {
  groupKey: string;
  group: FormDefinition['rowGroups'][string];
  issues?: FormDiagnostic[];
}

export function RowGroupGrid({ groupKey, group, issues = [] }: Props) {
  const rows = useDocumentStore(s => s.genericForm?.rows[groupKey]) ?? [];
  const columns = Object.entries(group.columns);
  const idCounts = new Map<string, number>();
  for (const row of rows) idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);
  const remove = (index: number) => editForm(form => { form.rows[groupKey].splice(index, 1); });
  const control = (index: number, key: string) => <FormAnswerControl
    field={group.columns[key]}
    label={`${group.columns[key].label}, row ${index + 1}`}
    value={rows[index].answers[key]}
    error={issues.filter(issue => issue.path === `${groupKey}.${index}.${key}`).map(issue => issue.message).join('; ')}
    onChange={value => editForm(form => { form.rows[groupKey][index].answers[key] = value; })}
  />;
  // Invalid imported drafts can contain duplicate IDs; keep each row editable.
  const rowKey = (index: number) => idCounts.get(rows[index].id)! > 1 ? `${rows[index].id}-${index}` : rows[index].id;
  return <div className="space-y-2">
    {group.editor === 'cards' ? rows.map((_, index) => <div key={rowKey(index)} className="space-y-2 rounded border p-3">
      <p>Row {index + 1}</p>
      {columns.map(([key, column]) => <div key={key}>
        <span className="text-sm">{column.label}{column.requiredAt === 'export' ? ' *' : ''}</span>
        {control(index, key)}
      </div>)}
      <Button variant="ghost" onClick={() => remove(index)}>Remove row {index + 1}</Button>
    </div>) : <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr>
          {columns.map(([key, column]) => <th key={key} scope="col" className="p-1 text-left">
            {column.label}{column.requiredAt === 'export' ? ' *' : ''}
          </th>)}
          <th scope="col">Actions</th>
        </tr></thead>
        <tbody>{rows.map((_, index) => <tr key={rowKey(index)}>
          {columns.map(([key]) => <td key={key} className="min-w-32 p-1">{control(index, key)}</td>)}
          <td><Button variant="ghost" aria-label={`Remove row ${index + 1}`} onClick={() => remove(index)}>Remove</Button></td>
        </tr>)}</tbody>
      </table>
    </div>}
    <Button variant="secondary" disabled={rows.length >= group.rows.length} onClick={() => editForm(form => {
      (form.rows[groupKey] ??= []).push({ id: crypto.randomUUID(), answers: {} });
    })}>Add row ({rows.length}/{group.rows.length})</Button>
  </div>;
}
