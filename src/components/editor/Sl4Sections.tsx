import { captureDocumentTarget, isCurrentDocumentTarget } from '@/stores/documentsStore';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useDocumentStore } from '@/stores/documentStore';
import { showAppConfirm } from '@/stores/alertStore';
import { newAttachmentId } from '@/lib/attachments';
import { buildSl4Indexes } from '@/lib/sl4References';
import { assignSl4Parent, deleteSl4Group, moveSl4Group } from '@/lib/sl4Editing';
import { isSl4BlockingFinding, sl4ContentFindings } from '@/lib/sl4Validation';
import { emptySl4, newSl4Part, numberedSl4Parts, type Sl4Data, type Sl4Row, type Sl4Part } from '@/data/techpub/sl4';
import { SL4_PREFACE, sl4PrefaceNumber, sl4PrefaceText } from '@/data/techpub/sl4Preface';
import { SL3_PORTIONS } from '@/data/techpub/sl3';
import { Sl3CoverSection, Sl3IllustrationsSection } from './Sl3Sections';
import { StockPublicationGroup as EditorGroup } from './StockPublicationGroup';

function useSl4() {
  const stored = useDocumentStore((store) => store.formData.sl4);
  const data = stored ?? emptySl4();
  return { data, update: (patch: Partial<Sl4Data>) => {
    const store = useDocumentStore.getState();
    store.setField('sl4', { ...(store.formData.sl4 ?? emptySl4()), ...patch });
  } };
}
function Field({ label, value, onChange, multiline = false, error, inputMode }: {
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean;
  error?: string; inputMode?: 'text' | 'decimal';
}) {
  const id = useId();
  const Component = multiline ? Textarea : Input;
  return <div className="min-w-0 space-y-2 text-sm">
    <Label htmlFor={id} className="font-medium">{label}</Label>
    <Component id={id} className={multiline ? 'min-h-20' : 'min-h-11'} value={value} inputMode={inputMode} aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value)} />
    {error && <p id={`${id}-error`} className="text-xs leading-relaxed text-destructive">{error}</p>}
  </div>;
}
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return <div className="min-w-0 space-y-2">
    <Label className="text-sm" htmlFor={id}>{label}</Label>
    <DatePicker id={id} className="sl3-date-control" dateFormat="iso" value={value}
      calendarLabel={`Choose ${label.toLowerCase()}`} onChange={onChange} />
  </div>;
}
function Choice({ label, value, onChange, children, error }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; error?: string }) {
  const id = useId();
  return <div className="min-w-0 space-y-2 text-sm">
    <Label htmlFor={id} className="font-medium">{label}</Label>
    <select id={id} className="min-h-11 w-full rounded-md border bg-background p-2" value={value}
      aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
      onChange={(e) => onChange(e.target.value)}>{children}</select>
    {error && <p id={`${id}-error`} className="text-xs leading-relaxed text-destructive">{error}</p>}
  </div>;
}

function focusSl4Part(id: string) {
  requestAnimationFrame(() => {
    const field = document.getElementById(`sl4-row-${id}`)?.querySelector<HTMLInputElement>('input');
    field?.scrollIntoView({ block: 'center' });
    field?.focus({ preventScroll: true });
  });
}
function Portion({ label, value, onChange }: { label: string; value: Sl4Data['contextPortion']; onChange: (value: Sl4Data['contextPortion']) => void }) {
  return <Choice label={label} value={value} onChange={(value) => onChange(value as Sl4Data['contextPortion'])}>{SL3_PORTIONS.map((mark) => <option key={mark}>{mark}</option>)}</Choice>;
}
export function Sl4CoverSection() { return <Sl3CoverSection publication="sl4" />; }
export function Sl4IllustrationsSection() { return <Sl3IllustrationsSection publication="sl4" />; }

