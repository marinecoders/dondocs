import { useId, useState } from 'react';
import type { Paragraph } from '@/types/document';
import { useDocumentStore } from '@/stores/documentStore';
import { beginDocumentTask, isCurrentDocumentTask } from '@/lib/documentTask';
import { withAttachmentStaging, persistAttachment } from '@/lib/attachments';
import { runFileImport } from '@/lib/fileImports';
import { prepareFigureUpload } from '@/lib/prepareFigureUpload';
import { inspectRasterImage } from '@/services/docx/imageAssets';
import { figureExtension } from '@/lib/figures';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Reuse native retained image assets and activation-bound import ownership. */
export function VolumeFigureEditor({ paragraph, index, label }: { paragraph: Paragraph; index: number; label: string }) {
  const id = useId();
  const [error, setError] = useState('');
  return <div className="space-y-3 text-sm">
    <div className="space-y-2"><Label htmlFor={id}>{paragraph.figure?.fileRef ? `Replace image for ${label}` : `Image for ${label}`}</Label>
      <input id={id} type="file" accept="image/png,image/jpeg" className="block min-h-11 max-w-full rounded-md border p-2 text-sm" onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const original = useDocumentStore.getState().paragraphs[index];
        if (!original?.figure) return;
        const task = beginDocumentTask(`volume-figure:${original.id}`);
        const currentIndex = () => useDocumentStore.getState().paragraphs.findIndex(block => block.id === original.id && block.figure && block.figure.fileRef === original.figure?.fileRef);
        const owns = () => isCurrentDocumentTask(task) && currentIndex() >= 0;
        setError('');
        void runFileImport(async () => {
          try {
            await withAttachmentStaging(async () => {
              if (!owns()) return;
              if (file.size > 10 * 1024 * 1024) throw new Error('Volume images must be smaller than 10 MB.');
              const extension = figureExtension(file.type, file.name);
              if (extension === 'pdf') throw new Error('Choose a PNG or JPEG image. Attach PDF pages as enclosures instead.');
              await inspectRasterImage(new Uint8Array(await file.arrayBuffer()), extension === 'jpg' ? 'image/jpeg' : 'image/png');
              if (!owns()) return;
              const { bytes, type, width, height } = await prepareFigureUpload(file);
              if (!owns()) return;
              const fileRef = await persistAttachment({ name: file.name, size: bytes.byteLength, type }, bytes);
              const target = currentIndex();
              if (!isCurrentDocumentTask(task) || target < 0) return;
              useDocumentStore.getState().updateParagraph(target, { figure: { ...useDocumentStore.getState().paragraphs[target].figure, fileRef, name: file.name, type, width, height, placement: 'body' } });
            });
          } catch (failure) {
            if (owns()) setError(failure instanceof Error ? failure.message : 'Cannot read this volume image.');
          }
        });
      }} />
    </div>
    {paragraph.figure?.name && <p className="break-all text-xs text-muted-foreground">Retained image: {paragraph.figure.name}</p>}
    <div className="space-y-2"><Label htmlFor={`${id}-alt`}>Alternative text for {label}</Label><Input id={`${id}-alt`} value={paragraph.figure?.altText ?? ''} maxLength={2_000} onChange={event => useDocumentStore.getState().updateParagraph(index, { figure: { ...paragraph.figure, altText: event.target.value } })} /></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
