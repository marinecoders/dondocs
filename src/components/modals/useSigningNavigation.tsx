import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { signingErrorMessage } from '@/lib/signingWorkspace';

type Transition = () => void;
interface SigningNavigation {
  navigate: (next: Transition) => void;
  registerSave: (save: () => Promise<void>) => () => void;
}

export const SigningNavigationContext = createContext<SigningNavigation | null>(null);

export function useSigningNavigation() {
  const navigation = useContext(SigningNavigationContext);
  if (!navigation) throw new Error('Signing navigation requires a workspace.');
  return navigation;
}

export function useSigningLeavePrompt() {
  const savePlacement = useRef<(() => Promise<void>) | null>(null);
  const [pending, setPending] = useState<Transition | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const navigate = useCallback((next: Transition) => {
    if (!savePlacement.current) { next(); return; }
    setError('');
    setPending(() => next);
  }, []);
  const registerSave = useCallback((save: () => Promise<void>) => {
    savePlacement.current = save;
    return () => { if (savePlacement.current === save) savePlacement.current = null; };
  }, []);
  const dismiss = () => { if (!savingRef.current) setPending(null); };
  const saveAndLeave = async () => {
    if (!pending || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await savePlacement.current?.();
    } catch (cause) {
      setError(signingErrorMessage(cause));
      return;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    setPending(null);
    pending();
  };
  const prompt = <AlertDialog open={!!pending} onOpenChange={open => { if (!open) dismiss(); }}>
    <AlertDialogContent>
      <AlertDialogTitle>Save signature placement changes?</AlertDialogTitle>
      <AlertDialogDescription>Your signer and box changes are still open in this document.</AlertDialogDescription>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={saving}>Keep editing</AlertDialogCancel>
        <Button variant="outline" disabled={saving} onClick={() => { setPending(null); pending?.(); }}>Discard</Button>
        <Button disabled={saving} onClick={() => void saveAndLeave()}>Save changes</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
  return { navigate, registerSave, prompt };
}
