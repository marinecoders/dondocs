import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useDocumentStore } from '@/stores/documentStore';
import { newParagraphId } from '@/lib/paragraphIdentity';
import { VOLUME_LIMITS, type PublicationVolume } from '@/lib/publicationVolume';

function Field({ label, value, onChange, multiline = false, maxLength }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; maxLength: number }) {
  const id = useId();
  const Control = multiline ? Textarea : Input;
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Control className="min-h-11" id={id} value={value} maxLength={maxLength} onChange={event => onChange(event.target.value)} /></div>;
}
export function VolumeSupplementSection({ kind }: { kind: 'glossary' | 'changes' }) {
  const volume = useDocumentStore(store => store.formData.volume);
  if (!volume) return <p role="alert">Select Technical Volume to initialize its outline.</p>;
  const update = (transform: (current: PublicationVolume) => PublicationVolume) => {
    const store = useDocumentStore.getState();
    if (store.formData.volume) store.setVolumeContent(transform(store.formData.volume));
  };
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{kind === 'glossary' ? 'Define terms used throughout this volume. Entries print in the order shown.' : 'Record publication changes without rewriting earlier entries. These author-entered records do not establish approval or an authenticated audit history.'}</p>
    {kind === 'glossary' ? volume.glossary.map((entry, index) => <fieldset key={entry.id} className="min-w-0 space-y-3 rounded-lg border p-4"><legend className="px-1 text-sm">Glossary entry {index + 1}</legend>
      <Field label={`Term ${index + 1}`} value={entry.term} maxLength={200} onChange={term => update(current => ({ ...current, glossary: current.glossary.map(item => item.id === entry.id ? { ...item, term } : item) }))} />
      <Field label={`Definition ${index + 1}`} value={entry.definition} maxLength={4_000} multiline onChange={definition => update(current => ({ ...current, glossary: current.glossary.map(item => item.id === entry.id ? { ...item, definition } : item) }))} />
      <Button size="sm" variant="ghost" onClick={() => update(current => ({ ...current, glossary: current.glossary.filter(item => item.id !== entry.id) }))}>Remove glossary entry {index + 1}</Button>
    </fieldset>) : volume.changes.map((entry, index) => <fieldset key={entry.id} className="min-w-0 space-y-3 rounded-lg border p-4"><legend className="px-1 text-sm">Change record {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-2"><Field label={`Change ${index + 1} number`} value={entry.number} maxLength={40} onChange={number => update(current => ({ ...current, changes: current.changes.map(item => item.id === entry.id ? { ...item, number } : item) }))} /><Field label={`Change ${index + 1} date`} value={entry.date} maxLength={80} onChange={date => update(current => ({ ...current, changes: current.changes.map(item => item.id === entry.id ? { ...item, date } : item) }))} /></div>
      <Field label={`Change ${index + 1} description`} value={entry.description} maxLength={4_000} multiline onChange={description => update(current => ({ ...current, changes: current.changes.map(item => item.id === entry.id ? { ...item, description } : item) }))} />
      <Button size="sm" variant="ghost" onClick={() => update(current => ({ ...current, changes: current.changes.filter(item => item.id !== entry.id) }))}>Remove change record {index + 1}</Button>
    </fieldset>)}
    <Button variant="outline" disabled={volume[kind].length >= (kind === 'glossary' ? VOLUME_LIMITS.glossary : VOLUME_LIMITS.changes)} onClick={() => update(current => kind === 'glossary' ? { ...current, glossary: [...current.glossary, { id: newParagraphId(), term: '', definition: '' }] } : { ...current, changes: [...current.changes, { id: newParagraphId(), number: '', date: '', description: '' }] })}>Add {kind === 'glossary' ? 'glossary entry' : 'change record'}</Button>
  </div>;
}
