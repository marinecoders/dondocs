import { useState } from 'react';
import { StockPublicationGroup as Group } from './StockPublicationGroup';
import { showAppConfirm } from '@/stores/alertStore';
import { format, isValid, parseISO } from 'date-fns';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { MANUAL_TYPES, emptyManualFrontMatter, ISSUING_ENTITIES, ISSUING_ADDRESSES, CONTROLLING_OFFICES, type ManualFrontMatter } from '@/data/techpub/manualFrontMatter';
import { reasonsFor } from '@/data/techpub/distributionStatements';
import { manualFrontMatterFindings, type ManualFinding } from '@/lib/manualFrontMatterValidation';
import { lastWorkingDay } from '@/lib/publicationDate';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import type { DocumentData } from '@/types/document';

const selectClass = 'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
const grid = 'sl3-field-grid';
function focusEndItem(rowId: string) {
  requestAnimationFrame(() => {
    const row = document.getElementById(`manual-row-${rowId}`);
    row?.scrollIntoView({ block: 'center' });
    row?.querySelector('input')?.focus({ preventScroll: true });
  });
}
type CommonTextField = keyof Pick<DocumentData, 'shortTitle' | 'subject' | 'nomenclature' | 'pcn' | 'publicationClosedDates' | 'unitLine1' | 'unitLine2' | 'unitAddress' | 'sigFirst' | 'sigMiddle' | 'sigLast' | 'sigTitle' | 'controllingOffice' | 'cuiControlledBy' | 'cuiCategory' | 'cuiDissemination' | 'pocEmail' | 'supersedure'>;

