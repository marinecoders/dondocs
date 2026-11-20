import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, isCurrentDocumentTarget } from '@/stores/documentsStore';
import { showAppConfirm } from '@/stores/alertStore';
import { newParagraphId } from '@/lib/paragraphIdentity';
import { moveVolumeNode, orderedVolumeBlocks, publicationVolumeErrors, VOLUME_DOC_TYPE, VOLUME_LIMITS, volumeOutline, type PublicationVolume, type VolumeDivision } from '@/lib/publicationVolume';
import { VariableChipEditor } from '@/components/ui/variable-chip-editor';
import { StockPublicationGroup } from './StockPublicationGroup';
import { BodyTableEditor } from './BodyTableEditor';
import type { Paragraph } from '@/types/document';

function Field({ label, value, onChange, maxLength = 300 }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number }) {
  const id = useId();
  return <div className="min-w-0 space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} className="min-h-11" maxLength={maxLength} value={value} onChange={event => onChange(event.target.value)} /></div>;
}
function updateVolume(transform: (volume: PublicationVolume) => PublicationVolume) {
  const store = useDocumentStore.getState();
  if (store.docType === VOLUME_DOC_TYPE && store.formData.volume) store.setVolumeContent(transform(store.formData.volume));
}
function updateDivision(id: string, transform: (node: VolumeDivision) => VolumeDivision) {
  updateVolume(volume => ({ ...volume, chapters: volume.chapters.map(node => node.id === id ? transform(node) : node), appendices: volume.appendices.map(node => node.id === id ? transform(node) : node) }));
}

export function VolumeDetailsSection() {
  const formData = useDocumentStore(store => store.formData);
  const setField = useDocumentStore(store => store.setField);
  return <div className="space-y-5">
    <StockPublicationGroup title="Technical volume" description="Write a structured volume with chapters and appendices. PDF output supports unclassified and CUI content. This authoring tool does not authenticate or approve a publication.">
      <Field label="Volume title" value={formData.subject ?? ''} onChange={value => setField('subject', value)} />
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Publication short title" value={formData.shortTitle ?? ''} onChange={value => setField('shortTitle', value)} /><Field label="Publication date" value={formData.date ?? ''} onChange={value => setField('date', value)} /></div>
      <Field label="Controlling office" value={formData.controllingOffice ?? ''} onChange={value => setField('controllingOffice', value)} />
    </StockPublicationGroup>
  </div>;
}