export function Sl4PrefaceSection() {
  const { data, update } = useSl4();
  const shortTitle = useDocumentStore(store => store.formData.shortTitle ?? '');
  return <div className="sl3-editor sl4-editor space-y-6">
    <h3 className="text-xl font-medium">Preface and special notes</h3>
    <EditorGroup title="Publication context">
    <Field label="Source maintenance manual" value={data.sourceManual} onChange={(sourceManual) => update({ sourceManual })} />
    <Field label="Reason for a standalone repair parts list" value={data.standaloneRationale} onChange={(standaloneRationale) => update({ standaloneRationale })} multiline />
    <div className="sl3-field-grid">
      <DateField label="Publication cut-off date" value={data.cutoffDate} onChange={(cutoffDate) => update({ cutoffDate })} />
      <Portion label="Publication context portion marking" value={data.contextPortion} onChange={(contextPortion) => update({ contextPortion })} />
    </div>
    </EditorGroup>
    <details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">Publication preface</summary><div className="space-y-3 pt-3">{SL4_PREFACE.map((block) => <p key={block.number || block.text}>{block.number && <strong>{sl4PrefaceNumber(block.number)} </strong>}{sl4PrefaceText(block.text, data.cutoffDate, shortTitle)}</p>)}</div></details>
    <p className="text-xs text-muted-foreground">The preface explains SMR codes and refers to SECNAVINST 4410.23. Assigned codes and equipment data require author review.</p>
    <h4 className="font-medium">Special notes</h4>
    {data.notes.map((note, i) => <fieldset key={note.id} className="space-y-4 rounded-lg border p-4"><legend>Special note {21 + i}</legend>
      <Field label={`Special note ${21 + i} text`} value={note.text} onChange={(text) => update({ notes: data.notes.map((entry) => entry.id === note.id ? { ...entry, text } : entry) })} multiline />
      <Portion label={`Special note ${21 + i} portion marking`} value={note.portionMarking} onChange={(portionMarking) => update({ notes: data.notes.map((entry) => entry.id === note.id ? { ...entry, portionMarking } : entry) })} />
      <Button variant="ghost" onClick={() => update({ notes: data.notes.filter((entry) => entry.id !== note.id) })}>Remove special note {21 + i}</Button>
    </fieldset>)}
    <Button variant="outline" onClick={() => update({ notes: [...data.notes, { id: newAttachmentId(), text: '', portionMarking: 'U' }] })}>Add special note</Button>
    <h4 className="font-medium">Additional definitions</h4>
    {data.definitions.map((definition, i) => <fieldset key={definition.id} className="space-y-4 rounded-lg border p-4"><legend>Definition {i + 1}</legend>
      {(['term', 'meaning'] as const).map((key) => <Field key={key} label={`Definition ${i + 1} ${key}`} value={definition[key]} multiline={key === 'meaning'} onChange={(value) => update({ definitions: data.definitions.map((entry) => entry.id === definition.id ? { ...entry, [key]: value } : entry) })} />)}
      <Portion label={`Definition ${i + 1} portion marking`} value={definition.portionMarking} onChange={(portionMarking) => update({ definitions: data.definitions.map((entry) => entry.id === definition.id ? { ...entry, portionMarking } : entry) })} />
      <Button variant="ghost" onClick={() => update({ definitions: data.definitions.filter((entry) => entry.id !== definition.id) })}>Remove definition {i + 1}</Button>
    </fieldset>)}
    <Button variant="outline" onClick={() => update({ definitions: [...data.definitions, { id: newAttachmentId(), term: '', meaning: '', portionMarking: 'U' }] })}>Add definition</Button>
  </div>;
}

export function Sl4CagesSection() {
  const { data, update } = useSl4();
  const existing = new Set(data.cages.map(entry => entry.code.trim().toUpperCase()));
  const missingCodes = [...new Set(data.rows.flatMap(row => row.kind === 'part' && row.cage.trim() ? [row.cage.trim().toUpperCase()] : []))].filter(code => !existing.has(code));
  return <div className="sl3-editor sl4-editor space-y-5"><h3 className="text-xl font-medium">Commercial and government entities</h3>
    <p className="text-sm text-muted-foreground">Identify the makers and organizations referenced by the parts list. Add missing CAGE codes from Part I, then complete their names and addresses.</p>
    {data.cages.map((cage, i) => <fieldset key={cage.id} className="space-y-4 rounded-lg border p-4"><legend>Entity {i + 1}</legend><div className="sl3-field-grid">
      {(['code', 'name'] as const).map((key) => <Field key={key} label={`Entity ${i + 1} ${key}`} value={cage[key]} onChange={(value) => update({ cages: data.cages.map((entry) => entry.id === cage.id ? { ...entry, [key]: value } : entry) })} />)}
    </div>
      <Field label={`Entity ${i + 1} address`} value={cage.address} multiline onChange={(address) => update({ cages: data.cages.map((entry) => entry.id === cage.id ? { ...entry, address } : entry) })} />
      <Portion label={`Entity ${i + 1} portion marking`} value={cage.portionMarking} onChange={(portionMarking) => update({ cages: data.cages.map((entry) => entry.id === cage.id ? { ...entry, portionMarking } : entry) })} />
      <Button variant="ghost" onClick={() => update({ cages: data.cages.filter((entry) => entry.id !== cage.id) })}>Remove entity {i + 1}</Button></fieldset>)}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => update({ cages: [...data.cages, { id: newAttachmentId(), code: '', name: '', address: '', portionMarking: 'U' }] })}>Add entity</Button>
      <Button variant="outline" disabled={!missingCodes.length} onClick={() => update({ cages: [...data.cages, ...missingCodes.map(code => ({ id: newAttachmentId(), code, name: '', address: '', portionMarking: 'U' as const }))] })}>Add missing CAGE codes</Button>
    </div>
  </div>;
}

