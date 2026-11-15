import { useId } from 'react';
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

/** One existing retained image, explicitly placed in a Word signing layout. */
export function WordSignatureImage({ dual = false }: { dual?: boolean }) {
  const id = useId();
  const image = useDocumentStore(state => state.formData.signatureImage);
  const signatureType = useDocumentStore(state => state.formData.signatureType);
  const signer = useDocumentStore(state => state.formData.signatureImageSigner);

  async function upload(file: File): Promise<void> {
    await runFileImport(async () => {
      if (!isImageFile(file)) {
        showAppAlert({ title: 'Image files only', message: rejectedFilesMessage([file], 'image') });
        return;
      }
      if (file.size > FILE_LIMITS.MAX_SIGNATURE_SIZE_MB * 1024 * 1024) {
        showAppAlert({ title: 'Image too large', message: `Choose an image smaller than ${FILE_LIMITS.MAX_SIGNATURE_SIZE_MB} MB.` });
        return;
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
        if (!ownsImage()) return;
        await withAttachmentStaging(async () => {
          const saved = await persistSignature({ name: file.name, size: file.size, data });
          if (ownsImage()) useDocumentStore.getState().setFormData({ signatureImage: saved, signatureType: 'image' });
        });
      } catch (error) {
        if (ownsImage()) showAppAlert({ title: 'Signature could not be saved', message: error instanceof Error ? error.message : 'Check browser storage and retry.' });
      } finally {
        stopObservingLayout();
      }
    });
  }

  return <section aria-label="Word signature image" className="space-y-3 rounded-md border p-3">
    <p className="text-sm font-medium">Uploaded Word signature</p>
    <p className="text-sm text-muted-foreground">
      This uploaded image is placed in Word output only. PDF output does not include it. One image can be attached to this document.
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