/** The outline edits structure while each body's existing native blocks keep their identities. */
export function VolumeOutlineSection() {
  const volume = useDocumentStore(store => store.formData.volume);
  const paragraphs = useDocumentStore(store => store.paragraphs);
  if (!volume) return <p role="alert">Select Technical Volume to initialize its outline.</p>;
  const addDivision = (appendix: boolean) => updateVolume(current => ({ ...current, [appendix ? 'appendices' : 'chapters']: [...current[appendix ? 'appendices' : 'chapters'], { id: newParagraphId(), title: appendix ? 'New appendix' : 'New chapter', sections: [{ id: newParagraphId(), title: 'General' }] }] }));
  const remove = async (divisionId: string, sectionId?: string) => {
    const target = captureDocumentTarget();
    const captured = useDocumentStore.getState();
    const model = captured.formData.volume;
    if (!model) return;
    const division = [...model.chapters, ...model.appendices].find(node => node.id === divisionId);
    if (!division) return;
    const sectionIds = new Set(sectionId ? [sectionId] : division.sections.map(section => section.id));
    const count = captured.paragraphs.filter(paragraph => sectionIds.has(paragraph.volumeSectionId ?? '')).length;
    const accepted = await showAppConfirm({ title: sectionId ? 'Remove section?' : 'Remove division?', message: `This removes ${count} body block${count === 1 ? '' : 's'}. References to removed targets must be repaired before export.`, confirmLabel: 'Remove' });
    const current = useDocumentStore.getState();
    if (!accepted || !isCurrentDocumentTarget(target) || current.formData.volume !== model || current.paragraphs !== captured.paragraphs) return;
    const next = sectionId ? { ...model, chapters: model.chapters.map(node => node.id === divisionId ? { ...node, sections: node.sections.filter(section => section.id !== sectionId) } : node), appendices: model.appendices.map(node => node.id === divisionId ? { ...node, sections: node.sections.filter(section => section.id !== sectionId) } : node) } : { ...model, chapters: model.chapters.filter(node => node.id !== divisionId), appendices: model.appendices.filter(node => node.id !== divisionId) };
    current.setVolumeContent(next, current.paragraphs.filter(paragraph => !sectionIds.has(paragraph.volumeSectionId ?? '')));
  };
  const sectionCount = [...volume.chapters, ...volume.appendices].reduce((sum, node) => sum + node.sections.length, 0);
  return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">Reorder chapters or sections without rewriting their content. Numbering and linked references follow the saved outline.</p>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={volume.includeContents} onChange={event => updateVolume(current => ({ ...current, includeContents: event.target.checked }))} />Include linked contents</label>
    {(['chapters', 'appendices'] as const).map(kind => <div key={kind} className="space-y-3">
      <h3 className="text-sm font-semibold">{kind === 'chapters' ? 'Chapters' : 'Appendices'}</h3>
      {volume[kind].map((division, divisionIndex) => {
        const label = kind === 'chapters' ? `Chapter ${divisionIndex + 1}` : `Appendix ${String.fromCharCode(65 + divisionIndex)}`;
        return <fieldset key={division.id} className="min-w-0 space-y-3 rounded-lg border p-4"><legend className="px-1 text-sm font-medium">{label}</legend>
          <Field label={`${label} title`} value={division.title} onChange={title => updateDivision(division.id, node => ({ ...node, title }))} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" aria-label={`Move ${label.toLowerCase()} up`} disabled={divisionIndex === 0} onClick={() => updateVolume(current => ({ ...current, [kind]: moveVolumeNode(current[kind], divisionIndex, divisionIndex - 1) }))}><ArrowUp className="mr-1 h-4 w-4" />Up</Button>
            <Button size="sm" variant="outline" aria-label={`Move ${label.toLowerCase()} down`} disabled={divisionIndex === volume[kind].length - 1} onClick={() => updateVolume(current => ({ ...current, [kind]: moveVolumeNode(current[kind], divisionIndex, divisionIndex + 1) }))}><ArrowDown className="mr-1 h-4 w-4" />Down</Button>
            <Button size="sm" variant="ghost" aria-label={`Remove ${label.toLowerCase()}`} disabled={kind === 'chapters' && volume.chapters.length <= 1} onClick={() => void remove(division.id)}><Trash2 className="mr-1 h-4 w-4" />Remove</Button>
          </div>
          {division.sections.map((section, index) => <div key={section.id} className="space-y-2 border-l-2 pl-3">
            <Field label={`${label}, section ${index + 1} title`} value={section.title} onChange={title => updateDivision(division.id, node => ({ ...node, sections: node.sections.map(item => item.id === section.id ? { ...item, title } : item) }))} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" aria-label={`Move section ${index + 1} up in ${label.toLowerCase()}`} disabled={!index} onClick={() => updateDivision(division.id, node => ({ ...node, sections: moveVolumeNode(node.sections, index, index - 1) }))}>Move up</Button>
              <Button size="sm" variant="ghost" aria-label={`Move section ${index + 1} down in ${label.toLowerCase()}`} disabled={index === division.sections.length - 1} onClick={() => updateDivision(division.id, node => ({ ...node, sections: moveVolumeNode(node.sections, index, index + 1) }))}>Move down</Button>
              <Button size="sm" variant="ghost" aria-label={`Remove section ${index + 1} from ${label.toLowerCase()}`} disabled={division.sections.length <= 1} onClick={() => void remove(division.id, section.id)}>Remove section</Button>
            </div>
          </div>)}
          <Button size="sm" variant="outline" disabled={sectionCount >= VOLUME_LIMITS.sections} onClick={() => updateDivision(division.id, node => ({ ...node, sections: [...node.sections, { id: newParagraphId(), title: 'New section' }] }))}><Plus className="mr-1 h-4 w-4" />Add section to {label.toLowerCase()}</Button>
        </fieldset>;
      })}
      <Button variant="outline" disabled={volume[kind].length >= (kind === 'chapters' ? VOLUME_LIMITS.divisions : 26) || sectionCount >= VOLUME_LIMITS.sections} onClick={() => addDivision(kind === 'appendices')}>Add {kind === 'chapters' ? 'chapter' : 'appendix'}</Button>
    </div>)}
    <p className="text-xs text-muted-foreground">{paragraphs.length} body blocks in {sectionCount} sections. Appendix pages use their own letter-prefixed sequence.</p>
  </div>;
}

