import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SignatureDrawingDialog } from '@/components/editor/SignatureDrawingDialog';
import { readSignatureGraphic } from '@/lib/signatureGraphic';

interface Props {
  value?: string;
  onChange(value: string | undefined): void;
  onBusyChange?(busy: boolean): void;
}

export function SignatureGraphicPicker({ value, onChange, onBusyChange }: Props) {
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);

  async function readFile(file: File) {
    const ticket = ++generation.current;
    setBusy(true); onBusyChange?.(true); setError('');
    try {
      const graphic = await readSignatureGraphic(file);
      if (ticket === generation.current) onChange(graphic);
    } catch (cause) {
      if (ticket === generation.current) throw cause;
    } finally {
      if (ticket === generation.current) { setBusy(false); onBusyChange?.(false); }
    }
  }

  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setDrawing(true)}>Draw</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>Upload PNG</Button>
      {value && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { onChange(undefined); setError(''); }}>Clear image</Button>}
      <input hidden ref={fileInput} type="file" accept="image/png,.png" aria-label="Signature PNG" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file) void readFile(file).catch(cause => {
          setError(cause instanceof Error ? cause.message : 'The signature image could not be read.');
        });
      }} />
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {drawing && <SignatureDrawingDialog open onOpenChange={open => {
      if (!open) {
        generation.current++;
        if (busy) { setBusy(false); onBusyChange?.(false); }
      }
      setDrawing(open);
    }} onUse={readFile} />}
  </div>;
}