export function ManualFrontMatterSection({ section }: { section: ManualFinding['section'] }) {
  const store = useDocumentStore();
  const d = store.formData;
  const [selectedItem, setSelectedItem] = useState('');
  const m = { ...emptyManualFrontMatter(), ...d.manualFrontMatter };
  const update = (patch: Partial<ManualFrontMatter>) => store.setField('manualFrontMatter', { ...m, ...patch });
  const findings = manualFrontMatterFindings(store);
  const errorsFor = (field: string) => [...new Set(findings.filter(finding => finding.fields?.includes(field)).map(finding => finding.message))];
  const fieldProps = (field: string, id = `manual-${field}`) => ({
    'aria-invalid': errorsFor(field).length ? true as const : undefined,
    'aria-describedby': errorsFor(field).length ? `${id}-errors` : undefined,
  });
  const fieldErrors = (field: string, id = `manual-${field}`) => errorsFor(field).length
    ? <p id={`${id}-errors`} className="text-xs leading-relaxed text-destructive">{errorsFor(field).join(' ')}</p> : null;
  const focusFinding = (finding: ManualFinding) => {
    const field = finding.fields?.[0];
    const aliases: Record<string, string> = { date: 'publication-date', publicationSigningDate: 'signing-date', classLevel: 'marking', cuiDistStatement: 'distribution', distReason: 'reason', distDate: 'determination-date', shortTitleBasis: 'numbering', authorityBasis: 'authority', rightsAssessment: 'rights' };
    const id = field ? `manual-${aliases[field] ?? field}` : '';
    const owner = id ? document.getElementById(id)?.closest('[id^="sec-"]')?.id.slice(4) : undefined;
    useEditorOutlineStore.getState().jump(owner ?? finding.section);
    if (field) requestAnimationFrame(() => {
      const input = document.getElementById(id);
      input?.scrollIntoView({ block: 'center' }); input?.focus({ preventScroll: true });
    });
  };

  const common = (key: CommonTextField, label: string, multiline = false, list?: string) => (
    <div className="space-y-2" key={key}>
      <Label htmlFor={`manual-${key}`}>{label}</Label>
      {multiline
        ? <Textarea className="min-h-20" id={`manual-${key}`} {...fieldProps(key)} value={d[key] ?? ''} onChange={(e) => store.setField(key, e.target.value)} rows={3} />
        : <Input className="min-h-11" id={`manual-${key}`} {...fieldProps(key)} list={list} value={d[key] ?? ''} onChange={(e) => store.setField(key, e.target.value)} />}
      {fieldErrors(key)}
    </div>
  );
  const text = (key: 'maintenanceLevel' | 'subtitle' | 'volume' | 'volumes' | 'volumeNotice' | 'supplementNotice' | 'copyrightCredit' | 'governmentRights' | 'contentContact' | 'shortTitleApproval' | 'authorityReference', label: string, multiline = false) => (
    <div className="space-y-2" key={key}>
      <Label htmlFor={`manual-${key}`}>{label}</Label>
      {multiline
        ? <Textarea className="min-h-20" id={`manual-${key}`} {...fieldProps(key)} value={m[key]} onChange={(e) => update({ [key]: e.target.value })} rows={3} />
        : <Input className="min-h-11" id={`manual-${key}`} {...fieldProps(key)} value={m[key]} onChange={(e) => update({ [key]: e.target.value })} />}
      {fieldErrors(key)}
    </div>
  );
  const move = (i: number, direction: -1 | 1) => {
    const items = [...m.endItems];
    [items[i], items[i + direction]] = [items[i + direction], items[i]];
    update({ endItems: items });
  };
  const title = { 'manual-publication': 'Publication', 'manual-items': 'End items', 'manual-notices': 'Markings and notices', 'manual-authentication': 'Authentication' }[section];
  return <div className="sl3-editor manual-editor space-y-6">
    <h3 className="text-xl font-medium">{title}</h3>
    {!!findings.filter(finding => finding.section === section).length && <details className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><summary className="cursor-pointer font-medium">Fields to complete ({findings.filter(finding => finding.section === section).length})</summary><ul className="mt-3 list-disc space-y-2 pl-4">{findings.filter(finding => finding.section === section).map((finding, index) => <li key={index}><button type="button" className="text-left underline underline-offset-2" onClick={() => focusFinding(finding)}>{finding.message}</button></li>)}</ul></details>}
    {section === 'manual-publication' && <>
      <p className="text-sm text-muted-foreground">Prepare the cover and authentication pages for a Marine Corps publication. PDF export includes an empty signature field for signing outside DonDocs.</p>
      <Group title="Publication identity">
      <div className="space-y-2"><Label htmlFor="manual-subtype">Publication type</Label>
        <select className={selectClass} id="manual-subtype" {...fieldProps('subtype', 'manual-subtype')} value={m.subtype} onChange={(e) => update({ subtype: e.target.value as ManualFrontMatter['subtype'] })}>
          {Object.entries(MANUAL_TYPES).map(([key, value]) => <option key={key} value={key}>{value[1]}</option>)}
        </select>{fieldErrors('subtype', 'manual-subtype')}
      </div>
      <div className={grid}>{common('shortTitle', 'Short title')}{common('pcn', 'Publication Control Number (PCN)')}</div>
      <div className="space-y-2"><Label htmlFor="manual-numbering">Numbering system</Label><select id="manual-numbering" {...fieldProps('shortTitleBasis', 'manual-numbering')} className={selectClass} value={m.shortTitleBasis} onChange={(e) => update({ shortTitleBasis: e.target.value as ManualFrontMatter['shortTitleBasis'] })}><option value="marine_corps">Marine Corps ID, FSC or SSIC number</option><option value="sponsor_assigned">Reviewed sponsor-assigned number</option></select>{fieldErrors('shortTitleBasis', 'manual-numbering')}</div>
      {m.shortTitleBasis === 'sponsor_assigned' && text('shortTitleApproval', 'Assigning activity and approval reference')}
      </Group><Group title="Titles and coverage">
      {common('subject', 'Long title (manual type and coverage)')}{common('nomenclature', 'Equipment nomenclature (prime title)')}
      <div className={grid}>{text('maintenanceLevel', 'Maintenance level (if applicable)')}{text('subtitle', 'Subtitle (if applicable)')}{text('volume', 'Volume number (optional)')}{text('volumes', 'Total volumes (optional)')}</div>
      </Group><Group title="Publication dates" description="The publication date is the last working day of the signing month.">
      <div className={grid}>
        <div className="space-y-2"><Label htmlFor="manual-signing-date">Signing date</Label><DatePicker className="sl3-date-control" id="manual-signing-date" {...fieldProps('publicationSigningDate', 'manual-signing-date')} dateFormat="iso" calendarLabel="Choose signing date" value={d.publicationSigningDate ?? ''} onChange={(value) => store.setField('publicationSigningDate', value)} />{fieldErrors('publicationSigningDate', 'manual-signing-date')}</div>
        <div className="space-y-2"><Label htmlFor="manual-publication-date">Publication date</Label><DatePicker className="sl3-date-control" calendarLabel="Choose publication date" id="manual-publication-date" {...fieldProps('date', 'manual-publication-date')} value={d.date ?? ''} onChange={(v) => store.setField('date', v)} />{fieldErrors('date', 'manual-publication-date')}</div>
      </div>
      {common('publicationClosedDates', 'Office closure dates (YYYY-MM-DD, separated by commas)')}
      <Button variant="outline" disabled={!d.publicationSigningDate || !isValid(parseISO(d.publicationSigningDate))} onClick={() => {
        const date = parseISO(d.publicationSigningDate!);
        store.setField('date', format(lastWorkingDay(date, (d.publicationClosedDates ?? '').split(/[\s,;]+/).filter(Boolean)), 'd MMM yy'));
      }}>Use last working day of signing month</Button>
      <p className="text-xs text-muted-foreground">The cover prints month and year; the authentication page prints the full date. Weekends, observed federal holidays and the entered office closures are excluded.</p>
      </Group>
      <details className="text-sm"><summary className="cursor-pointer font-medium">Export checks ({findings.length})</summary>
        {findings.length ? <ul className="mt-3 space-y-2">{findings.map((f, i) => <li key={`${f.section}-${i}`}><button className="text-left text-destructive underline underline-offset-2" onClick={() => focusFinding(f)}>{f.message}</button></li>)}</ul> : <p className="mt-2">Required fields are complete. Review the PDF before signing.</p>}
      </details>
    </>}
    {section === 'manual-items' && <>
      <p className="text-sm text-muted-foreground">The end-item list stays on the cover when it fits with the required notices. Otherwise the entire list moves to T-2, up to 38 end items. Leave an unassigned NSN or TAMCN blank.</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm font-medium">{m.endItems.length} of 38 end items</p>
        {!!m.endItems.length && <div className="min-w-48 space-y-2"><Label htmlFor="manual-item-jump">Jump to end item</Label><select id="manual-item-jump" className={selectClass} value={selectedItem} onChange={(e) => {
          setSelectedItem(e.target.value);
          focusEndItem(e.target.value);
        }}><option value="">Choose end item</option>{m.endItems.map((item, index) => <option key={item.rowId} value={item.rowId}>{index + 1}. {item.model || item.id || 'New end item'}</option>)}</select></div>}
      </div>
      {m.endItems.map((item, index) => <fieldset id={`manual-row-${item.rowId}`} key={item.rowId} className="min-w-0 space-y-3 rounded-lg border p-4">
        <legend className="sr-only">End item {index + 1}</legend>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">End item {index + 1}</h3><div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`Move end item ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="size-4" /></Button>
          <Button variant="ghost" size="icon" aria-label={`Move end item ${index + 1} down`} disabled={index === m.endItems.length - 1} onClick={() => move(index, 1)}><ArrowDown className="size-4" /></Button>
          <Button variant="ghost" size="icon" aria-label={`Remove end item ${index + 1}`} onClick={async () => {
            const snapshot = JSON.stringify(m.endItems);
            const documentId = useDocumentsStore.getState().currentId;
            if ([item.nsn, item.tamcn, item.id, item.model].some(value => value.trim()) && !await showAppConfirm({ title: `Remove end item ${index + 1}?`, message: 'The end item will be removed from this publication.', confirmLabel: 'Remove end item', destructive: true })) return;
            const current = useDocumentStore.getState();
            if (useDocumentsStore.getState().currentId !== documentId || current.docType !== 'tm_ietm_front_matter' || JSON.stringify(current.formData.manualFrontMatter?.endItems) !== snapshot) return;
            current.setField('manualFrontMatter', { ...current.formData.manualFrontMatter!, endItems: m.endItems.filter(row => row.rowId !== item.rowId) });
          }}><Trash2 className="size-4" /></Button>
        </div></div>
        <div className={grid}>{(['nsn', 'tamcn', 'id', 'model'] as const).map((key) => <div className="space-y-2" key={key}>
          <Label htmlFor={`manual-item-${item.rowId}-${key}`}>{key.toUpperCase()} — end item {index + 1}</Label>
          <Input className="min-h-11" id={`manual-item-${item.rowId}-${key}`} {...fieldProps(`item-${item.rowId}-${key}`)} value={item[key]} onChange={(e) => update({ endItems: m.endItems.map((r) => r.rowId === item.rowId ? { ...r, [key]: e.target.value } : r) })} />
          {fieldErrors(`item-${item.rowId}-${key}`)}
        </div>)}</div>
      </fieldset>)}
      <Button variant="outline" disabled={m.endItems.length >= 38} onClick={() => { const rowId = crypto.randomUUID(); update({ endItems: [...m.endItems, { rowId, nsn: '', tamcn: '', id: '', model: '' }] }); focusEndItem(rowId); }}><Plus className="mr-2 size-4" />Add end item</Button>
    </>}
    {section === 'manual-notices' && <>
      <p className="text-sm text-muted-foreground">Use the program office’s marking and release determinations for the complete publication.</p>
      <Group title="Markings and distribution">
      <div className="space-y-2"><Label htmlFor="manual-marking">Overall marking</Label><select id="manual-marking" {...fieldProps('classLevel', 'manual-marking')} className={selectClass} value={d.classLevel ?? 'unclassified'} onChange={(e) => store.setField('classLevel', e.target.value)}>
        <option value="unclassified">Unclassified</option><option value="cui">CUI</option>
        {!['unclassified', 'cui'].includes(d.classLevel ?? 'unclassified') && <option value={d.classLevel}>Review inherited marking: {d.classLevel}</option>}
      </select>{fieldErrors('classLevel', 'manual-marking')}</div>
      {d.classLevel === 'cui' && <div className={grid}>{common('cuiControlledBy', 'Controlled by')}{common('cuiCategory', 'CUI categories')}{common('cuiDissemination', 'Dissemination controls')}{common('pocEmail', 'CUI contact (phone or email)')}</div>}
      <div className="space-y-2"><Label htmlFor="manual-distribution">Distribution statement</Label><select id="manual-distribution" {...fieldProps('cuiDistStatement', 'manual-distribution')} className={selectClass} value={d.cuiDistStatement ?? ''} onChange={(e) => store.setField('cuiDistStatement', e.target.value)}>
        <option value="">Choose statement</option>{['A', 'B', 'C', 'D', 'E', 'F'].map((v) => <option key={v}>{v}</option>)}
      </select>{fieldErrors('cuiDistStatement', 'manual-distribution')}</div>
      {d.cuiDistStatement && d.cuiDistStatement !== 'A' && <>
        {d.cuiDistStatement !== 'F' && <div className="space-y-2"><Label htmlFor="manual-reason">Distribution reason</Label><select id="manual-reason" {...fieldProps('distReason', 'manual-reason')} className={selectClass} value={d.distReason ?? ''} onChange={(e) => store.setField('distReason', e.target.value)}><option value="">Choose reason</option>{reasonsFor(d.cuiDistStatement).map((r) => <option key={r}>{r}</option>)}{d.distReason && !reasonsFor(d.cuiDistStatement).includes(d.distReason) && <option value={d.distReason}>Review: {d.distReason}</option>}</select>{fieldErrors('distReason', 'manual-reason')}</div>}
        <div className="space-y-2"><Label htmlFor="manual-determination-date">Determination date</Label><DatePicker className="sl3-date-control" id="manual-determination-date" {...fieldProps('distDate', 'manual-determination-date')} dateFormat="iso" calendarLabel="Choose determination date" value={d.distDate ?? ''} onChange={(value) => store.setField('distDate', value)} />{fieldErrors('distDate', 'manual-determination-date')}</div>
      </>}
      <label className="flex items-center gap-3 text-sm"><input id="manual-exportRestricted" type="checkbox" {...fieldProps('exportRestricted')} checked={!!d.exportRestricted} onChange={(e) => store.setField('exportRestricted', e.target.checked)} />Include export-control warning</label>{fieldErrors('exportRestricted')}
      </Group><Group title="Contract rights">
      <div className="space-y-2"><Label htmlFor="manual-rights">Contract limited-rights markings</Label><select id="manual-rights" {...fieldProps('rightsAssessment', 'manual-rights')} className={selectClass} value={m.rightsAssessment} onChange={(e) => update({ rightsAssessment: e.target.value as ManualFrontMatter['rightsAssessment'] })}><option value="unreviewed">Choose determination</option><option value="not_required">Reviewed: not required for this packet</option><option value="limited_rights">Required: use an approved contract-specific profile</option></select>{fieldErrors('rightsAssessment', 'manual-rights')}</div>
      <p className="text-xs text-muted-foreground">Statements B/E require a contract-rights determination. Packets requiring company/contract markings and a Limited Rights legend cannot be exported by this profile.</p>
      </Group><Group title="Publication notices">
      {common('supersedure', 'Supersedure notice (optional)', true)}
      {text('supplementNotice', m.subtype === 'supplement' ? 'Supported publication and supplement notice' : 'Supplement notice (if applicable)', true)}
      {text('volumeNotice', 'Volume dependency notice (if applicable)', true)}
      {text('copyrightCredit', 'Copyright credit (if applicable)', true)}
      {text('governmentRights', 'Government rights statement (required with copyright credit)', true)}
      <p className="text-xs text-muted-foreground">Use the owner- or contract-approved statement of government rights to publish, reproduce and distribute. DonDocs does not grant those rights.</p>
      </Group>
      <p className="text-xs text-muted-foreground">A destruction notice is included for statements B–F. Printed CUI markings do not apply Microsoft sensitivity-label protection.</p>
    </>}
    {section === 'manual-authentication' && <>
      <Group title="Issuing organization">
      <div className="space-y-2"><Label htmlFor="manual-service">Service heading</Label><select id="manual-service" {...fieldProps('service', 'manual-service')} className={selectClass} value={m.service} onChange={(e) => update({ service: e.target.value as ManualFrontMatter['service'] })}><option>UNITED STATES MARINE CORPS</option><option>UNITED STATES NAVY</option></select>{fieldErrors('service', 'manual-service')}</div>
      <p className="text-xs text-muted-foreground">Both source service headings authenticate the publication for Marine Corps use.</p>
      <datalist id="manual-entities">{ISSUING_ENTITIES.map((v) => <option key={v} value={v} />)}</datalist>
      {common('unitLine1', 'Issuing entity', false, 'manual-entities')}{common('unitLine2', 'Additional issuing organization (optional)')}
      <div className="space-y-2"><Label htmlFor="manual-address-preset">Address preset (optional)</Label><select id="manual-address-preset" className={selectClass} value="" onChange={(e) => { if (e.target.value) store.setField('unitAddress', e.target.value); }}><option value="">Choose a source address</option>{ISSUING_ADDRESSES.map((v) => <option key={v} value={v}>{v.replaceAll('\n', ', ')}</option>)}</select></div>
      {common('unitAddress', 'Mailing address', true)}</Group><Group title="Technical support and contract">{text('contentContact', 'Technical-content contact (name, team, phone or email)', true)}
      <div className="space-y-2"><Label htmlFor="manual-dfar">DFAR clause in the acquisition contract</Label><select id="manual-dfar" {...fieldProps('dfarClause', 'manual-dfar')} className={selectClass} value={m.dfarClause} onChange={(e) => update({ dfarClause: e.target.value as ManualFrontMatter['dfarClause'] })}><option value="none">No clause paragraph</option><option value="252.227-7013">252.227-7013</option><option value="252.227-7015">252.227-7015</option></select>{fieldErrors('dfarClause', 'manual-dfar')}</div>
      </Group><Group title="Signing official">
      <div className={grid}>{common('sigFirst', 'Signing official first name or initial')}{common('sigMiddle', 'Middle name or initial (optional)')}{common('sigLast', 'Signing official last name')}</div>
      <datalist id="manual-signing-titles"><option value="Program Manager" /><option value="Program Executive Officer" /><option value="Portfolio Acquisition Executive" /><option value="Product Manager" /></datalist>
      <datalist id="manual-offices">{CONTROLLING_OFFICES.map((v) => <option key={v} value={v} />)}</datalist>
      {common('sigTitle', 'Signing authority title', false, 'manual-signing-titles')}{common('controllingOffice', 'Controlling office', false, 'manual-offices')}
      <div className="space-y-2"><Label htmlFor="manual-authority">Verified signing authority basis</Label><select id="manual-authority" {...fieldProps('authorityBasis', 'manual-authority')} className={selectClass} value={m.authorityBasis} onChange={(e) => update({ authorityBasis: e.target.value as ManualFrontMatter['authorityBasis'] })}><option value="unconfirmed">Choose verified authority</option><option value="pm_or_above">Program Manager or higher</option><option value="pdm_deviation">Product Manager under applicable 2024 deviation</option><option value="other_approved">Other approved authority</option></select>{fieldErrors('authorityBasis', 'manual-authority')}</div>
      {['pdm_deviation', 'other_approved'].includes(m.authorityBasis) && text('authorityReference', 'Delegation or approval reference', true)}
      </Group>
      <p className="text-sm">Authentication cannot be by direction.</p>
      {d.byDirection && <Button variant="outline" onClick={() => store.setField('byDirection', false)}>Clear inherited by-direction setting</Button>}
      <p className="text-xs text-muted-foreground">Verify the official’s authority under MCO 5215.17D. MIL-STD-38784C figure 16 cites a 21 March 2024 deviation permitting Product Manager delegation; confirm its applicability and record the reference before using it. Export creates an unsigned PDF signature field.</p>
    </>}
  </div>;
}
