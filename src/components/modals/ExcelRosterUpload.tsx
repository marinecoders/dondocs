import { useRef, useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { readExcelRoster, rosterDataRows, type ExcelRoster, type RosterSelection } from '@/lib/excelRoster';

export function ExcelRosterUpload({ disabled, onMap, onReset, onPendingChange }: { disabled: boolean; onMap(selection: RosterSelection): void; onReset(): void; onPendingChange(pending: boolean): void }) {
  const [roster, setRoster] = useState<ExcelRoster | null>(null);
  const [filename, setFilename] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [noHeader, setNoHeader] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => () => { ++request.current; }, []);
  const selection = roster ? { roster, headerRow: noHeader ? null : headerRow } : null;
  const headerValid = noHeader || !!roster?.rows.some(row => row.number === headerRow);
  const dataCount = selection ? rosterDataRows(selection).length : 0;
  const previewStart = Math.max(0, (roster?.rows.findIndex(row => row.number === headerRow) ?? 0) - 2);

  return <section className="space-y-3 rounded-lg border border-border/50 p-4 min-w-0" aria-label="Excel roster upload">
    <div className="space-y-2">
      <Label htmlFor="excel-roster-file">Upload Excel roster (.xlsx)</Label>
      <Input id="excel-roster-file" type="file" accept=".xlsx" disabled={disabled || loading} onChange={async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const id = ++request.current;
        onReset();
        onPendingChange(true);
        setLoading(true);setError('');setRoster(null);
        try {
          const parsed = await readExcelRoster(file);
          if (id !== request.current) return;
          setRoster(parsed);setFilename(file.name);setHeaderRow(parsed.rows[0].number);setNoHeader(false);
        } catch (err) {
          if (id === request.current) {
            setError(err instanceof Error ? err.message : 'This workbook could not be read. Choose another .xlsx file.');
            onPendingChange(false);
          }
        } finally { if (id === request.current) setLoading(false); }
      }} />
      <p className="text-xs text-muted-foreground">Reads the first worksheet on this device. Up to 10 MB (50 MB expanded), 5,000 worksheet rows, 100 columns and 100,000 cells.</p>
    </div>
    {loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Reading workbook…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {roster && <>
      <p className="text-sm break-words">{filename} · First worksheet: <strong>{roster.sheetName}</strong></p>
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="excel-roster-header">Header row</Label>
        <Input id="excel-roster-header" type="number" min={1} max={5000} value={Number.isFinite(headerRow) ? headerRow : ''}
          className="w-24" disabled={disabled || noHeader} onChange={event => { onReset();setHeaderRow(event.target.valueAsNumber); }} />
        <div className="flex items-center gap-2">
          <Checkbox id="excel-roster-no-header" checked={noHeader} disabled={disabled} onCheckedChange={checked => { onReset();setNoHeader(checked === true); }} />
          <Label htmlFor="excel-roster-no-header">No header row</Label>
        </div>
      </div>
      {!headerValid && <p role="alert" className="text-sm text-destructive">Choose a populated worksheet row for the headers.</p>}
      <p className="text-xs text-muted-foreground">Preview shows up to 10 rows near the selected header. Rows above it and empty rows are excluded. Excel dates use YYYY-MM-DD. Text dates are kept as entered.</p>
      <div className="overflow-x-auto max-h-64 rounded border border-border/50">
        <table className="w-full text-xs"><caption className="sr-only">First worksheet preview</caption>
          <thead><tr><th scope="col" className="p-2 text-left">Row</th>{Array.from({ length: roster.columnCount }, (_, i) => <th scope="col" key={i} className="p-2 text-left whitespace-nowrap">Column {i + 1}</th>)}</tr></thead>
          <tbody>{roster.rows.slice(previewStart, previewStart + 10).map(row => <tr key={row.number} className={row.number === selection?.headerRow ? 'bg-primary/10 font-medium' : 'border-t'}>
            <th scope="row" className="p-2 whitespace-nowrap">{row.number}{row.number === selection?.headerRow ? ' (header)' : ''}</th>
            {row.cells.map((cell, i) => <td key={i} className="p-2 max-w-64 truncate" title={cell.value}>{cell.value || '—'}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={disabled || !headerValid || dataCount === 0} onClick={() => { if (selection) onMap(selection); }}>Map {dataCount} roster {dataCount === 1 ? 'row' : 'rows'}</Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setRoster(null);onReset();onPendingChange(false); }}>Cancel roster import</Button>
      </div>
      {dataCount === 0 && <p className="text-sm text-muted-foreground">No data rows follow this header. Choose an earlier header or select No header row.</p>}
    </>}
  </section>;
}
