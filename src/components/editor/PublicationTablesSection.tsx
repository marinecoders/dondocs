import { Plus, Trash2, Indent, Outdent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PublicationTableCell } from './PublicationTableCell';
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
  const setTableRowDetails = useDocumentStore((s) => s.setTableRowDetails);

  const carried = paragraphs.flatMap((p, paragraphIndex) =>
    p.tableKey ? [{ key: p.tableKey, heading: p.header, paragraph: p, paragraphIndex }] : []
  );

  if (carried.length === 0) {
    return (
      <>
      <h3 className="editor-section-heading">Tables</h3>
      <p className="text-xs text-muted-foreground">
        No tables. They appear here as the paragraphs that carry them are added.
      </p>
      </>
    );
  }

  return (
    <>
    <h3 className="editor-section-heading">Tables</h3>
    <div className="editor-section-groups">
      <p className="text-xs text-muted-foreground">
        An item with no NSN gives its CAGE code under the part number, as 74024019 (1CSL0).
        Indent an item to list it as consisting of the one above.
      </p>
      {carried.map(({ key, heading, paragraph, paragraphIndex }) => {
        const spec = tableSpec(key, paragraph.tableIdentifierMode);
        if (!spec) return null;
        const rows = tables[key] ?? [];

        return (
          <div key={key} className="space-y-2">
            <span className="text-sm font-medium">{heading ?? key}</span>
            <label className="flex items-center gap-2 text-xs">
              Identifiers
              <select aria-label={`Identifier mode, ${heading ?? key}`} value={paragraph.tableIdentifierMode ?? 'stock'}
                onChange={(e) => useDocumentStore.getState().updateParagraph(paragraphIndex, { tableIdentifierMode: e.target.value === 'software' ? 'software' : 'stock' })}>
                <option value="stock">Stock identifiers</option>
                <option value="software">Software/firmware version (MI)</option>
              </select>
            </label>
            {paragraph.tableIdentifierMode === 'software' && <p className="text-xs text-muted-foreground">Use this alternative only when no NSN, part number or CAGE is assigned. Clear any stock identifiers before export.</p>}

            {rows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Empty. A table that does not apply is left empty and is not printed.
              </p>
            )}

            {rows.map((row, index) => (
              <div key={index} className="space-y-2">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] items-end gap-3">
                {spec.columns.map((col) => (
                  <div key={col.key} className="min-w-0 space-y-1" style={col.key === 'description' && row.level ? { marginLeft: `${row.level * 12}px` } : undefined}>
                    <Label className="text-2xs text-muted-foreground">{col.label}</Label>
                    <PublicationTableCell
                      value={row.values[col.key] ?? ''}
                      onChange={(value) => updateTableRow(key, index, { [col.key]: value })}
                      label={`${col.label}, ${heading ?? key} row ${index + 1}`}
                      paragraph={paragraph}
                      ensureReferenceId={() => {
                        const state = useDocumentStore.getState();
                        const existing = state.paragraphs[paragraphIndex].referenceId;
                        if (existing) return existing;
                        const id = crypto.randomUUID().replace(/-/g, '').toUpperCase();
                        state.updateParagraph(paragraphIndex, { referenceId: id });
                        return id;
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-1">
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
              {key === 'materielRequired' && <details className="text-xs">
                <summary>Identification exception</summary>
                <p>Only when no NSN, part number or CAGE is assigned, describe the identifying marks or explain how to identify the item.</p>
                <Input aria-label={`Identification exception, row ${index + 1}`} value={row.identificationException ?? ''}
                  onChange={(e) => setTableRowDetails(key, index, { identificationException: e.target.value })} />
              </details>}
              {key === 'specialTools' && <div className="space-y-1 text-xs">
                <label><input type="checkbox" checked={!!row.openPurchase} onChange={(e) => setTableRowDetails(key, index, { openPurchase: e.target.checked ? { manufacturer: '', address: '' } : undefined })} /> Open purchase, row {index + 1}</label>
                {row.openPurchase && <>
                  <Input aria-label={`Manufacturer, row ${index + 1}`} value={row.openPurchase.manufacturer} onChange={(e) => setTableRowDetails(key, index, { openPurchase: { ...row.openPurchase!, manufacturer: e.target.value } })} />
                  <Input aria-label={`Manufacturer address, row ${index + 1}`} value={row.openPurchase.address} onChange={(e) => setTableRowDetails(key, index, { openPurchase: { ...row.openPurchase!, address: e.target.value } })} />
                </>}
              </div>}
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
    </>
  );
}
