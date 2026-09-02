import { Plus, Trash2, Indent, Outdent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDocumentStore } from '@/stores/documentStore';
import { tableSpec } from '@/data/techpub/tables';

/** Deepest "consisting of" level the standard indents to. */
const MAX_LEVEL = 2;

/**
 * The tables a technical publication carries.
 *
 * Which tables appear is decided by the document's paragraphs — each names the
 * table it introduces — so removing a paragraph removes its table from here
 * too, and the heading shown is the paragraph's own. One editor serves all of
 * them, driven by the column set the table declares.
 */
export function PublicationTablesSection() {
  const paragraphs = useDocumentStore((s) => s.paragraphs);
  const tables = useDocumentStore((s) => s.publicationTables);
  const addTableRow = useDocumentStore((s) => s.addTableRow);
  const updateTableRow = useDocumentStore((s) => s.updateTableRow);
  const removeTableRow = useDocumentStore((s) => s.removeTableRow);
  const setTableRowLevel = useDocumentStore((s) => s.setTableRowLevel);

  const carried = paragraphs.flatMap((p) =>
    p.tableKey ? [{ key: p.tableKey, heading: p.header }] : []
  );

  if (carried.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No tables. They appear here as the paragraphs that carry them are added.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {carried.map(({ key, heading }) => {
        const spec = tableSpec(key);
        if (!spec) return null;
        const rows = tables[key] ?? [];

        return (
          <div key={key} className="space-y-2">
            <span className="text-sm font-medium">{heading ?? key}</span>

            {rows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Empty. A table that does not apply is left empty and is not printed.
              </p>
            )}

            {rows.map((row, index) => (
              <div key={index} className="flex items-end gap-2">
                {spec.columns.map((col, ci) => (
                  <div key={col.key} className="flex-1 space-y-1">
                    {index === 0 && (
                      <Label className="text-2xs text-muted-foreground">{col.label}</Label>
                    )}
                    <Input
                      value={row.values[col.key] ?? ''}
                      onChange={(e) => updateTableRow(key, index, { [col.key]: e.target.value })}
                      aria-label={`${col.label}, ${heading ?? key} row ${index + 1}`}
                      // The description carries the nesting, so indent it to
                      // match what prints.
                      style={ci === 1 && row.level ? { marginLeft: `${row.level * 12}px` } : undefined}
                    />
                  </div>
                ))}
                {spec.nestable && (
                  <>
                    <Button
                      type="button" variant="ghost" size="icon"
                      disabled={(row.level ?? 0) >= MAX_LEVEL}
                      onClick={() => setTableRowLevel(key, index, (row.level ?? 0) + 1)}
                      aria-label={`Indent row ${index + 1} as a consisting-of item`}
                    >
                      <Indent className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button" variant="ghost" size="icon"
                      disabled={!row.level}
                      onClick={() => setTableRowLevel(key, index, (row.level ?? 0) - 1)}
                      aria-label={`Outdent row ${index + 1}`}
                    >
                      <Outdent className="h-4 w-4" aria-hidden />
                    </Button>
                  </>
                )}
                <Button
                  type="button" variant="ghost" size="icon"
                  onClick={() => removeTableRow(key, index)}
                  aria-label={`Remove ${heading ?? key} row ${index + 1}`}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={() => addTableRow(key)}>
              <Plus className="h-4 w-4 mr-2" aria-hidden />
              Add row
            </Button>
          </div>
        );
      })}
    </div>
  );
}
