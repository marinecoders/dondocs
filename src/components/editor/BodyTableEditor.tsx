import { BODY_TABLE_LIMITS, autofitBodyTable, bodyTableRowHeight, bodyTableSchema, bodyTableWidths, fitBodyTableColumn, resizeBodyTableBoundary, resizeBodyTableColumn, type BodyTable } from '@/lib/bodyTable';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useRef, useState, type ComponentProps, type PointerEvent } from 'react';

function TableNumberInput({ value, onCommit, ...props }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & { value: number | null; onCommit(value: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <Input {...props} value={draft ?? value ?? ''} onChange={event => setDraft(event.target.value)} onBlur={event => {
    const text = event.target.value;setDraft(null);
    if (draft !== null && text.trim() && Number.isFinite(Number(text)) && Number(text) !== value) onCommit(Number(text));
  }} onKeyDown={event => {
    if (event.key === 'Enter') { event.preventDefault();event.currentTarget.blur(); }
    if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();event.currentTarget.value = value === null ? '' : String(value);event.currentTarget.blur(); }
  }} />;
}

export function BodyTableEditor({ table, index, onChange, autoFocus = false }: { table: BodyTable; index: number; onChange: (table: BodyTable) => void; autoFocus?: boolean }) {
  const [error, setError] = useState('');
  const [dragWidths, setDragWidths] = useState<number[]>();
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<{ table: BodyTable; boundary: number; start: number; width: number; percent: number } | null>(null);
  const widths = bodyTableWidths(table);
  const displayedWidths = dragWidths ?? widths;
  const border = table.borders ?? 'grid';
  const minimumEditorWidth = Math.max(widths.length * 68, 2400 / Math.min(100, ...widths.slice(1, -1)));
  const update = (next: BodyTable) => {
    const parsed = bodyTableSchema.safeParse(next);
    if (!parsed.success) { setError('Use complete columns, widths totaling 100%, and cells within the supported text limit.'); return; }
    setError(''); onChange(parsed.data);
  };
  const rows = (next: string[][]) => {
    const heights = table.rowHeights?.slice(0, next.length);
    if (heights && heights.length < next.length) heights.push(null);
    update({ ...table, rows: next, headerRows: Math.min(table.headerRows, next.length), rowHeights: heights?.some(height => height !== null) ? heights : undefined });
  };
  const resizeByPointer = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const active = drag.current;
    if (!active || active.table !== table) return;
    const delta = 100 * (event.clientX - active.start) / active.width;
    const resized = resizeBodyTableBoundary(table, active.boundary, active.percent + delta);
    if (commit) {
      // A click or double click leaves the authored widths unchanged.
      if (Math.abs(event.clientX - active.start) >= 1) update(resized);
    } else setDragWidths(resized.columnWidths);
  };
  const clearDrag = () => { drag.current = null; setDragWidths(undefined); };
  const setRowHeight = (row: number, value: number | null) => {
    const heights = table.rows.map((_, index) => index === row ? value : table.rowHeights?.[index] ?? null);
    update({ ...table, rowHeights: heights.some(height => height !== null) ? heights : undefined });
  };
  const columns = (add: boolean) => {
    const count = table.rows[0].length + (add ? 1 : -1);
    update({ ...table, rows: table.rows.map(row => add ? [...row, ''] : row.slice(0, -1)), columnWidths: Array.from({ length: count }, () => 100 / count),
      ...(table.columnAlignments ? { columnAlignments: add ? [...table.columnAlignments, 'left'] : table.columnAlignments.slice(0, -1) } : {}) });
  };
  return <div className="space-y-3 font-sans" role="group" aria-label={`Table in paragraph ${index + 1}`}>
    <div className="overflow-x-auto">
      <div style={{ minWidth: minimumEditorWidth }}>
        {widths.length > 1 && <div ref={strip} role="group" aria-label="Table column widths" className="relative my-2 flex h-6 rounded border border-border bg-muted/40">
          {displayedWidths.map((width, column) => <div key={column} style={{ width: `${width}%` }} className="min-w-0 truncate px-1 text-center text-[10px] leading-6 tabular-nums text-muted-foreground" aria-hidden="true">
            {Math.round(width)}%
          </div>)}
          {widths.slice(0, -1).map((width, boundary) => <div
            key={boundary} tabIndex={0} role="slider" aria-label={`Resize divider after column ${boundary + 1}`}
            aria-valuemin={5} aria-valuemax={Number((width + widths[boundary + 1] - 5).toFixed(2))}
            aria-valuenow={Number(displayedWidths[boundary].toFixed(2))} aria-valuetext={`${displayedWidths[boundary].toFixed(1)} percent`}
            title={`Drag to resize. Double-click to fit column ${boundary + 1}.`}
            className="absolute top-0 z-10 h-full w-6 -translate-x-1/2 touch-none cursor-col-resize rounded hover:bg-primary/15 focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-primary before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-border"
            style={{ left: `${displayedWidths.slice(0, boundary + 1).reduce((total, current) => total + current, 0)}%` }}
            onPointerDown={event => {
              const stripWidth = strip.current?.getBoundingClientRect().width ?? 0;
              if (event.button !== 0 || !event.isPrimary || stripWidth <= 0) return;
              drag.current = { table, boundary, percent: width, width: stripWidth, start: event.clientX };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => resizeByPointer(event, false)}
            onPointerUp={event => { resizeByPointer(event, true); clearDrag(); }}
            onPointerCancel={clearDrag} onLostPointerCapture={clearDrag}
            onDoubleClick={() => update(fitBodyTableColumn(table, boundary))}
            onKeyDown={event => {
              const max = width + widths[boundary + 1] - 5;
              const step = event.shiftKey ? 5 : 1;
              const next = { ArrowLeft: width - step, ArrowDown: width - step, ArrowRight: width + step, ArrowUp: width + step, Home: 5, End: max }[event.key];
              if (next === undefined) return;
              event.preventDefault();
              update(resizeBodyTableBoundary(table, boundary, next));
            }} />)}
        </div>}
        <table className="w-full table-fixed border-collapse text-sm" style={{ fontSize: table.fontSize ? `${table.fontSize}pt` : undefined }}>
          <caption className="sr-only">Editable document table {index + 1}</caption>
          <colgroup>{displayedWidths.map((width, column) => <col key={column} style={{ width: `${width}%` }} />)}</colgroup>
          <tbody>{table.rows.map((row, rowIndex) => {
            const minimum = bodyTableRowHeight(table, rowIndex);
            const isHeader = rowIndex < table.headerRows;
            const Cell = isHeader ? 'th' : 'td';
            return <tr key={rowIndex} style={{ height: minimum ? `${minimum}pt` : undefined }}>
              {row.map((cell, column) => <Cell key={column} scope={isHeader ? 'col' : undefined} className={cn(
                'p-1 align-top',
                border === 'grid' && 'border border-border',
                (border === 'outline' || border === 'columns') && [
                  'border-border',
                  rowIndex === 0 && 'border-t',
                  (rowIndex === table.rows.length - 1 || border === 'columns' && rowIndex === table.headerRows - 1) && 'border-b',
                  column === 0 && 'border-l',
                  (border === 'columns' || column === row.length - 1) && 'border-r',
                ],
              )}>
                <Textarea autoFocus={autoFocus && rowIndex === 0 && column === 0}
                  aria-label={`Table ${index + 1}, row ${rowIndex + 1}, column ${column + 1}`}
                  data-table-row={rowIndex} data-table-column={column} value={cell}
                  wrap={table.wrap === false ? 'off' : 'soft'} maxLength={BODY_TABLE_LIMITS.cellCharacters}
                  onChange={event => rows(table.rows.map((cells, i) => i === rowIndex
                    ? cells.map((text, j) => j === column ? event.target.value : text) : cells))}
                  className="min-h-14 min-w-0 resize-y text-sm"
                  style={{ textAlign: table.columnAlignments?.[column] ?? 'left', fontSize: 'inherit' }} />
              </Cell>)}
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>
    <details className="rounded-md border border-border p-3 text-xs"><summary className="cursor-pointer font-medium">Table formatting</summary>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="space-y-1">Header rows <select className="rounded border border-border bg-background p-1" aria-label={`Header rows for table ${index + 1}`} value={table.headerRows} onChange={event => update({ ...table, headerRows: Number(event.target.value) })}>
          {Array.from({ length: Math.min(3, table.rows.length) + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
        </select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={table.repeatHeaders !== false} disabled={!table.headerRows} onChange={event => update({ ...table, repeatHeaders: event.target.checked })} />Repeat headers on later pages</label>
        <label>Lines <select aria-label={`Lines for table ${index + 1}`} className="rounded border border-border bg-background p-1" value={table.borders ?? 'grid'} onChange={event => update({ ...table, borders: event.target.value as BodyTable['borders'] })}>
          <option value="grid">Grid</option><option value="columns">Columns</option><option value="outline">Outline</option><option value="none">None</option>
        </select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={table.wrap !== false} onChange={event => update({ ...table, wrap: event.target.checked ? undefined : false })} />Wrap cell text</label>
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
        <Button className="mt-2 h-7 px-2 text-xs" size="sm" variant="ghost" disabled={widths.length === 1}
          aria-label={`Fit column to text (table ${index + 1}, column ${column + 1})`}
          onClick={() => update(fitBodyTableColumn(table, column))}>Fit column to text</Button>
      </fieldset>)}</div>
      <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => update(autofitBodyTable(table))}>Fit widths to text</Button><Button size="sm" variant="outline" onClick={() => update({ ...table, columnWidths: undefined })}>Equal widths</Button></div>
      <details className="mt-3 rounded border border-border p-2">
        <summary className="cursor-pointer font-medium">Per-row minimum heights</summary>
        <p className="mt-1 text-muted-foreground">Rows without an override inherit the table minimum. Set 0 to remove the minimum for one row.</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {table.rows.map((_, row) => <div key={row} className="space-y-1">
            <label htmlFor={`table-${index}-row-${row}-height`}>Row {row + 1} (pt)</label>
            <div className="flex items-center gap-1">
              <TableNumberInput id={`table-${index}-row-${row}-height`}
                type="number" min={0} max={144} className="h-8 min-w-0" value={table.rowHeights?.[row] ?? null} placeholder={String(table.minimumRowHeight ?? 0)} onCommit={value => setRowHeight(row, value)} />
              {table.rowHeights?.[row] != null && <Button size="sm" className="h-7 px-2 text-xs" variant="ghost" onClick={() => setRowHeight(row, null)} aria-label={`Reset minimum height for table ${index + 1} row ${row + 1}`}>Reset</Button>}
            </div>
          </div>)}
        </div>
      </details>
      {table.wrap === false && <p className="mt-2 text-muted-foreground">New lines stay where you type them. Long lines fit within the column.</p>}
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
