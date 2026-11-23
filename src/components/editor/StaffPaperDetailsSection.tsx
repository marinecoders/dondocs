import { staffDecisionOfficials } from '@/lib/staffPapers';
import { COORDINATION_FIELD_LENGTH, MAX_COORDINATION_OFFICES } from '@/lib/staffPaperFields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useDocumentStore } from '@/stores/documentStore';
import type { CoordinationEntry } from '@/types/document';

const entryFields = [
  ['office', 'Office'], ['contact', 'Point of contact / title'], ['phone', 'Phone'],
  ['date', 'Date coordinated'], ['position', 'Position or remarks'],
] as const;

const blankEntry: CoordinationEntry = { office: '', contact: '', phone: '', date: '', position: '' };

export function StaffPaperDetailsSection() {
  const docType = useDocumentStore(state => state.docType);
  const data = useDocumentStore(state => state.formData);
  const setField = useDocumentStore(state => state.setField);
  const field = (key: 'subject' | 'officeCode' | 'date' | 'preparedBy' | 'staffApprovedBy', label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={'admin-' + key}>{label}</Label>
      <Input id={'admin-' + key} value={data[key] ?? ''} maxLength={key === 'staffApprovedBy' ? 500 : undefined}
        onChange={event => setField(key, event.target.value)} />
    </div>
  );

  if (docType === 'coordination_page') {
    const layout = data.coordinationLayout ?? 'secnav';
    const entries = Array.isArray(data.coordinationEntries) ? data.coordinationEntries : [];
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="coordination-layout">Layout</Label>
          <select id="coordination-layout" className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={layout} onChange={event => setField('coordinationLayout', event.target.value === 'hqmc' ? 'hqmc' : 'secnav')}>
            <option value="secnav">SECNAV Coordination Page</option>
            <option value="hqmc">HQMC Coordination Page</option>
          </select>
        </div>
        {layout === 'hqmc' && field('subject', 'Subject')}
        {entries.map((entry, index) => (
          <fieldset key={index} className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Coordinating office {index + 1}</legend>
            {entryFields.filter(([key]) => layout === 'secnav' || key !== 'phone').map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={['coordination', index, key].join('-')}>{label}</Label>
                <Input id={['coordination', index, key].join('-')} maxLength={COORDINATION_FIELD_LENGTH} value={entry[key]}
                  onChange={event => setField('coordinationEntries', entries.map((row, rowIndex) => rowIndex === index
                    ? { ...row, [key]: event.target.value } : row))} />
              </div>
            ))}
            <Button variant="ghost" size="sm" type="button" onClick={() =>
              setField('coordinationEntries', entries.filter((_, rowIndex) => index !== rowIndex))}>
              Remove office {index + 1}
            </Button>
          </fieldset>
        ))}
        <Button variant="outline" type="button" disabled={entries.length >= MAX_COORDINATION_OFFICES} onClick={() => setField('coordinationEntries', [...entries, { ...blankEntry }])}>Add coordinating office</Button>
        {layout === 'hqmc' && (
          <div className="space-y-1.5">
            <Label htmlFor="coordination-comments">Staffing comments</Label>
            <Textarea maxLength={8000} id="coordination-comments" value={data.coordinationComments ?? ''}
              onChange={event => setField('coordinationComments', event.target.value)} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {field('officeCode', 'Originating office code')}
      {field('date', 'Date')}
      {field('subject', 'Subject')}
      {field('preparedBy', 'Prepared by')}
      {docType === 'position_decision_paper' && (
        <>
          {field('staffApprovedBy', 'Approved by')}
          <div className="space-y-1.5">
            <Label htmlFor="staff-decisions">Decision grid</Label>
            <select id="staff-decisions" className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={data.staffDecisionStyle ?? 'single'}
              onChange={event => setField('staffDecisionStyle', event.target.value === 'choose_one'
                ? 'choose_one' : event.target.value === 'independent' ? 'independent' : 'single')}>
              <option value="single">Single recommendation</option>
              <option value="choose_one">Choose one option</option>
              <option value="independent">Decide on each recommendation</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-officials">Officials in routing order</Label>
            <Textarea maxLength={1000} id="staff-officials" value={data.staffDecisionOfficials ?? staffDecisionOfficials(data).join('\n')}
              onChange={event => setField('staffDecisionOfficials', event.target.value)} />
            <p className="text-xs text-muted-foreground">Enter one official per line. Put the final decision authority last.</p>
          </div>
          {data.staffDecisionStyle && data.staffDecisionStyle !== 'single' && (
            <div className="space-y-1.5">
              <Label htmlFor="staff-options">Options or recommendations, one per line</Label>
              <Textarea maxLength={4000} id="staff-options" value={data.staffDecisionOptions ?? ''}
                onChange={event => setField('staffDecisionOptions', event.target.value)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
