import { useEffect, useState } from 'react';
import type { EnclosureMarking } from '@/types/document';
import { getClassificationConfig } from '@/config/classification';
import { getDomainClassificationRestriction, type ClassificationLevel } from '@/lib/domainClassification';
import { CLASSIFICATION_LABELS } from '@/lib/detectClassification';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CuiRegistryFields } from './CuiRegistryFields';

export function EnclosureMarkingField({ index, marking, onChange }: {
  index: number; marking?: EnclosureMarking; onChange: (marking: EnclosureMarking | undefined) => void;
}) {
  const [allowed, setAllowed] = useState<readonly ClassificationLevel[]>(() => getDomainClassificationRestriction().allowedLevels);
  useEffect(() => {
    let active = true;
    void getClassificationConfig().then(config => { if (active && config) setAllowed(config.allowedLevels); });
    return () => { active = false; };
  }, []);
  const id = `enclosure-marking-${index}`;
  const update = (patch: Partial<EnclosureMarking>) => onChange({ classLevel: marking?.classLevel ?? 'unclassified', ...marking, ...patch });
  return <div className="space-y-2 rounded-md border border-border/70 p-2">
    <Label htmlFor={id} className="text-xs">Assembled page marking</Label>
    <Select value={marking?.classLevel ?? 'inherit'} onValueChange={value => onChange(value === 'inherit' ? undefined
      : { classLevel: value as EnclosureMarking['classLevel'] })}>
      <SelectTrigger id={id} className="h-8 text-xs" aria-label={`Enclosure (${index + 1}) marking`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit">Inherit the letter marking</SelectItem>
        {CLASSIFICATION_LEVELS.filter(value => allowed.includes(value) || marking?.classLevel === value).map(value =>
          <SelectItem key={value} value={value} disabled={!allowed.includes(value)}>{CLASSIFICATION_LABELS[value]}</SelectItem>)}
        <SelectItem value="custom">Custom banner</SelectItem>
      </SelectContent>
    </Select>
    {marking?.classLevel === 'custom' && <div className="space-y-1">
      <Label className="text-xs" htmlFor={`${id}-custom`}>Exact banner text</Label>
      <Input id={`${id}-custom`} value={marking.customClassification ?? ''} maxLength={240}
        onChange={event => update({ customClassification: event.target.value })} />
    </div>}
    {marking?.classLevel === 'cui' && <div className="grid gap-2 sm:grid-cols-2">
      <CuiRegistryFields categoryId={`${id}-category`} controlId={`${id}-controls`} values={marking}
        onChange={(field, value) => update({ [field]: value })} suggestions={false} />
    </div>}
    <p className="text-xs text-muted-foreground">Inspect the original pages before choosing. This labels the assembled copy; the original PDF and its existing markings stay unchanged.</p>
    {marking?.classLevel === 'cui' && <p className="text-xs text-muted-foreground">Categories and controls are compared with the cover. Use Custom banner when the original requires a complete category or control banner.</p>}
  </div>;
}
