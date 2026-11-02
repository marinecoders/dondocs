import { useEffect, useState } from 'react';
import { loadAttachment } from '@/lib/attachments';
import { figureExtension, printedDpi } from '@/lib/figures';
import type { Paragraph } from '@/types/document';

export function Sl3FigurePreview({ figure, title, printWidth, printHeight = 4.3, alsoEndItem = false }: {
  figure: NonNullable<Paragraph['figure']>; title: string; printWidth: number; printHeight?: number; alsoEndItem?: boolean;
}) {
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [dimensions, setDimensions] = useState<{ id: string; width: number; height: number } | null>(null);
  const id = figure.fileRef?.id;
  const extension = figureExtension(figure.type ?? figure.fileRef?.type, figure.name ?? figure.fileRef?.name);
  useEffect(() => {
    if (!id || extension === 'pdf') return;
    let cancelled = false;
    let url: string | undefined;
    void loadAttachment(id).then(bytes => {
      if (cancelled) return;
      if (!bytes) { setPreview({ id, url: '' }); return; }
      url = URL.createObjectURL(new Blob([bytes], { type: extension === 'jpg' ? 'image/jpeg' : 'image/png' }));
      setPreview({ id, url });
    }).catch(() => { if (!cancelled) setPreview({ id, url: '' }); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [id, extension]);
  if (!id) return null;
  if (extension === 'pdf') return <p className="text-xs text-muted-foreground">Single-page PDF attached. Review its placement in the document preview.</p>;
  const width = dimensions?.id === id ? dimensions.width : figure.width;
  const height = dimensions?.id === id ? dimensions.height : figure.height;
  const dpi = width && height ? Math.round(Math.min(printedDpi(width, height, printWidth, printHeight),
    alsoEndItem ? printedDpi(width, height, 6.5, 4.3) : Infinity)) : undefined;
  return (
    <div className="space-y-2 rounded-md border p-3">
      {preview?.id === id && preview.url && <img src={preview.url} alt={`Attached image: ${title}`} className="max-h-64 w-full rounded-sm bg-white object-contain"
        onLoad={event => setDimensions({ id, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />}
      {preview?.id === id && !preview.url && <p role="alert" className="text-xs text-destructive">Attached image unavailable. Reattach it before export.</p>}
      <p className="text-xs text-muted-foreground">The full image fits proportionally without cropping. Review the printed caption and labels in the document preview.</p>
      {dpi !== undefined && <p className="text-xs text-muted-foreground">{width} × {height} pixels · approximately {dpi} dpi in this layout.</p>}
      {dpi !== undefined && dpi < 150 && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">This image may look soft in print. Use a higher-resolution original; enlarging this file will not restore detail.</p>}
    </div>
  );
}
