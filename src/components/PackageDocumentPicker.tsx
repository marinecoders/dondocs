import { useState, type ReactNode } from 'react';
import { FilePlus2, Files, Search, Upload } from 'lucide-react';
import { DOC_TYPE_CATEGORIES, DOC_TYPE_LABELS } from '@/types/document';
import { useFormCatalog } from '@/services/formCatalog';
import { packageOfficialForms } from '@/lib/packageOfficialForms';
import type { DocumentEntry } from '@/stores/documentsStore';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { FormCatalogStatus } from './editor/FormCatalogStatus';

const sources = ['Suggested', 'Forms', 'Correspondence', 'My documents', 'Upload'] as const;
type Source = typeof sources[number];
interface Choice {
  id: string; title: string; detail: string; search?: string; action: string; select(): void;
}
interface Props {
  docs: Record<string, DocumentEntry>; currentId: string | null;
  onLibrary(id: string): void;
  onCorrespondence(type: string, label: string): void;
  onForm(id: string, label: string): void;
  upload: ReactNode;
}

export function PackageDocumentPicker({ docs, currentId, onLibrary, onCorrespondence, onForm, upload }: Props) {
  const [source, setSource] = useState<Source>('Suggested');
  const [query, setQuery] = useState('');
  const catalog = useFormCatalog();
  const forms = new Map<string, Choice>();
  for (const form of packageOfficialForms) forms.set(form.id, {
    id: form.id, title: form.label, detail: form.id.replace(/_/g, ' ').toUpperCase().replace(/([A-Z])(?=\d)/, '$1 '),
    action: 'Add ' + form.label, select: () => onForm(form.id, form.label),
  });
  for (const form of catalog) {
    const existing = forms.get(form.formType);
    forms.set(form.formType, {
      id: form.formType, title: existing?.title ?? form.title, detail: form.number, search: [form.name, ...form.keywords].join(' '),
      action: existing?.action ?? 'Add ' + form.name, select: () => onForm(form.formType, existing?.title ?? form.name),
    });
  }
  const correspondence = DOC_TYPE_CATEGORIES.flatMap(group => group.types.map(id => {
    const title = id === 'naval_letter' ? 'Naval letter' : id === 'coordination_page' ? 'Coordination page' : DOC_TYPE_LABELS[id];
    return { id, title, detail: group.category, search: DOC_TYPE_LABELS[id], action: id === 'naval_letter' ? 'Add letter' : 'Add ' + (id === 'coordination_page' ? 'coordination page' : title), select: () => onCorrespondence(id, title) };
  }));
  const library = Object.values(docs).filter(doc => !doc.meta.deletedAt).sort((a, b) => Number(b.meta.id === currentId) - Number(a.meta.id === currentId) || b.meta.updatedAt - a.meta.updatedAt)
    .map(({ meta }) => ({ id: meta.id, title: meta.title, detail: meta.id === currentId ? 'Open in editor' : DOC_TYPE_LABELS[meta.docType] ?? meta.docType,
      action: meta.id === currentId ? 'Capture current document' : 'Add ' + meta.title, select: () => onLibrary(meta.id) }));
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const groups: [Source, Choice[]][] = [['Correspondence', correspondence], ['Forms', [...forms.values()]], ['My documents', library]];
  const results = groups.filter(([group]) => source === 'Suggested' || group === source).map(([group, choices]) => {
    const matching = choices.filter(c => terms.every(term => [c.title, c.id, c.detail, c.search].join(' ').toLowerCase().includes(term)));
    const rows = source === 'Suggested' && !terms.length ? group === 'Correspondence' ? matching.filter(c => c.id === 'naval_letter' || c.id === 'coordination_page') : matching.slice(0, 3) : matching;
    return { group, rows };
  });
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Document source">{sources.map(item =>
      <Button key={item} size="sm" variant={item === source ? 'secondary' : 'ghost'} aria-pressed={item === source}
        onClick={() => setSource(item)}>{item === 'Suggested' && query.trim() ? 'All results' : item}</Button>)}</div>
    {source !== 'Upload' && <>
      <div className="relative"><Search aria-hidden className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input type="search" className="pl-9" aria-label="Search documents to add" placeholder="Search by name or form number" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="max-h-72 overflow-y-auto rounded-md border">
        {results.map(({ group, rows }) => rows.length > 0 && <section key={group} aria-label={group} className="p-1">
          <h3 className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group}</h3>
          {rows.map(row => <button type="button" key={row.id} aria-label={row.action} onClick={row.select}
            className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-ring">
            {group === 'My documents' ? <Files aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : <FilePlus2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 break-words">{row.title}</span><span className="max-w-[40%] text-right text-xs text-muted-foreground">{row.detail}</span>
          </button>)}</section>)}
        {results.every(group => !group.rows.length) && <p role="status" className="p-4 text-sm text-muted-foreground">No matching documents.</p>}
        {(source === 'Forms' || source === 'Suggested') && <FormCatalogStatus />}
      </div>
    </>}
    {(source === 'Upload' || source === 'Suggested' && !terms.length) && <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm"><Upload aria-hidden className="size-4 text-muted-foreground" />{upload}</div>}
  </div>;
}
