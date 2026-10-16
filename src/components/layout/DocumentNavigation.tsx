import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { DOC_TYPE_CATEGORIES, DOC_TYPE_LABELS, FORM_TYPE_CATEGORIES, FORM_TYPE_LABELS, type FormType } from '@/types/document';

/** Category changes resume a separate draft; they never convert the open one. */
export function DocumentNavigation() {
  const category = useDocumentStore((s) => s.documentCategory);
  const docType = useDocumentStore((s) => s.docType);
  const setDocType = useDocumentStore((s) => s.setDocType);
  const formType = useDocumentStore((s) => s.formType);
  const selectKind = useDocumentsStore((s) => s.selectKind);

  return <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-x-3 gap-y-1 lg:basis-auto">
    <nav aria-label="Document category" data-tour="category" className="flex shrink-0 items-center gap-1 rounded-md bg-muted p-1">
      {(['correspondence', 'forms'] as const).map((kind) => <button
        key={kind}
        type="button"
        aria-current={category === kind ? 'page' : undefined}
        onClick={() => selectKind(kind)}
        className={`min-h-9 rounded px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-7 ${category === kind ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground hover:bg-background/60'}`}
      >{kind === 'forms' ? 'Forms' : 'Correspondence'}</button>)}
    </nav>
    {category === 'forms' ? <select
      aria-label="Switch form"
      value={formType}
      onChange={(event) => selectKind('forms', event.target.value as FormType)}
      className="h-10 min-w-[150px] flex-1 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring sm:h-8 sm:w-60 sm:flex-none"
    >
      {FORM_TYPE_CATEGORIES.map((group) => <optgroup key={group.category} label={group.category}>
        {group.types.map((type) => <option key={type} value={type}>{FORM_TYPE_LABELS[type]}</option>)}
      </optgroup>)}
    </select> : <select
      aria-label="Correspondence type"
      value={docType}
      onChange={(event) => setDocType(event.target.value)}
      className="h-10 min-w-[150px] max-w-full flex-1 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring sm:h-8 sm:w-72 sm:flex-none"
    >
      {DOC_TYPE_CATEGORIES.map((group) => <optgroup key={group.category} label={group.category}>
        {group.types.map((type) => <option key={type} value={type}>{DOC_TYPE_LABELS[type]}</option>)}
      </optgroup>)}
    </select>}
  </div>;
}