export function VolumeBodySection() {
  const volume = useDocumentStore(store => store.formData.volume);
  const paragraphs = useDocumentStore(store => store.paragraphs);
  const updateParagraph = useDocumentStore(store => store.updateParagraph);
  const [selected, setSelected] = useState('');
  const selectId = useId();
  if (!volume) return <p role="alert">Select Technical Volume to initialize its outline.</p>;
  const sections = volumeOutline(volume).filter(node => node.kind === 'section');
  const sectionId = sections.some(node => node.id === selected) ? selected : sections[0].id;
  const blocks = orderedVolumeBlocks(volume, paragraphs).filter(block => block.sectionId === sectionId);
  const addBlock = (table = false) => {
    const store = useDocumentStore.getState();
    if (store.docType !== VOLUME_DOC_TYPE || !store.formData.volume) return;
    const paragraph: Paragraph = { id: newParagraphId(), text: '', level: 0, volumeSectionId: sectionId, ...(table ? { bodyTable: { rows: [['Heading', 'Heading'], ['', '']], headerRows: 1 } } : {}) };
    store.setVolumeContent(store.formData.volume, [...store.paragraphs, paragraph]);
  };
  const moveBlock = (id: string, delta: number) => {
    const store = useDocumentStore.getState();
    const model = store.formData.volume;
    if (!model) return;
    const indices = store.paragraphs.flatMap((paragraph, index) => paragraph.volumeSectionId === sectionId ? [index] : []);
    const index = indices.findIndex(index => store.paragraphs[index].id === id);
    if (index < 0 || index + delta < 0 || index + delta >= indices.length) return;
    const body = [...store.paragraphs];
    [body[indices[index]], body[indices[index + delta]]] = [body[indices[index + delta]], body[indices[index]]];
    store.setVolumeContent(model, body);
  };
  return <div className="space-y-4">
    <div className="space-y-2"><Label htmlFor={selectId}>Editing section</Label><select id={selectId} className="min-h-11 w-full rounded-md border bg-background p-2 text-sm" value={sectionId} onChange={event => setSelected(event.target.value)}>{sections.map(node => <option key={node.id} value={node.id}>{node.label} {node.title}</option>)}</select></div>
    {!blocks.length && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">This section has no content yet. Add a paragraph or table below.</p>}
    {blocks.map((block, position) => <fieldset key={block.paragraph.id} className="min-w-0 space-y-3 rounded-lg border p-4"><legend className="px-1 text-sm font-medium">{block.label}</legend>
      <Field label={`Heading for ${block.label}`} value={block.paragraph.header ?? ''} onChange={header => updateParagraph(block.index, { header })} />
      {block.paragraph.bodyTable ? <BodyTableEditor table={block.paragraph.bodyTable} index={block.index} onChange={bodyTable => updateParagraph(block.index, { bodyTable })} /> : <VariableChipEditor ariaLabel={`Text for ${block.label}`} value={block.paragraph.text} onChange={text => updateParagraph(block.index, { text })} placeholder="Write section content" />}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" disabled={!position} onClick={() => moveBlock(block.paragraph.id!, -1)}>Move block up</Button>
        <Button variant="ghost" size="sm" disabled={position === blocks.length - 1} onClick={() => moveBlock(block.paragraph.id!, 1)}>Move block down</Button>
        <Button variant="ghost" size="sm" aria-label={`Remove block ${block.label}`} onClick={() => { const store = useDocumentStore.getState(); if (store.formData.volume) store.setVolumeContent(store.formData.volume, store.paragraphs.filter(paragraph => paragraph.id !== block.paragraph.id)); }}><Trash2 className="mr-1 h-4 w-4" />Remove block</Button>
      </div>
    </fieldset>)}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={paragraphs.length >= VOLUME_LIMITS.blocks} onClick={() => addBlock()}>Add volume paragraph</Button><Button variant="outline" disabled={paragraphs.length >= VOLUME_LIMITS.blocks} onClick={() => addBlock(true)}>Add volume table</Button></div>
    {publicationVolumeErrors(volume, paragraphs).map(error => <p key={error} className="text-xs text-muted-foreground">{error}</p>)}
  </div>;
}
