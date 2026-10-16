import { ChevronDown } from 'lucide-react';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { DOC_TYPE_LABELS, FORM_TYPE_CATEGORIES, FORM_TYPE_LABELS, type FormType } from '@/types/document';

/** Category changes resume a separate draft; they never convert the open one. */
export function DocumentNavigation() {
  const category = useDocumentStore((s) => s.documentCategory);
  const docType = useDocumentStore((s) => s.docType);
  const formType = useDocumentStore((s) => s.formType);
  const selectKind = useDocumentsStore((s) => s.selectKind);

  return <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
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
      className="h-10 w-full min-w-0 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring sm:h-8 sm:w-60"
    >
      {FORM_TYPE_CATEGORIES.map((group) => <optgroup key={group.category} label={group.category}>
        {group.types.map((type) => <option key={type} value={type}>{FORM_TYPE_LABELS[type]}</option>)}
      </optgroup>)}
    </select> : <button
      type="button"
      onClick={() => useEditorOutlineStore.getState().jump('type')}
      aria-label={`Document type: ${DOC_TYPE_LABELS[docType]}. Change type`}
      className="flex h-10 max-w-full min-w-0 items-center gap-1 rounded-md px-1 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:h-8"
    ><span className="truncate">{DOC_TYPE_LABELS[docType]}</span><ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" /></button>}
  </div>;
}
