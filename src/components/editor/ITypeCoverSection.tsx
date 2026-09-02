import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HelpTip } from '@/components/ui/help-tip';
import { Notice } from '@/components/ui/notice';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDocumentStore } from '@/stores/documentStore';
import { validateTimeCompliance } from '@/lib/timeCompliance';
import { validateProcedureSteps } from '@/lib/procedureSteps';

/** The standard prints this many rows whatever the publication covers, so the
 *  editor stops offering more once they are used up. */
const END_ITEM_ROWS = 6;

/**
 * Cover page of a technical publication: what the equipment is called, and the
 * end items the publication applies to.
 *
 * The End Item table always prints six rows — unused ones stay blank rather
 * than being deleted — and a seventh item moves the whole list to the back of
 * the cover page. Both happen at render time; this only collects the items.
 */
export function ITypeCoverSection() {
  const nomenclature = useDocumentStore((s) => s.formData.nomenclature ?? '');
  const setField = useDocumentStore((s) => s.setField);
  const endItems = useDocumentStore((s) => s.endItems);
  const addEndItem = useDocumentStore((s) => s.addEndItem);
  const updateEndItem = useDocumentStore((s) => s.updateEndItem);
  const removeEndItem = useDocumentStore((s) => s.removeEndItem);
  const urgency = useDocumentStore((s) => s.formData.miUrgency ?? 'normal');
  const completionDate = useDocumentStore((s) => s.formData.miCompletionDate ?? '');
  const paragraphs = useDocumentStore((s) => s.paragraphs);

  // Both sets of rules answer "does this publication hold together", so they
  // surface in one place rather than sending the drafter hunting.
  const findings = [
    ...validateTimeCompliance(urgency, completionDate, new Date()),
    ...validateProcedureSteps(paragraphs),
  ];

  const columns = [
    { key: 'nsn', label: 'NSN' },
    { key: 'tamcn', label: 'TAMCN' },
    { key: 'id', label: 'ID' },
    { key: 'model', label: 'MODEL' },
  ] as const;

  return (
    <div className="space-y-4">
      {findings.length > 0 && (
        <div className="space-y-2" aria-live="polite">
          {findings.map((f, i) => (
            <Notice key={i} variant={f.severity === 'error' ? 'error' : 'warning'}>
              <span className={f.severity === 'error' ? 'text-destructive' : 'text-warning'}>
                <span className="sr-only">{f.severity === 'error' ? 'Error: ' : 'Warning: '}</span>
                {f.message}
              </span>
            </Notice>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="miUrgency">Time compliance</Label>
        <Select value={urgency} onValueChange={(v) => setField('miUrgency', v as 'urgent' | 'normal')}>
          <SelectTrigger id="miUrgency" aria-label="Time compliance">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">NORMAL — one year</SelectItem>
            <SelectItem value="urgent">URGENT — under one year</SelectItem>
          </SelectContent>
        </Select>
        {urgency === 'urgent' && (
          <Input
            type="date"
            aria-label="Completion date"
            value={completionDate}
            onChange={(e) => setField('miCompletionDate', e.target.value)}
          />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="nomenclature">
          <span className="flex items-center gap-2">
            Nomenclature
            <HelpTip>
              <p className="font-medium mb-1">Nomenclature</p>
              <p className="text-xs">
                What the equipment is called, printed under the seal on the cover.
                Two lines at most.
              </p>
            </HelpTip>
          </span>
        </Label>
        <Input
          id="nomenclature"
          aria-label="Nomenclature"
          value={nomenclature}
          onChange={(e) => setField('nomenclature', e.target.value)}
          placeholder="COMBAT OPERATIONS CENTER, AN/TSQ-239(V)4"
        />
      </div>

      <div className="space-y-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          End items
          <HelpTip>
            <p className="font-medium mb-1">End items</p>
            <p className="text-xs">
              The equipment this publication applies to. The cover prints six rows
              whether or not they are all used; a seventh item moves the list to
              the back of the cover page.
            </p>
          </HelpTip>
        </span>

        {endItems.length === 0 && (
          <p className="text-xs text-muted-foreground">
            None added. The cover prints an empty six-row table.
          </p>
        )}

        {endItems.map((item, index) => (
          <div key={index} className="flex items-end gap-2">
            {columns.map((col) => (
              <div key={col.key} className="flex-1 space-y-1">
                {index === 0 && (
                  <Label className="text-2xs text-muted-foreground">{col.label}</Label>
                )}
                <Input
                  value={item[col.key]}
                  onChange={(e) => updateEndItem(index, { [col.key]: e.target.value })}
                  aria-label={`${col.label}, end item ${index + 1}`}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeEndItem(index)}
              aria-label={`Remove end item ${index + 1}`}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}

        {endItems.length < END_ITEM_ROWS && (
          <Button type="button" variant="outline" size="sm" onClick={addEndItem}>
            <Plus className="h-4 w-4 mr-2" aria-hidden />
            Add end item
          </Button>
        )}
      </div>
    </div>
  );
}
