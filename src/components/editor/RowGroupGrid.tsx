import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useFormStore } from '@/stores/formStore';
import type { FormRowGroupConfig } from '@/types/formConfig';

/**
 * Spreadsheet editor for a roster row group: columns are headers, one line per
 * row, tab across cells. The right shape for a table — a 30-Marine PFT roster
 * reads as a grid, not a stack of cards. One of the swappable row-group editor
 * modules (see the dispatcher in GenericFormSection); the harvester tags row
 * groups 'grid' by default.
 */
export function RowGroupGrid({
  formType,
  groupKey,
  group,
}: {
  formType: string;
  groupKey: string;
  group: FormRowGroupConfig;
}) {
  const rows = useFormStore((s) => s.configFormRows[formType]?.[groupKey]) ?? [];
  const addRow = useFormStore((s) => s.addConfigFormRow);
  const setRowValue = useFormStore((s) => s.setConfigFormRowValue);
  const removeRow = useFormStore((s) => s.removeConfigFormRow);

  // Signature columns are never typed here (signed after export), so they don't
  // earn a grid column.
  const columns = Object.entries(group.columns).filter(([, c]) => c.type !== 'signature');
  const atCap = rows.length >= group.count;

  // Vertical arrow keys move between the same column's cells, for spreadsheet
  // feel; Tab already walks left-to-right, top-to-bottom natively.
  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, colIndex: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rowIndex = Number(e.currentTarget.dataset.row);
    const next = e.key === 'ArrowDown' ? rowIndex + 1 : rowIndex - 1;
    const target = e.currentTarget
      .closest('table')
      ?.querySelector<HTMLInputElement>(`input[data-row="${next}"][data-col="${colIndex}"]`);
    if (target) {
      e.preventDefault();
      target.focus();
      target.select();
    }
  };

  const cell =
    'h-7 w-full min-w-[6.5rem] rounded-sm border border-transparent bg-transparent px-1.5 text-sm outline-none ' +
    'transition-[color,background-color,border-color,box-shadow] duration-150 hover:border-foreground/20 ' +
    'focus-visible:relative focus-visible:z-10 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className="w-8 px-2 py-1.5 text-2xs font-medium text-muted-foreground">
                #
              </th>
              {columns.map(([key, col]) => (
                <th
                  key={key}
                  scope="col"
                  className="whitespace-nowrap px-1.5 py-1.5 text-left text-2xs font-medium text-muted-foreground"
                >
                  {col.label || key}
                </th>
              ))}
              <th className="w-8" aria-label="Remove row" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No rows yet — add one below.
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="tnum px-2 py-0.5 text-center text-2xs text-muted-foreground">{i + 1}</td>
                {columns.map(([key, col], colIndex) => (
                  <td key={key} className="px-0.5 py-0.5">
                    {col.type === 'checkbox' ? (
                      <div className="flex justify-center">
                        <Checkbox
                          checked={row[key] === true}
                          onCheckedChange={(checked) => setRowValue(formType, groupKey, i, key, checked === true)}
                          aria-label={`${col.label || key}, row ${i + 1}`}
                        />
                      </div>
                    ) : (
                      <input
                        data-row={i}
                        data-col={colIndex}
                        value={typeof row[key] === 'string' ? (row[key] as string) : ''}
                        onChange={(e) => setRowValue(formType, groupKey, i, key, e.target.value)}
                        onKeyDown={(e) => onCellKeyDown(e, colIndex)}
                        aria-label={`${col.label || key}, row ${i + 1}`}
                        className={cell}
                      />
                    )}
                  </td>
                ))}
                <td className="px-1 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(formType, groupKey, i)}
                    aria-label={`Remove row ${i + 1}`}
                    className={cn(
                      'rounded p-1 text-muted-foreground/50 outline-none transition-colors duration-150',
                      'hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50'
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => addRow(formType, groupKey)}
        disabled={atCap}
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add row{atCap ? ` (page holds ${group.count})` : ''}
      </Button>
    </div>
  );
}
