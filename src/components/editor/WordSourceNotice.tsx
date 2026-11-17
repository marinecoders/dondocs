import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDocumentStore } from '@/stores/documentStore';
import { loadAttachment } from '@/lib/attachments';
import { triggerDownload } from '@/lib/encoding';
import { readWordDocument, WORD_DOCUMENT_TYPE } from '@/services/docx/import/readWord';
import { assertRetainedTextPolicy } from '@/lib/retainedDocumentTextPolicy';
import { getExportDeploymentPolicy } from '@/config/classification';
import { beginDocumentTask, isCurrentDocumentTask } from '@/lib/documentTask';

export function WordSourceNotice() {
  const source = useDocumentStore(state => state.formData.wordSource);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (!source) return null;
  const download = async () => {
    const task = beginDocumentTask(source);
    setBusy(true); setError('');
    try {
      if (!source.fileRef) throw new Error('The original Word file is not included in this shared copy. Use a complete draft or library backup.');
      const data = await loadAttachment(source.fileRef.id);
      if (!data) throw new Error('The original Word file is unavailable. Restore its complete backup.');
      const original = await readWordDocument(new Uint8Array(data), source.name);
      if (!mounted.current || !isCurrentDocumentTask(task)) return;
      if (original.source.sha256 !== source.sha256) throw new Error('The retained Word file does not match its saved identity.');
      assertRetainedTextPolicy([source.name, original.source.retainedText], await getExportDeploymentPolicy(undefined, true));
      if (!mounted.current || !isCurrentDocumentTask(task)) return;
      triggerDownload(new Blob([data], { type: WORD_DOCUMENT_TYPE }), source.name);
    } catch (failure) {
      if (mounted.current && isCurrentDocumentTask(task)) setError(failure instanceof Error ? failure.message : 'The original Word file could not be downloaded.');
    } finally { if (mounted.current) setBusy(false); }
  };
  return <aside className="mb-3 min-w-0 space-y-2 rounded-md border border-border p-3 text-sm [overflow-wrap:anywhere]" aria-label="Retained Word source">
    <p>Imported from {source.name}. The retained original stays separate from your current edits.</p>
    {source.notices.length > 0 && <details><summary>Word import notices</summary><ul className="list-disc space-y-1 pl-5">{source.notices.map(notice => <li key={notice}>{notice}</li>)}</ul></details>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" className="h-auto min-h-8 max-w-full whitespace-normal text-left" disabled={busy} onClick={() => void download()}>{busy ? 'Checking original…' : 'Download original Word file'}</Button>
    </div>
    {error && <p role="alert">{error}</p>}
  </aside>;
}
