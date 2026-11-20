import { BODY_TABLE_LIMITS, autofitBodyTable, bodyTableSchema, bodyTableWidths, resizeBodyTableColumn, type BodyTable } from '@/lib/bodyTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useState, type ComponentProps } from 'react';

function TableNumberInput({ value, onCommit, ...props }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & { value: number; onCommit(value: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <Input {...props} value={draft ?? value} onFocus={() => setDraft(String(value))} onChange={event => setDraft(event.target.value)} onBlur={event => {
    const text = event.target.value;setDraft(null);
    if (text.trim() && Number.isFinite(Number(text))) onCommit(Number(text));
  }} onKeyDown={event => {
    if (event.key === 'Enter') { event.preventDefault();event.currentTarget.blur(); }
    if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();event.currentTarget.value = String(value);event.currentTarget.blur(); }
  }} />;
}

export function BodyTableEditor({ table, index, onChange, autoFocus = false }: { table: BodyTable; index: number; onChange: (table: BodyTable) => void; autoFocus?: boolean }) {
  const [error, setError] = useState('');
  const widths = bodyTableWidths(table);
  const update = (next: BodyTable) => {
    const parsed = bodyTableSchema.safeParse(next);
    if (!parsed.success) { setError('Use complete columns, widths totaling 100%, and cells within the supported text limit.'); return; }
    setError(''); onChange(parsed.data);
  };
  const rows = (next: string[][]) => update({ ...table, rows: next, headerRows: Math.min(table.headerRows, next.length) });
  const columns = (add: boolean) => {
    const count = table.rows[0].length + (add ? 1 : -1);
    update({ ...table, rows: table.rows.map(row => add ? [...row, ''] : row.slice(0, -1)), columnWidths: Array.from({ length: count }, () => 100 / count),
      ...(table.columnAlignments ? { columnAlignments: add ? [...table.columnAlignments, 'left'] : table.columnAlignments.slice(0, -1) } : {}) });
  };
  return <div className="space-y-3 font-sans" role="group" aria-label={`Table in paragraph ${index + 1}`}>
    <div className="overflow-x-auto"><table className="w-full table-fixed border-collapse text-sm" style={{ fontSize: table.fontSize ? `${table.fontSize}pt` : undefined }}>
      <caption className="sr-only">Editable document table {index + 1}</caption><colgroup>{widths.map((width, column) => <col key={column} style={{ width: `${width}%` }} />)}</colgroup><tbody>
      {table.rows.map((row, rowIndex) => <tr key={rowIndex} style={{ height: table.minimumRowHeight ? `${table.minimumRowHeight}pt` : undefined }}>{row.map((cell, column) => {
        const Cell = rowIndex < table.headerRows ? 'th' : 'td';
        const border = table.borders ?? 'grid';
        return <Cell key={column} className={`p-1 align-top ${border === 'grid' ? 'border border-border' : border === 'outline' ? `${rowIndex === 0 ? 'border-t' : ''} ${rowIndex === table.rows.length - 1 ? 'border-b' : ''} ${column === 0 ? 'border-l' : ''} ${column === row.length - 1 ? 'border-r' : ''} border-border` : ''}`} scope={rowIndex < table.headerRows ? 'col' : undefined}>
          <Textarea autoFocus={autoFocus && rowIndex === 0 && column === 0} aria-label={`Table ${index + 1}, row ${rowIndex + 1}, column ${column + 1}`} data-table-row={rowIndex} data-table-column={column} value={cell} maxLength={BODY_TABLE_LIMITS.cellCharacters}
            onChange={event => rows(table.rows.map((cells, i) => i === rowIndex ? cells.map((text, j) => j === column ? event.target.value : text) : cells))} className="min-h-14 min-w-0 resize-y text-sm" style={{ textAlign: table.columnAlignments?.[column] ?? 'left', fontSize: 'inherit' }} />
        </Cell>;
      })}</tr>)}
    </tbody></table></div>
    <details className="rounded-md border border-border p-3 text-xs"><summary className="cursor-pointer font-medium">Table formatting</summary>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="space-y-1">Header rows <select className="rounded border border-border bg-background p-1" aria-label={`Header rows for table ${index + 1}`} value={table.headerRows} onChange={event => update({ ...table, headerRows: Number(event.target.value) })}>
          {Array.from({ length: Math.min(3, table.rows.length) + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
        </select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={table.repeatHeaders !== false} disabled={!table.headerRows} onChange={event => update({ ...table, repeatHeaders: event.target.checked })} />Repeat headers on later pages</label>
        <label>Lines <select aria-label={`Lines for table ${index + 1}`} className="rounded border border-border bg-background p-1" value={table.borders ?? 'grid'} onChange={event => update({ ...table, borders: event.target.value as BodyTable['borders'] })}>
          <option value="grid">Grid</option><option value="outline">Outline</option><option value="none">None</option>
        </select></label>
        <label>Text size <select aria-label={`Text size for table ${index + 1}`} className="rounded border border-border bg-background p-1" value={table.fontSize ?? ''} onChange={event => update({ ...table, fontSize: event.target.value ? Number(event.target.value) as 10 | 11 | 12 : undefined })}>
          <option value="">Document size</option>{[10, 11, 12].map(size => <option key={size} value={size}>{size} pt</option>)}
        </select></label>
        <label>Minimum row height (pt)<TableNumberInput aria-label={`Minimum row height for table ${index + 1}`} className="mt-1 h-8 w-24" type="number" min={0} max={144} value={table.minimumRowHeight ?? 0} onCommit={value => update({ ...table, minimumRowHeight: value })} /></label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{widths.map((width, column) => <fieldset key={column} className="min-w-0 rounded border border-border p-2">
        <legend className="px-1">Column {column + 1}</legend>
        <label className="flex items-center justify-between gap-2">Width (%)<TableNumberInput disabled={widths.length === 1} aria-label={`Width percentage for table ${index + 1} column ${column + 1}`} className="h-8 w-20" type="number" min={5} max={100 - 5 * (widths.length - 1)} step="0.1" value={Number(width.toFixed(1))} onCommit={value => update(resizeBodyTableColumn(table, column, value))} /></label>
        <input aria-label={`Resize table ${index + 1} column ${column + 1}`} className="mt-2 w-full accent-primary" type="range" min={5} max={100 - 5 * (widths.length - 1)} step="0.1" value={width} disabled={widths.length === 1} onChange={event => update(resizeBodyTableColumn(table, column, Number(event.target.value)))} />
        <label className="mt-2 flex items-center justify-between gap-2">Alignment<select aria-label={`Alignment for table ${index + 1} column ${column + 1}`} className="rounded border border-border bg-background p-1" value={table.columnAlignments?.[column] ?? 'left'} onChange={event => update({ ...table, columnAlignments: widths.map((_, current) => current === column ? event.target.value as 'left' | 'center' | 'right' : table.columnAlignments?.[current] ?? 'left') })}>
          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </select></label>
      </fieldset>)}</div>
      <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => update(autofitBodyTable(table))}>Fit widths to text</Button><Button size="sm" variant="outline" onClick={() => update({ ...table, columnWidths: undefined })}>Equal widths</Button></div>
      <p className="mt-2 text-muted-foreground">Text wraps within each column. Row heights grow to preserve all content.</p>
    </details>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button size="sm" variant="outline" disabled={table.rows.length >= BODY_TABLE_LIMITS.rows} onClick={() => rows([...table.rows, table.rows[0].map(() => '')])}>Add table row</Button>
      <Button size="sm" variant="outline" disabled={table.rows.length <= 1} onClick={() => rows(table.rows.slice(0, -1))}>Remove last row</Button>
      <Button size="sm" variant="outline" disabled={table.rows[0].length >= BODY_TABLE_LIMITS.columns} onClick={() => columns(true)}>Add table column</Button>
      <Button size="sm" variant="outline" disabled={table.rows[0].length <= 1} onClick={() => columns(false)}>Remove last column</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
