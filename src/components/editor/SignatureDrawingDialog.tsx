import { useEffect, useId, useRef, useState } from 'react';
import { Undo2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { hasSignatureDrawing, renderSignatureDrawing, signaturePoint, SIGNATURE_DRAWING, type SignaturePoint } from '@/lib/signatureDrawing';

interface SignatureDrawingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUse: (file: File) => Promise<void> | void;
}
const KEY_DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8],
};

export function SignatureDrawingDialog({ open, ...props }: SignatureDrawingDialogProps) {
  return open ? <SignatureDrawingSession {...props} /> : null;
}

function SignatureDrawingSession({ onOpenChange, onUse }: Omit<SignatureDrawingDialogProps, 'open'>) {
  const instructions = useId();
  const [strokes, setStrokes] = useState<SignaturePoint[][]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<SignaturePoint>({ x: 400, y: 200 });
  const [keyboardDrawing, setKeyboardDrawing] = useState(false);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const pointer = useRef<number | null>(null);
  const points = useRef(0);
  const request = useRef(0);
  const mounted = useRef(false);
  const drawing = useRef<SignaturePoint[][]>([]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function start(point: SignaturePoint): boolean {
    if (busy || drawing.current.length >= SIGNATURE_DRAWING.maxStrokes || points.current >= SIGNATURE_DRAWING.maxPoints) {
      if (!busy) setError('The drawing is full. Undo a stroke or clear it to try again.');
      return false;
    }
    points.current++;
    const next = [...drawing.current, [point]];
    drawing.current = next; setStrokes(next); setError('');
    return true;
  }
  function append(point: SignaturePoint) {
    const current = drawing.current;
    const stroke = current.at(-1);
    if (!stroke?.length || busy) return;
    const previous = stroke.at(-1)!;
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1) return;
    if (points.current >= SIGNATURE_DRAWING.maxPoints) { setError('The drawing is full. Undo a stroke or clear it to try again.'); return; }
    points.current++;
    const next = [...current.slice(0, -1), [...stroke, point]];
    drawing.current = next; setStrokes(next);
  }
  function finish() { pointer.current = null; setKeyboardDrawing(false); }
  function undo() {
    finish();
    const next = drawing.current.slice(0, -1);
    points.current = next.reduce((sum, stroke) => sum + stroke.length, 0);
    drawing.current = next; setStrokes(next); setError('');
  }
  async function saveDrawing() {
    if (busy || pointer.current !== null || keyboardDrawing) return;
    const ticket = ++request.current;
    setBusy(true); setError('');
    try {
      const file = await renderSignatureDrawing(drawing.current);
      if (!mounted.current || request.current !== ticket) return;
      await onUse(file);
      if (mounted.current && request.current === ticket) onOpenChange(false);
    } catch (cause) {
      if (mounted.current && request.current === ticket) setError(cause instanceof Error ? cause.message : 'The signature could not be saved. Try again.');
    } finally {
      if (mounted.current && request.current === ticket) setBusy(false);
    }
  }
  return <Dialog open onOpenChange={value => { request.current++; onOpenChange(value); }}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Draw signature</DialogTitle>
        <DialogDescription>Use your finger, stylus or mouse. This adds a signature image; it does not create a certificate signature.</DialogDescription>
      </DialogHeader>
      <p id={instructions} className="text-xs text-muted-foreground">Keyboard: use arrow keys to move the pen. Press Space to start or finish a stroke.</p>
      <svg viewBox="0 0 800 400" preserveAspectRatio="none" role="application" tabIndex={0} aria-label="Signature drawing area" aria-describedby={instructions}
        aria-disabled={busy} className="aspect-[2/1] w-full touch-none rounded-md border border-border bg-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={event => {
          if (busy || pointer.current !== null || event.button !== 0) return;
          event.preventDefault(); setKeyboardDrawing(false); setKeyboardFocused(false);
          if (start(signaturePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()))) {
            pointer.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerMove={event => { if (pointer.current === event.pointerId) append(signaturePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())); }}
        onPointerUp={event => {
          if (pointer.current !== event.pointerId) return;
          // Release can carry a newer position than the last delivered move.
          append(signaturePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()));
          finish();
        }}
        onPointerCancel={event => { if (pointer.current === event.pointerId) finish(); }}
        onLostPointerCapture={event => { if (pointer.current === event.pointerId) finish(); }}
        onFocus={() => setKeyboardFocused(true)}
        onBlur={() => { setKeyboardFocused(false); if (keyboardDrawing) finish(); }}
        onKeyDown={event => {
          if (busy || pointer.current !== null) return;
          if (event.key === ' ') {
            setKeyboardFocused(true);
            event.preventDefault();
            if (event.repeat) return;
            if (keyboardDrawing) finish(); else if (start(cursor)) setKeyboardDrawing(true);
            return;
          }
          const delta = KEY_DIRECTIONS[event.key];
          if (!delta) return;
          setKeyboardFocused(true); event.preventDefault();
          const next = { x: Math.max(0, Math.min(800, cursor.x + delta[0])), y: Math.max(0, Math.min(400, cursor.y + delta[1])) };
          setCursor(next); if (keyboardDrawing) append(next);
        }}>
        {strokes.map((stroke, index) => stroke.length === 1
          ? <circle key={index} cx={stroke[0].x} cy={stroke[0].y} r={SIGNATURE_DRAWING.lineWidth / 2} fill="#000" />
          : <polyline key={index} points={stroke.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={SIGNATURE_DRAWING.lineWidth} strokeLinecap="round" strokeLinejoin="round" />)}
        {keyboardFocused && <circle cx={cursor.x} cy={cursor.y} r="9" fill={keyboardDrawing ? '#2563eb' : 'none'} stroke="#2563eb" strokeWidth="3" />}
      </svg>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy || !strokes.length} onClick={undo}><Undo2 className="mr-1.5 size-4" />Undo stroke</Button>
        <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy || !strokes.length} onClick={() => { finish(); points.current = 0; drawing.current = []; setStrokes([]); setError(''); }}><Trash2 className="mr-1.5 size-4" />Clear drawing</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => { request.current++; onOpenChange(false); }}>Cancel</Button>
        <Button type="button" className="min-h-11" disabled={busy || keyboardDrawing || !hasSignatureDrawing(strokes)} onClick={() => void saveDrawing()}>{busy ? 'Saving signature…' : 'Use signature'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
