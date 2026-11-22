import { useId, useMemo } from 'react';
import { useDocumentStore } from '@/stores/documentStore';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FILE_LIMITS } from '@/lib/constants';
import { isImageFile, rejectedFilesMessage } from '@/lib/fileFilter';
import { loadSignatureAsPngBase64 } from '@/lib/signatureImage';
import { persistSignature } from '@/lib/signatureAssets';
import { withAttachmentStaging } from '@/lib/attachments';
import { beginDocumentTask, isCurrentDocumentTask } from '@/lib/documentTask';
import { runFileImport } from '@/lib/fileImports';
import { showAppAlert } from '@/stores/alertStore';
import { DrawSignatureButton } from './DrawSignatureButton';

/** One existing retained image, explicitly placed in a Word signing layout. */
export function WordSignatureImage({ dual = false }: { dual?: boolean }) {
  const id = useId();
  const image = useDocumentStore(state => state.formData.signatureImage);
  const signatureType = useDocumentStore(state => state.formData.signatureType);
  const signer = useDocumentStore(state => state.formData.signatureImageSigner);
  const docType = useDocumentStore(state => state.docType);
  const drawingOwner = useMemo(() => ({ image, signatureType, signer, docType }), [image, signatureType, signer, docType]);

  async function upload(file: File): Promise<boolean> {
    return runFileImport(async () => {
      if (!isImageFile(file)) {
        showAppAlert({ title: 'Image files only', message: rejectedFilesMessage([file], 'image') });
        return false;
      }
      if (file.size > FILE_LIMITS.MAX_SIGNATURE_SIZE_MB * 1024 * 1024) {
        showAppAlert({ title: 'Image too large', message: `Choose an image smaller than ${FILE_LIMITS.MAX_SIGNATURE_SIZE_MB} MB.` });
        return false;
      }
      const originalDocumentType = useDocumentStore.getState().docType;
      const original = useDocumentStore.getState().formData;
      const task = beginDocumentTask('signature-image');
      let layoutChanged = false;
      const stopObservingLayout = useDocumentStore.subscribe((current, previous) => {
        if (current.docType !== previous.docType) layoutChanged = true;
      });
      const ownsImage = () => {
        const current = useDocumentStore.getState().formData;
        return !layoutChanged && isCurrentDocumentTask(task)
          && useDocumentStore.getState().docType === originalDocumentType
          && current.signatureImage === original.signatureImage
          && current.signatureType === original.signatureType
          && current.signatureImageSigner === original.signatureImageSigner;
      };
      try {
        const data = await loadSignatureAsPngBase64(file);
        if (!ownsImage()) return false;
        return await withAttachmentStaging(async () => {
          const saved = await persistSignature({ name: file.name, size: file.size, data });
          if (!ownsImage()) return false;
          useDocumentStore.getState().setFormData({ signatureImage: saved, signatureType: 'image' });
          return true;
        });
      } catch (error) {
        if (ownsImage()) showAppAlert({ title: 'Signature could not be saved', message: error instanceof Error ? error.message : 'Check browser storage and retry.' });
        return false;
      } finally {
        stopObservingLayout();
      }
    });
  }

  return <section aria-label="Word signature image" className="space-y-3 rounded-md border p-3">
    <p className="text-sm font-medium">Word signature image</p>
    <p className="text-sm text-muted-foreground">
      This signature image is placed in Word output only. PDF output does not include it. One image can be attached to this document.
    </p>
    {dual && <div className="space-y-2">
      <Label htmlFor={`${id}-signer`}>Signature image signer</Label>
      <select id={`${id}-signer`} className="w-full rounded-md border bg-background p-2 text-sm"
        value={signer ?? ''}
        onChange={event => {
          const value = event.target.value;
          if (value !== 'junior' && value !== 'senior') return;
          beginDocumentTask('signature-image');
          useDocumentStore.getState().setField('signatureImageSigner', value);
        }}>
        <option value="" disabled>Choose the signer</option>
        <option value="junior">Junior signer (left)</option>
        <option value="senior">Senior signer (right)</option>
      </select>
      <p className="text-xs text-muted-foreground">The other signer stays unsigned. The image is never copied to both blocks.</p>
    </div>}
    <div className="space-y-2">
      <DrawSignatureButton owner={drawingOwner} resource="signature-image" disabled={dual && !signer} onFile={upload}
        isCurrent={() => {
          const current = useDocumentStore.getState();
          return current.docType === drawingOwner.docType && current.formData.signatureImage === drawingOwner.image
            && current.formData.signatureType === drawingOwner.signatureType && current.formData.signatureImageSigner === drawingOwner.signer;
        }} />
      <Label htmlFor={`${id}-image`}>Upload Word signature image</Label>
      <input id={`${id}-image`} type="file" accept="image/*" className="block w-full text-sm"
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void upload(file);
        }} />
    </div>
    {image && <div className="space-y-2">
      <p className="break-all text-sm">{image.name} · {signatureType === 'image' ? 'Included in Word' : 'Retained, currently inactive'}</p>
      {signatureType !== 'image' && <Button type="button" variant="outline" onClick={() => {
        beginDocumentTask('signature-image');
        useDocumentStore.getState().setField('signatureType', 'image');
      }}>Use attached Word signature</Button>}
      <Button type="button" variant="outline" onClick={() => {
        beginDocumentTask('signature-image');
        useDocumentStore.getState().setFormData({ signatureImage: undefined,
          ...(signatureType === 'image' ? { signatureType: 'none' } : {}) });
      }}>Remove Word signature image</Button>
    </div>}
  </section>;
}
