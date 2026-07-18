import { useCallback, useRef } from 'react';
import { Type, PenLine, Shield, X } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { loadSignatureAsPngBase64 } from '@/lib/signatureImage';
import { FILE_LIMITS } from '@/lib/constants';
import { showAppAlert } from '@/stores/alertStore';
import { isImageFile, rejectedFilesMessage } from '@/lib/fileFilter';
import type { FormSignatureBlock, SignatureStyle } from '@/types/signature';

/**
 * Per-signer style control shared by both NAVMC forms: choose how one signature
 * block signs — Typed (name only), Image (a scanned signature drawn in the gap),
 * or Digital (an empty CAC field signed later in Acrobat) — and, for Image,
 * upload the scan. Mirrors the naval letter's three-way choice so all three
 * document surfaces feel the same.
 */
export function SignatureStylePicker({
  block,
  index,
  onChange,
}: {
  block: FormSignatureBlock;
  index: number;
  onChange: (patch: Partial<FormSignatureBlock>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const style: SignatureStyle = block.style ?? 'typed';

  const handleUpload = useCallback(
    async (file: File) => {
      if (!isImageFile(file)) {
        showAppAlert({ title: 'Image files only', message: rejectedFilesMessage([file], 'image') });
        return;
      }
      // Stored base64 in the persisted form state — cap the size like the letter.
      if (file.size > FILE_LIMITS.MAX_SIGNATURE_SIZE_MB * 1024 * 1024) {
        showAppAlert({
          title: 'Image too large',
          message: `That signature image is too large (max ${FILE_LIMITS.MAX_SIGNATURE_SIZE_MB} MB). Please use a smaller file.`,
        });
        return;
      }
      try {
        const image = await loadSignatureAsPngBase64(file);
        onChange({ style: 'image', image });
      } catch (err) {
        showAppAlert({
          title: "Couldn't read that image",
          message: err instanceof Error ? err.message : 'Please try a different file.',
        });
      }
    },
    [onChange]
  );

  return (
    <div className="space-y-2">
      <Tabs value={style} onValueChange={(v) => onChange({ style: v as SignatureStyle })}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="typed" aria-label={`Signature block ${index + 1}: typed name only`}>
            <Type className="mr-1.5 h-3.5 w-3.5" /> Typed
          </TabsTrigger>
          <TabsTrigger value="image" aria-label={`Signature block ${index + 1}: upload a scanned signature`}>
            <PenLine className="mr-1.5 h-3.5 w-3.5" /> Image
          </TabsTrigger>
          <TabsTrigger value="digital" aria-label={`Signature block ${index + 1}: add a digital CAC signature field`}>
            <Shield className="mr-1.5 h-3.5 w-3.5" /> Digital
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {style === 'image' && (
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
              e.target.value = '';
            }}
          />
          {block.image ? (
            <>
              <img
                src={`data:image/png;base64,${block.image}`}
                alt="Signature preview"
                className="h-8 max-w-[9rem] rounded border border-border bg-white object-contain p-0.5"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                Replace
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove signature image"
                onClick={() => onChange({ image: undefined })}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <PenLine className="mr-1.5 h-3.5 w-3.5" /> Upload signature…
            </Button>
          )}
        </div>
      )}

      {style === 'digital' && (
        <p className="text-xs text-muted-foreground">
          An empty CAC-signable field is placed in the signing space. Sign it in
          Adobe Acrobat — a browser can&apos;t reach a CAC&apos;s private key.
        </p>
      )}
    </div>
  );
}
