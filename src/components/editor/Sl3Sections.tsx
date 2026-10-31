import { useState, type ReactNode } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useDocumentStore } from '@/stores/documentStore';
import { persistAttachment, newAttachmentId } from '@/lib/attachments';
import { validateFigureAsset } from '@/services/latex/figureAssets';
import {
  SL3_CATEGORIES,
  SL3_PORTIONS,
  emptySl3,
  newSl3Component,
  orderedSl3Components,
  moveSl3Group,
  assignSl3Parent,
  sl3GroupIds,
  canAssignSl3Parent,
  sl3FigureIds,
  type Sl3Data,
  type Sl3Component,
} from '@/data/techpub/sl3';
import { sl3ExportErrors } from '@/lib/sl3Preflight';
import { Sl3DateFields } from './Sl3DateFields';

function useSl3() {
  const stored = useDocumentStore((s) => s.formData.sl3);
  const setField = useDocumentStore((s) => s.setField);
  const data = stored ?? emptySl3();
  return {
    data,
    update: (patch: Partial<Sl3Data>) => setField('sl3', { ...data, ...patch }),
  };
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0 space-y-2 text-sm">
      <span className="font-medium">{label}</span>
      {multiline ? (
        <Textarea
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function Portion({
  label,
  value,
  onChange,
}: {
  label: string;
  value: (typeof SL3_PORTIONS)[number];
  onChange: (value: (typeof SL3_PORTIONS)[number]) => void;
}) {
  return (
    <label className="block min-w-0 space-y-2 text-sm">
      {label}
      <select
        aria-label={label}
        className="w-full rounded-md border bg-background p-2"
        value={value}
        onChange={(e) =>
          onChange(e.target.value as (typeof SL3_PORTIONS)[number])
        }
      >
        {SL3_PORTIONS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </label>
  );
}

function figureLabel(data: Sl3Data, id: string | undefined, index: number) {
  const number = sl3FigureIds(data).indexOf(id ?? '') + 1;
  return number ? `Figure ${number}` : `Illustration ${index + 1} (unassigned)`;
}

function EditorGroup({ title, description, children }: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="min-w-0 space-y-4 border-t pt-5">
      <legend className="pr-3 text-sm font-semibold">{title}</legend>
      {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {children}
    </fieldset>
  );
}

export function Sl3CoverSection() {
  const store = useDocumentStore();
  const { data, update } = useSl3();
  const errors = sl3ExportErrors(store);
  return (
    <div className="sl3-editor space-y-7">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Build your SL-3 components inventory publication. Changes are saved as you edit.
      </p>
      <EditorGroup title="Publication identity">
        <div className="sl3-field-grid">
          <Field label="Short title" value={store.formData.shortTitle ?? ''}
            placeholder="SL-3-12345A" onChange={(v) => store.setField('shortTitle', v)} />
          <Field label="PCN" value={store.formData.pcn ?? ''}
            placeholder="123 123450 00" onChange={(v) => store.setField('pcn', v)} />
        </div>
        <Field label="Long title" value={store.formData.subject ?? ''}
          placeholder="COMPONENTS LIST FOR…" onChange={(v) => store.setField('subject', v)} multiline />
        <Field label="End item nomenclature" value={store.formData.nomenclature ?? ''}
          onChange={(v) => store.setField('nomenclature', v)} />
      </EditorGroup>
      <EditorGroup title="Publication dates">
        <Sl3DateFields />
      </EditorGroup>
      <EditorGroup title="Issuing command and contact">
        {([
          ['unitLine1', 'Issuing command'],
          ['unitLine2', 'Command line 2'],
          ['unitAddress', 'Command address'],
          ['controllingOffice', 'Controlling office'],
          ['pocEmail', 'Program office email'],
        ] as const).map(([key, label]) => (
          <Field key={key} label={label} value={String(store.formData[key] ?? '')}
            onChange={(v) => store.setField(key, v)} />
        ))}
        <Field label="Supersedure notice" value={store.formData.supersedure ?? ''}
          onChange={(v) => store.setField('supersedure', v)} multiline />
      </EditorGroup>
      <EditorGroup title="End items" description="Six cover rows are retained. Longer lists continue after the cover.">
        {store.endItems.map((item, i) => (
          <div key={i} className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">End item {i + 1}</span>
              <Button variant="ghost" size="sm" onClick={() => store.removeEndItem(i)}>
                <Trash2 className="mr-2 size-3.5" />Remove end item
              </Button>
            </div>
            <div className="sl3-field-grid">
              {(['nsn', 'tamcn', 'id', 'model'] as const).map((key) => (
                <Field key={key} label={`End item ${i + 1} ${key.toUpperCase()}`}
                  value={item[key]} onChange={(v) => store.updateEndItem(i, { [key]: v })} />
              ))}
            </div>
          </div>
        ))}
        <Button variant="outline" onClick={store.addEndItem}>
          <Plus className="mr-2 h-4 w-4" />Add end item
        </Button>
      </EditorGroup>
      <EditorGroup title="Inventory pages" description="Cover and front matter remain portrait. This layout applies to inventory and certification pages. Landscape PDF pages widen to 11 by 11 inches under MIL-STD-38784C.">
        <div className="sl3-field-grid">
          <label className="block min-w-0 space-y-2 text-sm">
            <span className="font-medium">Inventory layout</span>
            <select aria-label="Inventory layout" className="w-full rounded-md border bg-background p-2"
              value={data.orientation} onChange={(e) => update({ orientation: e.target.value as Sl3Data['orientation'] })}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label className="block min-w-0 space-y-2 text-sm">
            <span className="font-medium">Maximum inventory rows per sheet</span>
            <select aria-label="Maximum inventory rows per sheet" className="w-full rounded-md border bg-background p-2"
              value={data.rowsPerSheet} onChange={(e) => update({ rowsPerSheet: Number(e.target.value) })}>
              {Array.from({ length: 13 }, (_, i) => i + 4).map((rows) => <option key={rows} value={rows}>{rows}</option>)}
            </select>
          </label>
        </div>
      </EditorGroup>
      <EditorGroup title="Release and review">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!store.formData.exportRestricted}
            onChange={(e) => store.setField('exportRestricted', e.target.checked)} />
          Export-controlled technical data
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Authentication requires a Program Manager or higher authority. Export prepares an unsigned digital signature field for certificate signing.
        </p>
        <details className="text-xs leading-relaxed text-muted-foreground">
          <summary className="cursor-pointer font-medium">Governing references and MVP limitations</summary>
          <div className="space-y-2 pt-2">
            <p>MCO 5215.17D and the supplied MARCORSYSCOM template govern this publication.</p>
            <p>This MVP embeds Nimbus Roman. The supplied template requires Times New Roman; font compliance and source-template exceptions remain unresolved.</p>
          </div>
        </details>
        {errors.length > 0 && (
          <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">{errors.length} {errors.length === 1 ? 'item' : 'items'} to complete before export</summary>
            <ul className="list-disc space-y-1 pl-5 pt-2">
              {errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </details>
        )}
      </EditorGroup>
    </div>
  );
}

export function Sl3DetailsSection() {
  const { data, update } = useSl3();
  return (
    <div className="sl3-editor space-y-5">
      <Field
        label="Source technical manual"
        value={data.sourceManual}
        onChange={(sourceManual) => update({ sourceManual })}
      />
      <Field
        label="TFSMS configuration source (for TAMCN associations)"
        value={data.configurationReference}
        onChange={(configurationReference) =>
          update({ configurationReference })
        }
      />
      <Field
        label="Technical data"
        value={data.technicalData}
        onChange={(technicalData) => update({ technicalData })}
        multiline
      />
      <Portion
        label="Technical data portion marking"
        value={data.technicalPortion}
        onChange={(technicalPortion) => update({ technicalPortion })}
      />
      <Field
        label="Inventory sequencing explanation (if not alphabetical)"
        value={data.sequencingNote}
        onChange={(sequencingNote) => update({ sequencingNote })}
        multiline
      />
      <Portion
        label="Sequencing explanation portion marking"
        value={data.sequencingPortion}
        onChange={(sequencingPortion) => update({ sequencingPortion })}
      />
      <p className="text-sm text-muted-foreground">
        The standard preface prints automatically. Special Notes remains present
        and prints None when empty.
      </p>
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">
          Abbreviations, symbols, and applicability codes
        </legend>
        <p className="text-sm text-muted-foreground">
          Standard terms are defined automatically. Define every additional term
          or symbol used in your publication here; the list prints
          alphabetically.
        </p>
        {(data.definitions ?? []).map((definition, i) => (
          <div key={definition.id} className="space-y-2 border-b pb-3">
            <Field
              label={`Term ${i + 1}`}
              value={definition.term}
              onChange={(term) =>
                update({
                  definitions: data.definitions.map((d) =>
                    d.id === definition.id ? { ...d, term } : d,
                  ),
                })
              }
            />
            <Field
              label={`Meaning ${i + 1}`}
              value={definition.meaning}
              onChange={(meaning) =>
                update({
                  definitions: data.definitions.map((d) =>
                    d.id === definition.id ? { ...d, meaning } : d,
                  ),
                })
              }
              multiline
            />
            <Portion
              label={`Definition ${i + 1} portion marking`}
              value={definition.portionMarking}
              onChange={(portionMarking) =>
                update({
                  definitions: data.definitions.map((d) =>
                    d.id === definition.id ? { ...d, portionMarking } : d,
                  ),
                })
              }
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                update({
                  definitions: data.definitions.filter(
                    (d) => d.id !== definition.id,
                  ),
                })
              }
            >
              Remove definition
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          onClick={() =>
            update({
              definitions: [
                ...(data.definitions ?? []),
                {
                  id: newAttachmentId(),
                  term: '',
                  meaning: '',
                  portionMarking: 'U',
                },
              ],
            })
          }
        >
          Add definition
        </Button>
      </fieldset>
      {data.notes.map((note, i) => (
        <div className="space-y-2 rounded-md border p-3" key={note.id}>
          <Field
            label={`Special note ${i + 19}`}
            value={note.text}
            onChange={(text) =>
              update({
                notes: data.notes.map((n) =>
                  n.id === note.id ? { ...n, text } : n,
                ),
              })
            }
            multiline
          />
          <Portion
            label={`Special note ${i + 19} portion marking`}
            value={note.portionMarking}
            onChange={(portionMarking) =>
              update({
                notes: data.notes.map((n) =>
                  n.id === note.id ? { ...n, portionMarking } : n,
                ),
              })
            }
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              update({
                notes: data.notes.filter((n) => n.id !== note.id),
                components: data.components.map((item) => ({
                  ...item,
                  noteIds: item.noteIds.filter((id) => id !== note.id),
                })),
              })
            }
          >
            Remove note
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          update({
            notes: [
              ...data.notes,
              { id: newAttachmentId(), text: '', portionMarking: 'U' },
            ],
          })
        }
      >
        <Plus className="mr-2 h-4 w-4" />
        Add special note
      </Button>
    </div>
  );
}

export function Sl3InventorySection() {
  const { data, update } = useSl3();
  const figures = useDocumentStore((s) => s.paragraphs).filter((p) => p.figure);
  const items = orderedSl3Components(data);
  const patch = (id: string, changes: Partial<Sl3Component>) =>
    update({
      components: data.components.map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
    });
  return (
    <div className="sl3-editor space-y-5">
      <p className="text-sm text-muted-foreground">
        Item numbers follow category and row order. Leave NSN blank when
        unassigned. Component quantities print with their identification;
        top-level quantities print in the quantity column.
      </p>
      {(['showFigureReference', 'showModel'] as const).map((key) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={data[key]}
            onChange={(e) => update({ [key]: e.target.checked })}
          />
          {key === 'showModel'
            ? 'Include model column'
            : 'Include figure key / reference designator column'}
        </label>
      ))}
      {(data.showModel || data.showFigureReference) && (
        <Field
          label="Fielding Plan for optional columns"
          value={data.fieldingPlanReference}
          onChange={(fieldingPlanReference) =>
            update({ fieldingPlanReference })
          }
        />
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Define abbreviations and symbols in Technical data and notes. Definitions apply to the entire publication.
      </p>
      {items.map((item, index) => (
        <div key={item.id} className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <strong className="text-sm">Item {index + 1}</strong>
            <div className="flex gap-1">
              {([-1, 1] as const).map((direction) => (
                <Button
                  key={direction}
                  variant="ghost"
                  size="icon"
                  aria-label={`Move item ${index + 1} ${direction < 0 ? 'up' : 'down'}`}
                  onClick={() =>
                    update({
                      components: moveSl3Group(data, item.id, direction),
                    })
                  }
                >
                  {direction < 0 ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove item ${index + 1}`}
                onClick={() =>
                  update({
                    components: data.components
                      .filter((p) => p.id !== item.id)
                      .map((p) =>
                        p.parentId === item.id
                          ? { ...p, parentId: item.parentId }
                          : p,
                      ),
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <label className="block min-w-0 space-y-2 text-sm">
            Responsibility category
            <select
              aria-label={`Item ${index + 1} responsibility category`}
              className="w-full rounded-md border bg-background p-2"
              value={item.category}
              onChange={(e) => {
                const group = sl3GroupIds(item.id, data.components);
                update({
                  components: data.components.map((p) =>
                    group.has(p.id)
                      ? {
                          ...p,
                          category: e.target.value as Sl3Component['category'],
                          ...(p.id === item.id ? { parentId: '' } : {}),
                        }
                      : p,
                  ),
                });
              }}
            >
              {Object.entries(SL3_CATEGORIES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Field
            label={`Item ${index + 1} nomenclature`}
            value={item.nomenclature}
            onChange={(v) => patch(item.id, { nomenclature: v })}
          />
          <Portion
            label={`Item ${index + 1} portion marking`}
            value={item.portionMarking}
            onChange={(portionMarking) => patch(item.id, { portionMarking })}
          />
          <Field
            label={`Item ${index + 1} description`}
            value={item.description}
            onChange={(v) => patch(item.id, { description: v })}
            multiline
          />
          <div className="sl3-field-grid">
            {(
              [
                ['nsn', 'NSN'],
                ['tamcn', 'TAMCN (if assigned)'],
                ['idNumber', 'ID number (if assigned)'],
                ['partNumber', 'Part number'],
                ['cage', 'CAGE'],
                ['unit', 'Unit of measure'],
                ['unitOfIssue', 'Unit of issue'],
                ['primaryTamcn', 'Associated primary TAMCN'],
                [
                  'configurationRatio',
                  'Configuration ratio (primary:component)',
                ],
                ['quantity', 'Quantity'],
              ] as const
            ).map(([key, label]) => (
              <Field
                key={key}
                label={`Item ${index + 1} ${label}`}
                value={item[key]}
                onChange={(v) => patch(item.id, { [key]: v })}
              />
            ))}
          </div>
          <label className="block min-w-0 space-y-2 text-sm">
            Component of
            <select
              aria-label={`Item ${index + 1} parent`}
              className="w-full rounded-md border bg-background p-2"
              value={item.parentId}
              onChange={(e) =>
                update({
                  components: assignSl3Parent(data, item.id, e.target.value),
                })
              }
            >
              <option value="">Top-level item</option>
              {items
                .slice(0, index)
                .filter((p) => canAssignSl3Parent(data, item.id, p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    Item {items.indexOf(p) + 1}: {p.nomenclature}
                  </option>
                ))}
            </select>
          </label>
          <label className="block min-w-0 space-y-2 text-sm">
            Illustration
            <select
              aria-label={`Item ${index + 1} illustration`}
              className="w-full rounded-md border bg-background p-2"
              value={item.figureId}
              onChange={(e) => patch(item.id, { figureId: e.target.value })}
            >
              <option value="">Not Shown</option>
              {figures.map((p, i) => (
                <option key={p.referenceId} value={p.referenceId}>
                  {figureLabel(data, p.referenceId, i)}: {p.text}
                </option>
              ))}
            </select>
          </label>
          {data.showFigureReference && (
            <Field
              label={`Item ${index + 1} figure key / reference designator`}
              value={item.figureReference}
              onChange={(v) => patch(item.id, { figureReference: v })}
            />
          )}
          {data.showModel && (
            <Field
              label={`Item ${index + 1} model`}
              value={item.model}
              onChange={(v) => patch(item.id, { model: v })}
            />
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.serialized}
              onChange={(e) => patch(item.id, { serialized: e.target.checked })}
            />
            Serialized item
          </label>
          {data.notes.map((note, i) => (
            <label key={note.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.noteIds.includes(note.id)}
                onChange={(e) =>
                  patch(item.id, {
                    noteIds: e.target.checked
                      ? [...item.noteIds, note.id]
                      : item.noteIds.filter((id) => id !== note.id),
                  })
                }
              />
              See special note {i + 19}
            </label>
          ))}
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          update({
            components: [
              ...data.components,
              newSl3Component(newAttachmentId()),
            ],
          })
        }
      >
        <Plus className="mr-2 h-4 w-4" />
        Add component
      </Button>
    </div>
  );
}

export function Sl3IllustrationsSection() {
  const paragraphs = useDocumentStore((s) => s.paragraphs);
  const updateParagraph = useDocumentStore((s) => s.updateParagraph);
  const { data, update } = useSl3();
  const [error, setError] = useState('');
  const figures = paragraphs.filter((p) => p.figure);
  const setArtwork = (
    figureId: string,
    patch: Partial<Sl3Data['artwork'][number]>,
  ) => {
    const existing = data.artwork?.find((a) => a.figureId === figureId);
    update({
      artwork: [
        ...(data.artwork ?? []).filter((a) => a.figureId !== figureId),
        { figureId, lettering: 'none', labels: [], ...existing, ...patch },
      ],
    });
  };
  return (
    <div className="sl3-editor space-y-5">
      <label className="block min-w-0 space-y-2 text-sm">
        End item illustration
        <select
          aria-label="End item illustration"
          className="w-full rounded-md border bg-background p-2"
          value={data.endItemFigureId}
          onChange={(e) => update({ endItemFigureId: e.target.value })}
        >
          <option value="">Not Shown</option>
          {figures.map((p, i) => (
            <option value={p.referenceId} key={p.referenceId}>
              {figureLabel(data, p.referenceId, i)}: {p.text}
            </option>
          ))}
        </select>
      </label>
      {figures.map((p, i) => (
        <div key={p.referenceId} className="space-y-2 rounded-md border p-3">
          <Field
            label={`${figureLabel(data, p.referenceId, i)} title`}
            value={p.text}
            onChange={(text) =>
              updateParagraph(paragraphs.indexOf(p), { text })
            }
          />
          <Portion
            label={`${figureLabel(data, p.referenceId, i)} portion marking`}
            value={p.figure?.portionMarking ?? 'U'}
            onChange={(portionMarking) =>
              updateParagraph(paragraphs.indexOf(p), {
                portionMarking,
                figure: { ...p.figure, portionMarking },
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            {p.figure?.name ?? 'No file attached'}
          </p>
          <label className="block text-sm">
            Choose illustration (PNG, JPEG or single-page PDF)
            <input
              className="mt-2 block w-full text-sm"
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const buffer = await file.arrayBuffer();
                  const extension =
                    file.type === 'application/pdf'
                      ? 'pdf'
                      : file.type === 'image/jpeg'
                        ? 'jpg'
                        : 'png';
                  await validateFigureAsset(
                    new Uint8Array(buffer),
                    `figure.${extension}`,
                  );
                  const fileRef = await persistAttachment(
                    {
                      name: file.name,
                      type: file.type,
                      size: buffer.byteLength,
                    },
                    buffer,
                  );
                  const current = useDocumentStore.getState();
                  const index = current.paragraphs.findIndex(
                    (entry) => entry.referenceId === p.referenceId,
                  );
                  if (index >= 0)
                    current.updateParagraph(index, {
                      figure: {
                        ...current.paragraphs[index].figure,
                        fileRef,
                        name: file.name,
                        type: file.type,
                      },
                    });
                  if (current.formData.sl3)
                    current.setField('sl3', {
                      ...current.formData.sl3,
                      artwork: (current.formData.sl3.artwork ?? []).filter(
                        (a) => a.figureId !== p.referenceId,
                      ),
                    });
                  setError('');
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'Could not attach illustration.',
                  );
                }
              }}
            />
          </label>
          <label className="block min-w-0 space-y-2 text-sm">
            Illustration lettering review
            <select
              className="w-full rounded-md border bg-background p-2"
              aria-label={`${figureLabel(data, p.referenceId, i)} lettering review`}
              value={
                data.artwork?.find((a) => a.figureId === p.referenceId)
                  ?.lettering ?? ''
              }
              onChange={(e) => {
                if (!e.target.value)
                  update({
                    artwork: (data.artwork ?? []).filter(
                      (a) => a.figureId !== p.referenceId,
                    ),
                  });
                else
                  setArtwork(p.referenceId!, {
                    lettering: e.target.value as 'none' | 'labels',
                    ...(e.target.value === 'none' ? { labels: [] } : {}),
                  });
              }}
            >
              <option value="">Review required</option>
              <option value="none">
                I confirm the artwork contains no lettering
              </option>
              <option value="labels">
                I removed baked-in lettering; add all labels as searchable text
              </option>
            </select>
          </label>
          {data.artwork?.find((a) => a.figureId === p.referenceId)
            ?.lettering === 'labels' && (
            <div className="space-y-2 rounded border p-3">
              <p className="text-xs text-muted-foreground">
                Labels print as visible, searchable text over the artwork.
                Position each label by its horizontal center and baseline
                height, in percent of the image. Supply artwork without baked-in
                lettering and check all labels against the preview.
              </p>
              {(
                data.artwork.find((a) => a.figureId === p.referenceId)
                  ?.labels ?? []
              ).map((label, j) => (
                <div key={label.id} className="space-y-2 border-b pb-2">
                  <Field
                    label={`Label ${j + 1} text`}
                    value={label.text}
                    onChange={(text) =>
                      setArtwork(p.referenceId!, {
                        labels: data.artwork
                          .find((a) => a.figureId === p.referenceId)!
                          .labels.map((l) =>
                            l.id === label.id ? { ...l, text } : l,
                          ),
                      })
                    }
                  />
                  {(['x', 'y'] as const).map((axis) => (
                    <label key={axis} className="block text-sm">
                      {axis === 'x'
                        ? 'Horizontal center (%)'
                        : 'Baseline from bottom (%)'}
                      <Input
                        aria-label={`Label ${j + 1} ${axis === 'x' ? 'horizontal center' : 'baseline'} percent`}
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={label[axis]}
                        onChange={(e) =>
                          setArtwork(p.referenceId!, {
                            labels: data.artwork
                              .find((a) => a.figureId === p.referenceId)!
                              .labels.map((l) =>
                                l.id === label.id
                                  ? { ...l, [axis]: Number(e.target.value) }
                                  : l,
                              ),
                          })
                        }
                      />
                    </label>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setArtwork(p.referenceId!, {
                        labels: data.artwork
                          .find((a) => a.figureId === p.referenceId)!
                          .labels.filter((l) => l.id !== label.id),
                      })
                    }
                  >
                    Remove label
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() =>
                  setArtwork(p.referenceId!, {
                    labels: [
                      ...(data.artwork.find((a) => a.figureId === p.referenceId)
                        ?.labels ?? []),
                      { id: newAttachmentId(), text: '', x: 50, y: 50 },
                    ],
                  })
                }
              >
                Add searchable label
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              useDocumentStore.setState({
                paragraphs: paragraphs.filter(
                  (entry) => entry.referenceId !== p.referenceId,
                ),
              });
              update({
                artwork: (data.artwork ?? []).filter(
                  (a) => a.figureId !== p.referenceId,
                ),
                endItemFigureId:
                  data.endItemFigureId === p.referenceId
                    ? ''
                    : data.endItemFigureId,
                components: data.components.map((item) =>
                  item.figureId === p.referenceId
                    ? { ...item, figureId: '' }
                    : item,
                ),
              });
            }}
          >
            Remove illustration
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        variant="outline"
        onClick={() =>
          useDocumentStore.setState({
            paragraphs: [
              ...paragraphs,
              {
                referenceId: newAttachmentId(),
                text: '',
                level: 0,
                portionMarking: 'U',
                figure: { portionMarking: 'U' },
              },
            ],
          })
        }
      >
        <Plus className="mr-2 h-4 w-4" />
        Add illustration
      </Button>
    </div>
  );
}