export function Sl4PartsSection() {
  const { data, update } = useSl4();
  const paragraphs = useDocumentStore((store) => store.paragraphs);
  const [message, setMessage] = useState<{ rowId: string; text: string } | null>(null);
  const parts = numberedSl4Parts(data.rows);
  const figures = paragraphs.filter((p) => p.figure);
  const findings = sl4ContentFindings(data, { figureIds: figures.map(figure => figure.referenceId ?? '') }).filter(isSl4BlockingFinding);
  const patch = (id: string, value: Partial<Sl4Part>) => update({ rows: data.rows.map((row) => row.id === id ? { ...row, ...value } as Sl4Row : row) });
  const applyRows = (rows: Sl4Row[]) => { if (rows !== data.rows) update({ rows, artwork: [] }); };
  return <div className="sl3-editor sl4-editor space-y-6"><h3 className="text-xl font-medium">Part I — Item identification listing</h3>
    <p className="text-sm text-muted-foreground">Keep parts in top-down breakdown order. Item numbers and cross-references update together. Moving a parent moves its components; changing their order requires a fresh illustration lettering review.</p>
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Part names, quantities and sheet limits</summary>
      <div className="space-y-3 pt-3 text-muted-foreground">
        <p>Use capitals for the official item name before the first comma. Keep descriptions in lower case except acronyms and proper names, and spell out symbols. Headings and blank rows count toward the 18-row sheet limit; column headings do not.</p>
        <p>Quantity per application is the amount used in that installation or assembly. Quantity per equipment is the author-verified consolidated total for a maintenance part, entered only at its first appearance in the list.</p>
      </div>
    </details>
    <EditorGroup title="Parts list" description={`${parts.length} repair ${parts.length === 1 ? 'part' : 'parts'}. Jump directly to an item to review or edit it.`}>
      <div className="sl3-field-grid">
        <Choice label="Jump to repair part" value="" onChange={focusSl4Part}>
          <option value="">Choose an item</option>
          {parts.map(part => <option key={part.id} value={part.id}>Item {part.itemNumber}: {part.nomenclature || 'Untitled part'}</option>)}
        </Choice>
        <Choice label="Maximum parts rows per sheet" value={String(data.rowsPerSheet)} onChange={(value) => update({ rowsPerSheet: Number(value) })}>{Array.from({ length: 18 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Choice>
      </div>
    </EditorGroup>
    {data.rows.map((row, rowIndex) => {
      const n = parts.find((part) => part.id === row.id)?.itemNumber;
      const label = row.kind === 'part' ? `Item ${n}` : `${row.kind === 'heading' ? 'Heading' : 'Blank row'} ${rowIndex + 1}`;
      const rowFindings = findings.filter(finding => finding.path[0] === 'rows' && finding.path[1] === rowIndex);
      const error = (field: string) => rowFindings.filter(finding => finding.path[2] === field).map(finding => finding.message).join(' ') || undefined;
      const rowErrors = rowFindings.filter(finding => finding.path.length === 2 || finding.path[2] === 'isKit');
      return <fieldset key={row.id} id={`sl4-row-${row.id}`} className="space-y-4 rounded-lg border p-4"><legend className="px-1 font-medium">{label}</legend>
        {row.kind === 'heading' && <><Field label={`${label} text`} value={row.text} error={error('text')} onChange={(text) => update({ rows: data.rows.map((entry) => entry.id === row.id ? { ...row, text } : entry) })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!row.majorCombination} onChange={(e) => update({ rows: data.rows.map((entry) => entry.id === row.id ? { ...row, majorCombination: e.target.checked } : entry) })} />Starts a major combination</label>
          <Portion label={`${label} portion marking`} value={row.portionMarking} onChange={(portionMarking) => update({ rows: data.rows.map((entry) => entry.id === row.id ? { ...row, portionMarking } : entry) })} /></>}
        {row.kind === 'part' && <>
          <EditorGroup title="Identification">
          <Field label={`${label} nomenclature`} value={row.nomenclature} error={error('nomenclature')} onChange={(nomenclature) => patch(row.id, { nomenclature })} />
          <Field label={`${label} description`} value={row.description} error={error('description')} onChange={(description) => patch(row.id, { description })} multiline />
          <Portion label={`${label} portion marking`} value={row.portionMarking} onChange={(portionMarking) => patch(row.id, { portionMarking })} />
          <div className="sl3-field-grid">{([
            ['smr', 'SMR'], ['nsn', 'NSN'], ['cage', 'CAGE'], ['partNumber', 'Part number'],
          ] as const).map(([key, name]) => <Field key={key} label={`${label} ${name}`} value={row[key]} error={error(key)} onChange={(value) => patch(row.id, { [key]: value })} />)}</div>
          </EditorGroup>
          <EditorGroup title="Quantities and replacement">
          <div className="sl3-field-grid">
            {([['unit', 'Unit of measure'], ['quantityPerApplication', 'Quantity per application'], ['quantityPerEquipment', 'Quantity per equipment']] as const).map(([key, name]) =>
              <Field key={key} label={`${label} ${name}`} value={row[key]} error={error(key)} inputMode={key === 'unit' ? 'text' : 'decimal'} onChange={value => patch(row.id, { [key]: value })} />)}
            <Choice label={`${label} maintenance status`} value={row.maintenancePart === undefined ? '' : row.maintenancePart ? 'yes' : 'no'} error={error('maintenancePart')} onChange={(value) => patch(row.id, { maintenancePart: value === '' ? undefined : value === 'yes' })}><option value="">Not specified</option><option value="yes">Maintenance part</option><option value="no">Non-maintenance part</option></Choice>
          </div>
          <div className="sl3-field-grid">
            {([['mandatoryReplacement', 'MAN mandatory replacement'], ['economicReplacement', 'ECO economic replacement']] as const).map(([key, name]) => <label key={key} className="flex min-h-11 items-center gap-2 text-sm"><input aria-label={`${label} ${name}`} type="checkbox" checked={row[key]} onChange={(e) => patch(row.id, { [key]: e.target.checked })} />{name}</label>)}
          </div>
          </EditorGroup>
          <EditorGroup title="Assembly and illustration">
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label={`${label} Kit or set`} checked={row.isKit} onChange={event => patch(row.id, { isKit: event.target.checked })} />Kit or set</label>
          <Choice label={`${label} parent`} value={row.parentId} onChange={(parentId) => {
            const rows = assignSl4Parent(data, row.id, parentId);
            if (rows === data.rows && parentId !== row.parentId) setMessage({ rowId: row.id, text: 'This parent would cross a major combination or break the component sequence.' });
            else { applyRows(rows); setMessage(null); }
          }}><option value="">Top-level item</option>{parts.filter((part) => part.itemNumber < (n ?? 0)).map((part) => <option key={part.id} value={part.id}>Item {part.itemNumber}: {part.nomenclature}</option>)}</Choice>
          <Choice label={`${label} illustration`} value={row.figureId} error={error('figureId')} onChange={(figureId) => patch(row.id, { figureId })}><option value="">Not illustrated</option>{figures.map((p) => <option key={p.referenceId} value={p.referenceId}>{p.text || 'Untitled illustration'}</option>)}</Choice>
          <Field label={`${label} circuit symbols (comma separated)`} value={row.circuitSymbols.join(', ')} error={error('circuitSymbols')} onChange={(value) => patch(row.id, { circuitSymbols: value ? value.split(',').map((symbol) => symbol.trim()) : [] })} />
          <Choice label={`${label} related-item type`} value={row.relationship?.kind ?? ''} error={!row.relationship ? error('relationship') : undefined} onChange={(value) => patch(row.id, { relationship: value ? { kind: value as NonNullable<Sl4Part['relationship']>['kind'], itemIds: [] } : undefined })}><option value="">None</option><option value="same_as">S/A — Same as</option><option value="fabricated_from">FAB FR — Fabricated from</option><option value="assembled_from">ASSEM FR — Assembled from</option></Choice>
          {row.relationship && <Choice label={`${label} related items`} value="" error={error('relationship')} onChange={(value) => { if (value) patch(row.id, { relationship: { ...row.relationship!, itemIds: row.relationship!.kind === 'same_as' ? [value] : [...new Set([...row.relationship!.itemIds, value])] } }); }}><option value="">Choose an item</option>{parts.filter((part) => part.id !== row.id && (row.relationship?.kind !== 'same_as' || part.itemNumber < (n ?? 0))).map((part) => <option key={part.id} value={part.id}>Item {part.itemNumber}: {part.nomenclature}</option>)}</Choice>}
          <div className="flex flex-wrap gap-2">
          {row.relationship?.itemIds.map((id) => <Button key={id} variant="outline" onClick={() => patch(row.id, { relationship: { ...row.relationship!, itemIds: row.relationship!.itemIds.filter((itemId) => itemId !== id) } })}>Remove related item {parts.find((part) => part.id === id)?.itemNumber ?? 'missing'}</Button>)}
          </div>
          </EditorGroup>
        </>}
        {!!rowErrors.length && <ul aria-label={`${label} checks`} className="space-y-1 text-sm text-destructive">{rowErrors.map((finding, i) => <li key={`${finding.code}-${i}`}>{finding.message}</li>)}</ul>}
        {message?.rowId === row.id && <p role="alert" className="text-sm text-destructive">{message.text}</p>}
        <div className="flex flex-wrap gap-2">{([-1, 1] as const).map((direction) => <Button key={direction} variant="outline" disabled={moveSl4Group(data, row.id, direction) === data.rows} aria-label={`Move ${label} ${direction < 0 ? 'up' : 'down'}`} onClick={() => applyRows(moveSl4Group(data, row.id, direction))}>{direction < 0 ? 'Move up' : 'Move down'}</Button>)}
          <Button variant="ghost" onClick={async () => {
            const target = captureDocumentTarget();
            if (!await showAppConfirm({ title: `Remove ${label}?`, message: 'This removes its component group and clears references to the removed items. Remaining item numbers update, and illustrations require another lettering review.', confirmLabel: 'Remove group', destructive: true })) return;
            const current = useDocumentStore.getState();
            if (current.docType !== 'sl4') return;
            const latest = current.formData.sl4;
            if (!latest) return;
            if (latest !== data) { setMessage({ rowId: row.id, text: 'This draft changed while the confirmation was open. Review the current parts and try again.' }); return; }
            if (!isCurrentDocumentTarget(target)) return;
            const rows = deleteSl4Group(latest, row.id);
            if (rows !== latest.rows) current.setField('sl4', { ...latest, rows, artwork: [] });
            setMessage(null);
          }}>Remove {label}</Button>
        </div>
      </fieldset>;
    })}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => update({ rows: [...data.rows, newSl4Part(newAttachmentId())] })}>Add repair part</Button>
      <Button variant="outline" onClick={() => update({ rows: [...data.rows, { kind: 'heading', id: newAttachmentId(), text: '', portionMarking: 'U' }] })}>Add heading</Button>
      <Button variant="outline" onClick={() => update({ rows: [...data.rows, { kind: 'blank', id: newAttachmentId() }] })}>Add blank row</Button>
    </div>
  </div>;
}

export function Sl4IndexesSection() {
  const { data, update } = useSl4();
  const jump = useEditorOutlineStore((store) => store.jump);
  const editPart = (id: string) => {
    jump('sl4-parts');
    focusSl4Part(id);
  };
  let indexes: ReturnType<typeof buildSl4Indexes> | undefined, error = '';
  try { indexes = buildSl4Indexes(data); } catch (cause) { error = cause instanceof Error ? cause.message : 'Correct the parts data to rebuild cross-references.'; }
  return <div className="sl3-editor sl4-editor space-y-5"><h3 className="text-xl font-medium">Cross-references</h3>
    <Choice label="Circuit-symbol index" value={data.circuitIndex.mode} onChange={(mode) => update({ circuitIndex: { ...data.circuitIndex, mode: mode as Sl4Data['circuitIndex']['mode'] } })}><option value="not_applicable">Not electronic equipment</option><option value="include">Include Part V</option><option value="omitted_excessive">Omit excessive circuit symbols</option></Choice>
    {data.circuitIndex.mode === 'omitted_excessive' && <Field label="Circuit-index omission reason" value={data.circuitIndex.reason} onChange={(reason) => update({ circuitIndex: { ...data.circuitIndex, reason } })} multiline />}
    <p className="text-sm text-muted-foreground">Parts II–V are generated from Part I. Edit the original part to change an index entry.</p>
    <Choice label="Maximum index rows per panel" value={String(data.indexRowsPerPanel)} onChange={(value) => update({ indexRowsPerPanel: Number(value) })}>{Array.from({ length: 55 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Choice>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {indexes && Object.entries(indexes).filter(([key]) => key !== 'partV' || data.circuitIndex.mode === 'include').map(([key, records]) => <section key={key} className="space-y-2" aria-labelledby={`sl4-index-${key}`}><h4 id={`sl4-index-${key}`} className="font-medium">{({ partII: 'Part II — Items without NSNs', partIII: 'Part III — National stock numbers', partIV: 'Part IV — Part numbers', partV: 'Part V — Circuit symbols' } as Record<string, string>)[key]}</h4>
      {!records.length ? <p className="text-sm text-muted-foreground">No entries.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>
        <th className="p-2">Item</th>
        <th className="p-2">{key === 'partV' ? 'Circuit symbol' : key === 'partIII' ? 'Stock number' : 'Part number'}</th>
        {key !== 'partV' && <th className="p-2">CAGE</th>}
        {(key === 'partIII' || key === 'partIV') && <th className="p-2">{key === 'partIII' ? 'Part number' : 'Stock number'}</th>}
      </tr></thead><tbody>{records.map((record, i) => <tr key={`${record.rowId}-${i}`} className="border-t">
        <td className="p-2 align-top tabular-nums"><button type="button" className="underline underline-offset-2" aria-label={`Edit item ${record.itemNumber}`} onClick={() => editPart(record.rowId)}>{record.itemNumber}</button></td>
        <td className="p-2 align-top">{'circuitSymbol' in record ? record.circuitSymbol : key === 'partIII' ? record.nsn : record.partNumber}</td>
        {key !== 'partV' && <td className="p-2 align-top">{'cage' in record ? record.cage : ''}</td>}
        {(key === 'partIII' || key === 'partIV') && <td className="p-2 align-top">{'nsn' in record ? key === 'partIII' ? record.partNumber : record.nsn : ''}</td>}
      </tr>)}</tbody></table></div>}
    </section>)}
  </div>;
}

export function Sl4RevisionsSection() {
  const { data, update } = useSl4();
  return <div className="sl3-editor sl4-editor space-y-5"><h3 className="text-xl font-medium">Record of changes</h3><p className="text-sm text-muted-foreground">Leave the record empty for a new publication.</p>
    {data.revisions.map((revision, i) => <fieldset key={revision.id} className="space-y-4 rounded-lg border p-4"><legend>Revision {i + 1}</legend>
      <div className="sl3-field-grid">
        <Field label={`Revision ${i + 1} number`} value={revision.revision} onChange={value => update({ revisions: data.revisions.map(entry => entry.id === revision.id ? { ...entry, revision: value } : entry) })} />
        <DateField label={`Revision ${i + 1} date`} value={revision.date} onChange={date => update({ revisions: data.revisions.map(entry => entry.id === revision.id ? { ...entry, date } : entry) })} />
      </div>
      <Field label={`Revision ${i + 1} title or brief description`} value={revision.description} multiline onChange={description => update({ revisions: data.revisions.map(entry => entry.id === revision.id ? { ...entry, description } : entry) })} />
      <div className="sl3-field-grid">
        <Field label={`Revision ${i + 1} entered by`} value={revision.enteredBy} onChange={enteredBy => update({ revisions: data.revisions.map(entry => entry.id === revision.id ? { ...entry, enteredBy } : entry) })} />
        <Portion label={`Revision ${i + 1} portion marking`} value={revision.portionMarking} onChange={portionMarking => update({ revisions: data.revisions.map(entry => entry.id === revision.id ? { ...entry, portionMarking } : entry) })} />
      </div>
      <Button variant="ghost" onClick={() => update({ revisions: data.revisions.filter((entry) => entry.id !== revision.id) })}>Remove revision {i + 1}</Button>
    </fieldset>)}
    <Button variant="outline" onClick={() => update({ revisions: [...data.revisions, { id: newAttachmentId(), revision: '', date: '', description: '', enteredBy: '', portionMarking: 'U' }] })}>Add revision record</Button>
  </div>;
}
