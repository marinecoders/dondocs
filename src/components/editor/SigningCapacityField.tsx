import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  signingCapacity, signingCapacityPatch, type SigningAuthority, type SigningCapacity,
} from '@/lib/signingAuthority';

export function SigningCapacityField({
  value, onChange, id = 'signingCapacity', allowActing = true, showActingTitle = false,
}: {
  value: SigningAuthority;
  onChange: (patch: Partial<SigningAuthority>) => void;
  id?: string;
  allowActing?: boolean;
  showActingTitle?: boolean;
}) {
  const capacity = signingCapacity(value);
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={id}>Signing capacity</Label>
        <Select value={capacity} onValueChange={(v) => onChange(signingCapacityPatch(v as SigningCapacity))}>
          <SelectTrigger id={id}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="regular">Regular</SelectItem>
            <SelectItem value="byDirection">By direction</SelectItem>
            {(allowActing || capacity === 'acting') && <SelectItem value="acting" disabled={!allowActing}>Acting</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      {capacity === 'byDirection' && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-authority`}>Authority (optional)</Label>
          <Input id={`${id}-authority`} value={value.byDirectionAuthority || ''}
            onChange={(e) => onChange({ byDirectionAuthority: e.target.value })}
            placeholder="Leave blank for a plain “By direction”" />
          <p className="text-xs text-muted-foreground">
            Leave blank for “By direction.” For correspondence affecting pay and allowances,
            enter the activity head, e.g., “the Commanding Officer” (SECNAV M-5216.5 Ch 7 ¶14b(5)).
          </p>
        </div>
      )}
      {allowActing && capacity === 'acting' && (
        <div className="space-y-2">
          <ActingGuidance />
          {showActingTitle && <>
            <Label htmlFor={`${id}-actingTitle`}>Acting position (optional)</Label>
            <Input id={`${id}-actingTitle`} value={value.actingTitle || ''}
              onChange={(e) => onChange({ actingTitle: e.target.value })} placeholder="e.g., Deputy" />
            <p className="text-xs text-muted-foreground">
              Leave blank when acting for the commander. Include a position only when replacing
              an official who signs by title; “Acting” prints below it.
            </p>
          </>}
        </div>
      )}
      {!allowActing && capacity === 'acting' && <p className="text-xs text-muted-foreground">
        This format does not use an Acting signature block. Choose Regular to clear the inherited setting.
      </p>}
    </div>
  );
}

function ActingGuidance() {
  return <p className="text-xs text-muted-foreground">
    For an officer authorized to temporarily succeed to command, or someone formally appointed
    to replace an official who signs by title (SECNAV M-5216.5 Ch 2 ¶5c–d).
  </p>;
}

export function ActingCheckbox({ id, checked, onCheckedChange }: {
  id: string; checked?: boolean; onCheckedChange: (checked: boolean) => void;
}) {
  return <div className="space-y-2 mt-3">
    <div className="flex items-center space-x-2">
      <Checkbox id={id} checked={!!checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
      <Label htmlFor={id} className="font-normal">Acting</Label>
    </div>
    {checked && <ActingGuidance />}
  </div>;
}
