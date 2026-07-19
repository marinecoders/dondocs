import { useMemo, useState } from 'react';
import { Compass, Info, ShieldAlert, ArrowRight, Pencil, Check, X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ACTION_ROUTING } from '@/data/actionRouting';
import { suggestRouting } from '@/lib/suggestRouting';
import { useRoutingStore } from '@/stores/routingStore';

/**
 * Advisory routing helper for the NAVMC 10274 "7. To" field. It reads the
 * drafter's "Nature of Action" text to guess the action type, lets them confirm
 * or change it, and shows the section that typically handles it — with the
 * governing order and a "verify with your SOP" caveat. It's a decision aid: the
 * drafter clicks to insert the suggestion, and it never fills the field on its
 * own.
 *
 * The bundled destinations are doctrine-level ("IPAC, or your S-1"); a unit can
 * Edit any one to its actual routing, which is saved (and rides in the backup
 * bundle) so an admin chief can configure the command's routing once and share
 * it. The AA form is dual-use — an admin action vs a counseling entry whose "To"
 * is the Marine — so the helper stays collapsed to a quiet link until a routable
 * action type is detected or the drafter asks for it.
 */
export function ActionRoutingHelper({
  natureOfAction,
  onInsert,
}: {
  natureOfAction: string;
  onInsert: (destination: string) => void;
}) {
  const detected = useMemo(() => suggestRouting(natureOfAction), [natureOfAction]);
  const overrides = useRoutingStore((s) => s.overrides);
  const setOverride = useRoutingStore((s) => s.setOverride);
  const clearOverride = useRoutingStore((s) => s.clearOverride);

  const [picked, setPicked] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const activeId = picked || detected[0]?.id || '';
  const route = ACTION_ROUTING.find((r) => r.id === activeId);
  const autoDetected = !picked && detected.length > 0;
  const expanded = manualOpen || detected.length > 0 || picked !== '';

  const override = activeId ? overrides[activeId] : undefined;
  const effectiveDestination = override ?? route?.destination ?? '';

  const startEdit = () => {
    setDraft(effectiveDestination);
    setEditing(true);
  };
  const saveEdit = () => {
    if (activeId) setOverride(activeId, draft);
    setEditing(false);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setManualOpen(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Compass className="h-3.5 w-3.5" />
        Not sure where this routes? Get routing help
      </button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border border-border bg-secondary/20 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Compass className="h-4 w-4 text-primary" />
        Where does this route?
      </div>

      <div className="space-y-1.5">
        <Select
          value={activeId}
          onValueChange={(v) => {
            setPicked(v);
            setEditing(false);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Type of action, for a routing suggestion">
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
        <div className="space-y-2 rounded-md border border-border bg-background p-2.5">
          {editing ? (
            <div className="space-y-2">
              <label htmlFor="routing-override" className="text-xs font-medium text-muted-foreground">
                Your command&apos;s routing for “{route.category}”
              </label>
              <Input
                id="routing-override"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={route.destination}
                autoFocus
              />
              <div className="flex justify-end gap-1.5">
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  <X className="mr-1 h-3.5 w-3.5" /> Cancel
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={saveEdit}>
                  <Check className="mr-1 h-3.5 w-3.5" /> Save
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="break-words text-sm font-medium">{effectiveDestination}</p>
                  {!override && <p className="text-xs text-muted-foreground">{route.note}</p>}
                  {!override && route.authority && (
                    <p className="text-2xs text-muted-foreground">Authority: {route.authority}</p>
                  )}
                  {override && (
                    <p className="flex items-center gap-1 text-2xs text-muted-foreground">
                      Saved for your unit
                      <button
                        type="button"
                        onClick={() => clearOverride(activeId)}
                        className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
                      >
                        <RotateCcw className="h-3 w-3" /> reset to default
                      </button>
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  aria-label={`Use "${effectiveDestination}" in the To field`}
                  onClick={() => onInsert(effectiveDestination)}
                >
                  Use <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
              <button
                type="button"
                onClick={startEdit}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <Pencil className="h-3 w-3" /> Set your command&apos;s routing
              </button>
            </>
          )}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-warning">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Advisory only — routing varies by command. Confirm with your unit SOP or S-1 before submitting.
      </p>
    </div>
  );
}
