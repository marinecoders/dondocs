import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { canAppendEndorsement, ENDORSEMENT_ORDINALS, hasEndorsementContent, type AdditionalEndorsement } from '@/lib/appendedEndorsement';
import { useDocumentStore } from '@/stores/documentStore';

type Fields = Omit<AdditionalEndorsement, 'id'>;

function EndorsementFields({ id, label: labelPrefix, value, update, from, to }: {
  id: string;
  label: string;
  value: Fields;
  update: (field: keyof Fields, value: string) => void;
  from?: string;
  to?: string;
}) {
  return <div className="space-y-3">
    <div className="space-y-2">
      <Label htmlFor={`${id}-body`}>Endorsement text</Label>
      <Textarea id={`${id}-body`} value={value.endorsementBody || ''}
        onChange={(e) => update('endorsementBody', e.target.value)}
        placeholder="Enter the endorsement. One paragraph per line." className="min-h-[76px] text-sm" />
      <p className="text-xs text-muted-foreground">Paragraphs are numbered automatically.</p>
    </div>
    <div className="space-y-2">
      <Label>Signed by</Label>
      <div className="grid grid-cols-3 gap-2">
        {([
          ['endorsementSigFirst', 'First name'],
          ['endorsementSigMiddle', 'Middle initial'],
          ['endorsementSigLast', 'Last name'],
        ] as const).map(([field, label]) => <Input key={field} value={value[field] || ''}
          onChange={(e) => update(field, e.target.value)} placeholder={label}
          aria-label={`${labelPrefix} signer ${label.toLowerCase()}`} />)}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-2">
        <Label htmlFor={`${id}-date`}>Date (optional)</Label>
        <Input id={`${id}-date`} value={value.endorsementDate || ''}
          onChange={(e) => update('endorsementDate', e.target.value)} placeholder="Blank to sign by hand" />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-serial`}>Serial (optional)</Label>
        <Input id={`${id}-serial`} value={value.endorsementSerial || ''}
          onChange={(e) => update('endorsementSerial', e.target.value)} placeholder="Ser 1710/024" />
      </div>
    </div>
    <div className="space-y-2">
      <Label htmlFor={`${id}-from`}>From (optional)</Label>
      <Input id={`${id}-from`} value={value.endorsementFrom || ''}
        onChange={(e) => update('endorsementFrom', e.target.value)} placeholder={to || "The letter's To line"} />
    </div>
    <div className="space-y-2">
      <Label htmlFor={`${id}-to`}>To (optional)</Label>
      <Input id={`${id}-to`} value={value.endorsementTo || ''}
        onChange={(e) => update('endorsementTo', e.target.value)} placeholder={from || "The letter's From line"} />
    </div>
    <p className="text-xs text-muted-foreground">
      Left blank, From and To answer the basic letter. Set each endorsement&apos;s routing as needed.
    </p>
  </div>;
}

export function AppendedEndorsementsEditor() {
  const { docType, formData, setField } = useDocumentStore();
  if (!canAppendEndorsement(docType)) return null;
  const extra = formData.additionalEndorsements ?? [];

  return <div className="space-y-3">
    <div className="flex items-center space-x-2">
      <Checkbox id="appendEndorsement" checked={formData.appendEndorsement || false}
        onCheckedChange={(checked) => setField('appendEndorsement', !!checked)} />
      <Label htmlFor="appendEndorsement" className="font-normal">Add an acknowledgement endorsement</Label>
    </div>
    {formData.appendEndorsement && <div className="space-y-4 ml-6">
      <section aria-label="First endorsement" className="space-y-3">
        <h4 className="text-sm font-medium">FIRST ENDORSEMENT</h4>
        <EndorsementFields id="first-endorsement" label="First endorsement" value={formData} update={setField}
          from={formData.from} to={formData.to} />
      </section>
      <p className="text-xs text-muted-foreground">Additional endorsements begin on a new page. Empty drafts are omitted from exports.</p>
      {extra.map((entry, index) => {
        const ordinal = ENDORSEMENT_ORDINALS[1 + extra.slice(0, index).filter(hasEndorsementContent).length];
        const label = hasEndorsementContent(entry) ? `${ordinal} endorsement` : 'New endorsement';
        return <section key={entry.id} aria-label={label}
        className="space-y-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">{hasEndorsementContent(entry) ? `${ordinal} ENDORSEMENT` : 'New endorsement'}</h4>
          <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${label}`}
            onClick={() => setField('additionalEndorsements', extra.filter((item) => item.id !== entry.id))}>Remove</Button>
        </div>
        <EndorsementFields id={entry.id} label={label} value={entry} from={formData.from} to={formData.to}
          update={(field, value) => setField('additionalEndorsements', extra.map((item) =>
            item.id === entry.id ? { ...item, [field]: value } : item))} />
      </section>;
      })}
      <Button type="button" variant="outline" size="sm" disabled={extra.length >= ENDORSEMENT_ORDINALS.length - 1}
        onClick={() => setField('additionalEndorsements', [...extra, { id: crypto.randomUUID() }])}>
        Add another endorsement
      </Button>
    </div>}
  </div>;
}
