import { useRef } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { FormPicker } from '@/components/editor/FormPicker';
import { FormCatalogModal } from '@/components/modals/FormCatalogModal';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { CorrespondencePicker } from '@/components/editor/CorrespondencePicker';

/** Category changes resume a separate draft; they never convert the open one. */
export function DocumentNavigation() {
  const catalogReturnFocus = useRef<HTMLButtonElement | null>(null);
  const catalogOpen = useUIStore(s => s.formCatalogOpen);
  const setCatalogOpen = useUIStore(s => s.setFormCatalogOpen);
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
    <div data-tour="doctype" className="min-w-0 flex-1 basis-full sm:basis-auto sm:w-72 sm:flex-none">
      {category === 'forms' ? (
        <FormPicker
          value={formType}
          onSelect={type => selectKind('forms', type)}
          onBrowse={trigger => { catalogReturnFocus.current = trigger; setCatalogOpen(true); }}
        />
      ) : <CorrespondencePicker value={docType} onSelect={setDocType} />}
    </div>
    <FormCatalogModal open={catalogOpen} onOpenChange={setCatalogOpen} onSelect={type => selectKind('forms', type)} onCloseAutoFocus={event => {
      const trigger = catalogReturnFocus.current;
      catalogReturnFocus.current = null;
      if (trigger?.isConnected) { event.preventDefault(); trigger.focus(); }
    }} />
  </div>;
}
