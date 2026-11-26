import { Button } from './ui/button';

export type PackageEditorSavePhase = 'opening' | 'saved' | 'pending' | 'saving' | 'error';
const statusLabels: Record<PackageEditorSavePhase, string> = {
  opening: 'Opening form…', saved: 'Saved to package', pending: 'Unsaved changes', saving: 'Saving…', error: 'Save needs attention',
};

export function PackageEditorSaveControls({ phase, disabled, unavailable, onSave }: {
  phase: PackageEditorSavePhase; disabled: boolean; unavailable?: boolean; onSave(): void;
}) {
  return <>
    <span className="ml-auto text-sm text-muted-foreground" role="status">{statusLabels[phase]}</span>
    {!unavailable && <Button size="sm" disabled={disabled || (phase !== 'pending' && phase !== 'error')} onClick={onSave}>
      {phase === 'error' ? 'Retry save' : 'Save changes'}
    </Button>}
  </>;
}
