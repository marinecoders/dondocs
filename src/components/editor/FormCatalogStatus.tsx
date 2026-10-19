import { useFormCatalogStatus } from '@/services/formRegistry';
import { Button } from '@/components/ui/button';

/** Built-ins remain usable even when the published catalog cannot be reached. */
export function FormCatalogStatus() {
  const { status, retry } = useFormCatalogStatus();
  if (status === 'idle' || status === 'loading') return <p role="status" className="px-3 py-2 text-xs text-muted-foreground">Loading published forms…</p>;
  if (status !== 'error') return null;
  return <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
    <p className="flex-1">The published form library could not load. Built-in forms remain available.</p>
    <Button size="sm" variant="outline" onClick={retry}>Retry library</Button>
  </div>;
}
