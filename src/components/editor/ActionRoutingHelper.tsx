import { useMemo, useState } from 'react';
import { Compass, Info, ShieldAlert, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ACTION_ROUTING } from '@/data/actionRouting';
import { suggestRouting } from '@/lib/suggestRouting';

/**
 * Advisory routing helper for the NAVMC 10274 "7. To" field. It reads the
 * drafter's "Nature of Action" text to guess the action type, lets them confirm
 * or change it, and shows the section that typically handles it — with the
 * governing order and a "verify with your SOP" caveat. It's a decision aid: the
 * drafter clicks to insert the suggestion, and it never fills the field on its
 * own. (Command-specific routing overrides are a planned follow-up.)
 */
export function ActionRoutingHelper({
  natureOfAction,
  onInsert,
}: {
  natureOfAction: string;
  onInsert: (destination: string) => void;
}) {
  const detected = useMemo(() => suggestRouting(natureOfAction), [natureOfAction]);
  const [picked, setPicked] = useState('');
  const activeId = picked || detected[0]?.id || '';
  const route = ACTION_ROUTING.find((r) => r.id === activeId);
  const autoDetected = !picked && detected.length > 0;

  return (
    <div className="space-y-2.5 rounded-md border border-border bg-secondary/20 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Compass className="h-4 w-4 text-primary" />
        Where does this route?
      </div>

      <div className="space-y-1.5">
        <Select value={activeId} onValueChange={setPicked}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick the type of action…" />
          </SelectTrigger>
          <SelectContent>
            {ACTION_ROUTING.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {autoDetected && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Detected from your Nature of Action — change it if that&apos;s not right.
          </p>
        )}
      </div>

      {route && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-border bg-background p-2.5">
          <div className="min-w-0 space-y-0.5">
            <p className="break-words text-sm font-medium">{route.destination}</p>
            <p className="text-xs text-muted-foreground">{route.note}</p>
            {route.authority && (
              <p className="text-2xs text-muted-foreground">Authority: {route.authority}</p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() => onInsert(route.destination)}
          >
            Use <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-warning">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Advisory only — routing varies by command. Confirm with your unit SOP or S-1 before submitting.
      </p>
    </div>
  );
}
