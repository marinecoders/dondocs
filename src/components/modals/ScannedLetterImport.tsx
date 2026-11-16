import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { recognizeScannedFile, type ScanPage, type ScanProgress } from '@/lib/scannedImport';

function SourcePage({ page, onFailure }: { page: ScanPage; onFailure: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void createImageBitmap(page.preview).then(bitmap => {
      const canvas = ref.current;
      if (active && canvas) {
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      }
      bitmap.close();
    }).catch(() => { if (active) { setFailed(true); onFailure(); } });
    return () => { active = false; };
  }, [page.preview, onFailure]);
  return <>{failed && <p role="alert">The source preview could not be displayed. Choose the file again before reviewing it.</p>}<canvas ref={ref} role="img" aria-label={`Original scanned page ${page.page}`} className="h-auto w-full bg-white" /></>;
}

export function ScannedLetterImport({ onRead, onBack }: { onRead: (text: string) => void; onBack: () => void }) {
  const active = useRef<AbortController | null>(null);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [reviewed, setReviewed] = useState<boolean[]>([]);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [previewFailure, setPreviewFailure] = useState<number | null>(null);
  const page = pages[index];
  const previewFailed = useCallback(() => {
    setPreviewFailure(index);
    setReviewed(values => values.map((value, position) => position === index ? false : value));
  }, [index]);
  useEffect(() => () => { active.current?.abort(); }, []);

  function cancel() {
    active.current?.abort(); active.current = null; setProgress(null);
  }
  async function choose(file: File) {
    active.current?.abort();
    const operation = new AbortController(); active.current = operation;
    setPages([]); setReviewed([]); setIndex(0); setError(''); setName(file.name); setPreviewFailure(null);
    setProgress({ page: 0, total: 1, fraction: 0 });
    try {
      const result = await recognizeScannedFile(file, operation.signal, value => {
        if (active.current === operation && !operation.signal.aborted) setProgress(value);
      });
      if (active.current !== operation || operation.signal.aborted) return;
      setPages(result); setReviewed(result.map(() => false));
      if (!result.some(page => page.text.trim())) setError('No text was recognized. Type the letter text beside its source, or choose a clearer scan.');
    } catch (cause) {
      if (active.current === operation && !operation.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'This source could not be read. Try a clear PDF or image.');
      }
    } finally {
      if (active.current === operation) { active.current = null; setProgress(null); }
    }
  }
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Recognize English text from a photo or scanned PDF, then compare and correct every page. Recognition runs locally. Use clear, upright pages; handwriting and complex layouts may need substantial correction. Up to 12 PDF pages and 20 MB per PDF; PNG/JPEG photos up to 10 MB and 40 megapixels.</p>
    <label className="block text-sm font-medium">Scanned PDF or image
      <input type="file" aria-label="Scanned PDF or image" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" className="mt-1 block w-full text-sm" onChange={event => {
        const file = event.target.files?.[0]; if (file) void choose(file); event.target.value = '';
      }} />
    </label>
    {progress && <div className="space-y-2">
      <p role="status" className="text-sm">{progress.page === 0 ? 'Preparing local text recognition…' : `Reading page ${progress.page} of ${progress.total} — ${Math.round(progress.fraction * 100)}%`}</p>
      <Button variant="outline" onClick={cancel}>Cancel recognition</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-warning">{error}</p>}
    {page && <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm break-words">{name} · Page {index + 1} of {pages.length} · Recognition confidence {Math.round(page.confidence)}%</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={index === 0} onClick={() => setIndex(value => value - 1)}>Previous page</Button>
          <Button variant="outline" disabled={index === pages.length - 1} onClick={() => setIndex(value => value + 1)}>Next page</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Confidence is an engine estimate. Verify names, dates, numbers, and markings against the original even when the score is high.</p>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <section aria-label="Scanned source" className="max-h-[45vh] overflow-auto rounded border"><SourcePage key={page.page} page={page} onFailure={previewFailed} /></section>
        <div className="space-y-2">
          <label htmlFor="scan-corrected-text" className="text-sm font-medium">Corrected text for page {index + 1}</label>
          <Textarea id="scan-corrected-text" className="h-72 field-sizing-fixed resize-y" value={page.text} onChange={event => {
            const text = event.target.value;
            setPages(values => values.map((value, position) => position === index ? { ...value, text } : value));
            setReviewed(values => values.map((value, position) => position === index ? false : value));
          }} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={previewFailure === index} checked={reviewed[index] ?? false} onChange={event => {
            const checked = event.target.checked;
            setReviewed(values => values.map((value, position) => position === index ? checked : value));
          }} />I checked the recognized text against this page.</label>
        </div>
      </div>
    </>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" onClick={() => { cancel(); onBack(); }}>Back</Button>
      <Button disabled={!pages.length || !reviewed.every(Boolean) || !pages.some(page => page.text.trim()) || Boolean(progress)} onClick={() => {
        try { onRead(pages.map(page => page.text).join('\n\n')); setError(''); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The corrected text could not be parsed.'); }
      }}>Review recognized letter</Button>
    </div>
  </div>;
}
