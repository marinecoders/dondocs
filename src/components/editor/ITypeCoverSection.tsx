import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HelpTip } from '@/components/ui/help-tip';
import { Notice } from '@/components/ui/notice';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { InputWithVariables } from '@/components/ui/variable-autocomplete';
import { useDocumentStore } from '@/stores/documentStore';
import { validateTimeCompliance } from '@/lib/timeCompliance';
import { validateProcedureSteps } from '@/lib/procedureSteps';
import { validateAppendixTitles } from '@/lib/appendixTitles';
import { validateNomenclature, validateLongTitle } from '@/lib/publicationTitle';
import { validateNsnConsistency } from '@/lib/nsnConsistency';
import { PUBLICATION_TYPES, type PublicationTypeCode } from '@/data/techpub/publicationTypes';

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
  const shortTitle = useDocumentStore((s) => s.formData.shortTitle ?? '');
  const pcn = useDocumentStore((s) => s.formData.pcn ?? '');
  const supersedure = useDocumentStore((s) => s.formData.supersedure ?? '');
  const exportRestricted = useDocumentStore((s) => s.formData.exportRestricted ?? false);
  const date = useDocumentStore((s) => s.formData.date ?? '');
  const publicationType = useDocumentStore((s) => s.formData.publicationType ?? 'MI');
  const unitLine1 = useDocumentStore((s) => s.formData.unitLine1 ?? '');
  const unitLine2 = useDocumentStore((s) => s.formData.unitLine2 ?? '');
  const unitAddress = useDocumentStore((s) => s.formData.unitAddress ?? '');
  const controllingOffice = useDocumentStore((s) => s.formData.controllingOffice ?? '');

  // Both sets of rules answer "does this publication hold together", so they
  // surface in one place rather than sending the drafter hunting.
  const subject = useDocumentStore((s) => s.formData.subject ?? '');
  const signatureType = useDocumentStore((s) => s.formData.signatureType ?? 'none');
  const tables = useDocumentStore((s) => s.publicationTables);
  const findings = [
    ...validateNomenclature(nomenclature),
    ...validateLongTitle(subject),
    ...validateTimeCompliance(urgency, completionDate, new Date()),
    ...validateProcedureSteps(paragraphs),
    ...validateAppendixTitles(paragraphs),
    // Every NSN in the publication, cover and tables alike, must use one form.
    ...validateNsnConsistency([
      ...endItems.map((e) => e.nsn),
      ...Object.values(tables).flat().map((r) => r.values.nsn ?? ''),
    ]),
    // "I-Types must be digitally signed."
    ...(signatureType === 'digital'
      ? []
      : [{ severity: 'warning' as const, message: 'An I-Type must be digitally signed. Choose a digital signature in the Signature section.' }]),
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
        <Label htmlFor="publicationType">Publication type</Label>
        <Select value={publicationType} onValueChange={(v) => setField('publicationType', v as PublicationTypeCode)}>
          <SelectTrigger id="publicationType" aria-label="Publication type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PUBLICATION_TYPES) as PublicationTypeCode[]).map((code) => (
              <SelectItem key={code} value={code}>{code} — {PUBLICATION_TYPES[code]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="subject">
          <span className="flex items-center gap-2">
            Long title
            <HelpTip>
              <p className="font-medium mb-1">Long title</p>
              <p className="text-xs">
                What the publication is about, printed in the cover header above
                the time compliance line. All caps, four lines at most, and no
                acronyms.
              </p>
            </HelpTip>
          </span>
        </Label>
        <InputWithVariables
          id="subject"
          aria-label="Long title"
          value={subject}
          onValueChange={(v) => setField('subject', v)}
          placeholder="INSTALLATION OF THE STOCK ACCESSORY RAIL"
          className="uppercase"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="date">Date</Label>
        <DatePicker id="date" value={date} onChange={(v) => setField('date', v)} dateFormat="military" />
        <p className="text-xs text-muted-foreground">
          Printed as the month and year on the cover, and in full on the pages after it.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="shortTitle">Short title</Label>
        <Input
          id="shortTitle"
          value={shortTitle}
          onChange={(e) => setField('shortTitle', e.target.value)}
          placeholder="MI 12345A-24/1"
        />
        <p className="text-xs text-muted-foreground">
          From the PCN request. Runs in the header of every page.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pcn">PCN</Label>
        <Input
          id="pcn"
          value={pcn}
          onChange={(e) => setField('pcn', e.target.value)}
          placeholder="184 123456 00"
        />
        <p className="text-xs text-muted-foreground">Printed at the foot of the cover only.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="supersedure">Supersedure notice</Label>
        <Input
          id="supersedure"
          value={supersedure}
          onChange={(e) => setField('supersedure', e.target.value)}
          placeholder="Leave empty if this supersedes nothing"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={exportRestricted}
          onCheckedChange={(v) => setField('exportRestricted', v === true)}
        />
        Technical data is export-restricted
        <HelpTip>
          <p className="text-xs">
            Adds the Arms Export Control Act warning between the distribution
            statement and the destruction notice, where the standard places it.
          </p>
        </HelpTip>
      </label>

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

      <div className="space-y-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          Issuing command
          <HelpTip>
            <p className="font-medium mb-1">Issuing command</p>
            <p className="text-xs">
              Service, command, and address, heading the authentication page. An
              I-Type carries no letterhead, so these print as text.
            </p>
          </HelpTip>
        </span>
        <Input
          id="unitLine1"
          aria-label="Issuing command"
          value={unitLine1}
          onChange={(e) => setField('unitLine1', e.target.value)}
          placeholder="UNITED STATES MARINE CORPS"
        />
        <Input
          id="unitLine2"
          aria-label="Issuing command, second line"
          value={unitLine2}
          onChange={(e) => setField('unitLine2', e.target.value)}
          placeholder="MARINE CORPS SYSTEMS COMMAND"
        />
        <Input
          id="unitAddress"
          aria-label="Issuing command address"
          value={unitAddress}
          onChange={(e) => setField('unitAddress', e.target.value)}
          placeholder="2200 LESTER STREET, QUANTICO, VA 22134"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="controllingOffice">
          <span className="flex items-center gap-2">
            Controlling office
            <HelpTip>
              <p className="font-medium mb-1">Controlling office</p>
              <p className="text-xs">
                Closes the signature block, under the signing official's name
                and title, and the cover's "Controlled by" line. The signing
                authority is the title given in the Signature section.
              </p>
            </HelpTip>
          </span>
        </Label>
        <Input
          id="controllingOffice"
          aria-label="Controlling office"
          value={controllingOffice}
          onChange={(e) => setField('controllingOffice', e.target.value)}
          placeholder="PM Infantry Weapons"
        />
      </div>
    </div>
  );
}
