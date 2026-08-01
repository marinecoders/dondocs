import { Bot, ClipboardList, FlaskConical, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { showAppConfirm } from '@/stores/alertStore';
import { useFormStore } from '@/stores/formStore';
import { configFormOutline, useFormConfigFor } from '@/services/formRegistry';
import { SectionShell } from '@/components/layout/SectionShell';
import { RowGroupGrid } from '@/components/editor/RowGroupGrid';
import { humanizeGroup } from '@/lib/humanizeGroup';
import type { FormFieldConfig, FormRowGroupConfig, FormSectionConfig } from '@/types/formConfig';

/**
 * Editor for a config-driven form (form.json): one accordion item per config
 * section, one widget per field chosen by its type. This single component is
 * the editor for every registry form — adding a form adds data, not UI code.
 */
export function GenericFormSection({ formType }: { formType: string }) {
  const values = useFormStore((s) => s.configFormValues[formType]);
  const setValue = useFormStore((s) => s.setConfigFormValue);
  const clearForm = useFormStore((s) => s.clearConfigForm);
  const rowValues = useFormStore((s) => s.configFormRows[formType]);
  const addRow = useFormStore((s) => s.addConfigFormRow);
  const setRowValue = useFormStore((s) => s.setConfigFormRowValue);
  const removeRow = useFormStore((s) => s.removeConfigFormRow);
  const setFormData = useFormStore((s) => s.setConfigFormData);
  // Shared with the sidebar outline (useEditorSections) so the rail and the
  // rendered sections always come from the same loaded config.
  const config = useFormConfigFor(formType);

  if (!config) return null;

  // Fill every field and every roster row with an unmistakable test pattern,
  // so a reviewer can eyeball the PDF preview and confirm each box of a
  // freshly imported form lands where it should. Checkboxes check, signature
  // fields stay blank (the renderer never draws them). ADDITIVE: every press
  // appends another run of the pattern to whatever is already there, so
  // repeated clicks stress-test shrink-to-fit, wrapping, and the clip.
  const fillTestData = async () => {
    // It writes to EVERY field and ticks EVERY checkbox. That is the point when
    // you are checking a freshly imported form's boxes, and a disaster on a form
    // someone has been filling in — there is no undo, and unpicking it by hand
    // across seventy-five fields is worse than starting over. Confirm only when
    // there is something to lose, the same rule the reference rows use.
    const hasWork =
      Object.values(values ?? {}).some((v) => v !== '' && v !== false && v !== undefined) ||
      Object.values(rowValues ?? {}).some((rows) => (rows ?? []).length > 0);
    if (hasWork) {
      const confirmed = await showAppConfirm({
        title: 'Overwrite this form with test data?',
        message:
          'Every field gets a test pattern and every checkbox is ticked, over what you have already entered. This cannot be undone.',
        confirmLabel: 'Fill with test data',
        destructive: true,
      });
      if (!confirmed) return;
    }
    const TEST = '01010101010101';
    const grow = (existing: unknown) =>
      (typeof existing === 'string' ? existing : '') + TEST;
    const nextValues: Record<string, string | boolean> = {};
    // Radios are pick-one: mark exactly the FIRST option of each group and
    // clear the rest, so the preview draws one mark per group (matching the
    // mutual exclusion radioGroup() enforces) instead of a truthy string on
    // every option. Ungrouped radios toggle on like a checkbox.
    const filledRadioGroup = new Set<string>();
    for (const [key, f] of Object.entries(config.fields)) {
      if (f.type === 'signature') continue;
      if (f.type === 'checkbox') {
        nextValues[key] = true;
      } else if (f.type === 'radio') {
        nextValues[key] = f.group ? !filledRadioGroup.has(f.group) : true;
        if (f.group) filledRadioGroup.add(f.group);
      } else {
        nextValues[key] = grow(values?.[key]);
      }
    }
    const nextRows: Record<string, Array<Record<string, string | boolean>>> = {};
    for (const [gkey, group] of Object.entries(config.rowGroups ?? {})) {
      const existing = rowValues?.[gkey] ?? [];
      nextRows[gkey] = Array.from({ length: group.count }, (_, i) => {
        const row: Record<string, string | boolean> = {};
        for (const [ckey, col] of Object.entries(group.columns)) {
          if (col.type === 'signature') continue;
          // A boolean column takes a boolean, never a string (a truthy string
          // would draw a mark the editor's checkbox shows as unchecked).
          row[ckey] =
            col.type === 'checkbox' ? true : col.type === 'radio' ? i === 0 : grow(existing[i]?.[ckey]);
        }
        return row;
      });
    }
    setFormData(formType, nextValues, nextRows);
  };

  const field = (key: string, f: FormFieldConfig) => {
    const value = values?.[key];
    if (f.type === 'checkbox') {
      return (
        <label key={key} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value === true}
            onCheckedChange={(checked) => setValue(formType, key, checked === true)}
          />
          {f.label || key}
        </label>
      );
    }
    // An ungrouped radio (hand-config, or a lone kid) toggles like a checkbox;
    // grouped radios are rendered mutually-exclusive by radioGroup().
    if (f.type === 'radio') {
      return (
        <label key={key} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value === true}
            onCheckedChange={(checked) => setValue(formType, key, checked === true)}
          />
          {f.label || key}
        </label>
      );
    }
    if (f.type === 'signature') {
      return (
        <div key={key} className="space-y-1">
          <Label className="text-muted-foreground">{f.label || key}</Label>
          <p className="text-xs text-muted-foreground">
            Signature field — signed after export (CAC in Acrobat, or by hand).
          </p>
        </div>
      );
    }
    if (f.type === 'date') {
      return (
        <div key={key} className="space-y-1">
          <Label>{f.label || key}</Label>
          <DatePicker
            value={typeof value === 'string' ? value : ''}
            onChange={(v) => setValue(formType, key, v)}
          />
        </div>
      );
    }
    // A dropdown with real options harvested from the PDF; falls back to a
    // plain text input if the options weren't captured.
    if (f.type === 'choice' && f.options && f.options.length > 0) {
      return (
        <div key={key} className="space-y-1">
          <Label>{f.label || key}</Label>
          <Select
            value={typeof value === 'string' ? value : ''}
            onValueChange={(v) => setValue(formType, key, v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {f.options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    if (f.multiline) {
      return (
        <div key={key} className="space-y-1">
          <Label>{f.label || key}</Label>
          <Textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setValue(formType, key, e.target.value)}
            rows={4}
          />
        </div>
      );
    }
    return (
      <div key={key} className="space-y-1">
        <Label>{f.label || key}</Label>
        <Input
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setValue(formType, key, e.target.value)}
        />
      </div>
    );
  };

  // Per-row card stack — the fallback editor module for a row group narrow
  // enough that a grid would waste space (editor: 'cards'). The grid module is
  // the default; see the dispatch in rowGroup().
  const rowCards = (gkey: string, group: FormRowGroupConfig) => {
    const rows = rowValues?.[gkey] ?? [];
    return (
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Row {i + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeRow(formType, gkey, i)}
                aria-label={`Remove row ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(group.columns).map(([ckey, col]) =>
                col.type === 'checkbox' ? (
                  <label key={ckey} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={row[ckey] === true}
                      onCheckedChange={(checked) => setRowValue(formType, gkey, i, ckey, checked === true)}
                    />
                    {col.label || ckey}
                  </label>
                ) : (
                  <div key={ckey} className="space-y-1">
                    <Label className="text-xs">{col.label || ckey}</Label>
                    <Input
                      value={typeof row[ckey] === 'string' ? (row[ckey] as string) : ''}
                      onChange={(e) => setRowValue(formType, gkey, i, ckey, e.target.value)}
                      className="h-8"
                    />
                  </div>
                )
              )}
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => addRow(formType, gkey)}
          disabled={rows.length >= group.count}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add row{rows.length >= group.count ? ` (page holds ${group.count})` : ''}
        </Button>
      </div>
    );
  };

  // A mutually-exclusive radio group: picking one option sets it true and
  // clears the group's siblings. The label is each option's harvested value.
  const radioGroup = (groupId: string, keys: string[]) => {
    const selected = keys.find((k) => values?.[k] === true);
    // Show the group's question as a heading. Prefer a harvested groupLabel;
    // otherwise derive a readable one from the slug (null = show nothing, as
    // before — a wrong heading on a signable form is worse than none).
    const heading = keys.map((k) => config.fields[k].groupLabel).find(Boolean) ?? humanizeGroup(groupId);
    return (
      <fieldset key={`radio:${groupId}`} className="space-y-1.5">
        {heading && <legend className="mb-1 text-xs font-medium text-muted-foreground">{heading}</legend>}
        {keys.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${formType}:${groupId}`}
              checked={selected === k}
              onChange={() => keys.forEach((sib) => setValue(formType, sib, sib === k))}
              className="size-4 rounded-full accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            {config.fields[k].label || k}
          </label>
        ))}
      </fieldset>
    );
  };

  // Render a section's fields as the right module: 'checklist' collapses a
  // mostly-checkbox section into a compact yes/no list; otherwise fields render
  // as a labeled stack, with radios collected into mutually-exclusive groups.
  const sectionBody = (section: FormSectionConfig) => {
    if (section.editor === 'checklist') {
      return (
        <div className="space-y-1.5">
          {section.fields.map((key) => {
            const f = config.fields[key];
            return f.type === 'checkbox' ? (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={values?.[key] === true}
                  onCheckedChange={(checked) => setValue(formType, key, checked === true)}
                />
                {f.label || key}
              </label>
            ) : (
              field(key, f)
            );
          })}
        </div>
      );
    }
    const nodes: React.ReactNode[] = [];
    const seen = new Set<string>();
    for (const key of section.fields) {
      const f = config.fields[key];
      if (f.type === 'radio' && f.group) {
        if (seen.has(f.group)) continue;
        seen.add(f.group);
        const members = section.fields.filter((k) => config.fields[k].group === f.group);
        // A real radio group is a handful of options. A huge "group" is a
        // harvester artifact (a form that names every radio identically) —
        // rendering it mutually-exclusive would clear dozens on each pick, so
        // fall back to independent toggles.
        if (members.length <= 8) nodes.push(radioGroup(f.group, members));
        else members.forEach((k) => nodes.push(field(k, config.fields[k])));
      } else {
        nodes.push(field(key, f));
      }
    }
    return <div className="space-y-4">{nodes}</div>;
  };

  // Dispatcher: pick the editor module for a row group. Grid (a spreadsheet) is
  // the right shape for a roster and the default; 'cards' is the narrow-group
  // fallback.
  const rowGroup = (gkey: string, group: FormRowGroupConfig, accordionValue: string) => {
    const rows = rowValues?.[gkey] ?? [];
    return (
      <AccordionItem value={accordionValue}>
        <AccordionTrigger className="hover:no-underline">
          {group.title}
          <span className="ml-2 text-xs text-muted-foreground">
            {rows.length} of {group.count}
          </span>
        </AccordionTrigger>
        <AccordionContent className="pt-2">
          {(group.editor ?? 'grid') === 'cards' ? (
            rowCards(gkey, group)
          ) : (
            <RowGroupGrid formType={formType} groupKey={gkey} group={group} />
          )}
        </AccordionContent>
      </AccordionItem>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardList className="h-4 w-4 text-primary" aria-hidden />
          {config.label}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={fillTestData}
            aria-label="Fill every field with test data"
            title="Fill every box with 01010101010101 to check field placement"
          >
            <FlaskConical className="h-4 w-4" aria-hidden />
            Test fill
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => clearForm(formType)}
            aria-label="Clear form fields"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Clear
          </Button>
        </div>
      </div>

      {/* Accordion values are the outline's deduped ids, not raw titles — two
          sections sharing a title in a hand-edited form.json must still
          expand and collapse independently. */}
      {/* Every form rendered by this component came through the automated
          import pipeline; the two hand-built forms (10274, 118(11)) use their
          own editors and never show this notice. */}
      <div className="border-l-2 pl-3 text-xs border-amber-400 dark:border-amber-600">
        <Bot className="mr-1 inline-block h-3.5 w-3.5 align-[-2px] text-amber-600 dark:text-amber-400" aria-hidden />
        <span className="font-medium">This form was prepared automatically.</span>{' '}
        <span className="text-muted-foreground">
          It is an early version and not every field has been hand-checked yet. Please
          compare your finished PDF against the{' '}
          {/* Deep link to the bundled blank page 1 so a Marine can check a
              cryptic field against the real form. Directory names contain
              spaces/parens — encode each path segment. */}
          <a
            href={`/templates/${config.directory.split('/').map(encodeURIComponent).join('/')}/page1.pdf`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-amber-700 underline decoration-dotted underline-offset-2 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
          >
            official form
          </a>{' '}
          before signing or submitting.
        </span>
      </div>

      <Accordion type="multiple" defaultValue={configFormOutline(config).map((e) => e.id)} className="space-y-2">
        {/* Each group is wrapped in a SectionShell whose id comes from the
            same configFormOutline the sidebar rail renders, giving config
            forms the `#sec-` jump anchors and active hairline the letter
            sections and built-in forms have. */}
        {configFormOutline(config).map((entry) =>
          entry.kind === 'section' ? (
            <SectionShell key={entry.id} id={entry.id}>
              <AccordionItem value={entry.id}>
                <AccordionTrigger className="hover:no-underline">{entry.label}</AccordionTrigger>
                <AccordionContent className="pt-2">
                  {sectionBody(config.sections[entry.index])}
                </AccordionContent>
              </AccordionItem>
            </SectionShell>
          ) : (
            <SectionShell key={entry.id} id={entry.id}>
              {rowGroup(entry.key, config.rowGroups![entry.key], entry.id)}
            </SectionShell>
          )
        )}
      </Accordion>
    </div>
  );
}
