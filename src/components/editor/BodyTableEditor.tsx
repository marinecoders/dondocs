import { BODY_TABLE_LIMITS, bodyTableSchema, type BodyTable } from '@/lib/bodyTable';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';

export function BodyTableEditor({ table, index, onChange }: { table: BodyTable; index: number; onChange: (table: BodyTable) => void }) {
  const [error, setError] = useState('');
  const update = (rows: string[][]) => {
    const parsed = bodyTableSchema.safeParse({ rows, headerRows: Math.min(table.headerRows, rows.length) });
    if (!parsed.success) { setError('This table exceeds its supported text limit. Shorten a cell before adding more content.'); return; }
    setError(''); onChange(parsed.data);
  };
  return <div className="space-y-2 font-sans" role="group" aria-label={`Table in paragraph ${index + 1}`}>
    <div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><caption className="sr-only">Editable document table {index + 1}</caption><tbody>
      {table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => {
        const Cell = rowIndex < table.headerRows ? 'th' : 'td';
        return <Cell key={column} className="min-w-28 border border-border p-1" scope={rowIndex < table.headerRows ? 'col' : undefined}>
          <Textarea aria-label={`Table ${index + 1}, row ${rowIndex + 1}, column ${column + 1}`} value={cell} maxLength={BODY_TABLE_LIMITS.cellCharacters}
            onChange={event => update(table.rows.map((cells, i) => i === rowIndex ? cells.map((text, j) => j === column ? event.target.value : text) : cells))} className="min-h-14 resize-y text-sm" />
        </Cell>;
      })}</tr>)}
    </tbody></table></div>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label>Header rows <select aria-label={`Header rows for table ${index + 1}`} value={table.headerRows} onChange={event => onChange({ ...table, headerRows: Number(event.target.value) })}>
        {Array.from({ length: Math.min(3, table.rows.length) + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
      </select></label>
      <Button size="sm" variant="outline" disabled={table.rows.length >= BODY_TABLE_LIMITS.rows} onClick={() => update([...table.rows, table.rows[0].map(() => '')])}>Add table row</Button>
      <Button size="sm" variant="outline" disabled={table.rows.length <= 1} onClick={() => update(table.rows.slice(0, -1))}>Remove last row</Button>
      <Button size="sm" variant="outline" disabled={table.rows[0].length >= BODY_TABLE_LIMITS.columns} onClick={() => update(table.rows.map(row => [...row, '']))}>Add table column</Button>
      <Button size="sm" variant="outline" disabled={table.rows[0].length <= 1} onClick={() => update(table.rows.map(row => row.slice(0, -1)))}>Remove last column</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
