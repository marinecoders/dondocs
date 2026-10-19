import type { SerializedSession } from '@/stores/documentStore';
import { sessionSearchFields } from '@/lib/workspaceSearch';
import { DOC_TYPE_LABELS, formTypeLabel } from '@/types/document';

/** Read-only text inspection shared by sharing, import and templates. */
export function SessionPreview({ session }: { session: SerializedSession }) {
  const fields = sessionSearchFields(session);
  const labels = [...new Set(fields.map((field) => field.label))];
  const type = session.documentCategory === 'forms' ? formTypeLabel(session.formType, session.genericForm?.definition.label) : DOC_TYPE_LABELS[session.docType];
  return <div className="space-y-2 text-sm">
    <p className="font-medium">{type}</p>
    {session.documentCategory !== 'forms' && <p className="text-xs text-muted-foreground">{session.paragraphs?.length ?? 0} paragraph{session.paragraphs?.length === 1 ? '' : 's'} · {session.references?.length ?? 0} reference{session.references?.length === 1 ? '' : 's'} · {session.enclosures?.length ?? 0} enclosure description{session.enclosures?.length === 1 ? '' : 's'}</p>}
    <details className="rounded-md border">
      <summary className="cursor-pointer px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring">Inspect document text</summary>
      <div className="space-y-3 border-t p-3">
        {labels.filter((label) => label !== 'Document type').map((label) => <section key={label}>
          <h4 className="font-medium">{label}</h4>
          {fields.filter((field) => field.label === label).map((field, index) => <p key={index} className="whitespace-pre-wrap break-words text-muted-foreground mt-1">{field.text}</p>)}
        </section>)}
      </div>
    </details>
  </div>;
}
