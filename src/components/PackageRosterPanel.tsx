import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { PackageIntakeQuestions } from './PackageIntakeQuestions';
import { PackageIntakePreview } from './PackageIntakePreview';
import { PackageTemplateContentsPreview } from './PackageTemplateContentsPreview';
import { PackageSigningPdfPreview } from './PackageSigningPdfPreview';
import { maintainedPackageAction, maintainedPackageActions } from '@/lib/maintainedPackageActions';
import { listPackageTemplates } from '@/lib/packageTemplateLibrary';
import { freshPackageTemplateAnswers, intakeAttachmentSlots } from '@/lib/conditionalIntakeView';
import { readExcelRoster, rosterHeaders, autoMapRosterColumns, type ExcelRoster } from '@/lib/excelRoster';
import { preparePackageRoster, savePreparedPackageRoster, createPreparedPackageRosterRow, prepareSavedPackageRoster, listPackageRosters,
  packageRosterRowsFromWorksheet, removePackageRoster, readCreatedPackageRosterRow, type PackageRosterInputRow, type PreparedPackageRoster } from '@/lib/packageRoster';
import { MAX_PACKAGE_ROSTER_ROWS, type PackageRoster } from '@/lib/packageRosterModel';
import { newPackageId, type ActionPackage } from '@/lib/actionPackages';
import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';
import { getExportDeploymentPolicy } from '@/config/classification';

const inputClass = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
interface Props {
  disabled: boolean; busy: boolean; run(action: () => Promise<void>): Promise<void>; signal(): AbortSignal | undefined; isCurrent(): boolean;
  onDirtyChange?(dirty: boolean): void; onCreated?(record: ActionPackage): void; onOpenPackage?(record: ActionPackage): void;
}
interface EditableRow extends PackageRosterInputRow { key: string }
export function PackageRosterPanel({ disabled, busy, run, signal, isCurrent, onDirtyChange, onCreated, onOpenPackage }: Props) {
  const [library, setLibrary] = useState<PackageTemplateV2[]>([]), [sourceId, setSourceId] = useState(''), [template, setTemplate] = useState<PackageTemplateV2 | null>(null);
  const [name, setName] = useState('Package roster'), [rows, setRows] = useState<EditableRow[]>([]), [worksheet, setWorksheet] = useState<ExcelRoster | null>(null), [headerRow, setHeaderRow] = useState<number | null>(null), [columns, setColumns] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<PreparedPackageRoster | null>(null), [inputsReviewed, setInputsReviewed] = useState(false), [rowReviewed, setRowReviewed] = useState(false);
  const [journals, setJournals] = useState<PackageRoster[]>([]), [journalId, setJournalId] = useState(''), [journal, setJournal] = useState<PackageRoster | null>(null), [rowId, setRowId] = useState('');
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; number: number; filename: string } | null>(null), [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(false), generation = useRef(0), running = useRef(false), enabled = useRef(!disabled), callback = useRef(onDirtyChange), wasDisabled = useRef(disabled);
  const locked = disabled || busy || pending, dirty = !!template && !journal;
  useLayoutEffect(() => { enabled.current = !disabled; callback.current = onDirtyChange; }, [disabled, onDirtyChange]);
  useLayoutEffect(() => {
    if (disabled && !wasDisabled.current) { generation.current++; queueMicrotask(() => { if (alive.current) { setPreview(null); setInputsReviewed(false); setRowReviewed(false); setPdf(null); } }); }
    wasDisabled.current = disabled;
  }, [disabled]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; callback.current?.(false); }; }, []);
  useLayoutEffect(() => { callback.current?.(dirty); }, [dirty]);
  function invalidate() { generation.current++; setPreview(null); setInputsReviewed(false); setRowReviewed(false); setPdf(null); setNotice(''); }
  async function perform(action: (current: () => boolean) => Promise<void>) {
    if (locked || running.current) return; running.current = true; setPending(true); setError('');
    const version = generation.current; let activeSignal: AbortSignal | undefined;
    const current = () => alive.current && enabled.current && generation.current === version && !activeSignal?.aborted && signal() === activeSignal && isCurrent();
    try { await run(async () => {
      activeSignal = signal();
      try { if (current()) await action(current); }
      catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The roster operation failed.'); throw cause; }
    }); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The roster operation failed.'); }
    finally { running.current = false; if (alive.current) setPending(false); }
  }
  function changeRow(key: string, update: (row: EditableRow) => EditableRow) { invalidate(); setRows(before => before.map(row => row.key === key ? update(row) : row)); }
  function discard() { invalidate(); setTemplate(null); setRows([]); setWorksheet(null); setColumns({}); setJournal(null); setRowId(''); setError(''); }
  const mappingFields = template ? [{ id: 'name', label: 'Action name' }, ...template.program.questions.filter(question => !question.groupId).map(question => ({ id: `question:${question.id}`, label: `${question.label} (${question.kind})` })),
    ...template.program.participantGroups.map(group => ({ id: `group:${group.id}`, label: `${group.label} (JSON people)` }))] : [];
  const headers = useMemo(() => worksheet ? rosterHeaders({ roster: worksheet, headerRow }) : [], [worksheet, headerRow]);
  const selected = preview?.rows.find(row => row.id === rowId), savedRow = journal?.rows.find(row => row.id === rowId);
  const status = savedRow?.status ?? selected?.status, currentFiles = savedRow?.attachments ?? {};
  const fileSlots = (row: EditableRow) => { try { return template ? intakeAttachmentSlots(template, row.answers) : []; } catch { return []; } };
  return <section aria-label="Packages from a roster" className="min-w-0 space-y-3 rounded-lg border bg-background p-2 sm:p-4" aria-busy={pending}>
    <h3 className="font-medium">Packages from a roster</h3><p className="text-sm text-muted-foreground">Create one independent action per row. Each action has fresh ownership, facts and files. Save local creation inputs, then review each action separately before creating it.</p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}{notice && <p role="status" className="break-words text-sm">{notice}</p>}
    <fieldset disabled={locked || !!journal} className="min-w-0 space-y-3">
      <Button className={buttonClass} variant="outline" onClick={() => void perform(async current => { const items = await listPackageTemplates(); if (current()) setLibrary(items.filter((item): item is PackageTemplateV2 => item.version === 2)); })}>Refresh roster templates</Button>
      <label className="block text-sm">Template<select aria-label="Roster template" className={inputClass} value={sourceId} onChange={event => { invalidate(); setSourceId(event.target.value); }}><option value="">Choose a versioned action template</option>
        {maintainedPackageActions.map(item => <option key={item.id} value={`maintained:${item.id}`}>{item.name}</option>)}{library.map(item => <option key={item.id} value={item.id}>{item.name} · {item.program.revision}</option>)}
      </select></label>
      <Button className={buttonClass} variant="outline" disabled={!sourceId} onClick={() => void perform(async current => {
        const value = sourceId.startsWith('maintained:') ? await maintainedPackageAction(sourceId.slice(11) as Parameters<typeof maintainedPackageAction>[0]) : library.find(item => item.id === sourceId);
        if (!value) throw new Error('Refresh and choose an available template.');
        if (current()) { invalidate(); setTemplate(value); setName(`${value.name} roster`.slice(0, 120)); setRows([]); setWorksheet(null); setColumns({}); }
      })}>Load roster template</Button>
      {template && <>
        <PackageTemplateContentsPreview template={template} disabled={locked} />
        <label className="block text-sm">Roster name<input aria-label="Package roster name" maxLength={120} className={inputClass} value={name} onChange={event => { invalidate(); setName(event.target.value); }} /></label>
        <label className="block text-sm">Excel workbook<input aria-label="Excel roster for packages" type="file" accept=".xlsx" className="mt-1 block max-w-full" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (file) void perform(async current => { const value = await readExcelRoster(file); if (current()) { invalidate(); setWorksheet(value); setHeaderRow(value.rows[0].number); setRows([]);
            const names = rosterHeaders({ roster: value, headerRow: value.rows[0].number }), aliases = mappingFields.map(item => item.id === 'name' ? 'name' : item.id.split(':').slice(1).join(':'));
            const detected = autoMapRosterColumns(names, aliases); setColumns(Object.fromEntries(Object.entries(detected).map(([index, alias]) => [mappingFields.find(item => (item.id === 'name' ? 'name' : item.id.split(':').slice(1).join(':')) === alias)!.id, +index])));
          } });
        }} /></label>
        {worksheet && <div className="min-w-0 space-y-3 rounded border p-3 text-sm">
          <label className="block">Header row<select aria-label="Package roster header row" className={inputClass} value={headerRow ?? ''} onChange={event => { invalidate(); setHeaderRow(event.target.value ? +event.target.value : null); setColumns({}); setRows([]); }}><option value="">No header</option>{worksheet.rows.slice(0, 26).map(row => <option key={row.number} value={row.number}>Worksheet row {row.number}</option>)}</select></label>
          {mappingFields.map(field => <label key={field.id} className="block">{field.label}<select aria-label={`Roster column for ${field.id}`} className={inputClass} value={columns[field.id] ?? ''} onChange={event => { invalidate(); setRows([]); setColumns(before => { const next = { ...before }; if (event.target.value !== '') next[field.id] = +event.target.value; else delete next[field.id]; return next; }); }}><option value="">Not mapped</option>{headers.map((header, index) => <option key={index} value={index}>{header} · column {index + 1}</option>)}</select></label>)}
          <p className="text-xs text-muted-foreground">Use YYYY-MM-DD dates and exact choice IDs. Repeated people use a per-row JSON list of {'{label, answers}'} objects; identities are always fresh. Map or cell changes discard unreviewed action rows.</p>
          <details className="min-w-0"><summary className="cursor-pointer">Inspect or correct mapped worksheet cells</summary><div className="mt-2 max-h-80 max-w-full overflow-auto"><table className="text-xs"><tbody>{worksheet.rows.filter(row => headerRow === null || row.number > headerRow).slice(0, 25).map(row => <tr key={row.number}><th className="p-1">Row {row.number}</th>{[...new Set(Object.values(columns))].map(column => <td key={column} className="p-1"><input aria-label={`Worksheet row ${row.number} column ${column + 1}`} className={inputClass} value={row.cells[column]?.value ?? ''} onChange={event => { invalidate(); setRows([]); setWorksheet(before => before ? { ...before, rows: before.rows.map(item => item.number === row.number ? { ...item, cells: item.cells.map((cell, index) => index === column ? { value: event.target.value } : cell) } : item) } : before); }} /></td>)}</tr>)}</tbody></table></div></details>
          <Button className={buttonClass} variant="outline" onClick={() => { try { invalidate(); setRows(packageRosterRowsFromWorksheet(template, { roster: worksheet, headerRow }, columns).map(row => ({ ...row, key: newPackageId('roster-input') }))); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The worksheet could not be mapped.'); } }}>Map worksheet to separate actions</Button>
        </div>}
        <Button className={buttonClass} variant="outline" disabled={rows.length >= MAX_PACKAGE_ROSTER_ROWS} onClick={() => { invalidate(); const number = Math.max(0, ...rows.map(row => row.number)) + 1; setRows([...rows, { key: newPackageId('roster-input'), number, name: `${template.name} action ${number}`.slice(0, 120), answers: freshPackageTemplateAnswers(template.program), attachments: {}, warnings: [] }]); }}>Add fresh action row</Button>
        {rows.map(row => <details key={row.key} open className="min-w-0 rounded border p-3"><summary className="cursor-pointer break-words font-medium">Action row {row.number}: {row.name || 'Unnamed action'}</summary><section aria-label={`Action row ${row.number}`} className="min-w-0 space-y-3 pt-3">
          <label className="block text-sm">Action name<input aria-label={`Action name for row ${row.number}`} className={inputClass} maxLength={120} value={row.name} onChange={event => changeRow(row.key, current => ({ ...current, name: event.target.value }))} /></label>
          <p className="text-xs text-muted-foreground">Enter answers before uploading this row's PDFs. Answer changes clear this row's uploads.</p>
          <PackageIntakeQuestions program={template.program} answers={row.answers} disabled={locked} onChange={answers => changeRow(row.key, current => ({ ...current, answers, attachments: {} }))} />
          {row.warnings?.map((warning, index) => <p key={index} className="break-words text-xs text-muted-foreground">{warning}</p>)}
          {fileSlots(row).map(slot => <div key={slot.key} className="min-w-0 space-y-2 rounded border p-2 text-sm"><label className="block">{slot.label}: fresh PDF for this row<input aria-label={`PDF for row ${row.number}: ${slot.label}`} type="file" accept="application/pdf,.pdf" className="mt-1 block max-w-full" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''; if (file) void perform(async current => { if (file.size > 25 * 1024 * 1024) throw new Error('Choose a PDF no larger than 25 MB.'); const data = await file.arrayBuffer(); if (current()) changeRow(row.key, value => ({ ...value, attachments: { ...value.attachments, [slot.key]: { name: file.name, data, signedOriginal: false } } })); });
          }} /></label>
            {row.attachments?.[slot.key] && <><p className="break-words">{row.attachments[slot.key].name}</p><label className="flex items-start gap-2"><input type="checkbox" checked={row.attachments[slot.key].signedOriginal} onChange={event => changeRow(row.key, value => ({ ...value, attachments: { ...value.attachments, [slot.key]: { ...value.attachments![slot.key], signedOriginal: event.target.checked } } }))} />This row's file is a signed original; preserve its bytes.</label>
              <Button className={buttonClass} variant="outline" onClick={() => setPdf({ number: row.number, filename: row.attachments![slot.key].name, bytes: new Uint8Array(row.attachments![slot.key].data.slice(0)) })}>Inspect row {row.number}: {row.attachments[slot.key].name}</Button>
              <Button className={buttonClass} variant="ghost" onClick={() => changeRow(row.key, value => ({ ...value, attachments: Object.fromEntries(Object.entries(value.attachments ?? {}).filter(([key]) => key !== slot.key)) }))}>Remove row {row.number} file {slot.label}</Button>
            </>}
          </div>)}
          <Button className={buttonClass} variant="outline" onClick={() => { invalidate(); setRows(before => before.filter(value => value.key !== row.key)); }}>Remove action row {row.number}</Button>
        </section></details>)}
        <Button className={buttonClass} variant="outline" disabled={!rows.length || !name.trim()} onClick={() => void perform(async current => { const value = await preparePackageRoster(template, name, rows, await getExportDeploymentPolicy(), signal()); if (current()) { setPreview(value); setInputsReviewed(false); setRowReviewed(false); setPdf(null); setRowId(value.rows[0]?.id ?? ''); } })}>Preview roster actions</Button>
      </>}
    </fieldset>
    {preview && !journal && <fieldset disabled={locked} className="min-w-0 space-y-3 rounded border p-3 text-sm"><p className="font-medium">{preview.ready ? 'Every action row is ready for input review.' : 'Correct the action rows before saving.'}</p>
      {preview.rows.map(row => <p key={row.id} className="break-words">Row {row.number}: {row.name} · {row.ready ? 'prepared' : 'needs correction'}{row.issues.length ? ` · ${row.issues.join(' ')}` : ''}</p>)}
      {preview.reviews.flatMap(review => [...review.notices, ...review.privacy.findings.map(finding => `${finding.type}: ${finding.value}`)]).map((text, index) => <p key={index} className="whitespace-pre-wrap break-words text-xs">{text}</p>)}
      <label className="flex items-start gap-2"><input type="checkbox" checked={inputsReviewed} onChange={event => setInputsReviewed(event.target.checked)} />I reviewed the template, all roster rows, per-row files and privacy findings before saving these local creation inputs.</label>
      <Button className={buttonClass} disabled={!preview.ready || !inputsReviewed} onClick={() => void perform(async current => { const saved = await savePreparedPackageRoster(preview, await getExportDeploymentPolicy(), inputsReviewed, signal(), current); if (current()) { setJournal(saved); setJournals(before => [saved, ...before.filter(item => item.id !== saved.id)]); setJournalId(saved.id); setRows([]); setWorksheet(null); setInputsReviewed(false); setPdf(null); setNotice('Creation inputs saved. Review each action separately before creating it.'); } })}>Save reviewed roster inputs</Button>
    </fieldset>}
    <fieldset disabled={locked} className="min-w-0 space-y-3 border-t pt-3">
      <Button className={buttonClass} variant="outline" onClick={() => void perform(async current => { const items = await listPackageRosters(); if (current()) setJournals(items); })}>Refresh saved rosters</Button>
      <label className="block text-sm">Saved creation inputs<select aria-label="Saved package roster" disabled={!!journal} className={inputClass} value={journalId} onChange={event => { invalidate(); setJournalId(event.target.value); }}><option value="">Choose a local roster journal</option>{journals.map(item => <option key={item.id} value={item.id}>{item.name} · {item.rows.filter(row => row.status === 'created').length}/{item.rows.length} created</option>)}</select></label>
      <Button className={buttonClass} variant="outline" disabled={!journalId} onClick={() => void perform(async current => { const saved = (await listPackageRosters()).find(item => item.id === journalId); if (!saved) throw new Error('The saved roster is unavailable. Refresh the inventory.'); const prepared = await prepareSavedPackageRoster(saved, await getExportDeploymentPolicy(), signal()); if (current()) { setTemplate(saved.template); setJournal(saved); setPreview(prepared); setRows([]); setInputsReviewed(false); setRowReviewed(false); setRowId(saved.rows.find(row => row.status !== 'created')?.id ?? saved.rows[0].id); setPdf(null); setNotice('Saved inputs reopened. Each remaining action needs a fresh review.'); } })}>Resume saved roster review</Button>
      {journal && <><p role="status" className="text-sm">{journal.rows.filter(row => row.status === 'created').length} of {journal.rows.length} independent actions created.</p>
        <p className="text-xs text-muted-foreground">Journals stay in this browser and are excluded from package/workspace backups. Created actions use the normal editable transfer and recovery workflow. Open a created action to prepare or resume its PDF assembly job.</p>
        <label className="block text-sm">Action row<select aria-label="Saved roster action" className={inputClass} value={rowId} onChange={event => { generation.current++; setRowId(event.target.value); setRowReviewed(false); setPdf(null); }}>{journal.rows.map(row => <option key={row.id} value={row.id}>Row {row.number}: {row.name} · {row.status}</option>)}</select></label>
        {savedRow?.error && <p className="break-words text-sm text-destructive">Last attempt: {savedRow.error}</p>}
        {selected && <div className="min-w-0 space-y-3 rounded border p-3"><h4 className="font-medium">Review action row {selected.number}</h4>{selected.warnings.map((warning, index) => <p key={index} className="break-words text-xs text-muted-foreground">{warning}</p>)}{selected.issues.map((issue, index) => <p key={index} className="break-words text-sm text-destructive">{issue}</p>)}
          {Object.entries(currentFiles).map(([key, file]) => <Button key={key} className={buttonClass} variant="outline" onClick={() => setPdf({ number: selected.number, filename: file.name, bytes: new Uint8Array(file.data.slice(0)) })}>Inspect row {selected.number}: {file.name}</Button>)}
          {status !== 'created' && selected.preview && <PackageIntakePreview preview={selected.preview} fresh disabled={locked} reviewed={rowReviewed} memberChoices={{}} answerChoices={{}} fieldChoices={{}} onReviewed={setRowReviewed} onMemberChoice={() => {}} onAnswerChoice={() => {}} onFieldChoice={() => {}} applyLabel="Create independent package" onApply={() => void perform(async current => {
            const approved = rowReviewed; setRowReviewed(false);
            const result = await createPreparedPackageRosterRow(preview!, rowId, await getExportDeploymentPolicy(), approved, signal(), current);
            if (current()) { setJournal(result.roster); setJournals(before => [result.roster, ...before.filter(item => item.id !== result.roster.id)]); setRowReviewed(false); setPdf(null); setRowId(result.roster.rows.find(row => row.status !== 'created')?.id ?? rowId); setNotice(`Created independent action: ${result.record.name}`); onCreated?.(result.record); }
          })} />}
          {status === 'created' && <><p className="text-sm">This row already created an owning action. It will not be recreated.</p>{onOpenPackage && <Button className={buttonClass} variant="outline" onClick={() => void perform(async current => { const value = await readCreatedPackageRosterRow(journal, rowId); if (current()) onOpenPackage(value); })}>Open created action row {selected.number}</Button>}</>}
        </div>}
        <Button className={buttonClass} variant="outline" onClick={() => void perform(async current => { await removePackageRoster(journal, current); if (current()) { setJournals(before => before.filter(item => item.id !== journal.id)); setJournalId(''); setJournal(null); setPreview(null); setTemplate(null); setNotice('Local roster inputs removed. Created actions remain saved.'); } })}>Remove saved roster inputs</Button>
      </>}
    </fieldset>
    {pdf && <div className="min-w-0 space-y-2 rounded border p-3"><p className="break-words text-sm">Row {pdf.number}: {pdf.filename}</p><PackageSigningPdfPreview bytes={pdf.bytes} label={`Exact row ${pdf.number} supporting PDF`} /><Button className={buttonClass} variant="outline" onClick={() => setPdf(null)}>Close roster PDF preview</Button></div>}
    {(template || journal) && <Button className={buttonClass} variant="outline" disabled={busy || pending} onClick={discard}>Discard roster preparation</Button>}
  </section>;
}
